import { useState, useCallback } from "react";
import type { Json } from "@/integrations/supabase/types";
import { Upload, MapPin, Calendar, Check, Image as ImageIcon, Loader2 } from "lucide-react";
import { extractExifFromFiles, groupPhotosByLocation, reverseGeocode, type PhotoExifData } from "@/lib/exif";
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
}

interface HybridLocationResult {
  key: string;
  locationName: string;
  country: string;
  latitude: number | null;
  longitude: number | null;
  confidence: SuggestedStep["confidence"];
  summary: string;
}

interface PhotoImportProps {
  tripId: string;
  onImportComplete: () => void;
}

function getRepresentativeCoordinates(photos: PhotoExifData[]) {
  const latitudes = photos
    .map((photo) => photo.latitude)
    .filter((value): value is number => value !== null)
    .sort((a, b) => a - b);
  const longitudes = photos
    .map((photo) => photo.longitude)
    .filter((value): value is number => value !== null)
    .sort((a, b) => a - b);

  const middleIndex = Math.floor(latitudes.length / 2);

  return {
    latitude: latitudes[middleIndex],
    longitude: longitudes[middleIndex],
  };
}

async function inferLocationsWithVision(
  steps: SuggestedStep[],
  noGpsPhotos: PhotoExifData[] = []
): Promise<Map<string, HybridLocationResult>> {
  const gpsGroups = steps.map((step) => ({
    key: step.key,
    exifLocation: {
      latitude: step.latitude,
      longitude: step.longitude,
      name: step.locationName,
      country: step.country,
    },
    photos: step.photos
      .filter((photo) => Boolean(photo.analysisImage))
      .slice(0, 3)
      .map((photo) => ({
        fileName: photo.file.name,
        takenAt: photo.takenAt?.toISOString() ?? null,
        analysisImage: photo.analysisImage ?? null,
      })),
  })).filter((group) => group.photos.length > 0);

  // Create groups for no-GPS photos (each photo is its own group for visual inference)
  const noGpsGroups = noGpsPhotos
    .filter((photo) => Boolean(photo.analysisImage))
    .map((photo, index) => ({
      key: `no-gps-${index}`,
      exifLocation: null,
      photos: [{
        fileName: photo.file.name,
        takenAt: photo.takenAt?.toISOString() ?? null,
        analysisImage: photo.analysisImage ?? null,
      }],
    }));

  const allGroups = [...gpsGroups, ...noGpsGroups];

  if (allGroups.length === 0) {
    return new Map();
  }

  const { data, error } = await supabase.functions.invoke("photo-location-inference", {
    body: { groups: allGroups },
  });

  if (error) {
    throw error;
  }

  const results = Array.isArray(data?.results) ? data.results : [];

  return new Map(
    results
      .filter((result): result is HybridLocationResult => typeof result?.key === "string")
      .map((result) => [result.key, result])
  );
}

