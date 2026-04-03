import { TripCard } from "@/components/TripCard";
import { trips } from "@/data/trips";

const TripsPage = () => {
  return (
    <div className="flex flex-col gap-8 py-8">
      <div>
        <h1 className="font-display text-3xl font-semibold text-foreground">My Trips</h1>
        <p className="mt-1 text-muted-foreground">All your adventures in one place.</p>
      </div>

      <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
        {trips.map((trip) => (
          <TripCard key={trip.id} trip={trip} />
        ))}
      </div>
    </div>
  );
};

export default TripsPage;
