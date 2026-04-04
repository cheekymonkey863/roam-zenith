import {
  Plane, TrainFront, Bus, Ship, Car, Footprints, Bike,
  Hotel, Building, Home, Castle, Trees, Tent, Mountain, Palmtree, Snowflake,
  Map, Camera, UtensilsCrossed, Users, Music, Theater, Sparkles, Heart, Flag, Trophy,
  type LucideIcon,
} from "lucide-react";

export interface EventTypeOption {
  value: string;
  label: string;
  icon: LucideIcon;
  group: string;
}

export const EVENT_TYPE_GROUPS = [
  {
    label: "Transport",
    options: [
      { value: "flight", label: "Flight", icon: Plane },
      { value: "train", label: "Train", icon: TrainFront },
      { value: "bus", label: "Bus", icon: Bus },
      { value: "ferry", label: "Ferry", icon: Ship },
      { value: "car", label: "Car", icon: Car },
      { value: "on_foot", label: "On Foot", icon: Footprints },
      { value: "cycling", label: "Cycling", icon: Bike },
    ],
  },
  {
    label: "Accommodation",
    options: [
      { value: "hotel", label: "Hotel", icon: Hotel },
      { value: "apartment_flat", label: "Apartment / Flat", icon: Building },
      { value: "private_home", label: "Private Home", icon: Home },
      { value: "villa", label: "Villa", icon: Castle },
      { value: "safari", label: "Safari", icon: Trees },
      { value: "glamping", label: "Glamping", icon: Mountain },
      { value: "camping", label: "Camping", icon: Tent },
      { value: "resort", label: "Resort", icon: Palmtree },
      { value: "ski_lodge", label: "Ski Lodge", icon: Snowflake },
    ],
  },
  {
    label: "Activity",
    options: [
      { value: "tour", label: "Tour", icon: Map },
      { value: "sightseeing", label: "Sightseeing", icon: Camera },
      { value: "dining", label: "Dining", icon: UtensilsCrossed },
      { value: "meeting", label: "Meeting", icon: Users },
      { value: "concert", label: "Concert", icon: Music },
      { value: "theatre", label: "Theatre", icon: Theater },
      { value: "live_show", label: "Live Show", icon: Sparkles },
      { value: "wellness", label: "Wellness", icon: Heart },
      { value: "sport", label: "Sport", icon: Trophy },
    ],
  },
] as const;

// Flat list of all event types
export const ALL_EVENT_TYPES: EventTypeOption[] = EVENT_TYPE_GROUPS.flatMap((g) =>
  g.options.map((o) => ({ ...o, group: g.label }))
);

// Lookup by value
export function getEventType(value: string): EventTypeOption | undefined {
  return ALL_EVENT_TYPES.find((t) => t.value === value);
}

// Get group label for a value
export function getEventTypeGroup(value: string): string {
  for (const g of EVENT_TYPE_GROUPS) {
    if (g.options.some((o) => o.value === value)) return g.label;
  }
  return "Activity";
}
