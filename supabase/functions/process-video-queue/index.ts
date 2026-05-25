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
const BATCH_SIZE = 5;
const INTER_JOB_DELAY_MS = 4000;

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

CRITICAL RULES FOR EXACT VENUE IDENTIFICATION:
1. The "Rough GPS Neighborhood" is an automated coordinate lookup. IT IS OFTEN WRONG (e.g., calling a pizza shop a nearby monument or office).
2. TRUST YOUR EYES AND EARS. If the GPS says "Thomas Riddell" but you see a pizza restaurant, the venue is the pizza restaurant.
3. You have been provided a list of "NEARBY BUSINESSES/VENUES". Cross-reference what you visually see and hear with this list.
4. If you see people eating pizza, and "Civerinos" is on the nearby list, the venue is definitively "Civerinos".
5. If you hear a live folk band, and "Whistlebinkies" is on the list, the venue is definitively "Whistlebinkies".
6. If you can read a sign, logo, or branding in the video, use that exact name.
7. ONLY if the visual evidence completely contradicts the nearby list (or the list is empty) should you fall back to a descriptive name.

CRITICAL RULES FOR SENSORY DETAILS:
Pay extreme attention to the weather (overcast, rainy, golden hour, crisp air), the lighting (neon, dim, candlelit, bright), and the audio (live music, crowd chatter, wind, sizzling food, laughter, clinking glasses).

OUTPUT FORMAT (JSON exactly matching this schema):
{
  "venueName": "The exact place name, prioritizing matches from the NEARBY BUSINESSES list (e.g., 'Civerinos', 'Whistlebinkies', 'Ibrox Stadium'). DO NOT include the city here.",
  "cityName": "The city name ONLY (e.g., 'Edinburgh', 'Glasgow').",
  "caption": "A 1-sentence description of the exact action happening in the video (e.g., 'Eating massive slices of pizza at 1am', 'Listening to a folk band in a packed basement pub').",
  "sceneDescription": "Literal description of the visual AND audio evidence in one rich sentence.",
  "essence": "A highly evocative, sensory 2-sentence journal entry. Capture the weather, lighting, sounds, smells, and mood of being there in this exact moment. Write in present tense. Make it beautiful and moody.",
  "activityType": "1-3 words (e.g., 'Comfort Food', 'Live Music', 'Stadium Visit', 'City Sightseeing').",
  "richTags": ["5-8", "lowercase", "literal", "tags", "about", "what", "is", "visible"],
  "moodTags": ["3", "emotional", "atmospheric", "tags"]
}

