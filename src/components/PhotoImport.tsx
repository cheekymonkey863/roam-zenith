import { useState, useCallback } from "react";
import { Upload, MapPin, Calendar, Check, X, Image as ImageIcon, Loader2 } from "lucide-react";
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
}

interface PhotoImportProps {
  tripId: string;
  onImportComplete: () => void;
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
    const imageFiles = files.filter((f) => f.type.startsWith("image/") || f.type.startsWith("video/"));

    if (imageFiles.length === 0) {
      toast.error("No image or video files found");
      setProcessing(false);
      return;
    }

    toast.info(`Processing ${imageFiles.length} file(s)...`);

    try {
      const exifResults = await extractExifFromFiles(imageFiles);
      const groups = groupPhotosByLocation(exifResults);
      const noGps = exifResults.filter((p) => p.latitude === null);
      setNoGpsPhotos(noGps);

      if (groups.size === 0) {
        toast.warning(`No GPS data found in ${imageFiles.length} file(s). Try photos taken with location services enabled.`);
        setProcessing(false);
        return;
      }

      const steps: SuggestedStep[] = [];
      for (const [key, photos] of groups) {
        const avgLat = photos.reduce((s, p) => s + p.latitude!, 0) / photos.length;
        const avgLng = photos.reduce((s, p) => s + p.longitude!, 0) / photos.length;
        const geo = await reverseGeocode(avgLat, avgLng);
        const dates = photos.map((p) => p.takenAt).filter(Boolean) as Date[];
        const earliest = dates.length > 0 ? new Date(Math.min(...dates.map((d) => d.getTime()))) : null;

        steps.push({
          key,
          locationName: geo.name,
          country: geo.country,
          latitude: avgLat,
          longitude: avgLng,
          photos,
          earliestDate: earliest,
          selected: true,
        });
      }

      steps.sort((a, b) => {
        if (a.earliestDate && b.earliestDate) return a.earliestDate.getTime() - b.earliestDate.getTime();
        return 0;
      });

      setSuggestions(steps);
      toast.success(`Found ${steps.length} location(s) from ${exifResults.length - noGps.length} photo(s)`);
    } catch (err) {
      console.error("Photo processing error:", err);
      toast.error("Failed to process photos. Please try again.");
    }
    setProcessing(false);
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
      prev.map((s) => (s.key === key ? { ...s, selected: !s.selected } : s))
    );
  };

  const importSelected = async () => {
    if (!user) return;
    setImporting(true);

    const selected = suggestions.filter((s) => s.selected);
    for (const step of selected) {
      // Create the step
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
          source: "photo_exif",
          is_confirmed: true,
        })
        .select()
        .single();

      if (stepError || !stepData) {
        console.error("Step insert error:", stepError);
        toast.error(`Failed to create step for ${step.locationName}`);
        continue;
      }

      // Upload photos for this step
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
      {/* Drop zone */}
      {suggestions.length === 0 && !processing && (
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
            <p className="text-sm text-muted-foreground">
              We'll extract GPS data to auto-suggest trip steps
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

      {/* Processing */}
      {processing && (
        <div className="flex flex-col items-center gap-3 rounded-2xl bg-card p-8 shadow-card">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
          <p className="text-sm text-muted-foreground">Extracting GPS data from your photos...</p>
        </div>
      )}

      {/* Suggestions */}
      {suggestions.length > 0 && (
        <div className="flex flex-col gap-4">
          <div className="flex items-center justify-between">
            <h3 className="font-display text-lg font-semibold text-foreground">
              Auto-Detected Locations ({suggestions.filter((s) => s.selected).length}/{suggestions.length})
            </h3>
            <button
              onClick={importSelected}
              disabled={importing || suggestions.filter((s) => s.selected).length === 0}
              className="flex items-center gap-2 rounded-xl bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50"
            >
              {importing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
              {importing ? "Importing..." : "Import Selected"}
            </button>
          </div>

          {noGpsPhotos.length > 0 && (
            <p className="text-sm text-muted-foreground">
              {noGpsPhotos.length} photo{noGpsPhotos.length > 1 ? "s" : ""} without GPS data were skipped.
            </p>
          )}

          <div className="flex flex-col gap-3">
            {suggestions.map((step) => (
              <div
                key={step.key}
                onClick={() => toggleStep(step.key)}
                className={`flex cursor-pointer items-start gap-4 rounded-2xl border-2 p-4 transition-all ${
                  step.selected
                    ? "border-primary bg-primary/5"
                    : "border-border bg-card opacity-60"
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
                  <div className="flex items-center gap-2">
                    <MapPin className="h-4 w-4 text-primary" />
                    <span className="font-medium text-foreground">{step.locationName}</span>
                    <span className="text-sm text-muted-foreground">{step.country}</span>
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

                  {/* Photo thumbnails */}
                  <div className="mt-1 flex gap-1.5 overflow-x-auto">
                    {step.photos.slice(0, 6).map((photo, i) =>
                      photo.thumbnail ? (
                        <img
                          key={i}
                          src={photo.thumbnail}
                          alt={photo.file.name}
                          className="h-14 w-14 shrink-0 rounded-lg object-cover"
                        />
                      ) : (
                        <div key={i} className="flex h-14 w-14 shrink-0 items-center justify-center rounded-lg bg-muted">
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