export function PhotoImport({ tripId, onImportComplete }: PhotoImportProps) {
  const { user } = useAuth();
  const [dragOver, setDragOver] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [importing, setImporting] = useState(false);
  const [suggestions, setSuggestions] = useState<SuggestedStep[]>([]);
  const [noGpsPhotos, setNoGpsPhotos] = useState<PhotoExifData[]>([]);

  const processFiles = useCallback(async (files: File[]) => {
    setProcessing(true);
    setSuggestions([]);
    setNoGpsPhotos([]);

    const imageFiles = files.filter((file) => file.type.startsWith("image/") || file.type.startsWith("video/"));

    if (imageFiles.length === 0) {
      toast.error("No image or video files found");
      setProcessing(false);
      return;
    }

    toast.info(`Processing ${imageFiles.length} file(s) with EXIF + visual recognition...`);

    try {
      const exifResults = await extractExifFromFiles(imageFiles);
      const groups = groupPhotosByLocation(exifResults, 10000);
      const noGps = exifResults.filter((photo) => photo.latitude === null || photo.longitude === null);
      setNoGpsPhotos(noGps);

      const baseSteps = await Promise.all(
        Array.from(groups.entries()).map(async ([key, photos]) => {
          const { latitude, longitude } = getRepresentativeCoordinates(photos);
          const geo = await reverseGeocode(latitude, longitude);
          const dates = photos.map((photo) => photo.takenAt).filter(Boolean) as Date[];
          const earliestDate = dates.length > 0 ? new Date(Math.min(...dates.map((date) => date.getTime()))) : null;

          return {
            key,
            locationName: geo.name,
            country: geo.country,
            latitude,
            longitude,
            photos,
            earliestDate,
            selected: true,
            confidence: "low" as const,
            summary: "Using GPS metadata for the location suggestion.",
          };
        })
      );

      let inferredLocations = new Map<string, HybridLocationResult>();

      try {
        inferredLocations = await inferLocationsWithVision(baseSteps, noGps);
      } catch (visionError) {
        console.error("Visual location inference error:", visionError);
        toast.warning("Visual recognition was unavailable, so locations are based on EXIF metadata only.");
      }

      // Merge inference results into GPS-based steps
      const steps = baseSteps.map((step) => {
        const inferred = inferredLocations.get(step.key);
        if (!inferred) return step;
        return {
          ...step,
          locationName: inferred.locationName || step.locationName,
          country: inferred.country || step.country,
          confidence: inferred.confidence,
          summary: inferred.summary || step.summary,
        };
      });

      // Create steps from no-GPS photos that got visual inference results
      for (const [index, photo] of noGps.entries()) {
        const key = `no-gps-${index}`;
        const inferred = inferredLocations.get(key);
        if (inferred && inferred.latitude !== null && inferred.longitude !== null) {
          steps.push({
            key,
            locationName: inferred.locationName || "Visually Identified Location",
            country: inferred.country || "Unknown",
            latitude: inferred.latitude,
            longitude: inferred.longitude,
            photos: [photo],
            earliestDate: photo.takenAt,
            selected: true,
            confidence: inferred.confidence,
            summary: inferred.summary || "Location identified from photo contents.",
          });
        }
      }

      steps.sort((a, b) => {
        const aTime = a.earliestDate?.getTime() ?? Number.MAX_SAFE_INTEGER;
        const bTime = b.earliestDate?.getTime() ?? Number.MAX_SAFE_INTEGER;
        return aTime - bTime;
      });

      setSuggestions(steps);

      const visuallyInferredCount = noGps.filter((_, i) => {
        const r = inferredLocations.get(`no-gps-${i}`);
        return r && r.latitude !== null;
      }).length;

      const remainingNoGps = noGps.length - visuallyInferredCount;

      toast.success(
        `Found ${steps.length} location(s) using EXIF + visual recognition` +
        (remainingNoGps > 0 ? `. ${remainingNoGps} photo(s) couldn't be located.` : "")
      );
    } catch (err) {
      console.error("Photo processing error:", err);
      toast.error("Failed to process photos. Please try again.");
    } finally {
      setProcessing(false);
    }
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragOver(false);
      const files = Array.from(e.dataTransfer.files);
      processFiles(files);
    },
    [processFiles]
  );

  const handleFileSelect = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const files = Array.from(e.target.files || []);
      processFiles(files);
    },
    [processFiles]
  );

  const toggleStep = (key: string) => {
    setSuggestions((prev) =>
      prev.map((step) => (step.key === key ? { ...step, selected: !step.selected } : step))
    );
  };

  const importSelected = async () => {
    if (!user) return;
    setImporting(true);

    const selected = suggestions.filter((step) => step.selected);
    for (const step of selected) {
      const { data: stepData, error: stepError } = await supabase
        .from("trip_steps")
        .insert({
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
          notes: step.summary,
        })
        .select()
        .single();

      if (stepError || !stepData) {
        console.error("Step insert error:", stepError);
        toast.error(`Failed to create step for ${step.locationName}`);
        continue;
      }

      for (const photo of step.photos) {
        const ext = photo.file.name.split(".").pop() || "jpg";
        const path = `${user.id}/${tripId}/${stepData.id}/${crypto.randomUUID()}.${ext}`;

        const { error: uploadError } = await supabase.storage
          .from("trip-photos")
          .upload(path, photo.file);

        if (uploadError) {
          console.error("Photo upload error:", uploadError);
        } else {
          await supabase.from("step_photos").insert({
            step_id: stepData.id,
            user_id: user.id,
            storage_path: path,
            file_name: photo.file.name,
            latitude: photo.latitude,
            longitude: photo.longitude,
            taken_at: photo.takenAt?.toISOString(),
            exif_data: (photo.exifRaw as Json) ?? null,
          });
        }
      }
    }

    toast.success(`Imported ${selected.length} location(s)!`);
    setImporting(false);
    setSuggestions([]);
    onImportComplete();
  };

  return (
    <div className="flex flex-col gap-6">
      {suggestions.length === 0 && !processing && (
        <label
          onDragOver={(e) => {
            e.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={handleDrop}
          className={`flex cursor-pointer flex-col items-center gap-4 rounded-2xl border-2 border-dashed p-12 transition-colors ${
            dragOver ? "border-primary bg-primary/5" : "border-border hover:border-primary/50"
          }`}
        >
          <Upload className="h-10 w-10 text-muted-foreground" />
          <div className="text-center">
            <p className="font-medium text-foreground">Drop photos & videos here</p>
            <p className="text-sm text-muted-foreground">
              We'll combine GPS metadata and visual recognition to suggest trip stops
            </p>
          </div>
          <input
            type="file"
            multiple
            accept="image/*,video/*"
            onChange={handleFileSelect}
            className="hidden"
          />
          <span className="rounded-xl bg-primary px-4 py-2 text-sm font-medium text-primary-foreground">
            Browse Files
          </span>
        </label>
      )}

      {processing && (
        <div className="flex flex-col items-center gap-3 rounded-2xl bg-card p-8 shadow-card">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
          <p className="text-sm text-muted-foreground">
            Reading EXIF metadata and checking what the photos show...
          </p>
        </div>
      )}

      {suggestions.length > 0 && (
        <div className="flex flex-col gap-4">
          <div className="flex items-center justify-between">
            <h3 className="font-display text-lg font-semibold text-foreground">
              Detected Locations ({suggestions.filter((step) => step.selected).length}/{suggestions.length})
            </h3>
            <button
              onClick={importSelected}
              disabled={importing || suggestions.filter((step) => step.selected).length === 0}
              className="flex items-center gap-2 rounded-xl bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50"
            >
              {importing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
              {importing ? "Importing..." : "Import Selected"}
            </button>
          </div>

          {noGpsPhotos.length > 0 && (
            <p className="text-sm text-muted-foreground">
              {noGpsPhotos.length} photo{noGpsPhotos.length > 1 ? "s" : ""} had no GPS metadata, so they weren't placed on the map automatically.
            </p>
          )}

          <div className="flex flex-col gap-3">
            {suggestions.map((step) => (
              <div
                key={step.key}
                onClick={() => toggleStep(step.key)}
                className={`flex cursor-pointer items-start gap-4 rounded-2xl border-2 p-4 transition-all ${
                  step.selected ? "border-primary bg-primary/5" : "border-border bg-card opacity-60"
                }`}
              >
                <div
                  className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-lg transition-colors ${
                    step.selected ? "bg-primary" : "bg-muted"
                  }`}
                >
                  {step.selected && <Check className="h-3.5 w-3.5 text-primary-foreground" />}
                </div>

                <div className="flex flex-1 flex-col gap-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <MapPin className="h-4 w-4 text-primary" />
                    <span className="font-medium text-foreground">{step.locationName}</span>
                    <span className="text-sm text-muted-foreground">{step.country}</span>
                    <span className="rounded-full bg-secondary px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-secondary-foreground">
                      {step.confidence} confidence
                    </span>
                  </div>

                  {step.earliestDate && (
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                      <Calendar className="h-3 w-3" />
                      {step.earliestDate.toLocaleDateString("en-US", {
                        month: "short",
                        day: "numeric",
                        year: "numeric",
                      })}
                    </div>
                  )}

                  <p className="text-xs leading-relaxed text-muted-foreground">{step.summary}</p>

                  <div className="mt-1 flex gap-1.5 overflow-x-auto">
                    {step.photos.slice(0, 6).map((photo, index) =>
                      photo.thumbnail ? (
                        <img
                          key={index}
                          src={photo.thumbnail}
                          alt={photo.file.name}
                          className="h-14 w-14 shrink-0 rounded-lg object-cover"
                        />
                      ) : (
                        <div
                          key={index}
                          className="flex h-14 w-14 shrink-0 items-center justify-center rounded-lg bg-muted"
                        >
                          <ImageIcon className="h-5 w-5 text-muted-foreground" />
                        </div>
                      )
                    )}
                    {step.photos.length > 6 && (
                      <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-lg bg-muted text-xs font-medium text-muted-foreground">
                        +{step.photos.length - 6}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
