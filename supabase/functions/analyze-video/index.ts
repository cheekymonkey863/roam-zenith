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

async function analyzeVideoWithGemini(
  apiKey: string,
  videoBase64: string,
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
              { inlineData: { mimeType, data: videoBase64 } },
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
    richTags: Array.isArray(parsed.richTags)
      ? parsed.richTags.filter((t: unknown): t is string => typeof t === "string").map((t: string) => t.trim().toLowerCase())
      : [],
    activityType: typeof parsed.activityType === "string" ? parsed.activityType.trim() : "activity",
    moodTags: Array.isArray(parsed.moodTags)
      ? parsed.moodTags.filter((t: unknown): t is string => typeof t === "string").map((t: string) => t.trim().toLowerCase())
      : [],
  };
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
      captionId,
      fileName = "video.mp4",
      takenAt = null,
      latitude = null,
      longitude = null,
      locationName = null,
      country = null,
    } = body;

    // Normalize MIME type — Gemini doesn't accept video/quicktime
    let mimeType = body.mimeType || "video/mp4";
    if (mimeType === "video/quicktime") {
      mimeType = "video/mov";
    }

    if (!videoBase64 || typeof videoBase64 !== "string") {
      return jsonResponse({ error: "videoBase64 is required" }, 400);
    }
    if (!captionId || typeof captionId !== "string") {
      return jsonResponse({ error: "captionId is required" }, 400);
    }

    const sizeMB = (videoBase64.length * 0.75 / 1024 / 1024).toFixed(1);
    console.log(`Analyzing video "${fileName}" (${sizeMB}MB, ${mimeType}) via inline data...`);

    const result = await analyzeVideoWithGemini(apiKey, videoBase64, mimeType, {
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
