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

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

const GEMINI_API_BASE = "https://generativelanguage.googleapis.com";
const GEMINI_MODEL = "gemini-2.5-flash";

// ── Gemini File API helpers ──────────────────────────────────

async function uploadToGeminiFileAPI(
  apiKey: string,
  videoBytes: Uint8Array,
  mimeType: string,
  displayName: string,
): Promise<string> {
  // Step 1: Start resumable upload
  const startRes = await fetch(
    `${GEMINI_API_BASE}/upload/v1beta/files?key=${apiKey}`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Upload-Protocol": "resumable",
        "X-Goog-Upload-Command": "start",
        "X-Goog-Upload-Header-Content-Length": String(videoBytes.byteLength),
        "X-Goog-Upload-Header-Content-Type": mimeType,
      },
      body: JSON.stringify({ file: { display_name: displayName } }),
    },
  );

  if (!startRes.ok) {
    const errText = await startRes.text();
    throw new Error(`Gemini File API start failed [${startRes.status}]: ${errText}`);
  }

  const uploadUrl = startRes.headers.get("X-Goog-Upload-URL");
  if (!uploadUrl) throw new Error("No upload URL returned from Gemini File API");

  // Consume the body to avoid resource leak
  await startRes.text();

  // Step 2: Upload the bytes
  const uploadRes = await fetch(uploadUrl, {
    method: "PUT",
    headers: {
      "Content-Length": String(videoBytes.byteLength),
      "X-Goog-Upload-Offset": "0",
      "X-Goog-Upload-Command": "upload, finalize",
    },
    body: videoBytes,
  });

  if (!uploadRes.ok) {
    const errText = await uploadRes.text();
    throw new Error(`Gemini File API upload failed [${uploadRes.status}]: ${errText}`);
  }

  const uploadData = await uploadRes.json();
  const fileUri = uploadData?.file?.uri;
  if (!fileUri) throw new Error("No fileUri in Gemini upload response");

  return fileUri;
}

async function waitForFileActive(apiKey: string, fileUri: string, maxWaitMs = 120_000): Promise<void> {
  // Extract file name from URI: files/xxxx
  const fileName = fileUri.split("/").slice(-1)[0];
  const getUrl = `${GEMINI_API_BASE}/v1beta/files/${fileName}?key=${apiKey}`;

  const deadline = Date.now() + maxWaitMs;
  while (Date.now() < deadline) {
    const res = await fetch(getUrl);
    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`File status check failed [${res.status}]: ${errText}`);
    }
    const data = await res.json();
    const state = data?.state;

    if (state === "ACTIVE") return;
    if (state === "FAILED") throw new Error(`Gemini file processing failed: ${JSON.stringify(data)}`);

    // Wait 2 seconds before polling again
    await new Promise((r) => setTimeout(r, 2000));
  }

  throw new Error("Timed out waiting for Gemini file to become ACTIVE");
}

// ── Main analysis ────────────────────────────────────────────

async function analyzeVideoWithGemini(
  apiKey: string,
  fileUri: string,
  mimeType: string,
  metadata: {
    captionId: string;
    fileName: string;
    takenAt: string | null;
    latitude: number | null;
    longitude: number | null;
    locationName: string | null;
    country: string | null;
  },
): Promise<VideoAnalysisResult> {
  // Build the Context Sandwich — ground-truth metadata injected alongside the video
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

  const prompt = `You are a world-class travel writer and expert metadata tagger.
I am providing a video from a user's trip, along with hard EXIF metadata extracted from the file.

${metadataBlock}

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
- "moodTags": 3 emotional/atmospheric tags derived from audio+visual (e.g. "energetic", "serene", "festive", "moody").`;

  const response = await fetch(
    `${GEMINI_API_BASE}/v1beta/models/${GEMINI_MODEL}:generateContent?key=${apiKey}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [
          {
            parts: [
              { fileData: { fileUri, mimeType } },
              { text: prompt },
            ],
          },
        ],
        generationConfig: {
          responseMimeType: "application/json",
          responseSchema: {
            type: "OBJECT",
            properties: {
              caption: { type: "STRING" },
              sceneDescription: { type: "STRING" },
              essence: { type: "STRING" },
              activityType: { type: "STRING" },
              richTags: { type: "ARRAY", items: { type: "STRING" } },
              moodTags: { type: "ARRAY", items: { type: "STRING" } },
            },
            required: ["caption", "sceneDescription", "essence", "activityType", "richTags", "moodTags"],
          },
        },
      }),
    },
  );

  if (!response.ok) {
    const errText = await response.text();
    console.error(`Gemini generateContent error [${response.status}]:`, errText);
    throw new Error(`Gemini API error [${response.status}]: ${errText}`);
  }

  const data = await response.json();
  const textContent = data?.candidates?.[0]?.content?.parts?.[0]?.text;

  if (!textContent) {
    console.error("Gemini response had no text content:", JSON.stringify(data));
    throw new Error("No content in Gemini response");
  }

  const parsed = JSON.parse(textContent);

  return {
    captionId: metadata.captionId,
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
}

// ── Request handler ──────────────────────────────────────────

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  try {
    const apiKey = Deno.env.get("GOOGLE_AI_STUDIO_KEY");
    if (!apiKey) throw new Error("GOOGLE_AI_STUDIO_KEY is not configured");

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
    } = body;

    if (!storagePath || typeof storagePath !== "string") {
      return jsonResponse({ error: "storagePath is required" }, 400);
    }
    if (!captionId || typeof captionId !== "string") {
      return jsonResponse({ error: "captionId is required" }, 400);
    }

    // Normalize MIME type for Gemini
    let mimeType = rawMimeType || "video/mp4";
    if (mimeType === "video/quicktime" || mimeType === "video/mov") {
      mimeType = "video/mp4";
    }

    // Download video from Supabase Storage
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabaseClient = createClient(supabaseUrl, supabaseServiceKey);

    console.log(`Downloading video "${fileName}" from storage: ${storagePath}...`);
    const { data: fileData, error: downloadError } = await supabaseClient.storage
      .from("trip-photos")
      .download(storagePath);

    if (downloadError || !fileData) {
      console.error("Storage download error:", downloadError);
      return jsonResponse({ error: `Failed to download video: ${downloadError?.message}` }, 500);
    }

    const videoBytes = new Uint8Array(await fileData.arrayBuffer());
    const sizeMB = (videoBytes.byteLength / 1024 / 1024).toFixed(1);
    console.log(`Downloaded ${sizeMB}MB. Uploading to Gemini File API...`);

    // Upload to Gemini File API
    const fileUri = await uploadToGeminiFileAPI(apiKey, videoBytes, mimeType, fileName);
    console.log(`Uploaded to Gemini. fileUri: ${fileUri}. Waiting for ACTIVE...`);

    // Wait for file to be processed
    await waitForFileActive(apiKey, fileUri);
    console.log(`File ACTIVE. Running analysis...`);

    // Analyze with generateContent using fileUri
    const result = await analyzeVideoWithGemini(apiKey, fileUri, mimeType, {
      captionId,
      fileName,
      takenAt,
      latitude,
      longitude,
      locationName,
      country,
    });

    console.log(`Analysis complete for "${fileName}": ${result.caption}`);
    return jsonResponse({ result });
  } catch (error) {
    console.error("analyze-video error:", error);
    const message = error instanceof Error ? error.message : "Unknown error";

    if (message.includes("429") || message.includes("RESOURCE_EXHAUSTED")) {
      return jsonResponse({ error: "Rate limited, please try again later." }, 429);
    }

    return jsonResponse({ error: message }, 500);
  }
});
