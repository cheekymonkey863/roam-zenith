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

const GEMINI_MODEL = "gemini-2.5-flash";
const RATE_LIMIT_RETRY_DELAYS_MS = [2000, 4000, 8000];
const FILE_POLL_INTERVAL_MS = 5000;
const FILE_POLL_MAX_ATTEMPTS = 60;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function getServiceClient() {
  return createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );
}

// ── Prompt builder ──────────────────────────────────────────────────

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
I am providing a video from a user's trip.

${metadataBlock}${nearbyPlacesBlock}${itineraryBlock}

OUTPUT RULES:
- TRUST YOUR EYES AND EARS. If the GPS says "Thomas Riddell" but you see a pizza restaurant, the venue is "Pizza Restaurant".
- If "NEARBY BUSINESSES/VENUES" are provided, cross-reference them with what you see and hear. If you see a stadium and "Ibrox Stadium" is on the list, the venue is definitively "Ibrox Stadium".
- If you can read a sign, logo, or branding in the video, use that exact name.
- ONLY if the visual evidence completely contradicts the nearby list (or the list is empty) should you fall back to a descriptive name.
- Pay extreme attention to weather (overcast, rainy, golden hour, crisp air), lighting (neon, dim, candlelit, bright), and audio (live music, crowd chatter, wind, sizzling food, laughter, clinking glasses).

OUTPUT FORMAT (JSON exactly matching this schema):
{
  "suggestedVenueName": "The exact place/venue name ONLY (e.g., 'Ibrox Stadium', 'Civerinos', 'Whistlebinkies'). DO NOT include the city here.",
  "suggestedCityName": "The city name ONLY (e.g., 'Glasgow', 'Edinburgh').",
  "caption": "A 1-sentence description of the exact action happening in the video (e.g., 'Eating massive slices of pizza at 1am').",
  "sceneDescription": "Literal description of the visual AND audio evidence in one rich sentence.",
  "essence": "A highly evocative, sensory 2-sentence journal entry capturing the weather, lighting, sounds, and mood of being there in this exact moment. Write in present tense. Make it beautiful.",
  "activityType": "1-3 words (e.g., 'Comfort Food', 'Live Music', 'Stadium Visit').",
  "richTags": ["5-8", "lowercase", "literal", "tags"],
  "moodTags": ["3", "emotional", "atmospheric", "tags"]
}

Respond with valid JSON only. No markdown, no explanation.`;
}

// ── Gemini File API helpers (videos only) ───────────────────────────

async function uploadToGeminiFileApi(
  apiKey: string,
  videoUrl: string,
  mimeType: string,
  displayName: string,
): Promise<string> {
  const videoResponse = await fetch(videoUrl);
  if (!videoResponse.ok || !videoResponse.body) {
    throw new Error(`Failed to fetch video from storage: ${videoResponse.statusText}`);
  }

  const fileApiUrl = `https://generativelanguage.googleapis.com/upload/v1beta/files?uploadType=media&key=${apiKey}`;
  console.log(`Streaming "${displayName}" to Gemini File API (${mimeType})...`);

  const uploadRes = await fetch(fileApiUrl, {
    method: "POST",
    headers: {
      "X-Goog-Upload-Protocol": "raw",
      "Content-Type": mimeType,
    },
    body: videoResponse.body,
    // @ts-ignore — Deno requires this to stream request bodies without buffering to RAM
    duplex: "half",
  });

  if (!uploadRes.ok) {
    const errBody = await uploadRes.text();
    throw new Error(`Gemini File API upload failed [${uploadRes.status}]: ${errBody}`);
  }

  const uploadData = await uploadRes.json();
  const fileUri = uploadData?.file?.uri;
  if (!fileUri) {
    throw new Error(`Gemini File API returned no fileUri: ${JSON.stringify(uploadData)}`);
  }

  console.log(`Upload complete. URI: ${fileUri}`);
  return fileUri;
}

async function waitForFileActive(apiKey: string, fileUri: string): Promise<void> {
  const filePath = fileUri.replace("https://generativelanguage.googleapis.com/v1beta/", "");
  const statusUrl = `https://generativelanguage.googleapis.com/v1beta/${filePath}?key=${apiKey}`;

  for (let attempt = 0; attempt < FILE_POLL_MAX_ATTEMPTS; attempt++) {
    const res = await fetch(statusUrl);
    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`Failed to check file status: ${errText}`);
    }
    const data = await res.json();
    if (data?.state === "ACTIVE") {
      console.log("File is ACTIVE.");
      return;
    }
    if (data?.state === "FAILED") {
      throw new Error(`Gemini file processing failed: ${JSON.stringify(data?.error)}`);
    }
    await sleep(FILE_POLL_INTERVAL_MS);
  }
  throw new Error("Gemini file processing timed out.");
}

