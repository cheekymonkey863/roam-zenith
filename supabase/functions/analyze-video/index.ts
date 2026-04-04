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
}

type HttpError = Error & { status?: number };

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

const LOVABLE_AI_URL = "https://ai.gateway.lovable.dev/v1/chat/completions";
const MODEL = "google/gemini-2.5-flash";
const RATE_LIMIT_RETRY_DELAYS_MS = [2000, 4000, 8000];

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function createHttpError(status: number, message: string): HttpError {
  const error = new Error(message) as HttpError;
  error.status = status;
  return error;
}

function getRetryDelayMs(retryAfterHeader: string | null, fallbackMs: number) {
  if (!retryAfterHeader) return fallbackMs;

  const retryAfterSeconds = Number(retryAfterHeader);
  if (Number.isFinite(retryAfterSeconds) && retryAfterSeconds >= 0) {
    return retryAfterSeconds * 1000;
  }

  const retryAt = new Date(retryAfterHeader).getTime();
  if (Number.isFinite(retryAt)) {
    return Math.max(retryAt - Date.now(), fallbackMs);
  }

  return fallbackMs;
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

function buildPrompt(metadata: {
  takenAt: string | null;
  latitude: number | null;
  longitude: number | null;
  locationName: string | null;
  country: string | null;
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
    metadataParts.push(`Recorded on ${formatted} UTC`);
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
    metadataParts.push(`Approximate Location: ${loc}`);
  }

  const metadataBlock = metadataParts.length > 0
    ? `METADATA: ${metadataParts.join(". ")}.`
    : "No metadata available.";

  let itineraryBlock = "";
  if (metadata.itinerarySteps && metadata.itinerarySteps.length > 0) {
    const stopLines = metadata.itinerarySteps.map((s, i) => {
      const loc = s.location_name || "Unknown";
      const country = s.country && s.country !== "Unknown" ? `, ${s.country}` : "";
      const date = new Date(s.recorded_at).toLocaleDateString("en-GB", { dateStyle: "medium" });
      const desc = s.description ? ` — ${s.description}` : "";
      return `  ${i + 1}. ${loc}${country} (${date}, ${s.event_type})${desc}`;
    });
    itineraryBlock = `\n\nKNOWN ITINERARY STOPS (pre-planned or already confirmed stops on this trip):\n${stopLines.join("\n")}\n\nIMPORTANT: If the video clearly matches one of these known stops, reference it in your caption and description. Use the stop's location name as ground truth when the visual content is consistent with it.`;
  }

  return `You are a world-class travel writer and expert metadata tagger.
I am providing a video from a user's trip, along with hard EXIF metadata extracted from the file.

${metadataBlock}${itineraryBlock}

TASKS:
1. Watch the entire video carefully — every second matters.
2. Listen to the full audio track — identify background noise, music, speech, nature sounds, crowd sounds, wind.
3. Analyze visual elements: lighting, scenery, objects, movement, signage, architecture, landmarks, food, people, weather.
4. Cross-reference what you see and hear with the provided metadata to determine the exact travel moment.
5. Use the GPS coordinates and location name as ground truth for WHERE. Use your visual/audio analysis for WHAT is happening.

OUTPUT RULES:
- Describe ONLY what is literally visible and audible. Never speculate or invent narratives.
- The metadata location is authoritative — do not contradict it unless what you see clearly indicates otherwise.
- "caption": A concise label (max 14 words) describing the literal content.
- "sceneDescription": One rich sentence capturing the visual AND audio elements literally present.
- "essence": Two to three vivid sentences capturing the atmosphere of this moment — what it felt like to be there. Reference specific visual details, sounds, and the setting from the metadata. Write in present tense.
- "activityType": One to three words (e.g. "City Sightseeing", "Live Concert", "Street Food Dining", "Beach Walk", "Stadium Event").
- "richTags": 3-8 lowercase tags about what is visible/audible (e.g. "gothic architecture", "christmas market", "crowd noise", "pizza").
- "moodTags": 3 emotional/atmospheric tags derived from audio+visual (e.g. "energetic", "serene", "festive", "moody").

Respond with valid JSON matching the schema exactly.`;
}

async function callLovableAiWithRetries(lovableApiKey: string, requestBody: unknown) {
  for (let attempt = 0; attempt <= RATE_LIMIT_RETRY_DELAYS_MS.length; attempt++) {
    const response = await fetch(LOVABLE_AI_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${lovableApiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(requestBody),
    });

    if (response.status === 429) {
      const errText = await response.text();
      if (attempt < RATE_LIMIT_RETRY_DELAYS_MS.length) {
        const delayMs = getRetryDelayMs(response.headers.get("retry-after"), RATE_LIMIT_RETRY_DELAYS_MS[attempt]);
        console.warn(
          `[analyze-video] Lovable AI rate limited, retrying in ${delayMs}ms (attempt ${attempt + 1}/${RATE_LIMIT_RETRY_DELAYS_MS.length + 1})`,
        );
        await sleep(delayMs);
        continue;
      }

      throw createHttpError(429, errText || "Rate limited, please try again later.");
    }

    if (response.status === 402) {
      const errText = await response.text();
      throw createHttpError(402, errText || "AI credits exhausted. Please add funds in Settings > Workspace > Usage.");
    }

    if (!response.ok) {
      const errText = await response.text();
      console.error(`Lovable AI error [${response.status}]:`, errText);
      throw createHttpError(response.status, `AI gateway error [${response.status}]: ${errText}`);
    }

    return await response.json();
  }

  throw createHttpError(429, "Rate limited, please try again later.");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  try {
    const lovableApiKey = Deno.env.get("LOVABLE_API_KEY");
    if (!lovableApiKey) throw new Error("LOVABLE_API_KEY is not configured");

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

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const videoUrl = `${supabaseUrl}/storage/v1/object/public/trip-photos/${storagePath}`;

    console.log(`Analyzing "${fileName}" via Lovable AI. Video URL: ${videoUrl}`);

    const prompt = buildPrompt({ takenAt, latitude, longitude, locationName, country });
    const data = await callLovableAiWithRetries(lovableApiKey, {
      model: MODEL,
      messages: [
        {
          role: "user",
          content: [
            {
              type: "image_url",
              image_url: { url: videoUrl },
            },
            {
              type: "text",
              text: prompt,
            },
          ],
        },
      ],
      response_format: { type: "json_object" },
    });

    const textContent = data?.choices?.[0]?.message?.content;
    if (!textContent) {
      console.error("AI response had no content:", JSON.stringify(data));
      throw new Error("No content in AI response");
    }

    const parsed = JSON.parse(textContent);
    const result: VideoAnalysisResult = {
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
    };

    console.log(`Analysis complete for "${fileName}": ${result.caption}`);
    return jsonResponse({ result });
  } catch (error) {
    console.error("analyze-video error:", error);
    const message = error instanceof Error ? error.message : "Unknown error";
    const status = typeof error === "object" && error !== null && "status" in error && typeof (error as HttpError).status === "number"
      ? (error as HttpError).status!
      : null;

    if (status === 402 || message.includes("402")) {
      return jsonResponse({ error: "AI credits exhausted. Please add funds in Settings > Workspace > Usage." }, 402);
    }

    if (status === 429 || message.includes("429") || message.includes("RESOURCE_EXHAUSTED")) {
      return jsonResponse({ error: "Rate limited, please try again later." }, 429);
    }

    return jsonResponse({ error: message }, 500);
  }
});
