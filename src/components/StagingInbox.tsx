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
}: StagingInboxProps) {
  const { user } = useAuth();
  const [importing, setImporting] = useState(false);
  const [importProgress, setImportProgress] = useState({ current: 0, total: 0 });
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
      if (coords && coords.latitude !== 0) {
        lastValidLat = coords.latitude;
        lastValidLon = coords.longitude;
        return { ...g, latitude: coords.latitude, longitude: coords.longitude };
      }
      return { ...g, latitude: lastValidLat, longitude: lastValidLon };
    });
  }, [localFiles, existingSteps]);

  useEffect(() => {
    const toResolve = groups.filter((g) => g.latitude !== 0 && !resolvedNames.has(g.key));
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
            newNames.set(g.key, name || `${g.latitude?.toFixed(4)}, ${g.longitude?.toFixed(4)}`);
          }
        } catch (e) {
          newNames.set(g.key, `${g.latitude?.toFixed(4)}, ${g.longitude?.toFixed(4)}`);
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

  const importSelected = async () => {
    if (!user) return;
    setImporting(true);
    const selectedGroups = groups;
    setImportProgress({ current: 0, total: localFiles.length });

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
        const locName = resolvedNames.get(group.key);
        await supabase.from("trip_steps").insert({
          id: stepId,
          trip_id: tripId,
          user_id: user.id,
          latitude: group.latitude,
          longitude: group.longitude,
          recorded_at: group.earliestDate?.toISOString(),
          location_name: locName,
          is_confirmed: true,
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

        setCompletedGroups((prev) => new Set(prev).add(group.key));
      }
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
              <span>Securing Media...</span>
              <span>{Math.round((importProgress.current / importProgress.total) * 100)}%</span>
            </div>
            <div className="h-2 w-full bg-gray-200 rounded-full overflow-hidden">
              <div
                className="h-full bg-blue-600 transition-all"
                style={{ width: `${(importProgress.current / importProgress.total) * 100}%` }}
              />
            </div>
          </div>
        )}
        <div className="flex justify-between items-center">
          <h3 className="text-xl font-bold">Trip Inbox ({localFiles.length})</h3>
          <div className="flex gap-2">
            <button onClick={onAddMore} className="px-4 py-2 bg-secondary rounded-xl text-sm font-medium">
              Add More
            </button>
            <button
              onClick={importSelected}
              disabled={importing}
              className="px-6 py-2 bg-primary text-white rounded-xl font-bold shadow-lg disabled:opacity-50"
            >
              {importing ? "Importing..." : "Import Selected"}
            </button>
          </div>
        </div>
      </div>

      <div className="flex flex-col gap-4 mt-4">
        {groups.map((group) => (
          <div
            key={group.key}
            className={cn(
              "rounded-2xl border-2 p-4 transition-all",
              completedGroups.has(group.key) ? "border-green-500 bg-green-50" : "border-border bg-card",
            )}
          >
            <div className="flex items-start gap-4">
              {completedGroups.has(group.key) ? (
                <CheckCircle2 className="h-6 w-6 text-green-500" />
              ) : (
                <MapPin className="h-6 w-6 text-primary" />
              )}
              <div className="flex-1">
                <div className="flex justify-between items-center mb-3">
                  <span className="text-lg font-bold">
                    {resolvedNames.get(group.key) ||
                      `${group.latitude?.toFixed(4) ?? 0}, ${group.longitude?.toFixed(4) ?? 0}`}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {group.earliestDate?.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                  </span>
                </div>
                <div className="grid grid-cols-4 sm:grid-cols-6 gap-2">
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
        ))}
      </div>
    </div>
  );
}
