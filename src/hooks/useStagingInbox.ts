import { useCallback, useEffect, useState } from "react";
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

export function useStagingInbox(tripId: string) {
  const { user } = useAuth();
  const [stagedFiles, setStagedFiles] = useState<StagedMediaFile[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploads, setUploads] = useState<Map<string, UploadProgress>>(new Map());

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

  // Realtime subscription for AI status updates
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
              // Revoke object URLs from local placeholders being replaced
              const replaced = prev.filter(
                (f) => f.isLocalOnly && f.file_name === row.file_name,
              );
              replaced.forEach((f) => {
                if (f.localPreviewUrl) URL.revokeObjectURL(f.localPreviewUrl);
              });
              const withoutLocal = prev.filter(
                (f) => !(f.isLocalOnly && f.file_name === row.file_name),
              );
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

  // Upload files: extract EXIF → TUS upload → insert DB row
  const stageFiles = useCallback(
    async (files: File[]) => {
      if (!user) return;

      const mediaFiles = files.filter((f) => f.type.startsWith("image/") || f.type.startsWith("video/"));
      if (mediaFiles.length === 0) {
        toast.error("No image or video files found");
        return;
      }

      // --- INSTANT RENDER: add local preview placeholders immediately ---
      const localPreviews: StagedMediaFile[] = mediaFiles.map((file) => ({
        id: `local-${crypto.randomUUID()}`,
        trip_id: tripId,
        storage_path: "",
        mime_type: file.type,
        file_name: file.name,
        exif_metadata: {},
        ai_processing_status: "pending" as const,
        ai_result: null,
        group_key: null,
        created_at: new Date().toISOString(),
        publicUrl: "",
        localPreviewUrl: URL.createObjectURL(file),
        isLocalOnly: true,
      }));
      setStagedFiles((prev) => [...prev, ...localPreviews]);

      toast.info(`Uploading ${mediaFiles.length} file(s)…`);

      const newUploads = new Map<string, UploadProgress>();
      mediaFiles.forEach((f) => {
        newUploads.set(f.name, { fileName: f.name, percent: 0, status: "uploading" });
      });
      setUploads(new Map(newUploads));

      const results = await Promise.allSettled(
        mediaFiles.map(async (file) => {
          // 0. Duplicate check — skip if file already staged for this trip
          const { data: existing } = await supabase
            .from("pending_media_imports")
            .select("id, storage_path")
            .eq("file_name", file.name)
            .eq("trip_id", tripId)
            .maybeSingle();

          if (existing) {
            console.log(`[staging] Skipping duplicate: ${file.name}`);
            setUploads((prev) => {
              const next = new Map(prev);
              next.set(file.name, { fileName: file.name, percent: 100, status: "done" });
              return next;
            });
            return existing.storage_path;
          }

          // 1. Extract EXIF (fast, client-side)
          let exif: PhotoExifData;
          try {
            exif = await extractExifFromFile(file);
          } catch {
            exif = {
              file,
              captionId: crypto.randomUUID(),
              latitude: null,
              longitude: null,
              takenAt: null,
            };
          }

          // 2. Upload to staging path via TUS
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

          // 3. Insert DB row
          const { data: inserted, error: insertError } = await supabase.from("pending_media_imports").insert({
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
          }).select("id").single();

          if (insertError) {
            console.error("Failed to insert staged file:", insertError);
            throw insertError;
          }

          // 4. If no GPS from EXIF, request AI location inference in background
          if (exif.latitude === null || exif.longitude === null) {
            const publicUrl = getPublicUrl(objectName);
            supabase.functions.invoke("photo-location-inference", {
              body: {
                mediaId: inserted?.id,
                imageUrl: publicUrl,
                fileName: file.name,
                mimeType: file.type,
                takenAt: exif.takenAt?.toISOString() ?? null,
              },
            }).then(({ data, error: aiErr }) => {
              if (aiErr) {
                console.warn(`[staging] AI location inference failed for ${file.name}:`, aiErr);
                return;
              }
              if (data?.latitude && data?.longitude) {
                console.log(`[staging] AI inferred location for ${file.name}:`, data.latitude, data.longitude);
                // Update the DB row with inferred location
                supabase.from("pending_media_imports").update({
                  exif_metadata: {
                    latitude: data.latitude,
                    longitude: data.longitude,
                    takenAt: exif.takenAt?.toISOString() ?? null,
                    cameraMake: exif.cameraMake ?? null,
                    cameraModel: exif.cameraModel ?? null,
                    duration: exif.duration ?? null,
                  },
                  ai_processing_status: "complete",
                  ai_result: data,
                }).eq("id", inserted?.id).then(({ error: updateErr }) => {
                  if (updateErr) console.warn("[staging] Failed to update AI result:", updateErr);
                });
              }
            }).catch((err) => {
              console.warn(`[staging] AI inference error for ${file.name}:`, err);
            });
          }

          return objectName;
        }),
      );

      const succeeded = results.filter((r) => r.status === "fulfilled").length;
      const failed = results.filter((r) => r.status === "rejected").length;

      if (failed > 0) {
        toast.error(`${failed} file(s) failed to upload`);
      }
      if (succeeded > 0) {
        toast.success(`${succeeded} file(s) uploaded to staging`);
      }

      // Clear upload progress after a short delay
      setTimeout(() => setUploads(new Map()), 2000);
    },
    [user, tripId],
  );

  // Delete staged files
  const deleteStagedFiles = useCallback(
    async (ids: string[]) => {
      const toDelete = stagedFiles.filter((f) => ids.includes(f.id));

      // Optimistic UI update — remove from state immediately
      setStagedFiles((prev) => prev.filter((f) => !ids.includes(f.id)));

      try {
        // Delete from storage
        const storagePaths = toDelete.map((f) => f.storage_path);
        if (storagePaths.length > 0) {
          await supabase.storage.from("trip-photos").remove(storagePaths);
        }

        // Delete DB rows
        const { error } = await supabase
          .from("pending_media_imports")
          .delete()
          .in("id", ids);

        if (error) {
          console.error("Failed to delete staged files:", error);
          toast.error("Failed to delete from database, but removed from view");
          return;
        }

        toast.success(`Removed ${ids.length} file(s)`);
      } catch (err) {
        console.error("Delete failed:", err);
        toast.error("Delete encountered an error, but items removed from view");
      }
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