import { useState, useMemo } from "react";
import { Check, Loader2, MapPin, Trash2, Upload, X, Film, Image as ImageIcon } from "lucide-react";
import { type StagedMediaFile, type UploadProgress } from "@/hooks/useStagingInbox";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { buildImportedStepDetails } from "@/lib/placeClassification";
import { queueVideoAnalysisJob } from "@/lib/videoAnalysisQueue";
import { buildStoredMediaMetadata } from "@/lib/mediaMetadata";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

interface StagingGroup {
  key: string;
  locationName: string;
  country: string;
  latitude: number | null;
  longitude: number | null;
  files: StagedMediaFile[];
  earliestDate: Date | null;
  selected: boolean;
}

interface StagingInboxProps {
  tripId: string;
  stagedFiles: StagedMediaFile[];
  uploads: Map<string, UploadProgress>;
  isUploading: boolean;
  overallProgress: number;
  onDeleteFiles: (ids: string[]) => Promise<void>;
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
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function groupStagedFiles(files: StagedMediaFile[]): StagingGroup[] {
  const groups: StagingGroup[] = [];
  const ungrouped: StagedMediaFile[] = [];

  for (const file of files) {
    const lat = file.exif_metadata?.latitude;
    const lng = file.exif_metadata?.longitude;

    if (lat == null || lng == null) {
      ungrouped.push(file);
      continue;
    }

    let matched = false;
    for (const group of groups) {
      if (group.latitude != null && group.longitude != null) {
        const dist = haversineDistance(lat, lng, group.latitude, group.longitude);
        if (dist <= LOCATION_GROUP_RADIUS_METERS) {
          group.files.push(file);
          matched = true;
          break;
        }
      }
    }

    if (!matched) {
      // Check AI result for location name
      const venueName = file.ai_result?.suggestedVenueName;
      const cityName = file.ai_result?.suggestedCityName;
      const locationName = venueName && cityName
87:         ? `${venueName}, ${cityName}`
88:         : venueName || null; // null = pending resolution

      groups.push({
        key: `group-${groups.length}`,
        locationName: locationName || "",
        country: "",
        latitude: lat,
        longitude: lng,
        files: [file],
        earliestDate: file.exif_metadata?.takenAt ? new Date(file.exif_metadata.takenAt) : null,
        selected: true,
      });
    }
  }

  // Add ungrouped files as their own group
  if (ungrouped.length > 0) {
    groups.push({
      key: "ungrouped",
      locationName: "",
      country: "",
      latitude: null,
      longitude: null,
      files: ungrouped,
      earliestDate: null,
      selected: true,
    });
  }

  // Update group location names from AI results
  for (const group of groups) {
    const aiFile = group.files.find(
      (f) => f.ai_result?.suggestedVenueName || f.ai_result?.suggestedCityName,
    );
    if (aiFile?.ai_result) {
      const venue = aiFile.ai_result.suggestedVenueName;
      const city = aiFile.ai_result.suggestedCityName;
      if (venue && city) {
        group.locationName = `${venue}, ${city}`;
      } else if (venue) {
        group.locationName = venue;
      }
    }

    // Compute earliest date
    const dates = group.files
      .map((f) => f.exif_metadata?.takenAt)
      .filter(Boolean)
      .map((d) => new Date(d!));
    group.earliestDate = dates.length > 0 ? new Date(Math.min(...dates.map((d) => d.getTime()))) : null;
  }

  return groups.sort(
    (a, b) => (a.earliestDate?.getTime() ?? Infinity) - (b.earliestDate?.getTime() ?? Infinity),
  );
}

function StagedFileThumbnail({ file }: { file: StagedMediaFile }) {
  const isVideo = file.mime_type.startsWith("video/");
  const url = file.publicUrl;

  if (isVideo) {
    return (
      <div className="relative aspect-square w-full overflow-hidden rounded-lg bg-slate-900">
        <video
          src={`${url}#t=0.001`}
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
    <div className="aspect-square w-full overflow-hidden rounded-lg bg-muted">
      <img src={url} alt={file.file_name} className="h-full w-full object-cover" loading="lazy" />
    </div>
  );
}

function AiStatusIndicator({ file }: { file: StagedMediaFile }) {
  const status = file.ai_processing_status;
  const hasNoGps = file.exif_metadata?.latitude == null || file.exif_metadata?.longitude == null;

  if (status === "complete") return null; // Clean — no badge needed
  if (status === "processing" || (status === "pending" && hasNoGps)) {
    return (
      <span className="flex items-center gap-1 rounded-full bg-black/50 px-2 py-0.5 text-[10px] font-medium text-white/80 backdrop-blur-sm">
        <Loader2 className="h-3 w-3 animate-spin" />
        {hasNoGps ? "Locating…" : "Enhancing…"}
      </span>
    );
  }
  if (status === "pending") {
    return (
      <span className="rounded-full bg-black/40 px-2 py-0.5 text-[10px] font-medium text-white/70 backdrop-blur-sm">
        Queued
      </span>
    );
  }
  // failed — subtle indicator
  return null;
}

export function StagingInbox({
  tripId,
  stagedFiles,
  uploads,
  isUploading,
  overallProgress,
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

  const groups = useMemo(() => groupStagedFiles(stagedFiles), [stagedFiles]);

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

  const deleteSelected = async () => {
    if (selectedIds.size === 0) return;
    await onDeleteFiles(Array.from(selectedIds));
    setSelectedIds(new Set());
  };

  const importSelected = async () => {
    if (!user) return;
    setImporting(true);

    const selectedGroups = groups.filter((g) => groupSelection.get(g.key));
    const totalItems = selectedGroups.reduce((n, g) => n + g.files.length, 0) + selectedGroups.length;
    let completed = 0;
    setImportProgress({ current: 0, total: totalItems });

    for (const group of selectedGroups) {
      if (group.latitude == null || group.longitude == null) {
        completed++;
        setImportProgress({ current: completed, total: totalItems });
        continue;
      }

      const stepDetails = buildImportedStepDetails({
        locationName: group.locationName,
        country: group.country,
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
            location_name: group.locationName,
            country: group.country || null,
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
          toast.error(`Failed to create step for ${group.locationName}`);
          completed++;
          continue;
        }
        stepId = stepData.id;
      }

      completed++;
      setImportProgress({ current: completed, total: totalItems });

      for (const file of group.files) {
        // Move file from staging to final path
        const finalPath = `${user.id}/${tripId}/${stepId}/${crypto.randomUUID()}.${file.file_name.split(".").pop() || "jpg"}`;
        const { error: moveError } = await supabase.storage
          .from("trip-photos")
          .move(file.storage_path, finalPath);

        if (moveError) {
          console.error("File move error:", moveError);
          // Try copy instead
          const { error: copyError } = await supabase.storage
            .from("trip-photos")
            .copy(file.storage_path, finalPath);
          if (copyError) {
            console.error("File copy error:", copyError);
            completed++;
            setImportProgress({ current: completed, total: totalItems });
            continue;
          }
        }

        const exifData: Record<string, any> = {
          latitude: file.exif_metadata?.latitude,
          longitude: file.exif_metadata?.longitude,
          locationName: group.locationName,
          country: group.country,
        };
        if (file.ai_result) {
          exifData.caption = file.ai_result.caption;
          exifData.essence = file.ai_result.essence;
          exifData.sceneDescription = file.ai_result.sceneDescription;
          exifData.aiTags = file.ai_result.tags;
        }

        await supabase.from("step_photos").insert({
          step_id: stepId,
          user_id: user.id,
          storage_path: finalPath,
          file_name: file.file_name,
          latitude: file.exif_metadata?.latitude ?? null,
          longitude: file.exif_metadata?.longitude ?? null,
          taken_at: file.exif_metadata?.takenAt ?? null,
          exif_data: exifData,
        });

        // Queue video analysis for videos
        if (file.mime_type.startsWith("video/")) {
          await queueVideoAnalysisJob({
            captionId: file.id,
            userId: user.id,
            tripId,
            storagePath: finalPath,
            fileName: file.file_name,
            mimeType: file.mime_type,
            takenAt: file.exif_metadata?.takenAt ?? null,
            latitude: group.latitude,
            longitude: group.longitude,
            locationName: group.locationName,
            country: group.country,
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

        completed++;
        setImportProgress({ current: completed, total: totalItems });
      }

      // Clean up DB rows for this group
      await supabase
        .from("pending_media_imports")
        .delete()
        .in("id", group.files.map((f) => f.id));
    }

    toast.success("Import complete!");
    setImporting(false);
    setImportProgress({ current: 0, total: 0 });
    onImportComplete();
  };

  const pendingAiCount = stagedFiles.filter((f) => f.ai_processing_status === "pending" || f.ai_processing_status === "processing").length;
  const selectedGroupCount = groups.filter((g) => groupSelection.get(g.key)).length;

  // Helper: resolve display name for a group
  const getGroupDisplayName = (group: StagingGroup) => {
    if (group.locationName) return group.locationName;
    // No venue yet — show date/time as placeholder
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
  };

  const isEnhancing = pendingAiCount > 0;

  return (
    <div className="flex flex-col gap-4">
      {/* Upload progress */}
      {isUploading && (
        <div className="rounded-2xl bg-card p-4 shadow-card">
          <div className="flex items-center gap-3">
            <Loader2 className="h-5 w-5 animate-spin text-primary" />
            <div className="flex-1">
              <div className="flex items-center justify-between text-sm">
                <span className="font-medium text-foreground">Uploading…</span>
                <span className="text-muted-foreground">{overallProgress}%</span>
              </div>
              <div className="mt-1.5 h-2 w-full overflow-hidden rounded-full bg-muted">
                <div
                  className="h-full rounded-full bg-primary transition-all duration-300"
                  style={{ width: `${overallProgress}%` }}
                />
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Enhancing bar */}
      {isEnhancing && !isUploading && (
        <div className="flex items-center gap-3 rounded-2xl bg-card p-3 shadow-card">
          <Loader2 className="h-4 w-4 animate-spin text-primary" />
          <span className="text-sm text-muted-foreground">Enhancing your timeline…</span>
          <div className="ml-auto h-1.5 w-24 overflow-hidden rounded-full bg-muted">
            <div className="h-full animate-pulse rounded-full bg-primary/60" style={{ width: "60%" }} />
          </div>
        </div>
      )}

      {/* Header */}
      <div className="flex items-center justify-between">
        <h3 className="font-display text-lg font-semibold text-foreground">
          Trip Inbox ({stagedFiles.length})
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
            <span>Moving files to trip…</span>
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
                    <span className="text-lg font-medium text-foreground">{group.locationName}</span>
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
                        <StagedFileThumbnail file={file} />
                        <div className="absolute top-1 right-1">
                          <AiStatusBadge status={file.ai_processing_status} />
                        </div>
                        {selectedIds.has(file.id) && (
                          <div className="absolute inset-0 flex items-center justify-center rounded-lg bg-destructive/20">
                            <Trash2 className="h-5 w-5 text-destructive" />
                          </div>
                        )}
                      </div>
                    ))}
                  </div>

                  {/* AI captions hidden in staging — data preserved in ai_result for import */}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {stagedFiles.length === 0 && !isUploading && (
        <div className="flex flex-col items-center gap-4 rounded-2xl border-2 border-dashed border-border p-12 text-center">
          <ImageIcon className="h-10 w-10 text-muted-foreground" />
          <div>
            <p className="font-medium text-foreground">No files in staging</p>
            <p className="text-sm text-muted-foreground">Drop photos & videos to start</p>
          </div>
        </div>
      )}
    </div>
  );
}