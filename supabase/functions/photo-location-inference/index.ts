const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

type Confidence = "high" | "medium" | "low";

interface LocationGroupInput {
  key: string;
  exifLocation: {
    latitude: number;
    longitude: number;
    name: string;
    country: string;
  } | null;
  photos: Array<{
    captionId: string;
    fileName: string;
    takenAt: string | null;
    analysisImage: string | null;
  }>;
}

interface PhotoCaptionResult {
  captionId: string;
  caption: string;
  sceneDescription?: string;
  richTags?: string[];
}

interface InferenceResult {
  key: string;
  locationName: string;
  country: string;
  latitude: number | null;
  longitude: number | null;
  confidence: Confidence;
  summary: string;
  eventDescription: string;
  photoCaptions: PhotoCaptionResult[];
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function normalizeString(value: unknown, fallback: string) {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : fallback;
}

function normalizeConfidence(value: unknown): Confidence {
  return value === "high" || value === "medium" || value === "low" ? value : "low";
}

function normalizeRichTags(value: unknown): string[] {
  if (!Array.isArray(value)) return [];

  return Array.from(
    new Set(
      value
        .filter((item): item is string => typeof item === "string" && item.trim().length > 0)
        .map((item) => item.trim().toLowerCase())
        .slice(0, 12)
    )
  );
}

function normalizePhotoCaptions(value: unknown): PhotoCaptionResult[] {
  if (!Array.isArray(value)) return [];

  return value
    .map((item: any) => ({
      captionId: normalizeString(item?.captionId, ""),
      caption: normalizeString(item?.caption, ""),
      sceneDescription: normalizeString(item?.sceneDescription, ""),
      richTags: normalizeRichTags(item?.richTags),
    }))
    .filter((item: PhotoCaptionResult) => item.captionId.length > 0 && item.caption.length > 0);
}

function parseStructuredOutput(raw: string) {
  const candidates = [raw.trim()];

  if (raw.includes("```")) {
    for (const match of raw.matchAll(/```(?:json)?\s*([\s\S]*?)\s*```/gi)) {
      candidates.push(match[1].trim());
    }
  }

  const firstBrace = raw.indexOf("{");
  const lastBrace = raw.lastIndexOf("}");
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    candidates.push(raw.slice(firstBrace, lastBrace + 1).trim());
  }

  for (const candidate of candidates) {
    if (!candidate) continue;
    try {
      return JSON.parse(candidate);
    } catch {
      continue;
    }
  }

  return null;
}

function buildFallbackSummary(locationName: string) {
  return locationName !== "Unknown" && locationName !== "Unknown Location"
    ? `Grouped media around ${locationName}.`
    : "Grouped nearby media from the same stop.";
}