async function deleteGeminiFile(apiKey: string, fileUri: string): Promise<void> {
  try {
    const filePath = fileUri.replace("https://generativelanguage.googleapis.com/v1beta/", "");
    await fetch(`https://generativelanguage.googleapis.com/v1beta/${filePath}?key=${apiKey}`, { method: "DELETE" });
  } catch { /* Gemini auto-deletes after 48h */ }
}

// ── Gemini generate (accepts any media part) ────────────────────────

// deno-lint-ignore no-explicit-any
async function callGemini(apiKey: string, mediaPart: any, prompt: string) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${apiKey}`;
  const body = {
    contents: [{
      parts: [
        mediaPart,
        { text: prompt },
      ],
    }],
    generationConfig: { responseMimeType: "application/json" },
  };

  for (let attempt = 0; attempt <= RATE_LIMIT_RETRY_DELAYS_MS.length; attempt++) {
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    if (response.status === 429) {
      const errText = await response.text();
      if (attempt < RATE_LIMIT_RETRY_DELAYS_MS.length) {
        console.warn(`Gemini rate limited, retrying in ${RATE_LIMIT_RETRY_DELAYS_MS[attempt]}ms`);
        await sleep(RATE_LIMIT_RETRY_DELAYS_MS[attempt]);
        continue;
      }
      throw new Error(`Rate limited after retries: ${errText}`);
    }
    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`Gemini error [${response.status}]: ${errText}`);
    }
    return await response.json();
  }
  throw new Error("Rate limited after all retries.");
}

// ── Parse result helper ─────────────────────────────────────────────

// deno-lint-ignore no-explicit-any
function parseGeminiResult(parsed: any, captionId: string): VideoAnalysisResult {
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
    suggestedVenueName: typeof parsed.venueName === "string" ? parsed.venueName.trim() : null,
    suggestedCityName: typeof parsed.cityName === "string" ? parsed.cityName.trim() : null,
  };
}

// ── Background processing ───────────────────────────────────────────

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
  const geminiApiKey = Deno.env.get("GOOGLE_AI_STUDIO_KEY")!;
  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const supabase = getServiceClient();
  let geminiFileUri: string | null = null;

  try {
    const mediaUrl = `${supabaseUrl}/storage/v1/object/public/trip-photos/${params.storagePath}`;

    // deno-lint-ignore no-explicit-any
    let geminiMediaPart: any;

    // ── Route based on media type ──
    if (params.mimeType.startsWith("video/")) {
      console.log(`Analyzing VIDEO "${params.fileName}" via Gemini File API.`);

      geminiFileUri = await uploadToGeminiFileApi(geminiApiKey, mediaUrl, params.mimeType, params.fileName);
      await waitForFileActive(geminiApiKey, geminiFileUri);

      geminiMediaPart = {
        fileData: {
          mimeType: params.mimeType,
          fileUri: geminiFileUri,
        },
      };
    } else if (params.mimeType.startsWith("image/")) {
      console.log(`Analyzing IMAGE "${params.fileName}" via Inline Data.`);

      const imageResponse = await fetch(mediaUrl);
      if (!imageResponse.ok) throw new Error("Failed to fetch image from storage.");

      const arrayBuffer = await imageResponse.arrayBuffer();
      const bytes = new Uint8Array(arrayBuffer);
      let binary = "";
      for (let i = 0; i < bytes.length; i++) {
        binary += String.fromCharCode(bytes[i]);
      }
      const base64Data = btoa(binary);

      geminiMediaPart = {
        inlineData: {
          mimeType: params.mimeType,
          data: base64Data,
        },
      };
    } else {
      throw new Error(`Unsupported file type: ${params.mimeType}`);
    }

    // Generate analysis
    const prompt = buildPrompt({
      takenAt: params.takenAt,
      latitude: params.latitude,
      longitude: params.longitude,
      locationName: params.locationName,
      country: params.country,
      nearbyPlaces: params.nearbyPlaces,
      itinerarySteps: params.itinerarySteps,
    });
    const data = await callGemini(geminiApiKey, geminiMediaPart, prompt);

    const textContent = data?.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!textContent) throw new Error("No content in Gemini response");

    const parsed = JSON.parse(textContent);
    const result = parseGeminiResult(parsed, params.captionId);

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
  } finally {
    if (geminiFileUri) {
      await deleteGeminiFile(geminiApiKey, geminiFileUri);
    }
  }
}

// ── Main handler ────────────────────────────────────────────────────

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  try {
    const geminiApiKey = Deno.env.get("GOOGLE_AI_STUDIO_KEY");
    if (!geminiApiKey) throw new Error("GOOGLE_AI_STUDIO_KEY is not configured");

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
