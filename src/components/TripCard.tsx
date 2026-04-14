import { Link } from "react-router-dom";
import { Calendar, MapPin } from "lucide-react";

export function TripCard({ trip }: { trip: any }) {
  const startDate = trip.start_date
    ? new Date(trip.start_date).toLocaleDateString("en-US", { month: "short", year: "numeric" })
    : "Dates TBD";

  const tripImage = trip.image_url;

  return (
    <Link
      to={`/trip/${trip.id}`}
      className="group relative flex flex-col overflow-hidden rounded-2xl border border-border bg-card transition-all hover:shadow-lg hover:-translate-y-1"
    >
      <div className="aspect-[16/9] w-full bg-muted overflow-hidden">
        {tripImage ? (
          <img
            src={tripImage}
            alt={trip.title}
            className="h-full w-full object-cover transition-transform group-hover:scale-105"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center bg-primary/5">
            <MapPin className="h-8 w-8 text-primary/20" />
          </div>
        )}
      </div>
      <div className="p-5">
        <h3 className="font-display text-lg font-bold text-foreground group-hover:text-primary transition-colors truncate">
          {trip.title}
        </h3>
        <div className="mt-2 flex items-center gap-2 text-sm text-muted-foreground">
          <Calendar className="h-4 w-4" />
          <span>{startDate}</span>
        </div>
      </div>
    </Link>
  );
}
