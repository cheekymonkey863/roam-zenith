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

interface ItineraryStop {
  location_name: string | null;
  country: string | null;
  latitude: number;
  longitude: number;
  recorded_at: string;
  event_type: string;
  description: string | null;
}

type HttpError = Error & { status?: number };

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

const GEMINI_MODEL = "gemini-2.5-flash";
const RATE_LIMIT_RETRY_DELAYS_MS = [2000, 4000, 8000];
const FILE_POLL_INTERVAL_MS = 2000;
const FILE_POLL_MAX_ATTEMPTS = 60; // 2 minutes max

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function createHttpError(status: number, message: string): HttpError {
  const error = new Error(message) as HttpError;
  error.status = status;
  return error;
}

// ── Prompt builder ──────────────────────────────────────────────────

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

// ── Gemini File API helpers ─────────────────────────────────────────

async function uploadToGeminiFileApi(
  apiKey: string,
  videoUrl: string,
  mimeType: string,
  displayName: string,
): Promise<string> {
  // Stream the video from Supabase Storage directly to the Gemini File API
  const videoResponse = await fetch(videoUrl);
  if (!videoResponse.ok || !videoResponse.body) {
    throw createHttpError(videoResponse.status, `Failed to fetch video from storage: ${videoResponse.statusText}`);
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
  });

  if (!uploadRes.ok) {
    const errBody = await uploadRes.text();
    throw createHttpError(uploadRes.status, `Gemini File API upload failed [${uploadRes.status}]: ${errBody}`);
  }

  const uploadData = await uploadRes.json();
  const fileUri = uploadData?.file?.uri;
  const fileName = uploadData?.file?.name;

  if (!fileUri || !fileName) {
    throw new Error(`Gemini File API returned no fileUri: ${JSON.stringify(uploadData)}`);
  }

  console.log(`Upload complete. File: ${fileName}, URI: ${fileUri}`);
  return fileUri;
}

async function waitForFileActive(apiKey: string, fileUri: string): Promise<void> {
  // Extract file name from URI: files/xxx -> xxx
  const fileName = fileUri.replace("https://generativelanguage.googleapis.com/v1beta/", "");
  const statusUrl = `https://generativelanguage.googleapis.com/v1beta/${fileName}?key=${apiKey}`;

  for (let attempt = 0; attempt < FILE_POLL_MAX_ATTEMPTS; attempt++) {
    const res = await fetch(statusUrl);
    if (!res.ok) {
      const errText = await res.text();
      throw createHttpError(res.status, `Failed to check file status: ${errText}`);
    }

    const data = await res.json();
    const state = data?.state;

    if (state === "ACTIVE") {
      console.log(`File is ACTIVE, ready for analysis.`);
      return;
    }

    if (state === "FAILED") {
      throw new Error(`Gemini file processing failed: ${JSON.stringify(data?.error)}`);
    }

    // PROCESSING — wait and retry
    await sleep(FILE_POLL_INTERVAL_MS);
  }

  throw new Error("Gemini file processing timed out after 2 minutes.");
}

async function deleteGeminiFile(apiKey: string, fileUri: string): Promise<void> {
  try {
    const filePath = fileUri.replace("https://generativelanguage.googleapis.com/v1beta/", "");
    const deleteUrl = `https://generativelanguage.googleapis.com/v1beta/${filePath}?key=${apiKey}`;
    const res = await fetch(deleteUrl, { method: "DELETE" });
    if (res.ok) {
      console.log(`Cleaned up Gemini file: ${filePath}`);
    }
    await res.text(); // consume body
  } catch {
    // Non-critical — Gemini auto-deletes after 48h
  }
}

// ── Gemini generateContent with retries ─────────────────────────────

async function callGeminiWithRetries(
  apiKey: string,
  fileUri: string,
  mimeType: string,
  prompt: string,
) {
  const generateUrl = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${apiKey}`;

  const requestBody = {
    contents: [
      {
        parts: [
          {
            fileData: {
              mimeType,
              fileUri,
            },
          },
          {
            text: prompt,
          },
        ],
      },
    ],
    generationConfig: {
      responseMimeType: "application/json",
    },
  };

  for (let attempt = 0; attempt <= RATE_LIMIT_RETRY_DELAYS_MS.length; attempt++) {
    const response = await fetch(generateUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(requestBody),
    });

    if (response.status === 429) {
      const errText = await response.text();
      if (attempt < RATE_LIMIT_RETRY_DELAYS_MS.length) {
        const delayMs = RATE_LIMIT_RETRY_DELAYS_MS[attempt];
        console.warn(`[analyze-video] Gemini rate limited, retrying in ${delayMs}ms (attempt ${attempt + 1})`);
        await sleep(delayMs);
        continue;
      }
      throw createHttpError(429, errText || "Rate limited, please try again later.");
    }

    if (!response.ok) {
      const errText = await response.text();
      console.error(`Gemini API error [${response.status}]:`, errText);
      throw createHttpError(response.status, `Gemini API error [${response.status}]: ${errText}`);
    }

    return await response.json();
  }

  throw createHttpError(429, "Rate limited after all retries.");
}

// ── Main handler ────────────────────────────────────────────────────

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  let geminiFileUri: string | null = null;

  try {
    const geminiApiKey = Deno.env.get("GOOGLE_AI_STUDIO_KEY");
    if (!geminiApiKey) throw new Error("GOOGLE_AI_STUDIO_KEY is not configured");

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

    // Normalize MIME type — Gemini needs video/mp4 for .mov files
    let mimeType = rawMimeType || "video/mp4";
    if (mimeType === "video/quicktime" || mimeType === "video/mov") {
      mimeType = "video/mp4";
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const videoUrl = `${supabaseUrl}/storage/v1/object/public/trip-photos/${storagePath}`;

    console.log(`Analyzing "${fileName}" via Gemini File API.`);

    // 1. Stream video from Storage → Gemini File API
    geminiFileUri = await uploadToGeminiFileApi(geminiApiKey, videoUrl, mimeType, fileName);

    // 2. Poll until Gemini finishes processing the video
    await waitForFileActive(geminiApiKey, geminiFileUri);

    // 3. Call generateContent with the file reference
    const prompt = buildPrompt({ takenAt, latitude, longitude, locationName, country, itinerarySteps });
    const data = await callGeminiWithRetries(geminiApiKey, geminiFileUri, mimeType, prompt);

    // 4. Parse the response
    const textContent = data?.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!textContent) {
      console.error("Gemini response had no text content:", JSON.stringify(data));
      throw new Error("No content in Gemini response");
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

    if (status === 429 || message.includes("429") || message.includes("RESOURCE_EXHAUSTED")) {
      return jsonResponse({ error: "Rate limited, please try again later." }, 429);
    }

    return jsonResponse({ error: message }, 500);
  } finally {
    // Clean up the Gemini file regardless of success/failure
    if (geminiFileUri) {
      const geminiApiKey = Deno.env.get("GOOGLE_AI_STUDIO_KEY");
      if (geminiApiKey) {
        await deleteGeminiFile(geminiApiKey, geminiFileUri);
      }
    }
  }
});
