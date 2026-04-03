import { useParams, Link } from "react-router-dom";
import { ArrowLeft, Calendar, MapPin, Route } from "lucide-react";
import { trips } from "@/data/trips";
import { TripTimeline } from "@/components/TripTimeline";

function formatDate(dateStr: string) {
  return new Date(dateStr).toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
  });
}

const TripDetail = () => {
  const { id } = useParams<{ id: string }>();
  const trip = trips.find((t) => t.id === id);

  if (!trip) {
    return (
      <div className="flex flex-col items-center gap-4 py-20 text-center">
        <h2 className="font-display text-2xl font-semibold text-foreground">Trip not found</h2>
        <Link to="/trips" className="text-primary hover:underline">Back to trips</Link>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-8 py-8">
      {/* Header */}
      <div className="flex flex-col gap-4">
        <Link to="/trips" className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors">
          <ArrowLeft className="h-4 w-4" />
          Back to trips
        </Link>

        <div className="rounded-2xl bg-gradient-to-br from-primary/15 via-accent/10 to-secondary p-8">
          <h1 className="font-display text-3xl font-semibold text-foreground md:text-4xl">
            {trip.title}
          </h1>

          <div className="mt-4 flex flex-wrap items-center gap-4 text-sm text-muted-foreground">
            <span className="flex items-center gap-1.5">
              <Calendar className="h-4 w-4" />
              {formatDate(trip.startDate)} — {formatDate(trip.endDate)}
            </span>
            <span className="flex items-center gap-1.5">
              <MapPin className="h-4 w-4" />
              {trip.countries.join(", ")}
            </span>
            <span className="flex items-center gap-1.5">
              <Route className="h-4 w-4" />
              {trip.distance.toLocaleString()} km
            </span>
          </div>
        </div>
      </div>

      {/* Timeline */}
      <div className="flex flex-col gap-4">
        <h2 className="font-display text-2xl font-semibold text-foreground">
          Journey Timeline
        </h2>
        <TripTimeline steps={trip.steps} />
      </div>
    </div>
  );
};

export default TripDetail;
