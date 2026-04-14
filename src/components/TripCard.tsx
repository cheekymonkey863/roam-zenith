import { Link } from "react-router-dom";
import { MapPin, Calendar } from "lucide-react";
import type { Tables } from "@/integrations/supabase/types";

type Trip = Tables<"trips">;

interface TripCardProps {
  trip: Trip;
}

export function TripCard({ trip }: TripCardProps) {
  return (
    <Link
      to={`/trips/${trip.id}`}
      className="group block rounded-2xl border border-border bg-card p-6 shadow-sm transition-all hover:shadow-md hover:border-primary/30"
    >
      <h3 className="font-display text-lg font-semibold text-foreground group-hover:text-primary transition-colors">
        {trip.title}
      </h3>
      <div className="mt-3 flex flex-col gap-1.5 text-sm text-muted-foreground">
        {trip.start_date && (
          <div className="flex items-center gap-2">
            <Calendar className="h-4 w-4" />
            <span>
              {trip.start_date}
              {trip.end_date ? ` — ${trip.end_date}` : ""}
            </span>
          </div>
        )}
        {trip.is_active && (
          <div className="flex items-center gap-2">
            <MapPin className="h-4 w-4 text-primary" />
            <span className="text-primary font-medium">Active</span>
          </div>
        )}
      </div>
    </Link>
  );
}
