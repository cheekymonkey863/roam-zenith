import { useState, useCallback } from "react";
import type { Json } from "@/integrations/supabase/types";
import { Upload, MapPin, Calendar, Check, Image as ImageIcon, Loader2, Pencil, X, Play, Merge } from "lucide-react";
import {
  extractExifFromFiles,
  geocodeLocationName,
  groupMediaByTime,
  groupPhotosByLocation,
  reverseGeocode,
  type PhotoExifData,
} from "@/lib/exif";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "sonner";

interface SuggestedStep {
  key: string;
  locationName: string;
  country: string;
  latitude: number;
  longitude: number;
  photos: PhotoExifData[];
  earliestDate: Date | null;
  selected: boolean;
  confidence: "high" | "medium" | "low";
  summary: string;
  description: string;
}

interface MediaCaptionResult {
  captionId: string;
  caption: string;
}

interface HybridLocationResult {
  key: string;
  locationName: string;
  country: string;
  latitude: number | null;
  longitude: number | null;
  confidence: SuggestedStep["confidence"];
  summary: string;
  eventDescription?: string;
  photoCaptions?: MediaCaptionResult[];
}

interface PhotoImportProps {
  tripId: string;
  onImportComplete: () => void;
  onCancel?: () => void;
  existingSteps?: Array<{ id: string; latitude: number; longitude: number; location_name: string | null }>;
}

const LOCATION_GROUP_RADIUS_METERS = 500;
const LOCATION_GROUP_MAX_GAP_HOURS = 6;
const EXISTING_STEP_MATCH_RADIUS_METERS = 500;
const UNGROUPED_MEDIA_MATCH_WINDOW_MS = LOCATION_GROUP_MAX_GAP_HOURS * 60 * 60 * 1000;

const CONFIDENCE_RANK: Record<SuggestedStep["confidence"], number> = {
  low: 0,
  medium: 1,
  high: 2,
};

function sortMediaByCapturedTime<T extends PhotoExifData>(media: T[]) {
  return [...media].sort(
    (a, b) => (a.takenAt?.getTime() ?? a.file.lastModified ?? 0) - (b.takenAt?.getTime() ?? b.file.lastModified ?? 0)
  );
}

function isKnownLocationName(value: string) {
  const normalized = value.trim().toLowerCase();
  return normalized.length > 0 && normalized !== "unknown" && normalized !== "unknown location";
}

function buildLocationSummary(locationName: string, country: string) {
  if (!isKnownLocationName(locationName)) {
    return "Grouped nearby media from the same travel stop.";
  }

  return country && country !== "Unknown"
    ? `Grouped media around ${locationName}, ${country}.`
    : `Grouped media around ${locationName}.`;
}

function buildEventDescription(locationName: string, country: string) {
  if (!isKnownLocationName(locationName)) {
    return "Travel event created from nearby media captured in the same time range.";
  }

  return country && country !== "Unknown"
    ? `Travel event around ${locationName}, ${country}.`
    : `Travel event around ${locationName}.`;
}

function buildMediaCaption(photo: PhotoExifData, locationName: string) {
  const mediaLabel = photo.file.type.startsWith("video/") ? "Video" : "Image";
  if (!isKnownLocationName(locationName)) {
    return `${mediaLabel} from this travel stop`;
  }

  return `${mediaLabel} showing ${locationName}`;
}

function applyMediaCaptions(
  photos: PhotoExifData[],
  photoCaptions: MediaCaptionResult[] | undefined,
  locationName: string
): PhotoExifData[] {
  const captionMap = new Map(
    (photoCaptions ?? [])
      .filter((item) => item.captionId.trim().length > 0 && item.caption.trim().length > 0)
      .map((item) => [item.captionId, item.caption.trim()])
  );

  return sortMediaByCapturedTime(photos).map((photo) => ({
    ...photo,
    caption: captionMap.get(photo.captionId) ?? photo.caption ?? buildMediaCaption(photo, locationName),
  }));
}

function pickHigherConfidence(
  left: SuggestedStep["confidence"],
  right: SuggestedStep["confidence"]
): SuggestedStep["confidence"] {
  return CONFIDENCE_RANK[left] >= CONFIDENCE_RANK[right] ? left : right;
}

