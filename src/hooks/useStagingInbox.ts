import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { extractExifFromFile, type PhotoExifData } from "@/lib/exif";
import { resumableUpload } from "@/lib/resumableUpload";
import { toast } from "sonner";

export interface StagedMediaFile {
  id: string;
  trip_id: string;
  storage_path: string;
  mime_type: string;
  file_name: string;
  exif_metadata: {
    latitude?: number | null;
    longitude?: number | null;
    takenAt?: string | null;
    cameraMake?: string | null;
    cameraModel?: string | null;
    duration?: number | null;
  };
  ai_processing_status: "pending" | "processing" | "complete" | "failed";
  ai_result: {
    caption?: string;
    essence?: string;
    suggestedVenueName?: string;
    suggestedCityName?: string;
    tags?: string[];
    sceneDescription?: string;
  } | null;
  group_key: string | null;
  created_at: string;
  publicUrl: string;
  /** Local object URL for instant preview before upload completes */
  localPreviewUrl?: string;
  /** True while the file is still uploading to storage */
  isLocalOnly?: boolean;
}

export interface UploadProgress {
  fileName: string;
  percent: number;
  status: "uploading" | "done" | "error";
}

/** Run async tasks with a concurrency cap */
async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<PromiseSettledResult<R>[]> {
  const results: PromiseSettledResult<R>[] = new Array(items.length);
  let nextIndex = 0;

  async function worker() {
    while (nextIndex < items.length) {
      const i = nextIndex++;
      try {
        results[i] = { status: "fulfilled", value: await fn(items[i], i) };
      } catch (reason: any) {
        results[i] = { status: "rejected", reason };
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, () => worker()));
  return results;
}

export function useStagingInbox(tripId: string) {
  const { user } = useAuth();
  const [stagedFiles, setStagedFiles] = useState<StagedMediaFile[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploads, setUploads] = useState<Map<string, UploadProgress>>(new Map());
  // Track local preview URLs for cleanup
  const localUrlsRef = useRef<Set<string>>(new Set());

  const getPublicUrl = useCallback((storagePath: string) => {
    const { data } = supabase.storage.from("trip-photos").getPublicUrl(storagePath);
    return data.publicUrl;
  }, []);

  // Fetch existing staged files for this trip
  const fetchStaged = useCallback(async () => {
    if (!user || !tripId) return;
    const { data, error } = await supabase
      .from("pending_media_imports")
      .select("*")
      .eq("trip_id", tripId)
      .eq("user_id", user.id)
      .order("created_at", { ascending: true });

    if (error) {
      console.error("Failed to fetch staged files:", error);
      return;
    }

    setStagedFiles(
      (data || []).map((row: any) => ({
        ...row,
        publicUrl: getPublicUrl(row.storage_path),
      })),
    );
    setLoading(false);
  }, [user, tripId, getPublicUrl]);

  useEffect(() => {
    fetchStaged();
  }, [fetchStaged]);

  // Cleanup all local object URLs on unmount
  useEffect(() => {
    const urls = localUrlsRef.current;
    return () => {
      urls.forEach((u) => URL.revokeObjectURL(u));
      urls.clear();
    };
  }, []);

  // Realtime subscription
  useEffect(() => {
    if (!user || !tripId) return;

    const channel = supabase
      .channel(`staging-${tripId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "pending_media_imports",
          filter: `trip_id=eq.${tripId}`,
        },
        (payload) => {
          if (payload.eventType === "INSERT") {
            const row = payload.new as any;
            setStagedFiles((prev) => {
              // Revoke + remove local placeholders for this file
              const replaced = prev.filter((f) => f.isLocalOnly && f.file_name === row.file_name);
              replaced.forEach((f) => {
                if (f.localPreviewUrl) {
                  URL.revokeObjectURL(f.localPreviewUrl);
                  localUrlsRef.current.delete(f.localPreviewUrl);
                }
              });
              const withoutLocal = prev.filter((f) => !(f.isLocalOnly && f.file_name === row.file_name));
              if (withoutLocal.some((f) => f.id === row.id)) return withoutLocal;
              return [...withoutLocal, { ...row, publicUrl: getPublicUrl(row.storage_path) }];
            });
          } else if (payload.eventType === "UPDATE") {
            const row = payload.new as any;
            setStagedFiles((prev) =>
              prev.map((f) => (f.id === row.id ? { ...row, publicUrl: getPublicUrl(row.storage_path) } : f)),
            );
          } else if (payload.eventType === "DELETE") {
            const row = payload.old as any;
            setStagedFiles((prev) => prev.filter((f) => f.id !== row.id));
          }
        },
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [user, tripId, getPublicUrl]);

  const stageFiles = useCallback(
    async (files: File[]) => {
      if (!user) return;

      const mediaFiles = files.filter((f) => f.type.startsWith("image/") || f.type.startsWith("video/"));
      if (mediaFiles.length === 0) {
        toast.error("No image or video files found");
        return;
      }

      // ── PHASE 1: Parallel EXIF extraction (all at once) ──
      const exifResults = await Promise.all(
        mediaFiles.map(async (file): Promise<PhotoExifData> => {
          try {
            return await extractExifFromFile(file);
          } catch {
            return {
              file,
              captionId: crypto.randomUUID(),
              latitude: null,
              longitude: null,
              takenAt: null,
            };
          }
        }),
      );

      // ── PHASE 2: Instant render — local previews with EXIF metadata ──
      const localPreviews: StagedMediaFile[] = mediaFiles.map((file, i) => {
        const exif = exifResults[i];
        const previewUrl = URL.createObjectURL(file);
        localUrlsRef.current.add(previewUrl);
        return {
          id: `local-${crypto.randomUUID()}`,
          trip_id: tripId,
          storage_path: "",
          mime_type: file.type,
          file_name: file.name,
          exif_metadata: {
            latitude: exif.latitude,
            longitude: exif.longitude,
            takenAt: exif.takenAt?.toISOString() ?? null,
            cameraMake: exif.cameraMake ?? null,
            cameraModel: exif.cameraModel ?? null,
            duration: exif.duration ?? null,
          },
          ai_processing_status: "pending" as const,
          ai_result: null,
          group_key: null,
          created_at: new Date().toISOString(),
          publicUrl: "",
          localPreviewUrl: previewUrl,
          isLocalOnly: true,
        };
      });
      setStagedFiles((prev) => [...prev, ...localPreviews]);

      toast.info(`Uploading ${mediaFiles.length} file(s)…`);

      const newUploads = new Map<string, UploadProgress>();
      mediaFiles.forEach((f) => {
        newUploads.set(f.name, { fileName: f.name, percent: 0, status: "uploading" });
      });
      setUploads(new Map(newUploads));

      // ── PHASE 3: Concurrent upload + DB insert (max 5 at a time) ──
      const results = await mapWithConcurrency(mediaFiles, 5, async (file, i) => {
        const exif = exifResults[i];

        // Duplicate check
        const { data: existing } = await supabase
          .from("pending_media_imports")
          .select("id, storage_path")
          .eq("file_name", file.name)
          .eq("trip_id", tripId)
          .maybeSingle();

        if (existing) {
          setUploads((prev) => {
            const next = new Map(prev);
            next.set(file.name, { fileName: file.name, percent: 100, status: "done" });
            return next;
          });
          return existing.storage_path;
        }

        // Upload via TUS
        const ext = file.name.split(".").pop() || (file.type.startsWith("video/") ? "mp4" : "jpg");
        const objectName = `${user.id}/${tripId}/staging/${crypto.randomUUID()}.${ext}`;

        await resumableUpload({
          bucketName: "trip-photos",
          objectName,
          file: exif.uploadFile ?? file,
          contentType: file.type || undefined,
          onProgress: (percent) => {
            setUploads((prev) => {
              const next = new Map(prev);
              next.set(file.name, { fileName: file.name, percent, status: "uploading" });
              return next;
            });
          },
        });

        setUploads((prev) => {
          const next = new Map(prev);
          next.set(file.name, { fileName: file.name, percent: 100, status: "done" });
          return next;
        });

        // Insert DB row (no AI calls — AI runs only after "Import Selected")
        const { error: insertError } = await supabase.from("pending_media_imports").insert({
          trip_id: tripId,
          user_id: user.id,
          storage_path: objectName,
          mime_type: file.type || "application/octet-stream",
          file_name: file.name,
          exif_metadata: {
            latitude: exif.latitude,
            longitude: exif.longitude,
            takenAt: exif.takenAt?.toISOString() ?? null,
            cameraMake: exif.cameraMake ?? null,
            cameraModel: exif.cameraModel ?? null,
            duration: exif.duration ?? null,
          },
        });

        if (insertError) {
          console.error("Failed to insert staged file:", insertError);
          throw insertError;
        }

        return objectName;
      });

      const succeeded = results.filter((r) => r.status === "fulfilled").length;
      const failed = results.filter((r) => r.status === "rejected").length;

      if (failed > 0) toast.error(`${failed} file(s) failed to upload`);
      if (succeeded > 0) toast.success(`${succeeded} file(s) ready in inbox`);

      setTimeout(() => setUploads(new Map()), 2000);
    },
    [user, tripId, getPublicUrl],
  );

  // Delete staged files — instant, no waiting for AI
  const deleteStagedFiles = useCallback(
    async (ids: string[]) => {
      // Snapshot what to delete before removing from state
      const toDelete = stagedFiles.filter((f) => ids.includes(f.id));

      // Revoke any local preview URLs
      toDelete.forEach((f) => {
        if (f.localPreviewUrl) {
          URL.revokeObjectURL(f.localPreviewUrl);
          localUrlsRef.current.delete(f.localPreviewUrl);
        }
      });

      // Instant UI removal
      setStagedFiles((prev) => prev.filter((f) => !ids.includes(f.id)));

      // Background cleanup — don't block UI
      const realFiles = toDelete.filter((f) => !f.isLocalOnly);
      if (realFiles.length > 0) {
        const storagePaths = realFiles.map((f) => f.storage_path).filter(Boolean);
        const realIds = realFiles.map((f) => f.id);

        Promise.all([
          storagePaths.length > 0
            ? supabase.storage.from("trip-photos").remove(storagePaths)
            : Promise.resolve(),
          supabase.from("pending_media_imports").delete().in("id", realIds),
        ]).catch((err) => {
          console.error("Background delete failed:", err);
        });
      }

      toast.success(`Removed ${ids.length} file(s)`);
    },
    [stagedFiles],
  );

  // Update group_key for a file
  const updateGroupKey = useCallback(
    async (id: string, groupKey: string | null) => {
      await supabase
        .from("pending_media_imports")
        .update({ group_key: groupKey })
        .eq("id", id);
    },
    [],
  );

  const isUploading = Array.from(uploads.values()).some((u) => u.status === "uploading");

  const overallProgress = uploads.size > 0
    ? Math.round(Array.from(uploads.values()).reduce((sum, u) => sum + u.percent, 0) / uploads.size)
    : 0;

  return {
    stagedFiles,
    loading,
    uploads,
    isUploading,
    overallProgress,
    stageFiles,
    deleteStagedFiles,
    updateGroupKey,
    refetch: fetchStaged,
  };
}
