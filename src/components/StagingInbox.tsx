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
              `https://nominatim.openstreetmap.org/reverse?format=json&lat=${group.latitude}&lon=${group.longitude}&zoom=18`
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
      if ('wakeLock' in navigator) {
        wakeLock = await (navigator as any).wakeLock.request('screen');
      }
    } catch (err) {
      console.warn('Wake Lock API not supported or denied');
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
            longitude: file.