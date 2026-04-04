export type StepVisualType =
  | "airport"
  | "hotel"
  | "food"
  | "sightseeing"
  | "border"
  | "transport"
  | "activity"
  | "other";

export interface StepVisualInput {
  event_type: string;
  location_name: string | null;
  description: string | null;
  notes: string | null;
}

const AIRPORT_PATTERN = /\b(airport|airfield|flight|airline|boarding|gate|terminal|depart(?:ure|ing)|arriv(?:al|ing)|runway|iata)\b|\([A-Z]{3}\)/i;
const HOTEL_PATTERN = /\b(hotel|resort|lodge|hostel|airbnb|inn|suite|suites|guesthouse|villa|camp|room|stay|marriott|hilton|hyatt|radisson|pullman|fairmont|sheraton|belmond|vignette|palace|palacio|sanctuary)\b/i;
const HOTEL_EVENT_PATTERN = /\bhotel\s+check.?in\b|\bhotel\s+check.?out\b/i;
const FOOD_PATTERN = /\b(restaurant|cafe|bar|bistro|breakfast|lunch|dinner|brunch|tasting|meal|food)\b/i;
const BORDER_PATTERN = /\b(border|immigration|passport|customs|checkpoint|crossing)\b/i;
const TRANSPORT_PATTERN = /\b(train|rail|station|metro|subway|tram|bus|coach|transfer|shuttle|ferry|port|harbor|pier|dock)\b/i;
const SIGHTSEEING_PATTERN = /\b(museum|beach|mountain|park|falls|waterfall|trail|viewpoint|tower|temple|church|cathedral|plaza|square|landmark|safari|penguin|monument|gallery|tour|visit)\b/i;

function getGoogleVisualType(googlePlaceTypes: string[]): StepVisualType | null {
  const types = new Set(googlePlaceTypes);

  if (types.has("airport")) return "airport";
  if (types.has("lodging")) return "hotel";
  if (types.has("restaurant") || types.has("cafe") || types.has("bar") || types.has("meal_takeaway")) return "food";
  if (
    types.has("train_station") ||
    types.has("transit_station") ||
    types.has("bus_station") ||
    types.has("subway_station") ||
    types.has("light_rail_station") ||
    types.has("taxi_stand") ||
    types.has("ferry_terminal")
  ) {
    return "transport";
  }
  if (types.has("tourist_attraction") || types.has("natural_feature") || types.has("museum") || types.has("park") || types.has("campground")) {
    return "sightseeing";
  }

  return null;
}

export function buildStepContextText(step: StepVisualInput) {
  return [step.location_name, step.description, step.notes].filter(Boolean).join(" ");
}

export function inferStepVisualType(step: StepVisualInput, googlePlaceTypes: string[] = []): StepVisualType {
  const text = buildStepContextText(step);
  const googleType = getGoogleVisualType(googlePlaceTypes);

  const isAirport = AIRPORT_PATTERN.test(text) || googleType === "airport";
  const isHotel = HOTEL_PATTERN.test(text) || HOTEL_EVENT_PATTERN.test(text) || googleType === "hotel";
  const isFood = FOOD_PATTERN.test(text) || googleType === "food";
  const isBorder = BORDER_PATTERN.test(text);
  const isTransport = TRANSPORT_PATTERN.test(text) || googleType === "transport";
  const isSightseeing = SIGHTSEEING_PATTERN.test(text) || googleType === "sightseeing";

  switch (step.event_type) {
    case "accommodation":
      return "hotel";
    case "food":
      return "food";
    case "sightseeing":
      return "sightseeing";
    case "border_crossing":
      return "border";
    case "transport":
      if (isAirport) return "airport";
      if (isHotel) return "hotel";
      if (isTransport) return "transport";
      return googleType || "transport";
    case "arrival":
    case "departure":
      if (isAirport) return "airport";
      if (isHotel) return "hotel";
      if (isTransport) return "transport";
      return googleType || "airport";
    case "activity":
      if (isFood) return "food";
      if (isSightseeing) return "sightseeing";
      if (isHotel) return "hotel";
      if (isAirport) return "airport";
      return googleType || "activity";
    default:
      if (isAirport) return "airport";
      if (isHotel) return "hotel";
      if (isFood) return "food";
      if (isBorder) return "border";
      if (isTransport) return "transport";
      if (isSightseeing) return "sightseeing";
      return googleType || "other";
  }
}
