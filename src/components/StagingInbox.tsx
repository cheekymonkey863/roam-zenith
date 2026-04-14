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
  if (addr.house_number && addr.road) return `${addr.house_number} ${addr.road}, ${addr.city || addr.town || ""}`;
  const place = addr.amenity || addr.leisure || addr.tourism || addr.shop || addr.historic || addr.building;
  const road = addr.road || addr.pedestrian || addr.path;
  const city = addr.city || addr.town || addr.village || "";
  if (place && city) return `${place} - ${city}`;
  if (road && city) return `${road}, ${city}`;
  return data?.display_name?.split(",").slice(0, 2).join(",").trim() || null;
}

export function StagingInbox({
  tripId,
  localFiles,
  onDeleteFiles,
  onImportComplete,
  onCancel,
  onAddMore,
  existingSteps = [],
  onProgressChange,
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
  const [resolvedNames, setResolvedNames] = useState<Map<string, string>>(new Map());
  const [isGeocoding, setIsGeocoding] = useState(false);
  const [geoProgress, setGeoProgress] = useState({ current: 0, total: 0 });

  const groups = useMemo(() => {
    const rawGroups = groupLocalFiles(localFiles);
    let lastValidLat = existingSteps[existingSteps.length - 1]?.latitude || 0;
    let lastValidLon = existingSteps[existingSteps.length - 1]?.longitude || 0;

    return rawGroups.map((g) => {
      const coords = getGroupRepresentativeCoordinates(g);
      if (coords && (coords.latitude !== 0 || coords.longitude !== 0)) {
        lastValidLat = coords.latitude;
        lastValidLon = coords.longitude;
        return { ...g, latitude: coords.latitude, longitude: coords.longitude };
      }
      return { ...g, latitude: lastValidLat, longitude: lastValidLon };
    });
  }, [localFiles, existingSteps]);

  useEffect(() => {
    const toResolve = groups.filter((g) => (g.latitude !== 0 || g.longitude !== 0) && !resolvedNames.has(g.key));
    if (toResolve.length === 0 || isGeocoding) return;

    setIsGeocoding(true);
    setGeoProgress({ current: 0, total: toResolve.length });

    (async () => {
      const newNames = new Map(resolvedNames);
      for (let i = 0; i < toResolve.length; i++) {
        const g = toResolve[i];
        try {
          const res = await fetch(
            `https://nominatim.openstreetmap.org/reverse?format=json&lat=${g.latitude}&lon=${g.longitude}&zoom=18&addressdetails=1`,
          );
          if (res.ok) {
            const data = await res.json();
            const name = parseNominatimAddress(data);
            if (name) newNames.set(g.key, name);
          }
        } catch (e) {
          // silently handle the failed map fetch and rely on fallback coords later
        }
        setResolvedNames(new Map(newNames));
        setGeoProgress({ current: i + 1, total: toResolve.length });
        await new Promise((r) => setTimeout(r, 1200));
      }
      setIsGeocoding(false);
    })();
  }, [groups]);

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
      e.returnValue = "Upload in progress. Do not close.";
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
    const selectedGroups = groups;
    setImportProgress({ current: 0, total: localFiles.length, phase: "upload" });

    try {
      const allNewStepIds: string[] = [];
      for (const group of selectedGroups) {
        const uploaded: string[] = [];
        for (const f of group.files) {
          const ext = f.fileName.split(".").pop() || "jpg";
          const path = `${user.id}/${tripId}/staging/${crypto.randomUUID()}.${ext}`;
          await resumableUpload({ bucketName: "trip-photos", objectName: path, file: f.file });
          uploaded.push(path);
          setImportProgress((p) => ({ ...p, current: p.current + 1 }));
        }

        const stepId = crypto.randomUUID();
        const locName = resolvedNames.get(group.key) || null;
        await supabase.from("trip_steps").insert({
          id: stepId,
          trip_id: tripId,
          user_id: user.id,
          latitude: group.latitude,
          longitude: group.longitude,
          recorded_at: group.earliestDate?.toISOString(),
          location_name: locName,
          is_confirmed: false,
          source: "photo_import",
        });
        allNewStepIds.push(stepId);

        await supabase.from("step_photos").insert(
          group.files.map((f, i) => ({
            step_id: stepId,
            user_id: user.id,
            storage_path: uploaded[i],
            file_name: f.fileName,
            taken_at: f.takenAt?.toISOString(),
          })),
        );

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
              latitude: group.latitude,
              longitude: group.longitude,
              locationName: locName || "",
              country: "",
              nearbyPlaces: [],
              itinerarySteps: [],
            }).catch(() => {});
          }
        }

        setCompletedGroups((prev) => new Set(prev).add(group.key));
      }

      setImportProgress((p) => ({ ...p, phase: "sorting" }));
      supabase.functions.invoke("process-trip-steps", { body: { step_ids: allNewStepIds } });
      toast.success("Import Secured!");
      setTimeout(onImportComplete, 2000);
    } catch (e) {
      setImporting(false);
    }
  };

  const isAnalyzing = localFiles.some((f) => !f.exifDone) || isGeocoding;

  if (isAnalyzing && !importing) {
    return (
      <div className="flex flex-col gap-4 bg-card border p-10 rounded-2xl shadow-xl items-center text-center">
        <Loader2 className="h-10 w-10 animate-spin text-primary mb-2" />
        <h3 className="text-xl font-semibold">Matching Media to Locations...</h3>
        <p className="text-muted-foreground">
          Pinpointing exact addresses within 6m ({geoProgress.current}/{geoProgress.total})
        </p>
        <div className="h-2 w-full max-w-md bg-muted rounded-full mt-4 overflow-hidden">
          <div
            className="h-full bg-primary transition-all"
            style={{ width: `${(geoProgress.current / geoProgress.total) * 100}%` }}
          />
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4 relative bg-background border rounded-2xl shadow-2xl p-6">
      <div className="sticky top-0 z-50 bg-background/95 backdrop-blur pb-4 border-b flex flex-col gap-4">
        {importing && (
          <div className="p-4 bg-primary/5 rounded-xl border border-primary/20">
            <div className="flex justify-between text-sm font-medium mb-2">
              <span className="flex items-center gap-2">
                <Loader2 className="h-4 w-4 animate-spin text-primary" />
                {importProgress.phase === "sorting" ? "Sorting stops..." : "Securing Media..."}
              </span>
              <span className="font-semibold text-primary">
                {Math.round((importProgress.current / importProgress.total) * 100)}%
              </span>
            </div>
            <div className="h-2 w-full bg-gray-200 rounded-full overflow-hidden">
              <div
                className="h-full bg-primary transition-all"
                style={{ width: `${(importProgress.current / importProgress.total) * 100}%` }}
              />
            </div>
          </div>
        )}
        <div className="flex justify-between items-center">
          <h3 className="text-xl font-bold">Trip Inbox ({localFiles.length})</h3>

          <div className="flex items-center gap-2">
            {/* The Restored Delete and Cancel Buttons */}
            {selectedIds.size > 0 && (
              <button
                onClick={deleteSelected}
                className="flex items-center gap-1.5 rounded-xl bg-destructive/10 px-4 py-2 text-sm font-medium text-destructive hover:bg-destructive/20 transition-colors"
              >
                <Trash2 className="h-4 w-4" />
                Delete ({selectedIds.size})
              </button>
            )}
            {!importing && (
              <button
                onClick={onAddMore}
                className="flex items-center gap-1.5 rounded-xl bg-secondary px-4 py-2 text-sm font-medium text-secondary-foreground hover:bg-secondary/80 transition-colors"
              >
                <Upload className="h-4 w-4" />
                Add More
              </button>
            )}
            {onCancel && !importing && (
              <button
                onClick={onCancel}
                className="flex items-center gap-1.5 rounded-xl bg-secondary px-4 py-2 text-sm font-medium text-secondary-foreground hover:bg-secondary/80 transition-colors"
              >
                <X className="h-4 w-4" />
                Cancel
              </button>
            )}
            <button
              onClick={importSelected}
              disabled={importing || groups.length === 0}
              className="flex items-center gap-2 rounded-xl bg-primary px-6 py-2.5 text-sm font-semibold text-primary-foreground shadow-lg disabled:opacity-50"
            >
              {importing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
              {importing ? "Importing..." : "Import Selected"}
            </button>
          </div>
        </div>
      </div>

      <div className="flex flex-col gap-4 mt-4">
        {groups.map((group) => {
          // Check for valid location display vs 0.0000 fallback
          const hasValidCoords = group.latitude !== 0 || group.longitude !== 0;
          const fallbackDisplay = hasValidCoords
            ? `${group.latitude?.toFixed(4)}, ${group.longitude?.toFixed(4)}`
            : "Unknown Location";
          const displayName = resolvedNames.get(group.key) || fallbackDisplay;

          return (
            <div
              key={group.key}
              className={cn(
                "rounded-2xl border-2 p-4 transition-all",
                completedGroups.has(group.key) ? "border-green-500 bg-green-50" : "border-border bg-card",
              )}
            >
              <div className="flex items-start gap-4">
                {completedGroups.has(group.key) ? (
                  <CheckCircle2 className="h-6 w-6 text-green-500 shrink-0 mt-0.5" />
                ) : (
                  <MapPin className="h-6 w-6 text-primary shrink-0 mt-0.5" />
                )}
                <div className="flex-1 min-w-0">
                  <div className="flex justify-between items-center mb-3 gap-4">
                    <span className="text-lg font-bold truncate">{displayName}</span>
                    <span className="text-xs text-muted-foreground shrink-0">
                      {group.earliestDate?.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                    </span>
                  </div>
                  <div className="grid grid-cols-4 sm:grid-cols-6 md:grid-cols-8 gap-2">
                    {group.files.map((file) => (
                      <div
                        key={file.id}
                        className={cn(
                          "relative rounded-lg ring-2 transition-all cursor-pointer",
                          selectedIds.has(file.id) ? "ring-primary" : "ring-transparent",
                        )}
                        onClick={() => toggleFileSelection(file.id)}
                      >
                        <FileThumbnail file={file} />
                        <div
                          className={cn(
                            "absolute top-1 left-1 h-5 w-5 rounded border-2 flex items-center justify-center",
                            selectedIds.has(file.id) ? "bg-primary border-primary" : "bg-black/20 border-white",
                          )}
                        >
                          {selectedIds.has(file.id) && <Check className="h-3 w-3 text-white" />}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
