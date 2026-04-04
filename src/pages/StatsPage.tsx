import { useEffect, useState } from "react";
import { Globe, MapPin, Route, Calendar, Compass, Flag } from "lucide-react";
import { StatCard } from "@/components/StatCard";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useResolvedCities } from "@/hooks/useResolvedCities";
import type { Tables } from "@/integrations/supabase/types";

type Trip = Tables<"trips">;
type TripStep = Tables<"trip_steps">;

const StatsPage = () => {
  const { user } = useAuth();
  const [trips, setTrips] = useState<Trip[]>([]);
  const [steps, setSteps] = useState<TripStep[]>([]);

  useEffect(() => {
    if (!user) return;
    Promise.all([
      supabase.from("trips").select("*").eq("user_id", user.id),
      supabase.from("trip_steps").select("*").eq("user_id", user.id),
    ]).then(([t, s]) => {
      setTrips(t.data || []);
      setSteps(s.data || []);
    });
  }, [user]);

  const countries = [...new Set(steps.map((s) => s.country).filter(Boolean))];
  const { cityCount, isResolvingCities } = useResolvedCities(steps);

  return (
    <div className="flex flex-col gap-8 py-8">
      <div>
        <h1 className="font-display text-3xl font-semibold text-foreground">Travel Statistics</h1>
        <p className="mt-1 text-muted-foreground">Your adventures by the numbers.</p>
      </div>

      <div className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-5">
        <StatCard icon={Globe} label="Countries" value={countries.length} />
        <StatCard icon={MapPin} label="Cities" value={isResolvingCities && steps.length > 0 ? "…" : cityCount} />
        <StatCard icon={Route} label="Steps" value={steps.length} />
        <StatCard icon={Compass} label="Trips" value={trips.length} />
        <StatCard icon={Calendar} label="Active" value={trips.filter((t) => t.is_active).length} />
      </div>

      {countries.length > 0 && (
        <div className="flex flex-col gap-4">
          <h2 className="font-display text-2xl font-semibold text-foreground">Countries Visited</h2>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-4">
            {countries.map((country) => (
              <div key={country} className="flex items-center gap-3 rounded-2xl bg-card p-4 shadow-card">
                <Flag className="h-4 w-4 text-primary" />
                <span className="text-sm font-medium text-foreground">{country}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {trips.length > 0 && (
        <div className="flex flex-col gap-4 pb-12">
          <h2 className="font-display text-2xl font-semibold text-foreground">Trips Breakdown</h2>
          <div className="flex flex-col gap-3">
            {trips.map((trip) => {
              const tripSteps = steps.filter((s) => s.trip_id === trip.id);
              return (
                <div key={trip.id} className="flex items-center justify-between rounded-2xl bg-card p-5 shadow-card">
                  <div>
                    <h3 className="font-display text-lg font-semibold text-foreground">{trip.title}</h3>
                    <p className="text-sm text-muted-foreground">
                      {[...new Set(tripSteps.map((s) => s.country).filter(Boolean))].join(", ") || "No locations"}
                    </p>
                  </div>
                  <span className="text-sm text-muted-foreground">{tripSteps.length} steps</span>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
};

export default StatsPage;
