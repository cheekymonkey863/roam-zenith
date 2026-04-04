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
const MAX_POLL_ATTEMPTS = 30;
const POLL_INTERVAL_MS = 2000;

async function uploadToFileApi(
  apiKey: string,
  videoBase64: string,
  mimeType: string,
  displayName: string,
): Promise<string> {
  // Decode base64 to binary
  const binaryString = atob(videoBase64);
  const bytes = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }

  // Step 1: Initiate resumable upload
  const initResponse = await fetch(
    `${GEMINI_API_BASE}/upload/v1beta/files?key=${apiKey}`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Upload-Protocol": "resumable",
        "X-Goog-Upload-Command": "start",
        "X-Goog-Upload-Header-Content-Length": String(bytes.length),
        "X-Goog-Upload-Header-Content-Type": mimeType,
      },
      body: JSON.stringify({ file: { display_name: displayName } }),
    },
  );

  if (!initResponse.ok) {
    const errText = await initResponse.text();
    throw new Error(`File API init failed [${initResponse.status}]: ${errText}`);
  }

  const uploadUrl = initResponse.headers.get("X-Goog-Upload-URL");
  if (!uploadUrl) throw new Error("No upload URL returned from File API");

  // Step 2: Upload the bytes
  const uploadResponse = await fetch(uploadUrl, {
    method: "PUT",
    headers: {
      "Content-Length": String(bytes.length),
      "X-Goog-Upload-Offset": "0",
      "X-Goog-Upload-Command": "upload, finalize",
    },
    body: bytes,
  });

  if (!uploadResponse.ok) {
    const errText = await uploadResponse.text();
    throw new Error(`File upload failed [${uploadResponse.status}]: ${errText}`);
  }

  const uploadResult = await uploadResponse.json();
  const fileUri = uploadResult?.file?.uri;
  const fileName = uploadResult?.file?.name;

  if (!fileUri || !fileName) {
    throw new Error("File API returned no URI or name");
  }

  // Step 3: Poll until file state is ACTIVE
  for (let attempt = 0; attempt < MAX_POLL_ATTEMPTS; attempt++) {
    const statusResponse = await fetch(
      `${GEMINI_API_BASE}/v1beta/${fileName}?key=${apiKey}`,
    );
    if (statusResponse.ok) {
      const statusData = await statusResponse.json();
      if (statusData.state === "ACTIVE") {
        return fileUri;
      }
      if (statusData.state === "FAILED") {
        console.error("Gemini file processing failed:", JSON.stringify(statusData));
        throw new Error(`File processing failed on Gemini side: ${statusData.error?.message || JSON.stringify(statusData)}`);
      }
    }
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
  }

  throw new Error("File processing timed out");
}

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
  const metadataBlock = [
    metadata.takenAt ? `Timestamp: ${metadata.takenAt}` : null,
    metadata.latitude != null && metadata.longitude != null
      ? `Coordinates: ${metadata.latitude.toFixed(6)}, ${metadata.longitude.toFixed(6)}`
      : null,
    metadata.locationName ? `Reverse-geocoded location: ${metadata.locationName}${metadata.country ? `, ${metadata.country}` : ""}` : null,
  ]
    .filter(Boolean)
    .join(" | ");

  const prompt = `You are a world-class travel writer and expert metadata tagger.
I am providing a video from a user's trip, along with its metadata.

${metadataBlock ? `METADATA:\n${metadataBlock}` : "No metadata available."}

TASKS:
1. Watch the entire video carefully.
2. Listen to the audio track — identify background noise, music, speech, nature sounds, crowd sounds.
3. Analyze visual elements: lighting, scenery, objects, movement, signage, architecture, landmarks.
4. Synthesize the metadata and media to determine the exact travel moment.

OUTPUT RULES:
- Describe ONLY what is literally visible and audible. Never speculate or invent narratives.
- "caption": A concise label (max 14 words) describing the literal content of the video.
- "sceneDescription": One rich sentence capturing the visual AND audio elements literally present.
- "activityType": One to three words (e.g. "Live Concert", "Street Food Dining", "Beach Walk").
- "richTags": 3-8 lowercase tags about what is visible/audible.
- "moodTags": 3 emotional/atmospheric tags derived from audio+visual (e.g. "energetic", "serene", "festive").`;

  const response = await fetch(
    `${GEMINI_API_BASE}/v1beta/models/${GEMINI_MODEL}:generateContent?key=${apiKey}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [
          {
            parts: [
              { fileData: { mimeType, fileUri } },
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
              activityType: { type: "STRING" },
              richTags: { type: "ARRAY", items: { type: "STRING" } },
              moodTags: { type: "ARRAY", items: { type: "STRING" } },
            },
            required: ["caption", "sceneDescription", "activityType", "richTags", "moodTags"],
          },
        },
      }),
    },
  );

  if (!response.ok) {
    const errText = await response.text();
    console.error(`Gemini generateContent error [${response.status}]:`, errText);
    throw new Error(`Gemini API error [${response.status}]`);
  }

  const data = await response.json();
  const textContent = data?.candidates?.[0]?.content?.parts?.[0]?.text;

  if (!textContent) {
    throw new Error("No content in Gemini response");
  }

  const parsed = JSON.parse(textContent);

  return {
    captionId: metadata.captionId,
    caption: typeof parsed.caption === "string" ? parsed.caption.trim() : "Video clip",
    sceneDescription: typeof parsed.sceneDescription === "string" ? parsed.sceneDescription.trim() : "",
    richTags: Array.isArray(parsed.richTags)
      ? parsed.richTags.filter((t: unknown): t is string => typeof t === "string").map((t: string) => t.trim().toLowerCase())
      : [],
    activityType: typeof parsed.activityType === "string" ? parsed.activityType.trim() : "activity",
    moodTags: Array.isArray(parsed.moodTags)
      ? parsed.moodTags.filter((t: unknown): t is string => typeof t === "string").map((t: string) => t.trim().toLowerCase())
      : [],
  };
}

// Cleanup uploaded file after analysis
async function deleteFile(apiKey: string, fileUri: string) {
  try {
    // Extract file name from URI like "https://generativelanguage.googleapis.com/v1beta/files/xxx"
    const parts = fileUri.split("/");
    const fileName = `files/${parts[parts.length - 1]}`;
    await fetch(`${GEMINI_API_BASE}/v1beta/${fileName}?key=${apiKey}`, {
      method: "DELETE",
    });
  } catch {
    // Best-effort cleanup
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
    const apiKey = Deno.env.get("GOOGLE_AI_STUDIO_KEY");
    if (!apiKey) {
      throw new Error("GOOGLE_AI_STUDIO_KEY is not configured");
    }

    const body = await req.json();
    const {
      videoBase64,
      mimeType = "video/mp4",
      captionId,
      fileName = "video.mp4",
      takenAt = null,
      latitude = null,
      longitude = null,
      locationName = null,
      country = null,
    } = body;

    if (!videoBase64 || typeof videoBase64 !== "string") {
      return jsonResponse({ error: "videoBase64 is required" }, 400);
    }
    if (!captionId || typeof captionId !== "string") {
      return jsonResponse({ error: "captionId is required" }, 400);
    }

    console.log(`Uploading video "${fileName}" (${(videoBase64.length * 0.75 / 1024 / 1024).toFixed(1)}MB) to Gemini File API...`);
    const fileUri = await uploadToFileApi(apiKey, videoBase64, mimeType, fileName);
    console.log(`File ready: ${fileUri}`);

    const result = await analyzeVideoWithGemini(apiKey, fileUri, mimeType, {
      captionId,
      fileName,
      takenAt,
      latitude,
      longitude,
      locationName,
      country,
    });

    // Cleanup
    await deleteFile(apiKey, fileUri);

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
