import { useState, useMemo } from "react";
import { Check, Loader2, MapPin, Trash2, Upload, X, Film, Image as ImageIcon } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { buildImportedStepDetails } from "@/lib/placeClassification";
import { queueVideoAnalysisJob } from "@/lib/videoAnalysisQueue";
import { resumableUpload } from "@/lib/resumableUpload";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import type { LocalStagedFile } from "@/components/PhotoImport";

interface StagingGroup {
  key: string;
  locationName: string;
  latitude: number | null;
  longitude: number | null;
  files: LocalStagedFile[];
  earliestDate: Date | null;
}

interface StagingInboxProps {
  tripId: string;
  localFiles: LocalStagedFile[];
  onDeleteFiles: (ids: string[]) => void;
  onImportComplete: () => void;
  onCancel?: () => void;
  onAddMore: () => void;
  existingSteps?: Array<{
    id: string;
    latitude: number;
    longitude: number;
    location_name: string | null;
    country: string | null;
    recorded_at: string;
    event_type: string;
    description: string | null;
  }>;
}

const LOCATION_GROUP_RADIUS_METERS = 60;

function haversineDistance(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371000;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function groupLocalFiles(files: LocalStagedFile[]): StagingGroup[] {
  const groups: StagingGroup[] = [];
  const ungrouped: LocalStagedFile[] = [];

  for (const file of files) {
    if (file.latitude == null || file.longitude == null) {
      ungrouped.push(file);
      continue;
    }

    let matched = false;
    for (const group of groups) {
      if (group.latitude != null && group.longitude != null) {
        if (haversineDistance(file.latitude, file.longitude, group.latitude, group.longitude) <= LOCATION_GROUP_RADIUS_METERS) {
          group.files.push(file);
          matched = true;
          break;
        }
      }
    }

    if (!matched) {
      groups.push({
        key: `group-${groups.length}`,
        locationName: "",
        latitude: file.latitude,
        longitude: file.longitude,
        files: [file],
        earliestDate: file.takenAt,
      });
    }
  }

  if (ungrouped.length > 0) {
    groups.push({
      key: "ungrouped",
      locationName: "",
      latitude: null,
      longitude: null,
      files: ungrouped,
      earliestDate: null,
    });
  }

  // Compute earliest date per group
  for (const group of groups) {
    const dates = group.files.map((f) => f.takenAt).filter(Boolean) as Date[];
    group.earliestDate = dates.length > 0 ? new Date(Math.min(...dates.map((d) => d.getTime()))) : null;
  }

  return groups.sort(
    (a, b) => (a.earliestDate?.getTime() ?? Infinity) - (b.earliestDate?.getTime() ?? Infinity),
  );
}

function FileThumbnail({ file }: { file: LocalStagedFile }) {
  const isVideo = file.mimeType.startsWith("video/");

  if (isVideo) {
    return (
      <div className="relative aspect-square w-full overflow-hidden rounded-lg bg-slate-900">
        <video
          src={`${file.previewUrl}#t=0.001`}
          preload="metadata"
          muted
          playsInline
          className="h-full w-full object-cover"
        />
        <div className="absolute inset-0 flex items-center justify-center bg-black/30">
          <div className="flex h-10 w-10 items-center justify-center rounded-full bg-white/20 backdrop-blur-sm">
            <Film className="h-5 w-5 text-white" />
          </div>
        </div>
        <div className="absolute bottom-1 right-1 rounded bg-black/60 px-1.5 py-0.5 text-[10px] font-medium text-white">
          VIDEO
        </div>
      </div>
    );
  }

  return (
    <div className="relative aspect-square w-full overflow-hidden rounded-lg bg-muted">
      <img src={file.previewUrl} alt={file.fileName} className="h-full w-full object-cover" loading="lazy" />
    </div>
  );
}

function getGroupDisplayName(group: StagingGroup) {
  if (group.locationName) return group.locationName;
  if (group.latitude != null && group.longitude != null) {
    if (group.earliestDate) {
      return group.earliestDate.toLocaleDateString("en-US", {
        weekday: "short",
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
      });
    }
    return `📍 ${group.latitude.toFixed(4)}, ${group.longitude.toFixed(4)}`;
  }
  if (group.earliestDate) {
    return group.earliestDate.toLocaleDateString("en-US", {
      weekday: "short",
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
  }
  return `${group.files.length} file${group.files.length !== 1 ? "s" : ""}`;
}

export function StagingInbox({
  tripId,
  localFiles,
  onDeleteFiles,
  onImportComplete,
  onCancel,
  onAddMore,
  existingSteps = [],
}: StagingInboxProps) {
  const { user } = useAuth();
  const [importing, setImporting] = useState(false);
  const [importProgress, setImportProgress] = useState({ current: 0, total: 0 });
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  const groups = useMemo(() => groupLocalFiles(localFiles), [localFiles]);

  const [groupSelection, setGroupSelection] = useState<Map<string, boolean>>(() => {
    const map = new Map<string, boolean>();
    groups.forEach((g) => map.set(g.key, true));
    return map;
  });

  // Sync group selection when groups change
  useMemo(() => {
    setGroupSelection((prev) => {
      const next = new Map(prev);
      groups.forEach((g) => {
        if (!next.has(g.key)) next.set(g.key, true);
      });
      return next;
    });
  }, [groups]);

  const toggleGroup = (key: string) => {
    setGroupSelection((prev) => {
      const next = new Map(prev);
      next.set(key, !next.get(key));
      return next;
    });
  };

  const toggleFileSelection = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const deleteSelected = () => {
    if (selectedIds.size === 0) return;
    onDeleteFiles(Array.from(selectedIds));
    setSelectedIds(new Set());
  };

  const importSelected = async () => {
    if (!user) return;
    setImporting(true);

    const selectedGroups = groups.filter((g) => groupSelection.get(g.key));
    const allFiles = selectedGroups.flatMap((g) => g.files);
    const total = allFiles.length;
    let completed = 0;
    setImportProgress({ current: 0, total });
    const createdStepIds: string[] = [];

    try {
      for (const group of selectedGroups) {
        if (group.latitude == null || group.longitude == null) {
          // Skip ungrouped/no-GPS files for now
          completed += group.files.length;
          setImportProgress({ current: completed, total });
          continue;
        }

        const stepDetails = buildImportedStepDetails({
          locationName: group.locationName,
          country: "",
        });

        // Check if we match an existing step
        let stepId: string | null = null;
        for (const existing of existingSteps) {
          const dlat = (existing.latitude - group.latitude) * 111320;
          const dlng = (existing.longitude - group.longitude) * 111320 * Math.cos((group.latitude * Math.PI) / 180);
          if (Math.sqrt(dlat * dlat + dlng * dlng) < 60) {
            stepId = existing.id;
            break;
          }
        }

        if (!stepId) {
          const { data: stepData, error: stepError } = await supabase
            .from("trip_steps")
            .insert({
              trip_id: tripId,
              user_id: user.id,
              location_name: group.locationName || null,
              country: null,
              latitude: group.latitude,
              longitude: group.longitude,
              recorded_at: group.earliestDate?.toISOString() || new Date().toISOString(),
              source: "photo_import",
              event_type: stepDetails.eventType,
              is_confirmed: true,
            })
            .select()
            .single();

          if (stepError || !stepData) {
            console.error("Step insert error:", stepError);
            toast.error("Failed to create step");
            completed += group.files.length;
            setImportProgress({ current: completed, total });
            continue;
          }
          stepId = stepData.id;
          createdStepIds.push(stepId);

        // Upload each file and create step_photo
        for (const file of group.files) {
          try {
            const ext = file.fileName.split(".").pop() || "jpg";
            const objectName = `${user.id}/${tripId}/${stepId}/${crypto.randomUUID()}.${ext}`;

            await resumableUpload({
              bucketName: "trip-photos",
              objectName,
              file: file.file,
              contentType: file.mimeType || undefined,
            });

            await supabase.from("step_photos").insert({
              step_id: stepId,
              user_id: user.id,
              storage_path: objectName,
              file_name: file.fileName,
              latitude: file.latitude ?? null,
              longitude: file.longitude ?? null,
              taken_at: file.takenAt?.toISOString() ?? null,
              exif_data: {
                latitude: file.latitude,
                longitude: file.longitude,
                cameraMake: file.cameraMake,
                cameraModel: file.cameraModel,
              },
            });

            // Queue video analysis for videos
            if (file.mimeType.startsWith("video/")) {
              await queueVideoAnalysisJob({
                captionId: file.id,
                userId: user.id,
                tripId,
                storagePath: objectName,
                fileName: file.fileName,
                mimeType: file.mimeType,
                takenAt: file.takenAt?.toISOString() ?? null,
                latitude: group.latitude,
                longitude: group.longitude,
                locationName: group.locationName,
                country: "",
                nearbyPlaces: [],
                itinerarySteps: existingSteps?.map((s) => ({
                  location_name: s.location_name,
                  country: s.country,
                  latitude: s.latitude,
                  longitude: s.longitude,
                  recorded_at: s.recorded_at,
                  event_type: s.event_type,
                  description: s.description,
                })),
              });
            }
          } catch (err) {
            console.error("Upload failed for", file.fileName, err);
          }

          completed++;
          setImportProgress({ current: completed, total });
        }
      }

      // Trigger backend processing for reverse-geocoding + AI enrichment
      const newStepIds = selectedGroups
        .filter((g) => g.latitude != null && g.longitude != null)
        .map((g) => {
          // We need to collect step IDs created during import
          return null; // placeholder
        });

      // Collect created step IDs from above loop - refactor: track them
      if (createdStepIds.length > 0) {
        supabase.functions.invoke("process-trip-steps", {
          body: { step_ids: createdStepIds },
        }).catch((err) => console.error("Background processing trigger failed:", err));
      }

      toast.success("Import complete! Enhancing locations in the background…");
      onImportComplete();
    } catch (err) {
      console.error("Import error:", err);
      toast.error("Import failed");
    } finally {
      setImporting(false);
      setImportProgress({ current: 0, total: 0 });
    }
  };

  const selectedGroupCount = groups.filter((g) => groupSelection.get(g.key)).length;
  const exifPending = localFiles.some((f) => !f.exifDone);

  return (
    <div className="flex flex-col gap-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h3 className="font-display text-lg font-semibold text-foreground">
          Trip Inbox ({localFiles.length})
          {exifPending && (
            <span className="ml-2 text-xs font-normal text-muted-foreground">
              <Loader2 className="inline h-3 w-3 animate-spin mr-1" />
              Reading metadata…
            </span>
          )}
        </h3>
        <div className="flex items-center gap-2">
          {selectedIds.size > 0 && (
            <button
              onClick={deleteSelected}
              className="flex items-center gap-1.5 rounded-xl bg-destructive/10 px-3 py-2 text-sm font-medium text-destructive hover:bg-destructive/20 transition-colors"
            >
              <Trash2 className="h-4 w-4" />
              Delete ({selectedIds.size})
            </button>
          )}
          <button
            onClick={onAddMore}
            className="flex items-center gap-1.5 rounded-xl bg-secondary px-3 py-2 text-sm font-medium text-secondary-foreground hover:bg-secondary/80 transition-colors"
          >
            <Upload className="h-4 w-4" />
            Add More
          </button>
          {onCancel && (
            <button
              onClick={onCancel}
              className="flex items-center gap-1.5 rounded-xl bg-secondary px-3 py-2 text-sm font-medium text-secondary-foreground hover:bg-secondary/80 transition-colors"
            >
              <X className="h-4 w-4" />
              Cancel
            </button>
          )}
          <button
            onClick={importSelected}
            disabled={importing || selectedGroupCount === 0}
            className="flex items-center gap-2 rounded-xl bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50"
          >
            {importing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
            {importing
              ? `Importing… ${importProgress.total > 0 ? `(${Math.round((importProgress.current / importProgress.total) * 100)}%)` : ""}`
              : "Import Selected"}
          </button>
        </div>
      </div>

      {/* Import progress */}
      {importing && importProgress.total > 0 && (
        <div className="flex flex-col gap-1.5">
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>Uploading & creating timeline…</span>
            <span>{Math.round((importProgress.current / importProgress.total) * 100)}%</span>
          </div>
          <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
            <div
              className="h-full rounded-full bg-primary transition-all duration-300"
              style={{ width: `${(importProgress.current / importProgress.total) * 100}%` }}
            />
          </div>
        </div>
      )}

      {/* Groups */}
      <div className="flex flex-col gap-3">
        {groups.map((group) => {
          const isSelected = groupSelection.get(group.key) ?? true;
          return (
            <div
              key={group.key}
              className={cn(
                "rounded-2xl border-2 p-4 transition-all",
                isSelected ? "border-primary bg-primary/5" : "border-border bg-card opacity-60",
              )}
            >
              <div className="flex items-start gap-4">
                <div
                  onClick={() => toggleGroup(group.key)}
                  className={cn(
                    "mt-0.5 flex h-6 w-6 shrink-0 cursor-pointer items-center justify-center rounded-lg transition-colors",
                    isSelected ? "bg-primary" : "bg-muted",
                  )}
                >
                  {isSelected && <Check className="h-3.5 w-3.5 text-primary-foreground" />}
                </div>

                <div className="flex flex-1 flex-col gap-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <MapPin className="h-4 w-4 text-primary" />
                    <span className="text-lg font-medium text-foreground">{getGroupDisplayName(group)}</span>
                  </div>

                  {group.earliestDate && (
                    <p className="text-xs text-muted-foreground">
                      {group.earliestDate.toLocaleDateString("en-US", {
                        month: "short",
                        day: "numeric",
                        year: "numeric",
                      })}
                    </p>
                  )}

                  {/* File grid */}
                  <div className="grid grid-cols-4 gap-2 sm:grid-cols-6 md:grid-cols-8">
                    {group.files.map((file) => (
                      <div
                        key={file.id}
                        className={cn(
                          "relative cursor-pointer rounded-lg ring-2 transition-all",
                          selectedIds.has(file.id) ? "ring-destructive" : "ring-transparent hover:ring-primary/50",
                        )}
                        onClick={() => toggleFileSelection(file.id)}
                      >
                        <FileThumbnail file={file} />
                        {selectedIds.has(file.id) && (
                          <div className="absolute inset-0 flex items-center justify-center rounded-lg bg-destructive/20">
                            <Trash2 className="h-5 w-5 text-destructive" />
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {localFiles.length === 0 && (
        <div className="flex flex-col items-center gap-4 rounded-2xl border-2 border-dashed border-border p-12 text-center">
          <ImageIcon className="h-10 w-10 text-muted-foreground" />
          <div>
            <p className="font-medium text-foreground">Your Trip Inbox is empty</p>
            <p className="text-sm text-muted-foreground">Drop photos & videos to start building your timeline</p>
          </div>
        </div>
      )}
    </div>
  );
}
