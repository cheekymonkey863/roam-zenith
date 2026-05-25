import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

interface VideoAnalysisResult {
  captionId: string;
  caption: string;
  sceneDescription: string;
  essence: string;
  richTags: string[];
  activityType: string;
  moodTags: string[];
  suggestedVenueName: string | null;
  suggestedCityName: string | null;
}

interface ItineraryStop {
  location_name: string | null;
  country: string | null;
  latitude: number;
  longitude: number;
  recorded_at: string;
  event_type: string;
  description: string | null;
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

const GATEWAY_URL = "https://ai.gateway.lovable.dev/v1/chat/completions";
const MODEL = "google/gemini-2.5-flash";
const RATE_LIMIT_RETRY_DELAYS_MS = [2000, 4000, 8000];

// Hard cap on inline media size sent through the gateway (base64 inflates ~33%)
const MAX_INLINE_BYTES = 18 * 1024 * 1024; // 18MB raw -> ~24MB base64

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function getServiceClient() {
  return createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );
}

function buildPrompt(metadata: {
  takenAt: string | null;
  latitude: number | null;
  longitude: number | null;
  locationName: string | null;
  country: string | null;
  nearbyPlaces?: string[];
  itinerarySteps?: ItineraryStop[];
}): string {
  const metadataParts: string[] = [];
  if (metadata.takenAt) {
    const d = new Date(metadata.takenAt);
    const formatted = d.toLocaleString("en-GB", {
      dateStyle: "long",
      timeStyle: "short",
      timeZone: "UTC",
    });
    metadataParts.push(`Time: ${formatted} UTC`);
  }
  if (metadata.latitude != null && metadata.longitude != null) {
    metadataParts.push(
      `Coordinates: ${Math.abs(metadata.latitude).toFixed(4)}° ${metadata.latitude >= 0 ? "N" : "S"}, ${Math.abs(metadata.longitude).toFixed(4)}° ${metadata.longitude >= 0 ? "E" : "W"}`,
    );
  }
  if (metadata.locationName) {
    const loc = metadata.country && metadata.country !== "Unknown"
      ? `${metadata.locationName}, ${metadata.country}`
      : metadata.locationName;
    metadataParts.push(`Rough GPS Neighborhood: ${loc}`);
  }

  const metadataBlock = metadataParts.length > 0
    ? `METADATA:\n- ${metadataParts.join("\n- ")}`
    : "No metadata available.";

  let nearbyPlacesBlock = "";
  if (metadata.nearbyPlaces && metadata.nearbyPlaces.length > 0) {
    nearbyPlacesBlock = `\n\nNEARBY BUSINESSES/VENUES AT THESE COORDINATES:\n- ${metadata.nearbyPlaces.join("\n- ")}`;
  }

  let itineraryBlock = "";
  if (metadata.itinerarySteps && metadata.itinerarySteps.length > 0) {
    const stopLines = metadata.itinerarySteps.map((s, i) => {
      const loc = s.location_name || "Unknown";
      const country = s.country && s.country !== "Unknown" ? `, ${s.country}` : "";
      const date = new Date(s.recorded_at).toLocaleDateString("en-GB", { dateStyle: "medium" });
      const desc = s.description ? ` — ${s.description}` : "";
      return `  ${i + 1}. ${loc}${country} (${date}, ${s.event_type})${desc}`;
    });
    itineraryBlock = `\n\nKNOWN TRIP ITINERARY:\n${stopLines.join("\n")}`;
  }

  return `You are a world-class travel writer and expert video analyzer.
I am providing a video or image from a user's trip.

${metadataBlock}${nearbyPlacesBlock}${itineraryBlock}

OUTPUT RULES:
- GPS coordinates are a HINT, not the truth. The "Rough GPS Neighborhood" is an automated lookup that is often wrong.
- TRUST YOUR EYES AND EARS FIRST. If you can visually identify a specific landmark, venue sign, logo, or branding, that is the definitive venue name.
- If "NEARBY BUSINESSES/VENUES" are provided, cross-reference them with what you see.
- If you can read a sign, logo, or branding, use that EXACT name.
- Do NOT fall back to generic street addresses, administrative regions, or the GPS neighborhood name if a specific venue or landmark is visible.
- ONLY if visual evidence gives absolutely no clue should you use the GPS neighborhood as a last resort.
- Pay extreme attention to weather, lighting, and audio cues.

Respond with valid JSON only matching this exact schema. No markdown, no explanation:
{
  "suggestedVenueName": "exact venue name only, or null",
  "suggestedCityName": "city name only, or null",
  "caption": "1-sentence description of the exact action",
  "sceneDescription": "literal description of visual and audio evidence in one rich sentence",
  "essence": "highly evocative 2-sentence present-tense journal entry capturing weather, lighting, sounds, mood",
  "activityType": "1-3 words",
  "richTags": ["5-8", "lowercase", "tags"],
  "moodTags": ["3", "emotional", "tags"]
}`;
}

