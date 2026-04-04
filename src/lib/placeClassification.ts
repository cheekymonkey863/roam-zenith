export interface ImportedPlaceDetailsInput {
  locationName: string;
  country?: string | null;
  placeTypes?: string[];
  fallbackEventType?: string | null;
}

export interface ImportedPlaceDetails {
  eventType: string;
  summary: string;
  description: string;
}

const UNKNOWN_LOCATION_VALUES = new Set(["", "unknown", "unknown location"]);

const EVENT_TYPE_LABELS: Record<string, string> = {
  activity: "Activity",
  other: "Other",
  flight: "Flight",
  train: "Train",
  bus: "Bus",
  ferry: "Ferry",
  yacht_boat: "Yacht / Boat",
  cruise: "Cruise",
  car: "Car",
  on_foot: "On Foot",
  cycling: "Cycling",
  hotel: "Hotel",
  apartment_flat: "Apartment / Flat",
  private_home: "Private Home",
  villa: "Villa",
  safari: "Safari",
  glamping: "Glamping",
  camping: "Camping",
  resort: "Resort",
  ski_lodge: "Ski Lodge",
  tour: "Tour",
  sightseeing: "Sightseeing",
  dining: "Dining",
  meeting: "Meeting",
  concert: "Concert",
  theatre: "Theatre",
  live_show: "Live Show",
  wellness: "Wellness",
  sport: "Sport Event",
};

const SPORT_PLACE_TYPES = [
  "stadium",
  "sports_complex",
  "sports_centre",
  "sports_center",
  "athletic_field",
  "golf_course",
  "gym",
  "bowling_alley",
  "ice_rink",
  "racecourse",
  "velodrome",
];

const CONCERT_PLACE_TYPES = ["concert_hall", "music_venue"];
const LIVE_SHOW_PLACE_TYPES = ["live_music_venue", "night_club", "karaoke", "comedy_club"];
const THEATRE_PLACE_TYPES = ["theatre", "theater", "performing_arts_theater", "movie_theater", "opera_house"];
const DINING_PLACE_TYPES = ["restaurant", "cafe", "bakery", "meal_takeaway", "food_court"];
const SIGHTSEEING_PLACE_TYPES = [
  "tourist_attraction",
  "museum",
  "art_gallery",
  "park",
  "zoo",
  "aquarium",
  "church",
  "cathedral",
  "castle",
  "monument",
  "historical_landmark",
];

const SPORT_KEYWORDS = [
  "stadium",
  "arena",
  "sports centre",
  "sports center",
  "football club",
  "rugby club",
  "cricket club",
  "golf club",
  "tennis club",
  "racecourse",
  "velodrome",
];

const CONCERT_KEYWORDS = ["concert hall", "music hall", "academy", "ballroom", "concert venue"];
const LIVE_SHOW_KEYWORDS = [
  "live music",
  "music venue",
  "jazz",
  "blues",
  "gig",
  "sessions",
  "cabaret",
  "comedy club",
  "showbar",
];
const THEATRE_KEYWORDS = ["theatre", "theater", "playhouse", "opera house", "cinema"];
const DINING_KEYWORDS = ["restaurant", "cafe", "bistro", "brasserie", "grill", "kitchen", "pub", "bar", "tavern", "diner"];
const SIGHTSEEING_KEYWORDS = [
  "museum",
  "gallery",
  "cathedral",
  "castle",
  "palace",
  "abbey",
  "gardens",
  "monument",
  "viewpoint",
  "lookout",
  "park",
];

function normalizeText(value: string) {
  return value.trim().toLowerCase();
}

function normalizeType(value: string) {
  return normalizeText(value).replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
}

function hasKeyword(text: string, keywords: string[]) {
  return keywords.some((keyword) => text.includes(keyword));
}

export function isKnownLocationName(value: string) {
  return !UNKNOWN_LOCATION_VALUES.has(normalizeText(value));
}

export function getImportedEventTypeLabel(eventType: string) {
  return EVENT_TYPE_LABELS[eventType] ?? eventType.replace(/_/g, " ").replace(/\b\w/g, (char) => char.toUpperCase());
}

