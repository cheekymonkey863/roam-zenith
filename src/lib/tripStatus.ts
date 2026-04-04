export type TripStatus = "travelled" | "travelling" | "future";

export function getTripStatus(startDate: string | null, endDate: string | null): TripStatus {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const start = startDate ? new Date(startDate) : null;
  const end = endDate ? new Date(endDate) : null;

  if (end && end < today) return "travelled";
  if (start && start > today) return "future";
  return "travelling";
}

export function getTripStatusLabel(status: TripStatus): string {
  switch (status) {
    case "travelled": return "Travelled";
    case "travelling": return "Travelling";
    case "future": return "Future Travel";
  }
}

export function getTripStatusStyle(status: TripStatus): string {
  switch (status) {
    case "travelled": return "bg-muted text-muted-foreground";
    case "travelling": return "bg-accent text-accent-foreground";
    case "future": return "bg-primary/15 text-primary";
  }
}

export function formatTripDateRange(startDate: string | null, endDate: string | null): string {
  const fmt = (d: string) => new Date(d).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  
  const durationStr = (s: string, e: string) => {
    const days = Math.round((new Date(e).getTime() - new Date(s).getTime()) / 86400000) + 1;
    return ` (${days} day${days !== 1 ? "s" : ""})`;
  };

  if (startDate && endDate) return `${fmt(startDate)} – ${fmt(endDate)}${durationStr(startDate, endDate)}`;
  if (startDate) return `From ${fmt(startDate)}`;
  if (endDate) return `Until ${fmt(endDate)}`;
  return "No dates set";
}
