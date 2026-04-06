import { useState, useMemo, useEffect, useCallback } from "react";
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
  onProgressChange?: (progress: { importing: boolean; current: number; total: number; phase: "upload" | "sorting" }) => void;
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

// GPS grouping: 60m radius (building-sized)
const LOCATION_GROUP_RADIUS_METERS = 60;
// Only split into a new group if GPS > 60m AND time gap > 2 hours
const TIME_GAP_MS = 2 * 60 * 60 * 1000;

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
  const noGpsFiles: LocalStagedFile[] = [];

  // Sort all files by time first so groups are chronological
  const sorted = [...files].sort(
    (a, b) => (a.takenAt?.getTime() ?? Infinity) - (b.takenAt?.getTime() ?? Infinity),
  );

  for (const file of sorted) {
    if (file.latitude == null || file.longitude == null) {
      noGpsFiles.push(file);
      continue;
    }

    // Try to match an existing group: must be within 60m AND within 2h time gap
    let matched = false;
    for (const group of groups) {
      if (group.latitude != null && group.longitude != null) {
        const dist = haversineDistance(file.latitude, file.longitude, group.latitude, group.longitude);
        if (dist <= LOCATION_GROUP_RADIUS_METERS) {
          // Within 60m — check time gap against closest file in group
          const fileTime = file.takenAt?.getTime();
          if (fileTime) {
            const groupTimes = group.files
              .map((f) => f.takenAt?.getTime())
              .filter((t): t is number => t != null);
            const closestGap = groupTimes.length > 0
              ? Math.min(...groupTimes.map((t) => Math.abs(fileTime - t)))
              : 0;
            if (closestGap > TIME_GAP_MS) continue; // too far apart in time, try next group
          }
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

  // Second pass: group no-GPS files by 2-hour time gap
  if (noGpsFiles.length > 0) {
    const sortedNoGps = [...noGpsFiles].sort(
      (a, b) => (a.takenAt?.getTime() ?? Infinity) - (b.takenAt?.getTime() ?? Infinity),
    );

    let currentGroup: LocalStagedFile[] = [sortedNoGps[0]];
    for (let i = 1; i < sortedNoGps.length; i++) {
      const prevTime = sortedNoGps[i - 1].takenAt?.getTime();
      const currTime = sortedNoGps[i].takenAt?.getTime();
      if (prevTime && currTime && currTime - prevTime <= TIME_GAP_MS) {
        currentGroup.push(sortedNoGps[i]);
      } else {
        groups.push({
          key: `nogps-${groups.length}`,
          locationName: "",
          latitude: null,
          longitude: null,
          files: currentGroup,
          earliestDate: null,
        });
        currentGroup = [sorted[i]];
      }
    }
    groups.push({
      key: `nogps-${groups.length}`,
      locationName: "",
      latitude: null,
      longitude: null,
      files: currentGroup,
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
  onProgressChange,
  existingSteps = [],
}: StagingInboxProps) {
  const { user } = useAuth();
  const [importing, setImporting] = useState(false);
  const [importProgress, setImportProgress] = useState({ current: 0, total: 0, phase: "upload" as "upload" | "sorting" });
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

  // Hard lock: prevent tab close during import
  useEffect(() => {
    if (!importing) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "Upload in progress. Leaving this page will cancel your import.";
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [importing]);

  // Report progress up to parent
  useEffect(() => {
    onProgressChange?.({ importing, current: importProgress.current, total: importProgress.total, phase: importProgress.phase });
  }, [importing, importProgress, onProgressChange]);

  const importSelected = async () => {
    if (!user) return;
    setImporting(true);

    const selectedGroups = groups.filter((g) => groupSelection.get(g.key));
    const allFiles = selectedGroups.flatMap((g) => g.files);
    const total = allFiles.length;
    let completed = 0;
    setImportProgress({ current: 0, total, phase: "upload" });

    try {
      // ── STEP A: Upload all files to storage in parallel (concurrency 5) ──
      interface UploadResult {
        file: LocalStagedFile;
        storagePath: string;
        groupKey: string;
      }
      const uploadQueue: Array<{ file: LocalStagedFile; groupKey: string }> = [];
      for (const group of selectedGroups) {
        for (const file of group.files) {
          uploadQueue.push({ file, groupKey: group.key });
        }
      }

      const uploadResults: UploadResult[] = [];
      const CONCURRENCY = 5;
      let nextIdx = 0;

      async function uploadWorker() {
        while (nextIdx < uploadQueue.length) {
          const idx = nextIdx++;
          const { file, groupKey } = uploadQueue[idx];
          try {
            const ext = file.fileName.split(".").pop() || "jpg";
            const objectName = `${user!.id}/${tripId}/staging/${crypto.randomUUID()}.${ext}`;

            await resumableUpload({
              bucketName: "trip-photos",
              objectName,
              file: file.file,
              contentType: file.mimeType || undefined,
            });

            uploadResults.push({ file, storagePath: objectName, groupKey });
          } catch (err) {
            console.error("Upload failed for", file.fileName, err);
          }
          completed++;
          setImportProgress({ current: completed, total, phase: "upload" });
        }
      }

      await Promise.all(
        Array.from({ length: Math.min(CONCURRENCY, uploadQueue.length) }, () => uploadWorker()),
      );

      if (uploadResults.length === 0) {
        toast.error("No files uploaded successfully");
        return;
      }

      // ── STEP B: Sort into trip stops ──
      setImportProgress({ current: completed, total, phase: "sorting" });
      const groupToUploads = new Map<string, UploadResult[]>();
      for (const ur of uploadResults) {
        const arr = groupToUploads.get(ur.groupKey) || [];
        arr.push(ur);
        groupToUploads.set(ur.groupKey, arr);
      }

      const stepRows: Array<{
        id: string;
        trip_id: string;
        user_id: string;
        latitude: number;
        longitude: number;
        recorded_at: string;
        source: string;
        event_type: string;
        is_confirmed: boolean;
        location_name: null;
        country: null;
      }> = [];

      const stepIdByGroupKey = new Map<string, string>();

      for (const group of selectedGroups) {
        const uploads = groupToUploads.get(group.key);
        if (!uploads || uploads.length === 0) continue;
        if (group.latitude == null || group.longitude == null) continue;

        // Check if we match an existing step (using same 500m radius)
        let existingStepId: string | null = null;
        for (const existing of existingSteps) {
          if (haversineDistance(existing.latitude, existing.longitude, group.latitude, group.longitude) < 500) {
            existingStepId = existing.id;
            break;
          }
        }

        if (existingStepId) {
          stepIdByGroupKey.set(group.key, existingStepId);
        } else {
          const newId = crypto.randomUUID();
          stepIdByGroupKey.set(group.key, newId);
          const stepDetails = buildImportedStepDetails({
            locationName: group.locationName,
            country: "",
          });
          stepRows.push({
            id: newId,
            trip_id: tripId,
            user_id: user.id,
            latitude: group.latitude,
            longitude: group.longitude,
            recorded_at: group.earliestDate?.toISOString() || new Date().toISOString(),
            source: "photo_import",
            event_type: stepDetails.eventType,
            is_confirmed: true,
            location_name: null,
            country: null,
          });
        }
      }

      // Bulk insert all new steps at once
      if (stepRows.length > 0) {
        const { error: stepsError } = await supabase.from("trip_steps").insert(stepRows);
        if (stepsError) {
          console.error("Bulk step insert failed:", stepsError);
          toast.error("Failed to create timeline steps");
          return;
        }
      }

      // Build photo rows
      const photoRows = [] as Array<{
        step_id: string;
        user_id: string;
        storage_path: string;
        file_name: string;
        latitude: number | null;
        longitude: number | null;
        taken_at: string | null;
        exif_data: { latitude: number | null; longitude: number | null; cameraMake: string | null; cameraModel: string | null } | null;
      }>;

      const videoUploads: UploadResult[] = [];

      for (const ur of uploadResults) {
        const stepId = stepIdByGroupKey.get(ur.groupKey);
        if (!stepId) continue;

        photoRows.push({
          step_id: stepId,
          user_id: user.id,
          storage_path: ur.storagePath,
          file_name: ur.file.fileName,
          latitude: ur.file.latitude ?? null,
          longitude: ur.file.longitude ?? null,
          taken_at: ur.file.takenAt?.toISOString() ?? null,
          exif_data: {
            latitude: ur.file.latitude,
            longitude: ur.file.longitude,
            cameraMake: ur.file.cameraMake,
            cameraModel: ur.file.cameraModel,
          },
        });

        if (ur.file.mimeType.startsWith("video/")) {
          videoUploads.push(ur);
        }
      }

      // Bulk insert all photos at once
      if (photoRows.length > 0) {
        const { error: photosError } = await supabase.from("step_photos").insert(photoRows);
        if (photosError) {
          console.error("Bulk photo insert failed:", photosError);
          toast.error("Failed to save photos");
        }
      }

      // Queue video analysis jobs
      for (const vu of videoUploads) {
        const group = selectedGroups.find((g) => g.key === vu.groupKey);
        await queueVideoAnalysisJob({
          captionId: vu.file.id,
          userId: user.id,
          tripId,
          storagePath: vu.storagePath,
          fileName: vu.file.fileName,
          mimeType: vu.file.mimeType,
          takenAt: vu.file.takenAt?.toISOString() ?? null,
          latitude: group?.latitude ?? null,
          longitude: group?.longitude ?? null,
          locationName: group?.locationName ?? "",
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

      // ── STEP D: Trigger background enrichment (UPDATE only) ──
      const newStepIds = stepRows.map((r) => r.id);
      if (newStepIds.length > 0) {
        supabase.functions
          .invoke("process-trip-steps", { body: { step_ids: newStepIds } })
          .catch((err) => console.error("Background processing trigger failed:", err));
      }

      toast.success("Import complete! Enhancing locations in the background...");
      onImportComplete();
    } catch (err) {
      console.error("Import error:", err);
      toast.error("Import failed");
    } finally {
      setImporting(false);
      setImportProgress({ current: 0, total: 0, phase: "upload" });
    }
  };

  const selectedGroupCount = groups.filter((g) => groupSelection.get(g.key)).length;
  const exifPending = localFiles.some((f) => !f.exifDone);
  const exifDoneCount = localFiles.filter((f) => f.exifDone).length;
  const exifPercent = localFiles.length > 0 ? Math.round((exifDoneCount / localFiles.length) * 100) : 0;
  const uploadPercent = importProgress.total > 0 ? Math.round((importProgress.current / importProgress.total) * 100) : 0;

  // Determine unified progress bar state
  const showProgressBar = exifPending || importing;
  let progressLabel = "";
  let progressPercent = 0;
  let showWarning = false;

  if (importing) {
    progressLabel = importProgress.phase === "sorting"
      ? "Sorting media into trip stops…"
      : `Uploading & importing… (${importProgress.current} of ${importProgress.total})`;
    progressPercent = uploadPercent;
    showWarning = true;
  } else if (exifPending) {
    progressLabel = "Reading file data…";
    progressPercent = exifPercent;
  }

  return (
    <div className="flex flex-col gap-4">
      {/* ── Unified Progress Bar ── */}
      {showProgressBar && (
        <div className="flex flex-col gap-2 rounded-xl border border-border bg-card p-4">
          <div className="flex items-center justify-between text-sm font-medium">
            <span className="flex items-center gap-2 text-foreground">
              <Loader2 className="h-4 w-4 animate-spin text-blue-600" />
              {progressLabel}
            </span>
            <span className="text-blue-600 font-semibold">{progressPercent}%</span>
          </div>
          <div className="h-4 w-full overflow-hidden rounded-full bg-gray-100">
            <div
              className="h-full rounded-full bg-blue-600 transition-all duration-300"
              style={{ width: `${Math.max(progressPercent, 2)}%` }}
            />
          </div>
          {showWarning && (
            <p className="text-xs text-muted-foreground">Do not close this page</p>
          )}
        </div>
      )}

      {/* Header */}
      <div className="flex items-center justify-between">
        <h3 className="font-display text-lg font-semibold text-foreground">
          Trip Inbox ({localFiles.length})
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
              ? `Importing… (${uploadPercent}%)`
              : "Import Selected"}
          </button>
        </div>
      </div>

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
