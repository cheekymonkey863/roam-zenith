import { Link } from "react-router-dom";
import { MapPin, Calendar, Route } from "lucide-react";
import type { Trip } from "@/data/trips";

function formatDate(dateStr: string) {
  return new Date(dateStr).toLocaleDateString("en-US", { month: "short", year: "numeric" });
}

export function TripCard({ trip }: { trip: Trip }) {
  const stepLocations = trip.steps.map((s) => s.location);

  return (
    <Link
      to={`/trips/${trip.id}`}
      className="group flex flex-col overflow-hidden rounded-2xl bg-card shadow-card transition-all duration-300 hover:shadow-card-hover hover:-translate-y-1"
    >
      {/* Cover gradient */}
      <div className="relative h-40 bg-gradient-to-br from-primary/20 via-accent/10 to-secondary">
        <div className="absolute inset-0 flex items-end p-5">
          <h3 className="font-display text-xl font-semibold text-foreground">{trip.title}</h3>
        </div>
      </div>

      <div className="flex flex-col gap-3 p-5">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Calendar className="h-3.5 w-3.5" />
          <span>
            {formatDate(trip.startDate)} — {formatDate(trip.endDate)}
          </span>
        </div>

        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <MapPin className="h-3.5 w-3.5" />
          <span>{trip.countries.join(", ")}</span>
        </div>

        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Route className="h-3.5 w-3.5" />
          <span>
            {trip.distance.toLocaleString()} km · {trip.steps.length} stops
          </span>
        </div>

        <div className="mt-1 flex flex-wrap gap-1.5">
          {stepLocations.slice(0, 4).map((loc) => (
            <span
              key={loc}
              className="rounded-full bg-secondary px-2.5 py-0.5 text-xs font-medium text-secondary-foreground"
            >
              {loc}
            </span>
          ))}
          {stepLocations.length > 4 && (
            <span className="rounded-full bg-primary/10 px-2.5 py-0.5 text-xs font-medium text-primary">
              +{stepLocations.length - 4} more
            </span>
          )}
        </div>
      </div>
    </Link>
  );
}
