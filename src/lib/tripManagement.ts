import { supabase } from "@/integrations/supabase/client";

export function parseTripCountriesInput(value: string): string[] {
  return Array.from(
    new Set(
      value
        .split(",")
        .map((country) => country.trim())
        .filter(Boolean),
    ),
  );
}

interface SyncTripCountriesParams {
  tripId: string;
  currentCountries: string[];
  nextCountries: string[];
}

function normalizeCountries(countries: string[]): string[] {
  return Array.from(new Set(countries.map((country) => country.trim()).filter(Boolean)));
}

export async function syncTripCountries({
  tripId,
  currentCountries,
  nextCountries,
}: SyncTripCountriesParams): Promise<void> {
  const current = normalizeCountries(currentCountries);
  const next = normalizeCountries(nextCountries);

  if (current.join("|") === next.join("|")) {
    return;
  }

  if (next.length === 0) {
    const { error } = await supabase.from("trip_steps").update({ country: null }).eq("trip_id", tripId);

    if (error) throw error;
    return;
  }

  if (current.length === 0) {
    throw new Error("Countries are taken from this trip's steps. Add or edit a step location first.");
  }

  if (next.length > current.length) {
    throw new Error("To add more countries than were detected, update the trip steps first.");
  }

  const updates = current.map((country, index) => ({
    from: country,
    to: next[index] ?? next[next.length - 1] ?? null,
  }));

  for (const update of updates) {
    if (update.from === update.to) continue;

    const { error } = await supabase
      .from("trip_steps")
      .update({ country: update.to })
      .eq("trip_id", tripId)
      .eq("country", update.from);

    if (error) throw error;
  }
}

export async function deleteTripCascade(tripId: string): Promise<void> {
  const { data: tripSteps, error: tripStepsError } = await supabase
    .from("trip_steps")
    .select("id")
    .eq("trip_id", tripId);

  if (tripStepsError) throw tripStepsError;

  const stepIds = tripSteps?.map((step) => step.id) ?? [];

  if (stepIds.length > 0) {
    const { data: mediaRows, error: mediaRowsError } = await supabase
      .from("step_photos")
      .select("storage_path")
      .in("step_id", stepIds);

    if (mediaRowsError) throw mediaRowsError;

    const storagePaths = mediaRows?.map((row) => row.storage_path).filter(Boolean) ?? [];

    if (storagePaths.length > 0) {
      const { error: storageError } = await supabase.storage.from("trip-photos").remove(storagePaths);

      if (storageError) {
        console.warn("Failed to remove some trip media from storage", storageError);
      }
    }

    const { error: deleteMediaError } = await supabase.from("step_photos").delete().in("step_id", stepIds);

    if (deleteMediaError) throw deleteMediaError;
  }

  const [sharesResult, pointsResult, stepsResult] = await Promise.all([
    supabase.from("trip_shares").delete().eq("trip_id", tripId),
    supabase.from("location_points").delete().eq("trip_id", tripId),
    supabase.from("trip_steps").delete().eq("trip_id", tripId),
  ]);

  if (sharesResult.error) throw sharesResult.error;
  if (stepsResult.error) throw stepsResult.error;

  if (pointsResult.error) {
    console.warn("Failed to remove trip tracking points", pointsResult.error);
  }

  const { error: tripError } = await supabase.from("trips").delete().eq("id", tripId);

  if (tripError) throw tripError;
}

/**
 * Merge all steps, photos, and location points from sourceTrip into targetTrip,
 * then delete the source trip.
 */
export async function mergeTripInto(sourceTripId: string, targetTripId: string): Promise<void> {
  // Move trip_steps
  const { error: stepsErr } = await supabase
    .from("trip_steps")
    .update({ trip_id: targetTripId })
    .eq("trip_id", sourceTripId);
  if (stepsErr) throw stepsErr;

  // Move location_points
  const { error: pointsErr } = await supabase
    .from("location_points")
    .update({ trip_id: targetTripId })
    .eq("trip_id", sourceTripId);
  if (pointsErr) throw pointsErr;

  // Move pending_media_imports
  const { error: pendingErr } = await supabase
    .from("pending_media_imports")
    .update({ trip_id: targetTripId })
    .eq("trip_id", sourceTripId);
  if (pendingErr) throw pendingErr;

  // Move video_analysis_jobs
  const { error: videoErr } = await supabase
    .from("video_analysis_jobs")
    .update({ trip_id: targetTripId })
    .eq("trip_id", sourceTripId);
  if (videoErr) throw videoErr;

  // Move trip_shares (or just delete them)
  await supabase.from("trip_shares").delete().eq("trip_id", sourceTripId);

  // Delete the now-empty source trip
  const { error: tripErr } = await supabase.from("trips").delete().eq("id", sourceTripId);
  if (tripErr) throw tripErr;
}