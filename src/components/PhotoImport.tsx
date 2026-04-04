import { useState, useCallback } from "react";
import type { Json } from "@/integrations/supabase/types";
import { Upload, MapPin, Calendar, Check, Image as ImageIcon, Loader2, Pencil, X } from "lucide-react";
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
  description: string;
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
  onCancel?: () => void;
  existingSteps?: Array<{ id: string; latitude: number; longitude: number; location_name: string | null }>;
}

function getRepresentativeCoordinates(photos: PhotoExifData[]) {
  const latitudes = photos.map((p) => p.latitude).filter((v): v is number => v !== null).sort((a, b) => a - b);
  const longitudes = photos.map((p) => p.longitude).filter((v): v is number => v !== null).sort((a, b) => a - b);
  const mid = Math.floor(latitudes.length / 2);
  return { latitude: latitudes[mid], longitude: longitudes[mid] };
}

async function inferLocationsWithVision(
  steps: SuggestedStep[],
  noGpsPhotos: PhotoExifData[] = []
): Promise<Map<string, HybridLocationResult>> {
  const gpsGroups = steps.map((step) => ({
    key: step.key,
    exifLocation: { latitude: step.latitude, longitude: step.longitude, name: step.locationName, country: step.country },
    photos: step.photos.filter((p) => Boolean(p.analysisImage)).slice(0, 3).map((p) => ({
      fileName: p.file.name, takenAt: p.takenAt?.toISOString() ?? null, analysisImage: p.analysisImage ?? null,
    })),
  })).filter((g) => g.photos.length > 0);

  const noGpsGroups = noGpsPhotos.filter((p) => Boolean(p.analysisImage)).map((photo, i) => ({
    key: `no-gps-${i}`, exifLocation: null,
    photos: [{ fileName: photo.file.name, takenAt: photo.takenAt?.toISOString() ?? null, analysisImage: photo.analysisImage ?? null }],
  }));

  const allGroups = [...gpsGroups, ...noGpsGroups];
  if (allGroups.length === 0) return new Map();

  const { data, error } = await supabase.functions.invoke("photo-location-inference", { body: { groups: allGroups } });
  if (error) throw error;

  const results = Array.isArray(data?.results) ? data.results : [];
  return new Map(results.filter((r: any): r is HybridLocationResult => typeof r?.key === "string").map((r: HybridLocationResult) => [r.key, r]));
}

