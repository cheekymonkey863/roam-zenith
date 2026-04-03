import { Globe, MapPin, Route, Calendar, Compass, Flag } from "lucide-react";
import { StatCard } from "@/components/StatCard";
import { trips, travelStats } from "@/data/trips";

const StatsPage = () => {
  const allCountries = [...new Set(trips.flatMap((t) => t.countries))];

  return (
    <div className="flex flex-col gap-8 py-8">
      <div>
        <h1 className="font-display text-3xl font-semibold text-foreground">Travel Statistics</h1>
        <p className="mt-1 text-muted-foreground">Your adventures by the numbers.</p>
      </div>

      <div className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-5">
        <StatCard icon={Globe} label="Countries" value={travelStats.countriesVisited} />
        <StatCard icon={MapPin} label="Cities" value={travelStats.citiesVisited} />
        <StatCard icon={Route} label="Distance" value={travelStats.totalDistance} suffix="km" />
        <StatCard icon={Compass} label="Trips" value={travelStats.totalTrips} />
        <StatCard icon={Calendar} label="Days Traveling" value={travelStats.totalDays} />
      </div>

      {/* Countries visited */}
      <div className="flex flex-col gap-4">
        <h2 className="font-display text-2xl font-semibold text-foreground">Countries Visited</h2>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-4">
          {allCountries.map((country) => (
            <div key={country} className="flex items-center gap-3 rounded-2xl bg-card p-4 shadow-card">
              <Flag className="h-4 w-4 text-primary" />
              <span className="text-sm font-medium text-foreground">{country}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Trips breakdown */}
      <div className="flex flex-col gap-4 pb-12">
        <h2 className="font-display text-2xl font-semibold text-foreground">Trips Breakdown</h2>
        <div className="flex flex-col gap-3">
          {trips.map((trip) => (
            <div key={trip.id} className="flex items-center justify-between rounded-2xl bg-card p-5 shadow-card">
              <div>
                <h3 className="font-display text-lg font-semibold text-foreground">{trip.title}</h3>
                <p className="text-sm text-muted-foreground">{trip.countries.join(", ")}</p>
              </div>
              <div className="flex items-center gap-6 text-sm text-muted-foreground">
                <span>{trip.steps.length} stops</span>
                <span>{trip.distance.toLocaleString()} km</span>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

export default StatsPage;