async function fetchAsBase64(url: string): Promise<{ base64: string; bytes: number }> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to fetch media from storage: ${res.status} ${res.statusText}`);
  const buffer = await res.arrayBuffer();
  const bytes = buffer.byteLength;
  if (bytes > MAX_INLINE_BYTES) {
    throw new Error(`Media too large for inline analysis: ${(bytes / 1024 / 1024).toFixed(1)}MB (max ${MAX_INLINE_BYTES / 1024 / 1024}MB)`);
  }
  const arr = new Uint8Array(buffer);
  let binary = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < arr.length; i += CHUNK) {
    binary += String.fromCharCode(...arr.subarray(i, i + CHUNK));
  }
  return { base64: btoa(binary), bytes };
}

async function callGateway(body: unknown): Promise<any> {
  const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
  if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY is not configured");

  for (let attempt = 0; attempt <= RATE_LIMIT_RETRY_DELAYS_MS.length; attempt++) {
    const res = await fetch(GATEWAY_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });

    if (res.status === 429) {
      if (attempt < RATE_LIMIT_RETRY_DELAYS_MS.length) {
        console.warn(`Gateway rate limited, retrying in ${RATE_LIMIT_RETRY_DELAYS_MS[attempt]}ms`);
        await sleep(RATE_LIMIT_RETRY_DELAYS_MS[attempt]);
        continue;
      }
      throw new Error("Rate limit exceeded after retries. Please try again later.");
    }
    if (res.status === 402) {
      throw new Error("Lovable AI credits exhausted. Please add credits in workspace settings.");
    }
    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`AI gateway error [${res.status}]: ${errText}`);
    }
    return await res.json();
  }
  throw new Error("Rate limited after all retries.");
}

function parseJsonContent(raw: string): any {
  const candidates = [raw.trim()];
  if (raw.includes("```")) {
    for (const match of raw.matchAll(/```(?:json)?\s*([\s\S]*?)\s*```/gi)) {
      candidates.push(match[1].trim());
    }
  }
  const first = raw.indexOf("{");
  const last = raw.lastIndexOf("}");
  if (first >= 0 && last > first) candidates.push(raw.slice(first, last + 1).trim());
  for (const c of candidates) {
    try { return JSON.parse(c); } catch { /* continue */ }
  }
  throw new Error("Failed to parse JSON from model response");
}

function parseResult(parsed: any, captionId: string): VideoAnalysisResult {
  return {
    captionId,
    caption: typeof parsed.caption === "string" ? parsed.caption.trim() : "Video clip",
    sceneDescription: typeof parsed.sceneDescription === "string" ? parsed.sceneDescription.trim() : "",
    essence: typeof parsed.essence === "string" ? parsed.essence.trim() : "",
    richTags: Array.isArray(parsed.richTags)
      ? parsed.richTags.filter((t: unknown): t is string => typeof t === "string").map((t: string) => t.trim().toLowerCase())
      : [],
    activityType: typeof parsed.activityType === "string" ? parsed.activityType.trim() : "activity",
    moodTags: Array.isArray(parsed.moodTags)
      ? parsed.moodTags.filter((t: unknown): t is string => typeof t === "string").map((t: string) => t.trim().toLowerCase())
      : [],
    suggestedVenueName: typeof parsed.suggestedVenueName === "string" ? parsed.suggestedVenueName.trim() : null,
    suggestedCityName: typeof parsed.suggestedCityName === "string" ? parsed.suggestedCityName.trim() : null,
  };
}

