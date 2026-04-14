const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const VALID_EVENT_TYPES = [
  "flight", "train", "bus", "ferry", "yacht_boat", "cruise", "car", "on_foot", "cycling",
  "hotel", "apartment_flat", "private_home", "villa", "safari", "glamping", "camping", "resort", "ski_lodge",
  "tour", "sightseeing", "dining", "meeting", "concert", "theatre", "live_show", "wellness", "sport",
];

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
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

    const { text } = await req.json();
    if (!text || typeof text !== "string" || text.trim().length < 5) {
      return jsonResponse({ error: "No confirmation text provided" }, 400);
    }

    const truncated = text.slice(0, 15000);

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
            content: `You parse a single travel/booking confirmation document and extract the key details for ONE event.

Extract:
- eventType: MUST be one of: ${VALID_EVENT_TYPES.join(", ")}
  IMPORTANT: If the name contains "resort", use "resort". If it's a ski lodge/chalet, use "ski_lodge".
- locationName: the specific venue/place name (hotel name, restaurant, etc.)
  IMPORTANT FOR FLIGHTS: locationName MUST be formatted as "Origin Airport (IATA) → Destination Airport (IATA)"
  Example: "Edinburgh Airport (EDI) → London Heathrow Airport (LHR)"
  Example: "São Paulo Guarulhos (GRU) → Madrid Barajas (MAD)"
- country: the country of the ORIGIN/DEPARTURE location for flights and trains, otherwise the country of the location
- city: the city of the ORIGIN/DEPARTURE airport/station for flights and trains, otherwise the city of the location
- latitude/longitude: your best coordinate estimate for the ORIGIN/DEPARTURE location (for flights, use the departure airport; for trains, use the departure station)
- date: ISO date (YYYY-MM-DD) if found
- time: time (HH:MM) of departure if found
- description: brief summary of the booking. For flights include airline, flight number, departure time, arrival time.
- notes: booking reference, confirmation number, seat numbers, address, phone, any useful details
- activityName: a concise name for this event (e.g. "Hilton London Check-in", "BA 283 EDI → MAD")

Be precise with eventType:
- Hotel/resort booking = "hotel" or "resort" (if "resort" in name)
- Flight confirmation = "flight"
- Restaurant reservation = "dining"
- Train ticket = "train"
- Tour booking = "tour"
- Spa appointment = "wellness"
- Sports activity = "sport"`,
          },
          {
            role: "user",
            content: `Parse this booking/travel confirmation:\n\n${truncated}`,
          },
        ],
        tools: [
          {
            type: "function",
            function: {
              name: "return_parsed_event",
              description: "Return the parsed event from the confirmation document.",
              parameters: {
                type: "object",
                properties: {
                  eventType: { type: "string", enum: VALID_EVENT_TYPES },
                  locationName: { type: "string", description: "Venue/place name" },
                  activityName: { type: "string", description: "Concise event name" },
                  country: { type: "string" },
                  city: { type: "string" },
                  latitude: { type: "number" },
                  longitude: { type: "number" },
                  date: { type: "string", description: "ISO date YYYY-MM-DD or null" },
                  time: { type: "string", description: "Time HH:MM or null" },
                  description: { type: "string" },
                  notes: { type: "string" },
                },
                required: ["eventType", "locationName", "activityName", "description"],
                additionalProperties: false,
              },
            },
          },
        ],
        tool_choice: { type: "function", function: { name: "return_parsed_event" } },
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
    const rawOutput = message?.tool_calls?.[0]?.function?.arguments ?? message?.content;

    if (typeof rawOutput !== "string") {
      return jsonResponse({ error: "Failed to parse confirmation" }, 500);
    }

    const parsed = JSON.parse(rawOutput);

    const event = {
      eventType: VALID_EVENT_TYPES.includes(parsed.eventType) ? parsed.eventType : "tour",
      locationName: typeof parsed.locationName === "string" ? parsed.locationName : "",
      activityName: typeof parsed.activityName === "string" ? parsed.activityName : "",
      country: typeof parsed.country === "string" ? parsed.country : "",
      city: typeof parsed.city === "string" ? parsed.city : "",
      latitude: typeof parsed.latitude === "number" ? parsed.latitude : null,
      longitude: typeof parsed.longitude === "number" ? parsed.longitude : null,
      date: typeof parsed.date === "string" ? parsed.date : null,
      time: typeof parsed.time === "string" ? parsed.time : null,
      description: typeof parsed.description === "string" ? parsed.description : "",
      notes: typeof parsed.notes === "string" ? parsed.notes : "",
    };

    return jsonResponse({ event });
  } catch (error) {
    console.error("parse-confirmation error:", error);
    return jsonResponse({ error: error instanceof Error ? error.message : "Unknown error" }, 500);
  }
});