export function classifyImportedPlace({ locationName, placeTypes = [] }: Pick<ImportedPlaceDetailsInput, "locationName" | "placeTypes">) {
  const normalizedName = normalizeText(locationName);
  const normalizedTypes = new Set(placeTypes.map(normalizeType).filter(Boolean));
  const hasType = (...types: string[]) => types.some((type) => normalizedTypes.has(normalizeType(type)));

  if (!isKnownLocationName(locationName)) {
    return "activity";
  }

  if (hasType(...SPORT_PLACE_TYPES) || hasKeyword(normalizedName, SPORT_KEYWORDS)) {
    return "sport";
  }

  if (hasType(...CONCERT_PLACE_TYPES) || hasKeyword(normalizedName, CONCERT_KEYWORDS)) {
    return "concert";
  }

  if (
    hasType(...LIVE_SHOW_PLACE_TYPES) ||
    (hasType("bar", "pub") && hasKeyword(normalizedName, LIVE_SHOW_KEYWORDS)) ||
    hasKeyword(normalizedName, LIVE_SHOW_KEYWORDS)
  ) {
    return "live_show";
  }

  if (hasType(...THEATRE_PLACE_TYPES) || hasKeyword(normalizedName, THEATRE_KEYWORDS)) {
    return "theatre";
  }

  if (hasType("airport", "airfield") || normalizedName.includes("airport")) {
    return "flight";
  }

  if (hasType("train_station", "subway_station", "light_rail_station", "railway_station") || normalizedName.includes("station")) {
    return "train";
  }

  if (hasType("bus_station")) {
    return "bus";
  }

  if (hasType("ferry_terminal", "marina", "harbor", "harbour") || hasKeyword(normalizedName, ["ferry terminal", "harbour", "harbor", "marina", "port"])) {
    return "ferry";
  }

  if (hasType("resort") || normalizedName.includes("resort")) {
    return "resort";
  }

  if (hasType("campground", "camp_site", "rv_park") || hasKeyword(normalizedName, ["campground", "camp site", "camping", "glamping"])) {
    return "camping";
  }

  if (hasType("lodging", "hotel", "hostel") || hasKeyword(normalizedName, ["hotel", "hostel", "inn", "suites", "lodge"])) {
    return "hotel";
  }

  if (hasType("spa", "massage", "beauty_salon") || hasKeyword(normalizedName, ["spa", "wellness", "sauna"])) {
    return "wellness";
  }

  if (hasType(...DINING_PLACE_TYPES, "bar", "pub") || hasKeyword(normalizedName, DINING_KEYWORDS)) {
    return "dining";
  }

  if (hasType(...SIGHTSEEING_PLACE_TYPES) || hasKeyword(normalizedName, SIGHTSEEING_KEYWORDS)) {
    return "sightseeing";
  }

  return "activity";
}

export function buildImportedLocationSummary(locationName: string, country: string, eventType = "activity") {
  if (!isKnownLocationName(locationName)) {
    return "Grouped nearby media from the same travel stop.";
  }

  if (eventType !== "activity") {
    const label = getImportedEventTypeLabel(eventType).toLowerCase();
    return country && country !== "Unknown"
      ? `Detected ${label} at ${locationName}, ${country}.`
      : `Detected ${label} at ${locationName}.`;
  }

  return country && country !== "Unknown"
    ? `Grouped media around ${locationName}, ${country}.`
    : `Grouped media around ${locationName}.`;
}

export function buildImportedEventDescription(locationName: string, country: string, eventType = "activity") {
  if (!isKnownLocationName(locationName)) {
    return "Travel event created from nearby media captured in the same time range.";
  }

  const prefix = {
    sport: "Sport event",
    concert: "Concert",
    live_show: "Live show",
    theatre: "Theatre visit",
    dining: "Dining stop",
    sightseeing: "Sightseeing stop",
    meeting: "Meeting",
    wellness: "Wellness stop",
    hotel: "Stay",
    resort: "Stay",
    camping: "Camping stop",
    glamping: "Glamping stay",
    safari: "Safari stay",
    ski_lodge: "Ski lodge stay",
    flight: "Flight stop",
    train: "Train stop",
    bus: "Bus stop",
    ferry: "Ferry stop",
    cruise: "Cruise stop",
    yacht_boat: "Boat stop",
    car: "Road trip stop",
    on_foot: "Walking stop",
    cycling: "Cycling stop",
    tour: "Tour stop",
    apartment_flat: "Stay",
    private_home: "Stay",
    villa: "Stay",
    other: "Travel stop",
    activity: "Travel event",
  }[eventType] ?? "Travel event";

  return country && country !== "Unknown"
    ? `${prefix} at ${locationName}, ${country}.`
    : `${prefix} at ${locationName}.`;
}

export function buildImportedStepDetails(input: ImportedPlaceDetailsInput): ImportedPlaceDetails {
  const classifiedEventType = classifyImportedPlace(input);
  const eventType =
    classifiedEventType === "activity" && input.fallbackEventType && input.fallbackEventType !== "activity"
      ? input.fallbackEventType
      : classifiedEventType;

  return {
    eventType,
    summary: buildImportedLocationSummary(input.locationName, input.country ?? "Unknown", eventType),
    description: buildImportedEventDescription(input.locationName, input.country ?? "Unknown", eventType),
  };
}
