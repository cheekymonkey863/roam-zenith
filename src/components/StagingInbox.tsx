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

export function StagingInbox({ tripId, localFiles, onDeleteFiles, onImportComplete, onCancel, onAddMore, existingSteps = [] }: StagingInboxProps) {
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

    return rawGroups.map(g => {
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
    const toResolve = groups.filter(g => g.latitude !== 0 && !resolvedNames.has(g.key));
    if (toResolve.length === 0 || isGeocoding) return;

    setIsGeocoding(true);
    setGeoProgress({ current: 0, total: toResolve.length });

    (async () => {
      const newNames = new Map(resolvedNames);
      for (let i = 0; i < toResolve.length; i++) {
        const g = toResolve[i];
        try {
          const res = await fetch(`https://nominatim.openstreetmap.org/reverse?format=json&lat=${g.latitude}&lon=${g.longitude}&zoom=18&addressdetails=1`);
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
        await new Promise(r => setTimeout(r, 1200));
      }
      setIsGeocoding(false);
    })();
  }, [groups]);

  const toggleFileSelection = (id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
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
          setImportProgress(p => ({ ...p, current: p.current + 1 }));
        }

        const stepId = crypto.randomUUID();
        const locName = resolvedNames.get(group.key);
        await