function getRepresentativeCoordinates(photos: PhotoExifData[]) {
  const latitudes = photos.map((p) => p.latitude).filter((v): v is number => v !== null).sort((a, b) => a - b);
  const longitudes = photos.map((p) => p.longitude).filter((v): v is number => v !== null).sort((a, b) => a - b);
  const mid = Math.floor(latitudes.length / 2);
  return { latitude: latitudes[mid], longitude: longitudes[mid] };
}

function isSameCalendarDay(a: Date, b: Date) {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

function getClosestTimeDistanceMs(step: SuggestedStep, targetDate: Date) {
  const distances = step.photos
    .map((photo) => (photo.takenAt ? Math.abs(photo.takenAt.getTime() - targetDate.getTime()) : null))
    .filter((value): value is number => value !== null);

  return distances.length > 0 ? Math.min(...distances) : Number.POSITIVE_INFINITY;
}

function findStepForUngroupedMedia(media: PhotoExifData, steps: SuggestedStep[]) {
  if (!media.takenAt) return null;

  const candidates = steps
    .filter((step) => step.photos.some((photo) => photo.takenAt && isSameCalendarDay(photo.takenAt, media.takenAt!)))
    .map((step) => ({ step, diffMs: getClosestTimeDistanceMs(step, media.takenAt!) }))
    .sort((a, b) => a.diffMs - b.diffMs);

  if (candidates.length === 0) return null;
  if (
    candidates[0].diffMs <= UNGROUPED_MEDIA_MATCH_WINDOW_MS &&
    (candidates.length === 1 || candidates[0].diffMs <= candidates[1].diffMs / 2)
  ) {
    return candidates[0].step;
  }

  return null;
}

function prepareMediaForInference(photos: PhotoExifData[]) {
  const sorted = sortMediaByCapturedTime(photos);
  let remainingImages = 4;

  return sorted.map((photo) => {
    const includeImage = remainingImages > 0 && Boolean(photo.analysisImage);
    if (includeImage) remainingImages -= 1;

    return {
      captionId: photo.captionId,
      fileName: photo.file.name,
      takenAt: photo.takenAt?.toISOString() ?? null,
      analysisImage: includeImage ? photo.analysisImage ?? null : null,
    };
  });
}

async function inferLocationsWithVision(
  steps: SuggestedStep[],
  noGpsGroups: Array<{ key: string; photos: PhotoExifData[] }> = []
): Promise<Map<string, HybridLocationResult>> {
  const preparedNoGpsGroups = noGpsGroups
    .map((group) => ({
      key: group.key,
      exifLocation: null,
      photos: prepareMediaForInference(group.photos),
    }))
    .filter((group) => group.photos.some((photo) => Boolean(photo.analysisImage)));

  const gpsGroups = steps
    .map((step) => ({
      key: step.key,
      exifLocation: { latitude: step.latitude, longitude: step.longitude, name: step.locationName, country: step.country },
      photos: prepareMediaForInference(step.photos),
    }))
    .filter((group) => group.photos.length > 0);

  const allGroups = [...preparedNoGpsGroups, ...gpsGroups];
  if (allGroups.length === 0) return new Map();

  const batches = Array.from({ length: Math.ceil(allGroups.length / 12) }, (_, index) =>
    allGroups.slice(index * 12, index * 12 + 12)
  );

  const batchResults = await Promise.all(
    batches.map(async (batch) => {
      const { data, error } = await supabase.functions.invoke("photo-location-inference", { body: { groups: batch } });
      if (error) {
        console.error("Visual location inference batch error:", error);
        return [];
      }

      return Array.isArray(data?.results) ? data.results : [];
    })
  );

  const results = batchResults.flat();
  return new Map(
    results
      .filter((result: any): result is HybridLocationResult => typeof result?.key === "string")
      .map((result: HybridLocationResult) => [result.key, result])
  );
}

export function PhotoImport({ tripId, onImportComplete, onCancel, existingSteps = [] }: PhotoImportProps) {
  const { user } = useAuth();
  const [dragOver, setDragOver] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [importing, setImporting] = useState(false);
  const [suggestions, setSuggestions] = useState<SuggestedStep[]>([]);
  const [noGpsPhotos, setNoGpsPhotos] = useState<PhotoExifData[]>([]);
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [dragSourceKey, setDragSourceKey] = useState<string | null>(null);
  const [dragOverKey, setDragOverKey] = useState<string | null>(null);

  const processFiles = useCallback(async (files: File[]) => {
    setProcessing(true);
    setSuggestions([]);
    setNoGpsPhotos([]);

    const mediaFiles = files.filter((f) => f.type.startsWith("image/") || f.type.startsWith("video/"));
    if (mediaFiles.length === 0) {
      toast.error("No image or video files found");
      setProcessing(false);
      return;
    }

    toast.info(`Processing ${mediaFiles.length} file(s) with metadata + visual recognition...");

    try {
      const exifResults = await extractExifFromFiles(mediaFiles);
      const groups = groupPhotosByLocation(exifResults, LOCATION_GROUP_RADIUS_METERS, LOCATION_GROUP_MAX_GAP_HOURS);

      const baseSteps: SuggestedStep[] = await Promise.all(
        Array.from(groups.entries()).map(async ([key, photos]): Promise<SuggestedStep> => {
          const sortedPhotos = sortMediaByCapturedTime(photos);
          const { latitude, longitude } = getRepresentativeCoordinates(sortedPhotos);
          const geo = await reverseGeocode(latitude, longitude);
          const dates = sortedPhotos.map((p) => p.takenAt).filter(Boolean) as Date[];
          const earliestDate = dates.length > 0 ? new Date(Math.min(...dates.map((d) => d.getTime()))) : null;

          return {
            key,
            locationName: geo.name,
            country: geo.country,
            latitude,
            longitude,
            photos: applyMediaCaptions(sortedPhotos, undefined, geo.name),
            earliestDate,
            selected: true,
            confidence: "low" as const,
            summary: buildLocationSummary(geo.name, geo.country),
            description: buildEventDescription(geo.name, geo.country),
          };
        })
      );

      const ungroupedNoGps = exifResults.filter((photo) => photo.latitude === null || photo.longitude === null);
      const unresolvedNoGpsMedia: PhotoExifData[] = [];

      for (const media of ungroupedNoGps) {
        const matchedStep = findStepForUngroupedMedia(media, baseSteps);
        if (matchedStep) {
          matchedStep.photos.push(media);
          if (media.takenAt && (!matchedStep.earliestDate || media.takenAt < matchedStep.earliestDate)) {
            matchedStep.earliestDate = media.takenAt;
          }
          continue;
        }

        unresolvedNoGpsMedia.push(media);
      }

      const noGpsGroups = Array.from(groupMediaByTime(unresolvedNoGpsMedia, 6).values()).map((photos, index) => ({
        key: `no-gps-${index}`,
        photos,
      }));

      setNoGpsPhotos(unresolvedNoGpsMedia);

      let inferredLocations = new Map<string, HybridLocationResult>();
      try {
        inferredLocations = await inferLocationsWithVision(baseSteps, noGpsGroups);
      } catch (e) {
        console.error("Visual location inference error:", e);
        toast.warning("Visual recognition was unavailable, so only GPS-matched media was grouped.");
      }

      const steps: SuggestedStep[] = baseSteps.map((step): SuggestedStep => {
        const inferred = inferredLocations.get(step.key);
        const locationName = isKnownLocationName(step.locationName)
          ? step.locationName
          : inferred?.locationName || step.locationName;
        const country = step.country && step.country !== "Unknown"
          ? step.country
          : inferred?.country || step.country;

        return {
          ...step,
          locationName,
          country,
          photos: applyMediaCaptions(step.photos, inferred?.photoCaptions, locationName),
          confidence: inferred?.confidence ? pickHigherConfidence(step.confidence, inferred.confidence) : step.confidence,
          summary: inferred?.summary || buildLocationSummary(locationName, country),
          description: inferred?.eventDescription || buildEventDescription(locationName, country),
        };
      });


      const inferredNoGpsSteps = (
        await Promise.all(
          noGpsGroups.map(async (group): Promise<SuggestedStep | null> => {
            const inferred = inferredLocations.get(group.key);
            if (!inferred) return null;

            let latitude = inferred.latitude;
            let longitude = inferred.longitude;

            if ((latitude === null || longitude === null) && inferred.locationName) {
              const geocoded = await geocodeLocationName(inferred.locationName, inferred.country);
              latitude = geocoded?.latitude ?? null;
              longitude = geocoded?.longitude ?? null;
            }

            if (latitude === null || longitude === null) return null;

            const locationName = inferred.locationName || "Visually Identified Location";
            const country = inferred.country || "Unknown";
            const photos = applyMediaCaptions(group.photos, inferred.photoCaptions, locationName);
            const dates = photos.map((photo) => photo.takenAt).filter(Boolean) as Date[];
            const earliestDate = dates.length > 0 ? new Date(Math.min(...dates.map((date) => date.getTime()))) : null;

            return {
              key: group.key,
              locationName,
              country,
              latitude,
              longitude,
              photos,
              earliestDate,
              selected: true,
              confidence: inferred.confidence,
              summary: inferred.summary || buildLocationSummary(locationName, country),
              description: inferred.eventDescription || buildEventDescription(locationName, country),
            };
          })
        )
      ).filter((step): step is SuggestedStep => step !== null);

      steps.push(...inferredNoGpsSteps);
      steps.sort((a, b) => (a.earliestDate?.getTime() ?? Infinity) - (b.earliestDate?.getTime() ?? Infinity));
      setSuggestions(steps);

      const resolvedNoGpsKeys = new Set(inferredNoGpsSteps.map((step) => step.key));
      const resolvedNoGpsCount = noGpsGroups.reduce(
        (count, group) => count + (resolvedNoGpsKeys.has(group.key) ? group.photos.length : 0),
        0
      );
      const unresolvedCount = unresolvedNoGpsMedia.length - resolvedNoGpsCount;
      const issueParts: string[] = [];
      if (unresolvedCount > 0) issueParts.push(`${unresolvedCount} file${unresolvedCount > 1 ? "s" : ""} couldn't be located.`);

      toast.success(`Found ${steps.length} location(s)` + (issueParts.length > 0 ? `. ${issueParts.join(" ")}` : ""));
    } catch (err) {
      console.error("Photo processing error:", err);
      toast.error("Failed to process media. Please try again.");
    } finally {
      setProcessing(false);
    }
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    processFiles(Array.from(e.dataTransfer.files));
  }, [processFiles]);

  const handleFileSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    processFiles(Array.from(e.target.files || []));
  }, [processFiles]);

  const toggleStep = (key: string) => setSuggestions((prev) => prev.map((s) => (s.key === key ? { ...s, selected: !s.selected } : s)));

  const updateSuggestion = (key: string, field: keyof SuggestedStep, value: string) => {
    setSuggestions((prev) => prev.map((s) => (s.key === key ? { ...s, [field]: value } : s)));
  };

  const mergeSteps = (targetKey: string, sourceKey: string) => {
    if (targetKey === sourceKey) return;
    setSuggestions((prev) => {
      const target = prev.find((s) => s.key === targetKey);
      const source = prev.find((s) => s.key === sourceKey);
      if (!target || !source) return prev;

      const mergedLocationName = isKnownLocationName(target.locationName) ? target.locationName : source.locationName;
      const mergedCountry = target.country !== "Unknown" ? target.country : source.country;
      const allPhotos = applyMediaCaptions([...target.photos, ...source.photos], undefined, mergedLocationName);
      const allDates = allPhotos.map((p) => p.takenAt).filter(Boolean) as Date[];
      const earliestDate = allDates.length > 0 ? new Date(Math.min(...allDates.map((d) => d.getTime()))) : target.earliestDate;

      const merged: SuggestedStep = {
        ...target,
        locationName: mergedLocationName,
        country: mergedCountry,
        photos: allPhotos,
        earliestDate,
        selected: target.selected || source.selected,
        confidence: pickHigherConfidence(target.confidence, source.confidence),
        description: target.description || source.description || buildEventDescription(mergedLocationName, mergedCountry),
        summary: target.summary || source.summary || buildLocationSummary(mergedLocationName, mergedCountry),
      };

      return prev.filter((s) => s.key !== sourceKey).map((s) => (s.key === targetKey ? merged : s));
    });
  };

  const handleStepDragStart = (e: React.DragEvent, key: string) => {
    setDragSourceKey(key);
    e.dataTransfer.effectAllowed = "move";
  };

  const handleStepDragOver = (e: React.DragEvent, key: string) => {
    e.preventDefault();
    if (dragSourceKey && dragSourceKey !== key) {
      setDragOverKey(key);
    }
  };

  const handleStepDragLeave = () => {
    setDragOverKey(null);
  };

  const handleStepDrop = (e: React.DragEvent, targetKey: string) => {
    e.preventDefault();
    if (dragSourceKey && dragSourceKey !== targetKey) {
      mergeSteps(targetKey, dragSourceKey);
    }
    setDragSourceKey(null);
    setDragOverKey(null);
  };

  const handleStepDragEnd = () => {
    setDragSourceKey(null);
    setDragOverKey(null);
  };

  const findMatchingExistingStep = (lat: number, lng: number) => {
    for (const existing of existingSteps) {
      const dlat = (existing.latitude - lat) * 111320;
      const dlng = (existing.longitude - lng) * 111320 * Math.cos(lat * Math.PI / 180);
      const dist = Math.sqrt(dlat * dlat + dlng * dlng);
      if (dist < EXISTING_STEP_MATCH_RADIUS_METERS) return existing;
    }
    return null;
  };

  const importSelected = async () => {
    if (!user) return;
    setImporting(true);
    const selected = suggestions.filter((s) => s.selected);
    let newSteps = 0;
    let matchedSteps = 0;

    for (const step of selected) {
      const matchingStep = findMatchingExistingStep(step.latitude, step.longitude);
      let stepId: string;

      if (matchingStep) {
        stepId = matchingStep.id;
        matchedSteps++;
      } else {
        const { data: stepData, error: stepError } = await supabase.from("trip_steps").insert({
          trip_id: tripId,
          user_id: user.id,
          location_name: step.locationName,
          country: step.country,
          latitude: step.latitude,
          longitude: step.longitude,
          recorded_at: step.earliestDate?.toISOString() || new Date().toISOString(),
          source: "photo_import",
          event_type: "activity",
          is_confirmed: true,
          notes: null,
          description: step.description || step.summary || null,
        }).select().single();

        if (stepError || !stepData) {
          console.error("Step insert error:", stepError);
          toast.error(`Failed to create step for ${step.locationName}`);
          continue;
        }

        stepId = stepData.id;
        newSteps++;
      }

      for (const photo of step.photos) {
        const uploadFile = photo.uploadFile ?? photo.file;
        const ext = uploadFile.name.split(".").pop() || (uploadFile.type.startsWith("video/") ? "mp4" : "jpg");
        const path = `${user.id}/${tripId}/${stepId}/${crypto.randomUUID()}.${ext}`;
        const { error: uploadError } = await supabase.storage.from("trip-photos").upload(path, uploadFile, {
          contentType: uploadFile.type || undefined,
        });

        if (uploadError) {
          console.error("Photo upload error:", uploadError);
        } else {
          const exifData = {
            ...(photo.exifRaw ?? {}),
            caption: photo.caption ?? null,
            caption_id: photo.captionId,
            media_type: uploadFile.type.startsWith("video/") ? "video" : "image",
          };

          await supabase.from("step_photos").insert({
            step_id: stepId,
            user_id: user.id,
            storage_path: path,
            file_name: uploadFile.name,
            latitude: photo.latitude,
            longitude: photo.longitude,
            taken_at: photo.takenAt?.toISOString(),
            exif_data: exifData as Json,
          });
        }
      }
    }

    const parts = [];
    if (newSteps > 0) parts.push(`${newSteps} new location(s)`);
    if (matchedSteps > 0) parts.push(`${matchedSteps} matched to existing steps`);
    toast.success(`Imported: ${parts.join(", ")}!`);
    setImporting(false);
    setSuggestions([]);
    onImportComplete();
  };

  return (
    <div className="flex flex-col gap-6">
      {suggestions.length === 0 && !processing && (
        <div className="flex flex-col gap-3">
          <label
            onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            onDrop={handleDrop}
            className={`flex cursor-pointer flex-col items-center gap-4 rounded-2xl border-2 border-dashed p-12 transition-colors ${
              dragOver ? "border-primary bg-primary/5" : "border-border hover:border-primary/50"
            }`}
          >
            <Upload className="h-10 w-10 text-muted-foreground" />
            <div className="text-center">
              <p className="font-medium text-foreground">Drop photos & videos here</p>
              <p className="text-sm text-muted-foreground">We&apos;ll group media from the same day/time window within 500m and suggest travel stops</p>
            </div>
            <input type="file" multiple accept="image/*,video/*" onChange={handleFileSelect} className="hidden" />
            <span className="rounded-xl bg-primary px-4 py-2 text-sm font-medium text-primary-foreground">Browse Files</span>
          </label>
          {onCancel && (
            <button onClick={onCancel} className="self-end flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors">
              <X className="h-4 w-4" />
              Cancel
            </button>
          )}
        </div>
      )}

      {processing && (
        <div className="flex flex-col items-center gap-3 rounded-2xl bg-card p-8 shadow-card">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
          <p className="text-sm text-muted-foreground">Reading metadata and grouping your media...</p>
        </div>
      )}

      {suggestions.length > 0 && (
        <div className="flex flex-col gap-4">
          <div className="flex items-center justify-between">
            <h3 className="font-display text-lg font-semibold text-foreground">
              Detected Locations ({suggestions.filter((s) => s.selected).length}/{suggestions.length})
            </h3>
            <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <Merge className="h-3 w-3" /> Drag one event onto another to merge
            </p>
            <div className="flex items-center gap-2">
              {onCancel && (
                <button onClick={onCancel} className="flex items-center gap-1.5 rounded-xl bg-secondary px-4 py-2 text-sm font-medium text-secondary-foreground hover:bg-secondary/80 transition-colors">
                  <X className="h-4 w-4" />
                  Cancel
                </button>
              )}
              <button
                onClick={importSelected}
                disabled={importing || suggestions.filter((s) => s.selected).length === 0}
                className="flex items-center gap-2 rounded-xl bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50"
              >
                {importing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
                {importing ? "Importing..." : "Import Selected"}
              </button>
            </div>
          </div>

          {noGpsPhotos.length > 0 && (
            <p className="text-sm text-muted-foreground">
              {noGpsPhotos.length} media item{noGpsPhotos.length > 1 ? "s" : ""} had no GPS metadata.
            </p>
          )}

          <div className="flex flex-col gap-3">
            {suggestions.map((step) => {
              const isEditing = editingKey === step.key;
              const isDragSource = dragSourceKey === step.key;
              const isDragTarget = dragOverKey === step.key && dragSourceKey !== step.key;
              return (
                <div
                  key={step.key}
                  draggable
                  onDragStart={(e) => handleStepDragStart(e, step.key)}
                  onDragOver={(e) => handleStepDragOver(e, step.key)}
                  onDragLeave={handleStepDragLeave}
                  onDrop={(e) => handleStepDrop(e, step.key)}
                  onDragEnd={handleStepDragEnd}
                  className={`rounded-2xl border-2 p-4 transition-all cursor-grab active:cursor-grabbing ${
                    isDragTarget
                      ? "border-primary bg-primary/15 ring-2 ring-primary/30"
                      : isDragSource
                      ? "opacity-40 border-border"
                      : step.selected
                      ? "border-primary bg-primary/5"
                      : "border-border bg-card opacity-60"
                  }`}
                >
                  <div className="flex items-start gap-4">
                    <div
                      onClick={() => toggleStep(step.key)}
                      className={`mt-0.5 flex h-6 w-6 shrink-0 cursor-pointer items-center justify-center rounded-lg transition-colors ${step.selected ? "bg-primary" : "bg-muted"}`}
                    >
                      {step.selected && <Check className="h-3.5 w-3.5 text-primary-foreground" />}
                    </div>

                    <div className="flex flex-1 flex-col gap-2">
                      {isEditing ? (
                        <div className="flex flex-col gap-3">
                          <div className="flex flex-col gap-1">
                            <label className="text-xs font-medium text-muted-foreground">Activity Name</label>
                            <input
                              type="text"
                              value={step.locationName}
                              onChange={(e) => updateSuggestion(step.key, "locationName", e.target.value)}
                              className="rounded-lg border border-border bg-background px-3 py-1.5 text-sm text-foreground focus:border-primary focus:outline-none"
                            />
                          </div>
                          <div className="flex flex-col gap-1">
                            <label className="text-xs font-medium text-muted-foreground">Description</label>
                            <textarea
                              value={step.description}
                              onChange={(e) => updateSuggestion(step.key, "description", e.target.value)}
                              rows={2}
                              placeholder="Describe this activity..."
                              className="resize-none rounded-lg border border-border bg-background px-3 py-1.5 text-sm text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none"
                            />
                          </div>
                          <div className="flex flex-col gap-1">
                            <label className="text-xs font-medium text-muted-foreground">Country</label>
                            <input
                              type="text"
                              value={step.country}
                              onChange={(e) => updateSuggestion(step.key, "country", e.target.value)}
                              className="rounded-lg border border-border bg-background px-3 py-1.5 text-sm text-foreground focus:border-primary focus:outline-none"
                            />
                          </div>
                          <button onClick={() => setEditingKey(null)} className="self-start rounded-lg bg-secondary px-3 py-1 text-xs font-medium text-secondary-foreground hover:bg-secondary/80">
                            Done Editing
                          </button>
                        </div>
                      ) : (
                        <>
                          <div className="flex flex-wrap items-center gap-2">
                            <MapPin className="h-4 w-4 text-primary" />
                            <span className="font-medium text-foreground">{step.locationName}</span>
                            <span className="text-sm text-muted-foreground">{step.country}</span>
                            <span className="rounded-full bg-secondary px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-secondary-foreground">
                              {step.confidence} confidence
                            </span>
                            <button onClick={(e) => { e.stopPropagation(); setEditingKey(step.key); }} className="rounded-lg p-1 text-muted-foreground hover:text-foreground transition-colors">
                              <Pencil className="h-3.5 w-3.5" />
                            </button>
                          </div>

                          {step.earliestDate && (
                            <div className="flex items-center gap-2 text-xs text-muted-foreground">
                              <Calendar className="h-3 w-3" />
                              {step.earliestDate.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
                            </div>
                          )}

                          {step.description && <p className="text-xs leading-relaxed text-foreground">{step.description}</p>}
                          <p className="text-xs leading-relaxed text-muted-foreground">{step.summary}</p>
                        </>
                      )}

                      <div className="mt-1 flex gap-1.5 overflow-x-auto">
                        {step.photos.slice(0, 6).map((photo, index) => {
                          const isVideo = photo.file.type.startsWith("video/");
                          return photo.thumbnail ? (
                            <div key={index} className="relative h-14 w-14 shrink-0">
                              <img src={photo.thumbnail} alt={photo.caption || photo.file.name} className="h-14 w-14 rounded-lg object-cover" />
                              {isVideo && (
                                <div className="absolute inset-0 flex items-center justify-center rounded-lg bg-black/30">
                                  <Play className="h-4 w-4 text-white fill-white" />
                                </div>
                              )}
                            </div>
                          ) : (
                            <div key={index} className="flex h-14 w-14 shrink-0 items-center justify-center rounded-lg bg-muted">
                              {isVideo ? <Play className="h-5 w-5 text-muted-foreground" /> : <ImageIcon className="h-5 w-5 text-muted-foreground" />}
                            </div>
                          );
                        })}
                        {step.photos.length > 6 && (
                          <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-lg bg-muted text-xs font-medium text-muted-foreground">
                            +{step.photos.length - 6}
                          </div>
                        )}
                      </div>

                      {step.photos.length > 0 && (
                        <div className="grid gap-1">
                          {step.photos.map((photo, index) => (
                            <p key={photo.captionId} className="text-[11px] leading-relaxed text-muted-foreground">
                              <span className="font-medium text-foreground">
                                {photo.file.type.startsWith("video/") ? `Video ${index + 1}:` : `Image ${index + 1}:`}
                              </span>{" "}
                              {photo.caption}
                            </p>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
