export type StepVisualType =
  | "flight"
  | "train"
  | "bus"
  | "ferry"
  | "car"
  | "on_foot"
  | "cycling"
  | "hotel"
  | "apartment_flat"
  | "private_home"
  | "villa"
  | "safari_accommodation"
  | "glamping"
  | "camping"
  | "resort"
  | "ski_lodge"
  | "food"
  | "sightseeing"
  | "tour"
  | "dining"
  | "meeting"
  | "concert"
  | "theatre"
  | "live_show"
  | "wellness"
  | "sport"
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

const FLIGHT_PATTERN = /\b(airport|airfield|flight|airline|boarding|gate|terminal|depart(?:ure|ing)|arriv(?:al|ing)|runway|iata)\b|\([A-Z]{3}\)/i;
const HOTEL_PATTERN = /\b(hotel|resort|lodge|hostel|airbnb|inn|suite|suites|guesthouse|villa|camp|room|stay|marriott|hilton|hyatt|radisson|pullman|fairmont|sheraton|belmond|vignette|palace|palacio|sanctuary)\b/i;
const HOTEL_EVENT_PATTERN = /\bhotel\s+check.?in\b|\bhotel\s+check.?out\b/i;
const FOOD_PATTERN = /\b(restaurant|cafe|bar|bistro|breakfast|lunch|dinner|brunch|tasting|meal|food)\b/i;
const BORDER_PATTERN = /\b(border|immigration|passport|customs|checkpoint|crossing)\b/i;
const TRAIN_PATTERN = /\b(train|rail|railway|metro|subway|tram|light.?rail)\b/i;
const BUS_PATTERN = /\b(bus|coach|shuttle)\b/i;
const FERRY_PATTERN = /\b(ferry|boat|cruise|port|harbor|harbour|pier|dock|sailing|catamaran)\b/i;
const CAR_PATTERN = /\b(car|drive|driving|rental|uber|taxi|cab|lyft|transfer|road.?trip)\b/i;
const SIGHTSEEING_PATTERN = /\b(museum|beach|mountain|park|falls|waterfall|trail|viewpoint|tower|temple|church|cathedral|plaza|square|landmark|safari|penguin|monument|gallery|tour|visit)\b/i;

function getGoogleVisualType(googlePlaceTypes: string[]): StepVisualType | null {
  const types = new Set(googlePlaceTypes);

  if (types.has("airport")) return "flight";
  if (types.has("lodging")) return "hotel";
  if (types.has("restaurant") || types.has("cafe") || types.has("bar") || types.has("meal_takeaway")) return "dining";
  if (types.has("train_station") || types.has("light_rail_station") || types.has("subway_station")) return "train";
  if (types.has("bus_station")) return "bus";
  if (types.has("ferry_terminal")) return "ferry";
  if (types.has("taxi_stand") || types.has("car_rental")) return "car";
  if (types.has("transit_station")) return "transport";
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

  // Direct mapping for specific event types
  const directMap: Record<string, StepVisualType> = {
    flight: "flight",
    train: "train",
    bus: "bus",
    ferry: "ferry",
    car: "car",
    on_foot: "on_foot",
    cycling: "cycling",
    hotel: "hotel",
    apartment_flat: "apartment_flat",
    private_home: "private_home",
    villa: "villa",
    safari: "safari_accommodation",
    glamping: "glamping",
    camping: "camping",
    tour: "tour",
    sightseeing: "sightseeing",
    dining: "dining",
    meeting: "meeting",
    concert: "concert",
    theatre: "theatre",
    live_show: "live_show",
    wellness: "wellness",
  };

  if (directMap[step.event_type]) return directMap[step.event_type];

  const isFlight = FLIGHT_PATTERN.test(text) || googleType === "flight";
  const isHotel = HOTEL_PATTERN.test(text) || HOTEL_EVENT_PATTERN.test(text) || googleType === "hotel";
  const isFood = FOOD_PATTERN.test(text) || googleType === "dining";
  const isBorder = BORDER_PATTERN.test(text);
  const isTrain = TRAIN_PATTERN.test(text) || googleType === "train";
  const isBus = BUS_PATTERN.test(text) || googleType === "bus";
  const isFerry = FERRY_PATTERN.test(text) || googleType === "ferry";
  const isCar = CAR_PATTERN.test(text) || googleType === "car";
  const isSightseeing = SIGHTSEEING_PATTERN.test(text) || googleType === "sightseeing";

  switch (step.event_type) {
    case "accommodation":
      return "hotel";
    case "food":
      return "dining";
    case "border_crossing":
      return "border";
    case "transport":
      if (isFlight) return "flight";
      if (isTrain) return "train";
      if (isFerry) return "ferry";
      if (isBus) return "bus";
      if (isCar) return "car";
      if (isHotel) return "hotel";
      return googleType || "transport";
    case "arrival":
    case "departure":
      if (isFlight) return "flight";
      if (isTrain) return "train";
      if (isFerry) return "ferry";
      if (isBus) return "bus";
      if (isCar) return "car";
      if (isHotel) return "hotel";
      return googleType || "flight";
    case "activity":
      if (isFood) return "dining";
      if (isSightseeing) return "sightseeing";
      if (isHotel) return "hotel";
      if (isFlight) return "flight";
      return googleType || "activity";
    default:
      if (isFlight) return "flight";
      if (isHotel) return "hotel";
      if (isFood) return "dining";
      if (isBorder) return "border";
      if (isTrain) return "train";
      if (isFerry) return "ferry";
      if (isBus) return "bus";
      if (isCar) return "car";
      if (isSightseeing) return "sightseeing";
      return googleType || "other";
  }
}
