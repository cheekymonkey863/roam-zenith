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
  };
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
  confidence: Confidence;
  summary: string;
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json",
    },
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
      ? payload.groups
          .slice(0, 12)
          .map((group: any) => ({
            key: normalizeString(group?.key, crypto.randomUUID()),
            exifLocation: {
              latitude: Number(group?.exifLocation?.latitude ?? 0),
              longitude: Number(group?.exifLocation?.longitude ?? 0),
              name: normalizeString(group?.exifLocation?.name, "Unknown"),
              country: normalizeString(group?.exifLocation?.country, "Unknown"),
            },
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
          }))
          .filter(
            (group) =>
              Number.isFinite(group.exifLocation.latitude) &&
              Number.isFinite(group.exifLocation.longitude) &&
              group.photos.length > 0
          )
      : [];

    if (groups.length === 0) {
      return jsonResponse({ results: [] });
    }

    const fallbackResults = new Map<string, InferenceResult>(
      groups.map((group) => [
        group.key,
        {
          key: group.key,
          locationName: group.exifLocation.name,
          country: group.exifLocation.country,
          confidence: "low",
          summary: "Used GPS metadata because the visuals were inconclusive.",
        },
      ])
    );

    const content: Array<Record<string, unknown>> = [
      {
        type: "text",
        text:
          "Infer a user-facing travel stop name for each EXIF-based photo group. Treat the EXIF coordinates and reverse-geocoded country as the geographic source of truth. Use the photo contents only to refine the human-readable location/activity name when the visuals clearly support it. Do not invent a different country or a precise venue if the images are ambiguous. Keep the summary under 18 words.",
      },
    ];

    for (const group of groups) {
      content.push({
        type: "text",
        text: `Group ${group.key}\nEXIF center: ${group.exifLocation.latitude}, ${group.exifLocation.longitude}\nReverse geocode: ${group.exifLocation.name}, ${group.exifLocation.country}\nGoal: return the best display name for this stop, like a landmark, park, neighborhood, or activity, but stay consistent with the EXIF geography.`,
      });

      for (const photo of group.photos) {
        content.push({
          type: "text",
          text: `Photo file: ${photo.fileName}${photo.takenAt ? `, taken at ${photo.takenAt}` : ""}`,
        });
        content.push({
          type: "image_url",
          image_url: {
            url: photo.analysisImage,
          },
        });
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
            content:
              "You analyze travel photos. EXIF coordinates are the primary source of truth. Use visuals to refine the stop name, not to override the geography.",
          },
          {
            role: "user",
            content,
          },
        ],
        tools: [
          {
            type: "function",
            function: {
              name: "return_group_locations",
              description: "Return the best display name for each EXIF-based photo group.",
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
                        confidence: {
                          type: "string",
                          enum: ["high", "medium", "low"],
                        },
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
        tool_choice: {
          type: "function",
          function: {
            name: "return_group_locations",
          },
        },
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

      if (!fallback) {
        continue;
      }

      fallbackResults.set(key, {
        key,
        locationName: normalizeString(result?.locationName, fallback.locationName),
        country:
          fallback.country !== "Unknown"
            ? fallback.country
            : normalizeString(result?.country, fallback.country),
        confidence: normalizeConfidence(result?.confidence),
        summary: normalizeString(result?.summary, "Refined with EXIF and photo recognition."),
      });
    }

    return jsonResponse({ results: Array.from(fallbackResults.values()) });
  } catch (error) {
    console.error("photo-location-inference error:", error);
    return jsonResponse(
      { error: error instanceof Error ? error.message : "Unknown error" },
      500
    );
  }
});