export function PhotoImport({ tripId, onImportComplete, onCancel, existingSteps = [] }: PhotoImportProps) {
  const { user } = useAuth();
  const [dragOver, setDragOver] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [importing, setImporting] = useState(false);
  const [suggestions, setSuggestions] = useState<SuggestedStep[]>([]);
  const [noGpsPhotos, setNoGpsPhotos] = useState<PhotoExifData[]>([]);
  const [editingKey, setEditingKey] = useState<string | null>(null);

  const processFiles = useCallback(async (files: File[]) => {
    setProcessing(true);
    setSuggestions([]);
    setNoGpsPhotos([]);

    const imageFiles = files.filter((f) => f.type.startsWith("image/") || f.type.startsWith("video/"));
    if (imageFiles.length === 0) { toast.error("No image or video files found"); setProcessing(false); return; }
    toast.info(`Processing ${imageFiles.length} file(s) with EXIF + visual recognition...`);

    try {
      const exifResults = await extractExifFromFiles(imageFiles);
      const groups = groupPhotosByLocation(exifResults, 2000);
      const noGps = exifResults.filter((p) => p.latitude === null || p.longitude === null);
      setNoGpsPhotos(noGps);

      const baseSteps = await Promise.all(
        Array.from(groups.entries()).map(async ([key, photos]) => {
          const { latitude, longitude } = getRepresentativeCoordinates(photos);
          const geo = await reverseGeocode(latitude, longitude);
          const dates = photos.map((p) => p.takenAt).filter(Boolean) as Date[];
          const earliestDate = dates.length > 0 ? new Date(Math.min(...dates.map((d) => d.getTime()))) : null;
          return {
            key, locationName: geo.name, country: geo.country, latitude, longitude,
            photos, earliestDate, selected: true, confidence: "low" as const,
            summary: "Using GPS metadata for the location suggestion.", description: "",
          };
        })
      );

      let inferredLocations = new Map<string, HybridLocationResult>();
      try {
        inferredLocations = await inferLocationsWithVision(baseSteps, noGps);
      } catch (e) {
        console.error("Visual location inference error:", e);
        toast.warning("Visual recognition was unavailable, locations are based on EXIF metadata only.");
      }

      const steps = baseSteps.map((step) => {
        const inferred = inferredLocations.get(step.key);
        if (!inferred) return step;
        return { ...step, locationName: inferred.locationName || step.locationName, country: inferred.country || step.country, confidence: inferred.confidence, summary: inferred.summary || step.summary, description: inferred.summary || "" };
      });

      for (const [index, photo] of noGps.entries()) {
        const key = `no-gps-${index}`;
        const inferred = inferredLocations.get(key);
        if (inferred && inferred.latitude !== null && inferred.longitude !== null) {
          steps.push({
            key, locationName: inferred.locationName || "Visually Identified Location", country: inferred.country || "Unknown",
            latitude: inferred.latitude, longitude: inferred.longitude, photos: [photo], earliestDate: photo.takenAt,
            selected: true, confidence: inferred.confidence, summary: inferred.summary || "Location identified from photo contents.", description: inferred.summary || "",
          });
        }
      }

      steps.sort((a, b) => (a.earliestDate?.getTime() ?? Infinity) - (b.earliestDate?.getTime() ?? Infinity));
      setSuggestions(steps);

      const visuallyInferredCount = noGps.filter((_, i) => { const r = inferredLocations.get(`no-gps-${i}`); return r && r.latitude !== null; }).length;
      const remainingNoGps = noGps.length - visuallyInferredCount;
      toast.success(`Found ${steps.length} location(s)` + (remainingNoGps > 0 ? `. ${remainingNoGps} photo(s) couldn't be located.` : ""));
    } catch (err) {
      console.error("Photo processing error:", err);
      toast.error("Failed to process photos. Please try again.");
    } finally {
      setProcessing(false);
    }
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => { e.preventDefault(); setDragOver(false); processFiles(Array.from(e.dataTransfer.files)); }, [processFiles]);
  const handleFileSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => { processFiles(Array.from(e.target.files || [])); }, [processFiles]);
  const toggleStep = (key: string) => setSuggestions((prev) => prev.map((s) => (s.key === key ? { ...s, selected: !s.selected } : s)));

  const updateSuggestion = (key: string, field: keyof SuggestedStep, value: string) => {
    setSuggestions((prev) => prev.map((s) => (s.key === key ? { ...s, [field]: value } : s)));
  };

  // Check if a suggested step is near an existing step (within 2km)
  const findMatchingExistingStep = (lat: number, lng: number) => {
    for (const existing of existingSteps) {
      const dlat = (existing.latitude - lat) * 111320;
      const dlng = (existing.longitude - lng) * 111320 * Math.cos(lat * Math.PI / 180);
      const dist = Math.sqrt(dlat * dlat + dlng * dlng);
      if (dist < 2000) return existing;
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
        // Attach photos to existing step instead of creating duplicate
        stepId = matchingStep.id;
        matchedSteps++;
      } else {
        const { data: stepData, error: stepError } = await supabase.from("trip_steps").insert({
          trip_id: tripId, user_id: user.id, location_name: step.locationName, country: step.country,
          latitude: step.latitude, longitude: step.longitude,
          recorded_at: step.earliestDate?.toISOString() || new Date().toISOString(),
          source: "photo_import", event_type: "activity", is_confirmed: true,
          notes: step.summary, description: step.description || null,
        }).select().single();

        if (stepError || !stepData) { console.error("Step insert error:", stepError); toast.error(`Failed to create step for ${step.locationName}`); continue; }
        stepId = stepData.id;
        newSteps++;
      }

      for (const photo of step.photos) {
        const ext = photo.file.name.split(".").pop() || "jpg";
        const path = `${user.id}/${tripId}/${stepId}/${crypto.randomUUID()}.${ext}`;
        const { error: uploadError } = await supabase.storage.from("trip-photos").upload(path, photo.file);
        if (uploadError) { console.error("Photo upload error:", uploadError); } else {
          await supabase.from("step_photos").insert({
            step_id: stepId, user_id: user.id, storage_path: path, file_name: photo.file.name,
            latitude: photo.latitude, longitude: photo.longitude, taken_at: photo.takenAt?.toISOString(),
            exif_data: (photo.exifRaw as Json) ?? null,
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
              <p className="text-sm text-muted-foreground">We'll combine GPS metadata and visual recognition to suggest trip stops</p>
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
          <p className="text-sm text-muted-foreground">Reading EXIF metadata and checking what the photos show...</p>
        </div>
      )}

      {suggestions.length > 0 && (
        <div className="flex flex-col gap-4">
          <div className="flex items-center justify-between">
            <h3 className="font-display text-lg font-semibold text-foreground">
              Detected Locations ({suggestions.filter((s) => s.selected).length}/{suggestions.length})
            </h3>
            <div className="flex items-center gap-2">
              {onCancel && (
                <button onClick={onCancel} className="flex items-center gap-1.5 rounded-xl bg-secondary px-4 py-2 text-sm font-medium text-secondary-foreground hover:bg-secondary/80 transition-colors">
                  <X className="h-4 w-4" />
                  Cancel
                </button>
              )}
              <button onClick={importSelected} disabled={importing || suggestions.filter((s) => s.selected).length === 0}
                className="flex items-center gap-2 rounded-xl bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50">
                {importing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
                {importing ? "Importing..." : "Import Selected"}
              </button>
            </div>
          </div>

          {noGpsPhotos.length > 0 && (
            <p className="text-sm text-muted-foreground">
              {noGpsPhotos.length} photo{noGpsPhotos.length > 1 ? "s" : ""} had no GPS metadata.
            </p>
          )}

          <div className="flex flex-col gap-3">
            {suggestions.map((step) => {
              const isEditing = editingKey === step.key;
              return (
                <div key={step.key}
                  className={`rounded-2xl border-2 p-4 transition-all ${step.selected ? "border-primary bg-primary/5" : "border-border bg-card opacity-60"}`}>
                  <div className="flex items-start gap-4">
                    <div onClick={() => toggleStep(step.key)}
                      className={`mt-0.5 flex h-6 w-6 shrink-0 cursor-pointer items-center justify-center rounded-lg transition-colors ${step.selected ? "bg-primary" : "bg-muted"}`}>
                      {step.selected && <Check className="h-3.5 w-3.5 text-primary-foreground" />}
                    </div>

                    <div className="flex flex-1 flex-col gap-2">
                      {isEditing ? (
                        <div className="flex flex-col gap-3">
                          <div className="flex flex-col gap-1">
                            <label className="text-xs font-medium text-muted-foreground">Activity Name</label>
                            <input type="text" value={step.locationName} onChange={(e) => updateSuggestion(step.key, "locationName", e.target.value)}
                              className="rounded-lg border border-border bg-background px-3 py-1.5 text-sm text-foreground focus:border-primary focus:outline-none" />
                          </div>
                          <div className="flex flex-col gap-1">
                            <label className="text-xs font-medium text-muted-foreground">Description</label>
                            <textarea value={step.description} onChange={(e) => updateSuggestion(step.key, "description", e.target.value)}
                              rows={2} placeholder="Describe this activity..."
                              className="resize-none rounded-lg border border-border bg-background px-3 py-1.5 text-sm text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none" />
                          </div>
                          <div className="flex flex-col gap-1">
                            <label className="text-xs font-medium text-muted-foreground">Country</label>
                            <input type="text" value={step.country} onChange={(e) => updateSuggestion(step.key, "country", e.target.value)}
                              className="rounded-lg border border-border bg-background px-3 py-1.5 text-sm text-foreground focus:border-primary focus:outline-none" />
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
                            <button onClick={(e) => { e.stopPropagation(); setEditingKey(step.key); }}
                              className="rounded-lg p-1 text-muted-foreground hover:text-foreground transition-colors">
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
                        {step.photos.slice(0, 6).map((photo, index) =>
                          photo.thumbnail ? (
                            <img key={index} src={photo.thumbnail} alt={photo.file.name} className="h-14 w-14 shrink-0 rounded-lg object-cover" />
                          ) : (
                            <div key={index} className="flex h-14 w-14 shrink-0 items-center justify-center rounded-lg bg-muted">
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
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
