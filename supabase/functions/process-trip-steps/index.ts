import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function getServiceClient() {
  return createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );
}

const GOOGLE_MAPS_API_KEY = "AIzaSyCHXGKSMbpkEN5Amr0VRDF44cLcOg_JUD8";

interface ReverseGeocodeResult {
  venueName: string | null;
  cityName: string | null;
  country: string | null;
  eventType: string;
}

async function reverseGeocode(lat: number, lng: number): Promise<ReverseGeocodeResult> {
  const result: ReverseGeocodeResult = { venueName: null, cityName: null, country: null, eventType: "activity" };

  try {
    // 1. Try Nearby Search for venue name (20m radius)
    const nearbyUrl = `https://maps.googleapis.com/maps/api/place/nearbysearch/json?location=${lat},${lng}&radius=20&key=${GOOGLE_MAPS_API_KEY}`;
    const nearbyRes = await fetch(nearbyUrl);
    const nearbyData = await nearbyRes.json();

    if (nearbyData.results?.length > 0) {
      const place = nearbyData.results[0];
      result.venueName = place.name || null;

      // Classify event type from place types
      const types: string[] = place.types || [];
      if (types.some((t: string) => ["restaurant", "food", "cafe", "bar", "bakery"].includes(t))) {
        result.eventType = "dining";
      } else if (types.some((t: string) => ["lodging", "hotel"].includes(t))) {
        result.eventType = "hotel";
      } else if (types.some((t: string) => ["museum", "art_gallery", "church", "tourist_attraction", "point_of_interest"].includes(t))) {
        result.eventType = "sightseeing";
      } else if (types.some((t: string) => ["park", "natural_feature"].includes(t))) {
        result.eventType = "activity";
      }
    }

    // 2. Geocode for city + country
    const geocodeUrl = `https://maps.googleapis.com/maps/api/geocode/json?latlng=${lat},${lng}&key=${GOOGLE_MAPS_API_KEY}`;
    const geocodeRes = await fetch(geocodeUrl);
    const geocodeData = await geocodeRes.json();

    if (geocodeData.results?.length > 0) {
      for (const r of geocodeData.results) {
        for (const comp of r.address_components || []) {
          const types: string[] = comp.types || [];
          if (!result.cityName && (types.includes("locality") || types.includes("postal_town"))) {
            result.cityName = comp.long_name;
          }
          if (!result.country && types.includes("country")) {
            result.country = comp.long_name;
          }
        }
        if (result.cityName && result.country) break;
      }
    }
  } catch (err) {
    console.error("Reverse geocode failed:", err);
  }

  return result;
}

async function processStepsInBackground(stepIds: string[]) {
  const supabase = getServiceClient();

  for (const stepId of stepIds) {
    try {
      const { data: step } = await supabase
        .from("trip_steps")
        .select("*")
        .eq("id", stepId)
        .single();

      if (!step) continue;

      // Skip if already has a proper location name (not null/empty/"Unknown")
      const name = step.location_name?.trim() || "";
      const needsGeocode = !name || name.toLowerCase().includes("unknown") || name.toLowerCase().includes("no gps");

      if (needsGeocode && step.latitude && step.longitude) {
        const geo = await reverseGeocode(step.latitude, step.longitude);

        const locationName = geo.venueName && geo.cityName
          ? `${geo.venueName}, ${geo.cityName}`
          : geo.venueName || geo.cityName || null;

        const updates: Record<string, unknown> = {};
        if (locationName) updates.location_name = locationName;
        if (geo.country) updates.country = geo.country;
        if (geo.eventType && step.event_type === "activity") updates.event_type = geo.eventType;

        if (Object.keys(updates).length > 0) {
          await supabase.from("trip_steps").update(updates).eq("id", stepId);
        }
      }

      // Small delay between steps to avoid rate limits
      await new Promise((r) => setTimeout(r, 200));
    } catch (err) {
      console.error(`Error processing step ${stepId}:`, err);
    }
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  try {
    const { step_ids } = await req.json();

    if (!Array.isArray(step_ids) || step_ids.length === 0) {
      return jsonResponse({ error: "step_ids array required" }, 400);
    }

    // Process in background - return immediately
    EdgeRuntime.waitUntil(processStepsInBackground(step_ids));

    return jsonResponse({
      message: "Processing started",
      step_count: step_ids.length,
      status: "processing",
    });
  } catch (err) {
    console.error("process-trip-steps error:", err);
    return jsonResponse({ error: "Internal error" }, 500);
  }
});
