import { useState, useMemo, useEffect, useRef } from "react";
import {
  Check,
  CheckCircle2,
  CheckSquare,
  Loader2,
  MapPin,
  Square,
  Trash2,
  Upload,
  X,
  Film,
  Image as ImageIcon,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { buildImportedStepDetails } from "@/lib/placeClassification";
import { queueVideoAnalysisJob } from "@/lib/videoAnalysisQueue";
import { resumableUpload } from "@/lib/resumableUpload";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import type { LocalStagedFile } from "@/components/PhotoImport";
import { getGroupRepresentativeCoordinates, groupLocalFiles, type StagingGroup } from "@/lib/stagingGrouping";

interface StagingInboxProps {
  tripId: string;
  localFiles: LocalStagedFile[];
  onDeleteFiles: (ids: string[]) => void;
  onImportComplete: () => void;
  onCancel?: () => void;
  onAddMore: () => void;
  onProgressChange?: (progress: {
    importing: boolean;
    current: number;
    total: number;
    phase: "upload" | "sorting";
  }) => void;
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

function FileThumbnail({ file }: { file: LocalStagedFile }) {
  const isVideo = file.mimeType.startsWith("video/");

  return (
    <div className="relative aspect-square w-full overflow-hidden rounded-lg bg-muted">
      <img src={file.previewUrl} alt={file.fileName} className="h-full w-full object-cover" loading="lazy" />
      {isVideo && (
        <>
          <div className="absolute inset-0 flex items-center justify-center bg-black/30">
            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-white/20 backdrop-blur-sm">
              <Film className="h-5 w-5 text-white" />
            </div>
          </div>
          <div className="absolute bottom-1 right-1 rounded bg-black/60 px-1.5 py-0.5 text-[10px] font-medium text-white">
            VIDEO
          </div>
        </>
      )}
    </div>
  );
}

function parseNominatimAddress(data: any): string | null {
  const addr = data?.address;
  if (!addr) return null;

  const place =
    addr.amenity || addr.leisure || addr.tourism || addr.shop || addr.historic || addr.building || addr.road || null;
  const city = addr.city || addr.town || addr.village || null;
  const cc = addr.country_code ? addr.country_code.toUpperCase() : null;

  if (city && cc) {
    return place ? `${place} - ${city}, ${cc}` : `${city}, ${cc}`;
  }
  if (place) return place;
  return data?.display_name?.split(",").slice(0, 2).join(",").trim() || null;
}

function useGroupLocationNames(groups: StagingGroup[]) {
  const [names, setNames] = useState<Map<string, string>>(new Map());
  const [geocodingDone, setGeocodingDone] = useState(false);
  const [geocodingProgress, setGeocodingProgress] = useState({ current: 0, total: 0 });
  const prevKeysRef = useRef<string>("");

  useEffect(() => {
    const coordKeys = groups.map((g) => `${g.key}:${g.latitude}:${g.longitude}`).join("|");
    if (coordKeys === prevKeysRef.current) return;
    prevKeysRef.current = coordKeys;

    const toResolve = groups.filter((g) => g.latitude != null && g.longitude != null && !names.has(g.key));

    if (toResolve.length === 0) {
      setGeocodingDone(true);
      return;
    }

    setGeocodingDone(false);
    setGeocodingProgress({ current: 0, total: toResolve.length });
    let cancelled = false;

    (async () => {
      const batch = new Map<string, string>();
      let done = 0;
      for (const group of toResolve) {
        if (cancelled) break;
        let success = false;
        let attempts = 0;

        while (!success && attempts < 3) {
          try {
            attempts++;
            const res = await fetch(
              `https://nominatim.openstreetmap.org/reverse?format=json&lat=${group.latitude}&lon=${group.longitude}&zoom=18`,
            );
            if (res.ok) {
              const data = await res.json();
              const label = parseNominatimAddress(data);
              if (label) batch.set(group.key, label);
              success = true;
            } else {
              throw new Error("Nominatim rate limit or error");
            }
          } catch (err) {
            console.warn(`Geocoding failed for group ${group.key}, attempt ${attempts}`);
            if (attempts < 3) await new Promise((r) => setTimeout(r, 2000));
          }
        }

        done++;
        if (!cancelled) {
          setGeocodingProgress({ current: done, total: toResolve.length });
          if (batch.size > 0) {
            const snapshot = new Map(batch);
            setNames((prev) => {
              const next = new Map(prev);
              snapshot.forEach((v, k) => next.set(k, v));
              return next;
            });
          }
          await new Promise((r) => setTimeout(r, 1000));
        }
      }
      if (!cancelled) {
        setGeocodingDone(true);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [groups]);

  return { names, geocodingDone, geocodingProgress };
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
  const [importProgress, setImportProgress] = useState({
    current: 0,
    total: 0,
    phase: "upload" as "upload" | "sorting",
  });
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [completedGroups, setCompletedGroups] = useState<Set<string>>(new Set());

  const groups = useMemo(() => groupLocalFiles(localFiles), [localFiles]);
  const { names: resolvedNames, geocodingDone, geocodingProgress } = useGroupLocationNames(groups);

  const [groupSelection, setGroupSelection] = useState<Map<string, boolean>>(() => {
    const map = new Map<string, boolean>();
    groups.forEach((g) => map.set(g.key, true));
    return map;
  });

  useEffect(() => {
    setGroupSelection((prev) => {
      const next = new Map<string, boolean>();
      groups.forEach((g) => {
        next.set(g.key, prev.get(g.key) ?? true);
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

  useEffect(() => {
    if (!importing) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "Upload in progress. Leaving this page will cancel the upload.";
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [importing]);

  useEffect(() => {
    onProgressChange?.({
      importing,
      current: importProgress.current,
      total: importProgress.total,
      phase: importProgress.phase,
    });
  }, [importing, importProgress, onProgressChange]);

  const importSelected = async () => {
    if (!user) return;
    setImporting(true);
    setCompletedGroups(new Set());

    let wakeLock: any = null;
    try {
      if ("wakeLock" in navigator) {
        wakeLock = await (navigator as any).wakeLock.request("screen");
      }
    } catch (err) {
      console.warn("Wake Lock API not supported or denied");
    }

    const selectedGroups = groups.filter((g) => groupSelection.get(g.key));
    const allFiles = selectedGroups.flatMap((g) => g.files);
    const total = allFiles.length;
    let completed = 0;
    setImportProgress({ current: 0, total, phase: "upload" });

    try {
      const allNewStepIds: string[] = [];

      for (const group of selectedGroups) {
        const groupFiles = group.files;
        const CONCURRENCY = 3;
        let nextIdx = 0;
        const queue = [...groupFiles];
        const uploadedFiles: Array<{ file: LocalStagedFile; objectName: string }> = [];

        async function uploadWorker() {
          while (nextIdx < queue.length) {
            const idx = nextIdx++;
            const file = queue[idx];

            let success = false;
            let attempts = 0;

            while (!success && attempts < 3) {
              try {
                attempts++;
                const ext = file.fileName.split(".").pop() || "jpg";
                const objectName = `${user!.id}/${tripId}/staging/${crypto.randomUUID()}.${ext}`;

                await resumableUpload({
                  bucketName: "trip-photos",
                  objectName,
                  file: file.file,
                  contentType: file.mimeType || undefined,
                });

                uploadedFiles.push({ file, objectName });
                success = true;
              } catch (err) {
                console.warn(`Upload failed for ${file.fileName} (Attempt ${attempts}):`, err);
                if (attempts >= 3) {
                  toast.error(`Skipped ${file.fileName} due to network timeout.`);
                } else {
                  await new Promise((r) => setTimeout(r, 2000));
                }
              }
            }
            completed++;
            setImportProgress({ current: completed, total, phase: "upload" });
          }
        }

        await Promise.all(Array.from({ length: Math.min(CONCURRENCY, queue.length) }, () => uploadWorker()));

        if (uploadedFiles.length === 0) {
          setCompletedGroups((prev) => new Set(prev).add(group.key));
          continue;
        }

        const rawCoords = getGroupRepresentativeCoordinates(group);
        const coords =
          rawCoords && (rawCoords.latitude !== 0 || rawCoords.longitude !== 0)
            ? rawCoords
            : existingSteps.length > 0
              ? {
                  latitude: existingSteps[existingSteps.length - 1].latitude,
                  longitude: existingSteps[existingSteps.length - 1].longitude,
                }
              : null;

        if (!coords) {
          setCompletedGroups((prev) => new Set(prev).add(group.key));
          continue;
        }

        const earliest = group.earliestDate?.toISOString() ?? new Date().toISOString();
        const stepDetails = buildImportedStepDetails({
          locationName: resolvedNames.get(group.key) ?? "",
          country: "",
        });

        const stepId = crypto.randomUUID();
        const { error: stepError } = await supabase.from("trip_steps").insert({
          id: stepId,
          trip_id: tripId,
          user_id: user.id,
          latitude: coords.latitude,
          longitude: coords.longitude,
          recorded_at: earliest,
          source: "photo_import",
          event_type: stepDetails.eventType,
          is_confirmed: true,
          location_name: resolvedNames.get(group.key) || null,
          country: null,
        });

        if (stepError) {
          console.error("Step insert failed:", stepError);
          continue;
        }

        allNewStepIds.push(stepId);

        const photoRows = uploadedFiles.map(({ file, objectName }) => ({
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
        }));

        await supabase.from("step_photos").insert(photoRows);

        for (const { file, objectName } of uploadedFiles) {
          if (file.mimeType.startsWith("video/")) {
            queueVideoAnalysisJob({
              captionId: file.id,
              userId: user.id,
              tripId,
              storagePath: objectName,
              fileName: file.fileName,
              mimeType: file.mimeType,
              takenAt: file.takenAt?.toISOString() ?? null,
              latitude: group.latitude ?? null,
              longitude: group.longitude ?? null,
              locationName: resolvedNames.get(group.key) ?? "",
              country: "",
              nearbyPlaces: [],
              itinerarySteps: [],
            }).catch((err) => console.error("Video queue failed:", err));
          }
        }

        setCompletedGroups((prev) => new Set(prev).add(group.key));
      }

      setImportProgress((prev) => ({ ...prev, phase: "sorting" }));

      if (allNewStepIds.length > 0) {
        supabase.functions
          .invoke("process-trip-steps", { body: { step_ids: allNewStepIds } })
          .catch((err) => console.error("Background processing trigger failed:", err));
      }

      toast.success("All media secured! Trip details are being populated in the background.", { duration: 5000 });

      setTimeout(() => {
        onImportComplete();
      }, 2500);
    } catch (err) {
      console.error("Critical Import error:", err);
      toast.error("Import sequence encountered an unexpected error.");
      setImporting(false);
    } finally {
      if (wakeLock) {
        try {
          wakeLock.release();
        } catch (err) {}
      }
    }
  };

  const selectedGroupCount = groups.filter((g) => groupSelection.get(g.key)).length;

  // Unified Progress Math
  const exifPending = localFiles.some((f) => !f.exifDone);
  const exifDoneCount = localFiles.filter((f) => f.exifDone).length;
  const geocodingPending = !exifPending && !geocodingDone && groups.length > 0;

  const totalAnalysisSteps = localFiles.length + (groups.length > 0 ? groups.length : 0);
  const completedAnalysisSteps = exifDoneCount + geocodingProgress.current;
  const analysisPercent = totalAnalysisSteps > 0 ? Math.round((completedAnalysisSteps / totalAnalysisSteps) * 100) : 0;
  const uploadPercent =
    importProgress.total > 0 ? Math.round((importProgress.current / importProgress.total) * 100) : 0;

  const isAnalyzing = exifPending || geocodingPending;
  const showProgressBar = isAnalyzing || importing;
  const isCurtainLifted = !isAnalyzing;

  let progressLabel = "";
  let progressPercent = 0;
  let progressColor = "bg-gray-400";

  if (importing) {
    progressLabel =
      importProgress.phase === "sorting"
        ? "Sorting media into trip stops…"
        : `Uploading & importing… (${importProgress.current} of ${importProgress.total})`;
    progressPercent = uploadPercent;
    progressColor = "bg-blue-600";
  } else if (isAnalyzing) {
    progressLabel = "Analyzing media…";
    progressPercent = analysisPercent;
    progressColor = "bg-gray-400";
  }

  return (
    <div className="flex flex-col gap-4">
      {showProgressBar && (
        <div className="flex flex-col gap-2 rounded-xl border border-border bg-card p-4 shadow-sm">
          <div className="flex items-center justify-between text-sm font-medium">
            <span className="flex items-center gap-2 text-foreground">
              <Loader2 className={cn("h-4 w-4 animate-spin", importing ? "text-blue-600" : "text-gray-400")} />
              {progressLabel}
            </span>
            <span className={cn("font-semibold", importing ? "text-blue-600" : "text-gray-500")}>
              {progressPercent}%
            </span>
          </div>
          <div className="h-4 w-full overflow-hidden rounded-full bg-gray-100">
            <div
              className={cn("h-full rounded-full transition-all duration-300", progressColor)}
              style={{ width: `${Math.max(progressPercent, 2)}%` }}
            />
          </div>
          {importing && (
            <p className="text-xs font-medium text-amber-600 flex items-center gap-1.5 mt-1">
              ⚠️ Do not switch tabs. Backgrounding this page may pause the upload.
            </p>
          )}
        </div>
      )}

      <div className="flex flex-col gap-1">
        <div className="flex items-center justify-between">
          <h3 className="font-display text-lg font-semibold text-foreground">Trip Inbox ({localFiles.length})</h3>
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
            {!importing && (
              <button
                onClick={onAddMore}
                className="flex items-center gap-1.5 rounded-xl bg-secondary px-3 py-2 text-sm font-medium text-secondary-foreground hover:bg-secondary/80 transition-colors"
              >
                <Upload className="h-4 w-4" />
                Add More
              </button>
            )}
            {onCancel && !importing && (
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
              disabled={importing || selectedGroupCount === 0 || !isCurtainLifted}
              className="flex items-center gap-2 rounded-xl bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50"
            >
              {importing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
              {importing ? `Importing… (${uploadPercent}%)` : isAnalyzing ? "Analyzing media…" : "Import Selected"}
            </button>
          </div>
        </div>
        <p className="text-xs text-muted-foreground">
          Locations are preliminary. The importing process will populate accurate AI details.
        </p>
      </div>

      {isCurtainLifted && groups.length > 0 && (
        <div className="flex flex-col gap-3">
          {groups.map((group) => {
            const isSelected = groupSelection.get(group.key) ?? true;
            const isCompleted = completedGroups.has(group.key);
            return (
              <div
                key={group.key}
                className={cn(
                  "rounded-2xl border-2 p-4 transition-all",
                  isCompleted
                    ? "border-green-500 bg-green-50 dark:bg-green-950/20"
                    : isSelected
                      ? "border-primary bg-primary/5"
                      : "border-border bg-card opacity-60",
                )}
              >
                <div className="flex items-start gap-4">
                  {isCompleted ? (
                    <div className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-lg bg-green-500">
                      <CheckCircle2 className="h-4 w-4 text-white" />
                    </div>
                  ) : (
                    <div
                      onClick={() => !importing && toggleGroup(group.key)}
                      className={cn(
                        "mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-lg transition-colors",
                        importing ? "cursor-default" : "cursor-pointer",
                        isSelected ? "bg-primary" : "bg-muted",
                      )}
                    >
                      {isSelected && <Check className="h-3.5 w-3.5 text-primary-foreground" />}
                    </div>
                  )}

                  <div className="flex flex-1 flex-col gap-3">
                    <div className="flex flex-wrap items-center gap-2">
                      {isCompleted ? (
                        <CheckCircle2 className="h-4 w-4 text-green-500" />
                      ) : (
                        <MapPin className="h-4 w-4 text-primary" />
                      )}
                      <span className="text-lg font-semibold text-foreground">
                        {resolvedNames.get(group.key) ||
                          (group.latitude != null
                            ? `📍 ${group.latitude!.toFixed(4)}, ${group.longitude!.toFixed(4)}`
                            : `${group.files.length} file${group.files.length !== 1 ? "s" : ""}`)}
                      </span>
                      {group.earliestDate && (
                        <span className="text-sm text-muted-foreground">
                          {group.earliestDate.toLocaleDateString("en-US", {
                            weekday: "short",
                            month: "short",
                            day: "numeric",
                            hour: "numeric",
                            minute: "2-digit",
                          })}
                        </span>
                      )}
                      <span className="text-sm text-muted-foreground">
                        ({group.files.length} file{group.files.length !== 1 ? "s" : ""})
                      </span>
                      {isCompleted && (
                        <span className="rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-700 dark:bg-green-900/50 dark:text-green-400">
                          Imported ✓
                        </span>
                      )}
                    </div>

                    <div className="grid grid-cols-4 gap-2 sm:grid-cols-6 md:grid-cols-8">
                      {group.files.map((file) => {
                        const isFileSelected = selectedIds.has(file.id);
                        return (
                          <div
                            key={file.id}
                            className={cn(
                              "relative rounded-lg ring-2 transition-all group/thumb",
                              isCompleted
                                ? "ring-green-300 opacity-75"
                                : isFileSelected
                                  ? "ring-primary cursor-pointer"
                                  : "ring-transparent hover:ring-primary/50 cursor-pointer",
                            )}
                            draggable={!importing && !isCompleted}
                            onDragStart={(e) => {
                              e.dataTransfer.setData(
                                "text/plain",
                                JSON.stringify({ fileId: file.id, sourceGroupKey: group.key }),
                              );
                              e.dataTransfer.effectAllowed = "move";
                            }}
                            onClick={() => !importing && !isCompleted && toggleFileSelection(file.id)}
                          >
                            <FileThumbnail file={file} />
                            <button
                              type="button"
                              aria-pressed={isFileSelected}
                              onClick={(e) => {
                                e.stopPropagation();
                                if (!importing && !isCompleted) {
                                  toggleFileSelection(file.id);
                                }
                              }}
                              className={cn(
                                "absolute top-1 left-1 flex h-5 w-5 items-center justify-center rounded-sm border-2 transition-all",
                                isFileSelected
                                  ? "border-primary bg-primary opacity-100"
                                  : "border-white/70 bg-black/30 opacity-0 group-hover/thumb:opacity-100",
                              )}
                            >
                              {isFileSelected ? (
                                <CheckSquare className="h-3.5 w-3.5 text-primary-foreground" />
                              ) : (
                                <Square className="h-3.5 w-3.5 text-white" />
                              )}
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

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
