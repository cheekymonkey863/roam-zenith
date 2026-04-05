import { supabase } from "@/integrations/supabase/client";

/**
 * After uploading a video to its final storage path, call this to queue
 * a background analysis job. The `process-video-queue` edge function
 * will pick it up on its next cron tick.
 */
export async function queueVideoAnalysisJob(params: {
  captionId: string;
  userId: string;
  tripId: string;
  storagePath: string;
  fileName: string;
  mimeType: string;
  takenAt: string | null;
  latitude: number | null;
  longitude: number | null;
  locationName: string | null;
  country: string | null;
  itinerarySteps?: Array<{
    location_name: string | null;
    country: string | null;
    latitude: number;
    longitude: number;
    recorded_at: string;
    event_type: string;
    description: string | null;
  }>;
}): Promise<string | null> {
  let mimeType = params.mimeType || "video/mp4";
  if (mimeType === "video/quicktime" || mimeType === "video/mov") {
    mimeType = "video/mp4";
  }

  const { data, error } = await supabase
    .from("video_analysis_jobs")
    .insert({
      caption_id: params.captionId,
      user_id: params.userId,
      trip_id: params.tripId,
      storage_path: params.storagePath,
      file_name: params.fileName,
      mime_type: mimeType,
      taken_at: params.takenAt,
      latitude: params.latitude,
      longitude: params.longitude,
      location_name: params.locationName,
      country: params.country,
      itinerary_context: params.itinerarySteps ?? [],
      status: "pending",
    })
    .select("id")
    .single();

  if (error) {
    console.error(`Failed to queue video analysis for ${params.fileName}:`, error);
    return null;
  }

  return data?.id ?? null;
}
