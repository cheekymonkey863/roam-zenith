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
  const [isGeocoding, setIsGeocoding] = useState(false);
  const [geocodingProgress, setGeocodingProgress] = useState({ current: 0, total: 0 });
  const prevKeysRef = useRef<string>("");

  useEffect(() => {
    const coordKeys = groups.map((g) => `${g.key}:${g.latitude}:${g.longitude}`).join("|");
    if (coordKeys === prevKeysRef.current) return;
    prevKeysRef.current = coordKeys;

    const toResolve = groups.filter((g) => g.latitude != null && g.longitude != null && !names.has(g.key));

    if (toResolve.length === 0) {
      setIsGeocoding(false);
      return;
    }

    setIsGeocoding(true);
    setGeocodingProgress({ current: 0, total: toResolve.length });
    let cancelled = false;

    (async () => {
      const batch = new Map<string, string>();
      let done = 0;
      for (const group of toResolve) {
        if (cancelled) break;
        let success = false;
        let attempts = 0;

        while (!success && attempts < 2) {
          try {
            attempts++;
            // Force a unique timestamp query parameter to bypass Nominatim's aggressive caching
            const res = await fetch(
              `https://nominatim.openstreetmap.org/reverse?format=json&lat=${group.latitude}&lon=${group.longitude}&zoom=18&_t=${Date.now()}`
            );
            if (res.ok) {
              const data = await res.json();
              const label = parseNominatimAddress(data);
              if (label) {
                batch.set(group.key, label);
              } else {
                // If it resolves but finds no specific name, fallback to coords immediately to prevent AI hallucination
                batch.set(group.key, `${group.latitude!.toFixed(4)}°, ${group.longitude!.toFixed(4)}°`);
              }
              success = true;
            } else {
              throw new Error("Nominatim error");
            }
          } catch (err) {
            console.warn(`Geocoding failed for group ${group.key}, attempt ${attempts}`);
            if (attempts < 2) await new Promise((r) => setTimeout(r, 2000));
          }
        }
        
        // If it still fails after retries, assign the coordinate fallback
        if (!success) {
           batch.set(group.key, `${group.latitude!.toFixed(4)}°, ${group.longitude!.toFixed(4)}°`);
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
          // STRICT 1.5 SECOND DELAY to prevent Nominatim from IP banning the request loop
          await new Promise((r) => setTimeout(r, 1500));
        }
      }
      
      if (!cancelled) {
        setIsGeocoding(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [groups]);

  return { names, isGeocoding, geocodingProgress };
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
  const { names: resolvedNames, isGeocoding, geocodingProgress } = useGroupLocationNames(groups);

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
        
        // Force raw coordinates if map lookup failed, protecting against AI hallucinations
        const finalLocationName = resolvedNames.get(group.key) || `${coords.latitude.toFixed(4)}°, ${coords.longitude.toFixed(4)}°`;

        const stepDetails = buildImportedStepDetails({
          locationName: finalLocationName,
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
          location_name: finalLocationName,
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
              locationName: finalLocationName,
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

  const exifPending = localFiles.some((f) => !f.exifDone);
  const exifDoneCount = localFiles.filter((f) => f.exifDone).length;
  
  const isAnalyzing = exifPending || isGeocoding;
  const showProgressBar = isAnalyzing || importing;
  const isCurtainLifted = !isAnalyzing;

  // Add the groups to the total analysis steps for accurate math
  const totalAnalysisSteps = localFiles.length + (groups.length > 0 ? groups.length : 0);
  const completedAnalysisSteps = exifDoneCount + geocodingProgress.current;
  const analysisPercent = totalAnalysisSteps > 0 ? Math.round((completedAnalysisSteps / totalAnalysisSteps) * 100) : 0;
  const uploadPercent = importProgress.total > 0 ? Math.round((importProgress.current / importProgress.total) * 100) : 0;

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
    progressLabel = "Analyzing media & fetching locations...";
    progressPercent = analysisPercent;
    progressColor = "bg-gray-400";
  }

  // Hide the entire UI until the curtain lifts
  if (!isCurtainLifted && !importing) {
    return (
      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-2 rounded-xl border border-border bg-card p-8 shadow-sm text-center items-center justify-center">
          <Loader2 className="h-8 w-8 animate-spin text-primary mb-2" />
          <h3 className="font-display text-lg font-semibold text-foreground">
            {exifPending ? "Reading image data..." : "Fetching map locations..."}
          </h3>
          <p className="text-sm text-muted-foreground max-w-sm">
            {exifPending 
              ? `Processing ${exifDoneCount} of ${localFiles.length} files.` 
              : `Dropping pins for ${geocodingProgress.current} of ${geocodingProgress.total} locations.`}
          </p>
          <div className="h-2 w-full max-w-md overflow-hidden rounded-full bg-gray-100 mt-4">
            <div
              className="h-full rounded-full transition-all duration-300 bg-primary"
              style={{ width: `${Math.max(progressPercent, 2)}%` }}
            />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4 relative">
      <div className="sticky top-0 z-50 bg-background/95 backdrop-blur py-4 border-b border-border shadow-sm flex flex-col gap-4">
        {importing && (
          <div className="flex flex-col gap-2 rounded-xl border border-border bg-card p-4 shadow-sm">
            <div className="flex items-center justify-between text-sm font-medium">
              <span className="flex items-center gap-2 text-foreground">
                <Loader2 className={cn("h-4 w-4 animate-spin text-blue-600")} />
                {importProgress.phase === "sorting" ? "Sorting media into trip stops…" : `Uploading & importing… (${importProgress.current} of ${importProgress.total})`}
              </span>
              <span className="font-semibold text-blue-600">
                {uploadPercent}%
              </span>
            </div>
            <div className="h-4 w-full overflow-hidden rounded-full bg-gray-100">
              <div
                className="h-full rounded-full transition-all duration-300 bg-blue-600"
                style={{ width: `${Math.max(uploadPercent, 2)}%` }}
              />
            </div>
            <p className="text-xs font-medium text-amber-600 flex items-center gap-1.5 mt-1">
              ⚠️ Do not switch tabs. Backgrounding this page may pause the upload.
            </p>
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
                disabled={