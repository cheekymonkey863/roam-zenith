import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

export type VideoJobStatus = "pending" | "processing" | "complete" | "failed";

export interface VideoAnalysisJobInfo {
  id: string;
  status: VideoJobStatus;
  storage_path: string | null;
  error: string | null;
  updated_at: string;
}

/**
 * Subscribes to `video_analysis_jobs` for the given trip and returns a map
 * keyed by `storage_path` so consumers can look up status per media file.
 */
export function useVideoAnalysisJobs(tripId?: string) {
  const [jobsByPath, setJobsByPath] = useState<Map<string, VideoAnalysisJobInfo>>(new Map());

  useEffect(() => {
    if (!tripId) return;
    let cancelled = false;

    const apply = (rows: any[]) => {
      const next = new Map<string, VideoAnalysisJobInfo>();
      for (const row of rows) {
        if (!row?.storage_path) continue;
        next.set(row.storage_path, {
          id: row.id,
          status: row.status as VideoJobStatus,
          storage_path: row.storage_path,
          error: row.error ?? null,
          updated_at: row.updated_at,
        });
      }
      setJobsByPath(next);
    };

    const upsert = (row: any) => {
      if (!row?.storage_path) return;
      setJobsByPath((prev) => {
        const next = new Map(prev);
        next.set(row.storage_path, {
          id: row.id,
          status: row.status as VideoJobStatus,
          storage_path: row.storage_path,
          error: row.error ?? null,
          updated_at: row.updated_at,
        });
        return next;
      });
    };

    (async () => {
      const { data } = await supabase
        .from("video_analysis_jobs")
        .select("id, status, storage_path, error, updated_at")
        .eq("trip_id", tripId);
      if (!cancelled && data) apply(data);
    })();

    const channel = supabase
      .channel(`video-jobs-${tripId}-${Math.random().toString(36).slice(2)}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "video_analysis_jobs", filter: `trip_id=eq.${tripId}` },
        (payload) => {
          if (payload.eventType === "DELETE") {
            const old = payload.old as any;
            if (!old?.storage_path) return;
            setJobsByPath((prev) => {
              const next = new Map(prev);
              next.delete(old.storage_path);
              return next;
            });
          } else {
            upsert(payload.new);
          }
        },
      )
      .subscribe();

    return () => {
      cancelled = true;
      supabase.removeChannel(channel);
    };
  }, [tripId]);

  return jobsByPath;
}