function buildFallbackEventDescription(locationName: string, country: string) {
  if (locationName === "Unknown" || locationName === "Unknown Location") {
    return "Travel event created from nearby media captured in the same time range.";
  }

  return country !== "Unknown"
    ? `Travel event around ${locationName}, ${country}.`
    : `Travel event around ${locationName}.`;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  try {
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) {
      throw new Error("LOVABLE_API_KEY is not configured");
    }

    const payload = await req.json();
    const groups: LocationGroupInput[] = Array.isArray(payload?.groups)
      ? payload.groups.slice(0, 12).map((group: any) => {
          const hasExif =
            group?.exifLocation &&
            Number.isFinite(Number(group.exifLocation.latitude)) &&
            Number.isFinite(Number(group.exifLocation.longitude));

          return {
            key: normalizeString(group?.key, crypto.randomUUID()),
            exifLocation: hasExif
              ? {
                  latitude: Number(group.exifLocation.latitude),
                  longitude: Number(group.exifLocation.longitude),
                  name: normalizeString(group.exifLocation.name, "Unknown"),
                  country: normalizeString(group.exifLocation.country, "Unknown"),
                }
              : null,
            photos: Array.isArray(group?.photos)
              ? group.photos
                  .slice(0, 4)
                  .map((photo: any) => ({
                    captionId: normalizeString(photo?.captionId, crypto.randomUUID()),
                    fileName: normalizeString(photo?.fileName, "photo"),
                    takenAt: typeof photo?.takenAt === "string" ? photo.takenAt : null,
                    analysisImage:
                      typeof photo?.analysisImage === "string" && photo.analysisImage.startsWith("data:image/")
                        ? photo.analysisImage
                        : null,
                  }))
              : [],
          };
        // Keep groups that have at least one photo with an image, OR have exif location
        }).filter((group: LocationGroupInput) => group.photos.length > 0 && (group.photos.some(p => p.analysisImage) || group.exifLocation !== null))
      : [];

    if (groups.length === 0) {
      return jsonResponse({ results: [] });
    }

    // Separate groups with and without EXIF
    const exifGroups = groups.filter((g) => g.exifLocation !== null);
    const noExifGroups = groups.filter((g) => g.exifLocation === null);

    const fallbackResults = new Map<string, InferenceResult>(
      exifGroups.map((group) => [
        group.key,
        {
          key: group.key,
          locationName: group.exifLocation!.name,
          country: group.exifLocation!.country,
          latitude: group.exifLocation!.latitude,
          longitude: group.exifLocation!.longitude,
          confidence: "low" as Confidence,
          summary: buildFallbackSummary(group.exifLocation!.name),
          eventDescription: buildFallbackEventDescription(group.exifLocation!.name, group.exifLocation!.country),
          photoCaptions: [],
        },
      ])
    );

    // Also add placeholder entries for no-EXIF groups
    for (const group of noExifGroups) {
      fallbackResults.set(group.key, {
        key: group.key,
        locationName: "Unknown Location",
        country: "Unknown",
        latitude: null,
        longitude: null,
        confidence: "low",
        summary: "No GPS data; visual recognition was inconclusive.",
        eventDescription: "Travel event created from nearby media captured in the same time range.",
        photoCaptions: [],
      });
    }

    // Build the prompt content using "Context Sandwich" approach:
    // Feed metadata (GPS, timestamp, reverse-geocoded location) alongside visuals
    const content: Array<Record<string, unknown>> = [
      {
        type: "text",
        text: `You are a world-class travel writer and expert metadata tagger.
You are provided with groups of travel media (photos and video frames), each with extracted metadata.

CRITICAL RULES — GPS IS A HINT, NOT THE TRUTH:
1. The "Reverse-geocoded location" is an automated coordinate lookup. IT IS OFTEN WRONG (e.g., calling a pizza shop a nearby monument or office building).
2. TRUST YOUR EYES. If the GPS says "Lothian House" but you see Calton Hill, the venue IS "Calton Hill".
3. If you see people eating pizza and the coordinates are near "Civerinos", the venue IS "Civerinos".
4. If you see a pub stage with a band and the coordinates are near "Whistlebinkies", the venue IS "Whistlebinkies".
5. If you can read a sign, logo, or branding in the image, use that EXACT name.
6. ONLY if the visual evidence gives no clue should you fall back to the reverse-geocoded name.

YOUR APPROACH:
1. Analyze the visual elements in each image/frame (lighting, scenery, objects, signage, architecture, food, drinks).
2. Cross-reference with coordinates and nearby venue data to identify the EXACT venue or landmark.
3. Describe ONLY what is literally, visually present. NEVER speculate or invent narratives.

RULES FOR EACH GROUP:
- "locationName": Use the specific venue/landmark/POI name. Example: "Ibrox Stadium" not "Glasgow", "Civerinos" not "restaurant", "Calton Hill" not "City of Edinburgh".
- "summary": What is consistently, literally visible across the group. Max 18 words.
- "eventDescription": One factual sentence synthesizing the location and visual evidence. No narratives.
- "photoCaptions": One entry per media item using the exact "captionId".

CAPTION RULES:
- "caption": Describe ONLY what is literally visible in that specific frame. Max 14 words.
- "sceneDescription": One rich sensory sentence — capture lighting, weather, atmosphere, sounds implied by the scene.
- "richTags": 3-8 lowercase tags about visible content (place, activity, scenery, objects, weather, architecture).
- If multiple media show the same scene, use CONSISTENT descriptions.

NEVER mention GPS metadata or coordinates in outputs. NEVER identify people by name.`,
      },
    ];

    for (const group of groups) {
      // Context sandwich: provide metadata block BEFORE the images
      if (group.exifLocation) {
        content.push({
          type: "text",
          text: `--- GROUP: ${group.key} ---
METADATA:
- Coordinates: ${group.exifLocation.latitude.toFixed(6)}, ${group.exifLocation.longitude.toFixed(6)}
- Reverse-geocoded location: ${group.exifLocation.name}, ${group.exifLocation.country}
- Media count: ${group.photos.length} item(s)
${group.photos.filter(p => p.takenAt).map(p => `- Timestamp: ${p.takenAt}`).join("\n")}

TASK: Using the coordinates and reverse-geocoded name as ground truth, analyze the visuals to determine the most specific venue/landmark name. Return the best display name, one summary, one eventDescription, and one caption per media item.`,
        });
      } else {
        content.push({
          type: "text",
          text: `--- GROUP: ${group.key} (NO GPS) ---
METADATA:
- No coordinates available
- Media count: ${group.photos.length} item(s)
${group.photos.filter(p => p.takenAt).map(p => `- Timestamp: ${p.takenAt}`).join("\n")}

TASK: Identify the location purely from visual evidence (signage, architecture, landmarks, language on signs). Return city/landmark name, country, estimated lat/lng, one summary, one eventDescription, and one caption per media item.`,
        });
      }

      for (const photo of group.photos) {
        const isVideo = !photo.analysisImage;
        content.push({
          type: "text",
          text: `Media ${photo.captionId}: "${photo.fileName}"${photo.takenAt ? ` | ${photo.takenAt}` : ""}${isVideo ? " | VIDEO (no frame available — describe based on filename, timestamps, and context from other media in this group)" : ""}`,
        });
        if (photo.analysisImage) {
          content.push({ type: "image_url", image_url: { url: photo.analysisImage } });
        }
      }
    }

    const aiResponse = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        messages: [
          {
            role: "system",
            content: "You are a world-class travel writer and expert metadata tagger. You synthesize GPS metadata, timestamps, and visual evidence to identify exact venues and describe travel moments factually. You NEVER speculate or invent narratives. You describe ONLY what is literally visible. When multiple media items show the same scene, you use consistent descriptions. You never mention coordinates or GPS data in your outputs.",
          },
          { role: "user", content },
        ],
        tools: [
          {
            type: "function",
            function: {
              name: "return_group_locations",
              description: "Return the best display name and coordinates for each photo group.",
              parameters: {
                type: "object",
                properties: {
                  results: {
                    type: "array",
                    items: {
                      type: "object",
                      properties: {
                        key: { type: "string" },
                        locationName: { type: "string" },
                        country: { type: "string" },
                        latitude: { type: "number", description: "Latitude. Required for no-GPS groups, optional for GPS groups." },
                        longitude: { type: "number", description: "Longitude. Required for no-GPS groups, optional for GPS groups." },
                        confidence: { type: "string", enum: ["high", "medium", "low"] },
                        summary: { type: "string" },
                        eventDescription: { type: "string" },
                        photoCaptions: {
                          type: "array",
                          items: {
                            type: "object",
                            properties: {
                              captionId: { type: "string" },
                              caption: { type: "string" },
                              sceneDescription: { type: "string" },
                              richTags: {
                                type: "array",
                                items: { type: "string" },
                              },
                            },
                            required: ["captionId", "caption"],
                            additionalProperties: false,
                          },
                        },
                      },
                      required: ["key", "locationName", "country", "confidence", "summary", "eventDescription", "photoCaptions"],
                      additionalProperties: false,
                    },
                  },
                },
                required: ["results"],
                additionalProperties: false,
              },
            },
          },
        ],
        tool_choice: { type: "function", function: { name: "return_group_locations" } },
      }),
    });

    if (!aiResponse.ok) {
      const errorText = await aiResponse.text();
      console.error("AI gateway error:", aiResponse.status, errorText);
      if (aiResponse.status === 429) {
        return jsonResponse({ error: "Rate limits exceeded, please try again later." }, 429);
      }
      if (aiResponse.status === 402) {
        return jsonResponse({ error: "Payment required, please add funds to your Lovable AI workspace." }, 402);
      }
      return jsonResponse({ error: "AI gateway error" }, 500);
    }

    const responseData = await aiResponse.json();
    const message = responseData?.choices?.[0]?.message;
    const rawStructuredOutput = message?.tool_calls?.[0]?.function?.arguments ?? message?.content;

    if (typeof rawStructuredOutput !== "string") {
      return jsonResponse({ results: Array.from(fallbackResults.values()) });
    }

    const parsed = parseStructuredOutput(rawStructuredOutput);
    if (!parsed) {
      console.warn("photo-location-inference: failed to parse structured output", rawStructuredOutput);
      return jsonResponse({ results: Array.from(fallbackResults.values()) });
    }

    const results = Array.isArray(parsed?.results) ? parsed.results : [];

    for (const result of results) {
      const key = normalizeString(result?.key, "");
      const fallback = fallbackResults.get(key);
      if (!fallback) continue;

      const isNoExif = fallback.latitude === null;

      fallbackResults.set(key, {
        key,
        locationName: normalizeString(result?.locationName, fallback.locationName),
        country: fallback.country !== "Unknown" ? fallback.country : normalizeString(result?.country, fallback.country),
        latitude: isNoExif && typeof result?.latitude === "number" ? result.latitude : fallback.latitude,
        longitude: isNoExif && typeof result?.longitude === "number" ? result.longitude : fallback.longitude,
        confidence: normalizeConfidence(result?.confidence),
        summary: normalizeString(result?.summary, fallback.summary),
        eventDescription: normalizeString(result?.eventDescription, fallback.eventDescription),
        photoCaptions: normalizePhotoCaptions(result?.photoCaptions),
      });
    }

    return jsonResponse({ results: Array.from(fallbackResults.values()) });
  } catch (error) {
    console.error("photo-location-inference error:", error);
    return jsonResponse({ error: error instanceof Error ? error.message : "Unknown error" }, 500);
  }
});