async function processMediaInBackground(params: {
  jobId: string;
  storagePath: string;
  captionId: string;
  fileName: string;
  mimeType: string;
  takenAt: string | null;
  latitude: number | null;
  longitude: number | null;
  locationName: string | null;
  country: string | null;
  nearbyPlaces: string[];
  itinerarySteps: ItineraryStop[];
}) {
  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const supabase = getServiceClient();

  try {
    const mediaUrl = `${supabaseUrl}/storage/v1/object/public/trip-photos/${params.storagePath}`;
    console.log(`Analyzing "${params.fileName}" (${params.mimeType}) via Lovable AI Gateway.`);

    const { base64, bytes } = await fetchAsBase64(mediaUrl);
    console.log(`Fetched ${(bytes / 1024 / 1024).toFixed(2)}MB, encoding inline.`);

    const dataUrl = `data:${params.mimeType};base64,${base64}`;
    const prompt = buildPrompt({
      takenAt: params.takenAt,
      latitude: params.latitude,
      longitude: params.longitude,
      locationName: params.locationName,
      country: params.country,
      nearbyPlaces: params.nearbyPlaces,
      itinerarySteps: params.itinerarySteps,
    });

    const data = await callGateway({
      model: MODEL,
      messages: [
        {
          role: "user",
          content: [
            { type: "image_url", image_url: { url: dataUrl } },
            { type: "text", text: prompt },
          ],
        },
      ],
      response_format: { type: "json_object" },
    });

    const textContent = data?.choices?.[0]?.message?.content;
    if (typeof textContent !== "string" || !textContent.trim()) {
      throw new Error("No content in gateway response");
    }

    const parsed = parseJsonContent(textContent);
    const result = parseResult(parsed, params.captionId);
    console.log(`Analysis complete for "${params.fileName}": ${result.caption}`);

    await supabase
      .from("video_analysis_jobs")
      .update({ status: "complete", result, updated_at: new Date().toISOString() })
      .eq("id", params.jobId);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error(`Background analysis failed for "${params.fileName}":`, message);
    await supabase
      .from("video_analysis_jobs")
      .update({ status: "failed", error: message, updated_at: new Date().toISOString() })
      .eq("id", params.jobId);
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
    if (!Deno.env.get("LOVABLE_API_KEY")) throw new Error("LOVABLE_API_KEY is not configured");

    const authHeader = req.headers.get("authorization") ?? "";
    const supabase = getServiceClient();
    const token = authHeader.replace("Bearer ", "");
    const { data: { user } } = await createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
    ).auth.getUser(token);

    if (!user) {
      return jsonResponse({ error: "Unauthorized" }, 401);
    }

    const body = await req.json();
    const {
      storagePath,
      captionId,
      fileName = "video.mp4",
      mimeType: rawMimeType,
      takenAt = null,
      latitude = null,
      longitude = null,
      locationName = null,
      country = null,
      nearbyPlaces = [],
      itinerarySteps = [],
    } = body;

    if (!storagePath || typeof storagePath !== "string") {
      return jsonResponse({ error: "storagePath is required" }, 400);
    }
    if (!captionId || typeof captionId !== "string") {
      return jsonResponse({ error: "captionId is required" }, 400);
    }

    let mimeType = rawMimeType || "video/mp4";
    if (mimeType === "video/quicktime" || mimeType === "video/mov") {
      mimeType = "video/mp4";
    }

    const { data: job, error: jobError } = await supabase
      .from("video_analysis_jobs")
      .insert({ caption_id: captionId, user_id: user.id, status: "processing" })
      .select("id")
      .single();

    if (jobError || !job) {
      console.error("Failed to create job:", jobError);
      return jsonResponse({ error: "Failed to create analysis job" }, 500);
    }

    console.log(`Job ${job.id} created for "${fileName}" (${mimeType}). Starting background analysis...`);

    EdgeRuntime.waitUntil(
      processMediaInBackground({
        jobId: job.id,
        storagePath,
        captionId,
        fileName,
        mimeType,
        takenAt,
        latitude,
        longitude,
        locationName,
        country,
        nearbyPlaces: Array.isArray(nearbyPlaces) ? nearbyPlaces : [],
        itinerarySteps,
      }),
    );

    return jsonResponse({ jobId: job.id, status: "processing" });
  } catch (error) {
    console.error("analyze-video error:", error);
    const message = error instanceof Error ? error.message : "Unknown error";
    return jsonResponse({ error: message }, 500);
  }
});