Respond with valid JSON only. No markdown, no explanation.`;
}

// ── Gemini File API helpers ─────────────────────────────────────────

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

// ── Gemini generate ─────────────────────────────────────────────────

// deno-lint-ignore no-explicit-any
async function callGemini(apiKey: string, mediaPart: any, prompt: string) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${apiKey}`;
  const body = {
    contents: [{
      parts: [mediaPart, { text: prompt }],
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

// ── Process a single job ────────────────────────────────────────────

// deno-lint-ignore no-explicit-any
async function processJob(job: any, geminiApiKey: string, supabaseUrl: string) {
  const supabase = getServiceClient();
  let geminiFileUri: string | null = null;

  // Mark as processing
  await supabase
    .from("video_analysis_jobs")
    .update({ status: "processing", updated_at: new Date().toISOString() })
    .eq("id", job.id);

  try {
    const storagePath = job.storage_path;
    const mimeType = job.mime_type || "video/mp4";
    const fileName = job.file_name || "media";
    const mediaUrl = `${supabaseUrl}/storage/v1/object/public/trip-photos/${storagePath}`;

    // deno-lint-ignore no-explicit-any
    let geminiMediaPart: any;

    if (mimeType.startsWith("video/")) {
      console.log(`[Queue] Analyzing VIDEO "${fileName}" via Gemini File API.`);
      geminiFileUri = await uploadToGeminiFileApi(geminiApiKey, mediaUrl, mimeType, fileName);
      await waitForFileActive(geminiApiKey, geminiFileUri);
      geminiMediaPart = { fileData: { mimeType, fileUri: geminiFileUri } };
    } else if (mimeType.startsWith("image/")) {
      console.log(`[Queue] Analyzing IMAGE "${fileName}" via Inline Data.`);
      const imageResponse = await fetch(mediaUrl);
      if (!imageResponse.ok) throw new Error("Failed to fetch image from storage.");
      const arrayBuffer = await imageResponse.arrayBuffer();
      const bytes = new Uint8Array(arrayBuffer);
      let binary = "";
      for (let i = 0; i < bytes.length; i++) {
        binary += String.fromCharCode(bytes[i]);
      }
      geminiMediaPart = { inlineData: { mimeType, data: btoa(binary) } };
    } else {
      throw new Error(`Unsupported file type: ${mimeType}`);
    }

    // Extract nearbyPlaces and itinerarySteps from itinerary_context
    const context = job.itinerary_context || {};
    const nearbyPlaces: string[] = Array.isArray(context.nearbyPlaces) ? context.nearbyPlaces : [];
    const itinerarySteps: ItineraryStop[] = Array.isArray(context.itinerarySteps)
      ? context.itinerarySteps
      : Array.isArray(context)
        ? context  // backwards compat: old jobs stored itinerarySteps directly as array
        : [];

    const prompt = buildPrompt({
      takenAt: job.taken_at,
      latitude: job.latitude,
      longitude: job.longitude,
      locationName: job.location_name,
      country: job.country,
      nearbyPlaces,
      itinerarySteps,
    });

    const data = await callGemini(geminiApiKey, geminiMediaPart, prompt);
    const textContent = data?.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!textContent) throw new Error("No content in Gemini response");

    const parsed = JSON.parse(textContent);
    const result = parseGeminiResult(parsed, job.caption_id);

    console.log(`[Queue] Analysis complete for "${fileName}": ${result.caption}`);

    // Update the job with results
    await supabase
      .from("video_analysis_jobs")
      .update({ status: "complete", result, updated_at: new Date().toISOString() })
      .eq("id", job.id);

    // Also enrich the step_photos record with the AI-generated metadata
    if (storagePath) {
      const { data: photoRecords } = await supabase
        .from("step_photos")
        .select("id, exif_data")
        .eq("storage_path", storagePath)
        .limit(1);

      if (photoRecords && photoRecords.length > 0) {
        const photo = photoRecords[0];
        const existingExif = (photo.exif_data as Record<string, unknown>) ?? {};
        const enrichedExif = {
          ...existingExif,
          caption: result.caption,
          sceneDescription: result.sceneDescription,
          essence: result.essence,
          richTags: result.richTags,
          activityType: result.activityType,
          moodTags: result.moodTags,
          suggestedVenueName: result.suggestedVenueName,
          suggestedCityName: result.suggestedCityName,
          aiAnalyzedAt: new Date().toISOString(),
        };

        await supabase
          .from("step_photos")
          .update({ exif_data: enrichedExif })
          .eq("id", photo.id);

        // If the AI suggested a better venue name, update the step's location_name
        if (result.suggestedVenueName) {
          const { data: stepPhotos } = await supabase
            .from("step_photos")
            .select("step_id")
            .eq("id", photo.id)
            .single();

          if (stepPhotos?.step_id) {
            const venueName = result.suggestedCityName
              ? `${result.suggestedVenueName}, ${result.suggestedCityName}`
              : result.suggestedVenueName;

            await supabase
              .from("trip_steps")
              .update({ location_name: venueName })
              .eq("id", stepPhotos.step_id);

            console.log(`[Queue] Updated step ${stepPhotos.step_id} location to "${venueName}"`);
          }
        }

        console.log(`[Queue] Enriched step_photos record ${photo.id} with AI metadata.`);
      }
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error(`[Queue] Analysis failed for job ${job.id}:`, message);

    await supabase
      .from("video_analysis_jobs")
      .update({ status: "failed", error: message, updated_at: new Date().toISOString() })
      .eq("id", job.id);
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

  try {
    const geminiApiKey = Deno.env.get("GOOGLE_AI_STUDIO_KEY");
    if (!geminiApiKey) throw new Error("GOOGLE_AI_STUDIO_KEY is not configured");

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabase = getServiceClient();

    // Grab up to BATCH_SIZE pending jobs, oldest first
    const { data: pendingJobs, error: fetchError } = await supabase
      .from("video_analysis_jobs")
      .select("*")
      .eq("status", "pending")
      .order("created_at", { ascending: true })
      .limit(BATCH_SIZE);

    if (fetchError) {
      console.error("[Queue] Failed to fetch pending jobs:", fetchError);
      return jsonResponse({ error: "Failed to fetch pending jobs" }, 500);
    }

    if (!pendingJobs || pendingJobs.length === 0) {
      return jsonResponse({ message: "No pending jobs", processed: 0 });
    }

    console.log(`[Queue] Found ${pendingJobs.length} pending job(s). Processing sequentially...`);

    let processed = 0;
    let failed = 0;

    for (const job of pendingJobs) {
      await processJob(job, geminiApiKey, supabaseUrl);
      processed++;

      // Pace between jobs to respect rate limits
      if (processed < pendingJobs.length) {
        console.log(`[Queue] Waiting ${INTER_JOB_DELAY_MS}ms before next job...`);
        await sleep(INTER_JOB_DELAY_MS);
      }
    }

    console.log(`[Queue] Batch complete: ${processed} processed, ${failed} failed.`);
    return jsonResponse({ message: "Batch complete", processed, failed });
  } catch (error) {
    console.error("[Queue] Worker error:", error);
    const message = error instanceof Error ? error.message : "Unknown error";
    return jsonResponse({ error: message }, 500);
  }
});
