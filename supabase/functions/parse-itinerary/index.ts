const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const VALID_EVENT_TYPES = [
  "flight", "train", "bus", "ferry", "car", "on_foot", "cycling",
  "hotel", "apartment_flat", "private_home", "villa", "safari", "glamping", "camping",
  "tour", "sightseeing", "dining", "meeting", "concert", "theatre", "live_show", "wellness",
];

interface ParsedActivity {
  locationName: string;
  country: string;
  latitude: number | null;
  longitude: number | null;
  eventType: string;
  date: string | null;
  time: string | null;
  description: string;
  notes: string;
}

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
    if (!text || typeof text !== "string" || text.trim().length < 10) {
      return jsonResponse({ error: "No itinerary text provided" }, 400);
    }

    const truncated = text.slice(0, 30000);

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
            content: `You parse travel itinerary documents into structured activities. Extract EVERY activity, accommodation, transport, meal, sightseeing stop, and event mentioned.

For each item determine:
- locationName: specific place name (hotel name, restaurant, landmark, airport, station)
- country: country name
- latitude/longitude: your best estimate of coordinates (use your knowledge of the location)
- eventType: MUST be one of these exact values:

  TRANSPORT types (for any movement between places):
    "flight" - air travel
    "train" - rail travel
    "bus" - bus or coach travel
    "ferry" - boat, ferry, or cruise travel
    "car" - car, taxi, uber, transfer, or driving
    "on_foot" - walking tours, hikes, treks
    "cycling" - bicycle travel

  ACCOMMODATION types (for stays/lodging):
    "hotel" - hotel, resort, lodge, hostel, inn
    "apartment_flat" - apartment, flat, Airbnb rental
    "private_home" - staying at someone's home
    "villa" - villa or large private rental
    "safari" - safari lodge or camp
    "glamping" - glamping accommodation
    "camping" - camping, tent

  EVENT types (for activities/experiences):
    "tour" - guided tours, walking tours, excursions
    "sightseeing" - visiting landmarks, museums, viewpoints, parks
    "dining" - restaurants, meals, food experiences, cafes, bars
    "meeting" - business meetings, appointments
    "concert" - concerts, music events
    "theatre" - theatre, opera, ballet performances
    "live_show" - live shows, comedy, performances
    "wellness" - spa, massage, yoga, wellness activities

- date: ISO date string (YYYY-MM-DD) if mentioned, null otherwise
- time: time string (HH:MM) if mentioned, null otherwise
- description: brief description of what happens at this stop
- notes: any additional details (booking refs, addresses, tips, costs)

IMPORTANT: Be specific with eventType. For example:
- An airport pickup is "car" not generic transport
- A restaurant dinner is "dining" not generic activity
- A museum visit is "sightseeing" not generic activity
- Check-in at Hilton is "hotel" not generic accommodation
- A walking tour is "tour"
- A spa visit is "wellness"

Sort activities chronologically. Be thorough — extract every single stop mentioned.`,
          },
          {
            role: "user",
            content: `Parse this travel itinerary into activities:\n\n${truncated}`,
          },
        ],
        tools: [
          {
            type: "function",
            function: {
              name: "return_parsed_activities",
              description: "Return all parsed activities from the itinerary document.",
              parameters: {
                type: "object",
                properties: {
                  activities: {
                    type: "array",
                    items: {
                      type: "object",
                      properties: {
                        locationName: { type: "string" },
                        country: { type: "string" },
                        latitude: { type: "number", description: "Estimated latitude" },
                        longitude: { type: "number", description: "Estimated longitude" },
                        eventType: {
                          type: "string",
                          enum: VALID_EVENT_TYPES,
                        },
                        date: { type: "string", description: "ISO date YYYY-MM-DD or null" },
                        time: { type: "string", description: "Time HH:MM or null" },
                        description: { type: "string" },
                        notes: { type: "string" },
                      },
                      required: ["locationName", "country", "eventType", "description"],
                      additionalProperties: false,
                    },
                  },
                },
                required: ["activities"],
                additionalProperties: false,
              },
            },
          },
        ],
        tool_choice: { type: "function", function: { name: "return_parsed_activities" } },
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
      return jsonResponse({ activities: [] });
    }

    const parsed = JSON.parse(rawOutput);
    const activities: ParsedActivity[] = Array.isArray(parsed?.activities)
      ? parsed.activities.map((a: any) => ({
          locationName: typeof a.locationName === "string" ? a.locationName : "Unknown",
          country: typeof a.country === "string" ? a.country : "Unknown",
          latitude: typeof a.latitude === "number" ? a.latitude : null,
          longitude: typeof a.longitude === "number" ? a.longitude : null,
          eventType: VALID_EVENT_TYPES.includes(a.eventType) ? a.eventType : mapLegacyEventType(a.eventType),
          date: typeof a.date === "string" ? a.date : null,
          time: typeof a.time === "string" ? a.time : null,
          description: typeof a.description === "string" ? a.description : "",
          notes: typeof a.notes === "string" ? a.notes : "",
        }))
      : [];

    return jsonResponse({ activities });
  } catch (error) {
    console.error("parse-itinerary error:", error);
    return jsonResponse({ error: error instanceof Error ? error.message : "Unknown error" }, 500);
  }
});

// Map old generic types to specific new types
function mapLegacyEventType(type: string): string {
  switch (type) {
    case "arrival":
    case "departure":
    case "transport":
      return "car";
    case "accommodation":
      return "hotel";
    case "food":
      return "dining";
    case "activity":
      return "tour";
    case "border_crossing":
    case "other":
    default:
      return "sightseeing";
  }
}
