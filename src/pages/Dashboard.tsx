import { Globe, MapPin, Route, Calendar, Compass } from "lucide-react";
import { WorldMap } from "@/components/WorldMap";
import { TripCard } from "@/components/TripCard";
import { StatCard } from "@/components/StatCard";
import { trips, travelStats } from "@/data/trips";

const Dashboard = () => {
  return (
    <div className="flex flex-col gap-10">
      {/* Hero */}
      <section className="flex flex-col items-center gap-4 pt-8 text-center">
        <h1 className="font-display text-4xl font-semibold tracking-tight text-foreground md:text-5xl">
          Your Travel Story
        </h1>
        <p className="max-w-lg text-muted-foreground">
          Track every journey, remember every moment. Your personal travel map and journal — all in one place.
        </p>
      </section>

      {/* Stats */}
      <section className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-5">
        <StatCard icon={Globe} label="Countries" value={travelStats.countriesVisited} />
        <StatCard icon={MapPin} label="Cities" value={travelStats.citiesVisited} />
        <StatCard icon={Route} label="Distance" value={travelStats.totalDistance} suffix="km" />
        <StatCard icon={Compass} label="Trips" value={travelStats.totalTrips} />
        <StatCard icon={Calendar} label="Days Traveling" value={travelStats.totalDays} />
      </section>

      {/* Map */}
      <section className="flex flex-col gap-4">
        <h2 className="font-display text-2xl font-semibold text-foreground">
          Where You've Been
        </h2>
        <WorldMap />
      </section>

      {/* Recent trips */}
      <section className="flex flex-col gap-4 pb-12">
        <h2 className="font-display text-2xl font-semibold text-foreground">
          Recent Trips
        </h2>
        <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
          {trips.map((trip) => (
            <TripCard key={trip.id} trip={trip} />
          ))}
        </div>
      </section>
    </div>
  );
};

export default Dashboard;
