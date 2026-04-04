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
const FILE_POLL_INTERVAL_MS = 2000;
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
    itineraryBlock = `\n\nKNOWN ITINERARY STOPS:\n${stopLines.join("\n")}\n\nIMPORTANT: If the video clearly matches one of these known stops, reference it in your caption and description.`;
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
      itinerarySteps: params.itinerarySteps,
    });
    const data = await callGemini(geminiApiKey, geminiMediaPart, prompt);

    const textContent = data?.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!textContent) throw new Error("No content in Gemini response");

    const parsed = JSON.parse(textContent);
    const result: VideoAnalysisResult = {
      captionId: params.captionId,
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
