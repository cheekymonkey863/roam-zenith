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
    fileName: string;
    takenAt: string | null;
    analysisImage: string | null;
  }>;
}

interface InferenceResult {
  key: string;
  locationName: string;
  country: string;
  latitude: number | null;
  longitude: number | null;
  confidence: Confidence;
  summary: string;
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
                  .slice(0, 3)
                  .map((photo: any) => ({
                    fileName: normalizeString(photo?.fileName, "photo"),
                    takenAt: typeof photo?.takenAt === "string" ? photo.takenAt : null,
                    analysisImage:
                      typeof photo?.analysisImage === "string" && photo.analysisImage.startsWith("data:image/")
                        ? photo.analysisImage
                        : null,
                  }))
                  .filter((photo: { analysisImage: string | null }) => Boolean(photo.analysisImage))
              : [],
          };
        }).filter((group: LocationGroupInput) => group.photos.length > 0)
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
          summary: "Used GPS metadata because the visuals were inconclusive.",
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
      });
    }

    // Build the prompt content
    const content: Array<Record<string, unknown>> = [
      {
        type: "text",
        text: `You analyze travel photos. For each group:
- If EXIF coordinates are provided, they are the geographic source of truth. Use visuals to refine the human-readable location/activity name.
- If NO EXIF coordinates are provided, use the photo contents to identify the location. Return your best estimate of the city/landmark/country and approximate latitude/longitude.
Keep summaries under 18 words.`,
      },
    ];

    for (const group of groups) {
      if (group.exifLocation) {
        content.push({
          type: "text",
          text: `Group ${group.key} (HAS GPS)\nEXIF center: ${group.exifLocation.latitude}, ${group.exifLocation.longitude}\nReverse geocode: ${group.exifLocation.name}, ${group.exifLocation.country}\nGoal: return the best display name for this stop.`,
        });
      } else {
        content.push({
          type: "text",
          text: `Group ${group.key} (NO GPS)\nNo EXIF coordinates available. Identify the location from the photo contents. Return the city/landmark name, country, and your best estimate of latitude and longitude.`,
        });
      }

      for (const photo of group.photos) {
        content.push({
          type: "text",
          text: `Photo file: ${photo.fileName}${photo.takenAt ? `, taken at ${photo.takenAt}` : ""}`,
        });
        content.push({ type: "image_url", image_url: { url: photo.analysisImage } });
      }
    }

    const aiResponse = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-3-flash-preview",
        messages: [
          {
            role: "system",
            content: "You analyze travel photos to identify locations. For groups with GPS data, refine the name. For groups without GPS, identify the location from visual clues like landmarks, signs, architecture, and landscape.",
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
                      },
                      required: ["key", "locationName", "country", "confidence", "summary"],
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

    const parsed = JSON.parse(rawStructuredOutput);
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
      });
    }

    return jsonResponse({ results: Array.from(fallbackResults.values()) });
  } catch (error) {
    console.error("photo-location-inference error:", error);
    return jsonResponse({ error: error instanceof Error ? error.message : "Unknown error" }, 500);
  }
});
