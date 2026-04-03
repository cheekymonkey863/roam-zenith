import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Globe, MapPin, Route, Calendar, Compass, Plus } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { WorldMap } from "@/components/WorldMap";
import { StatCard } from "@/components/StatCard";
import { TrackingControl } from "@/components/TrackingControl";
import type { Tables } from "@/integrations/supabase/types";

type Trip = Tables<"trips">;
type TripStep = Tables<"trip_steps">;

const Dashboard = () => {
  const { user } = useAuth();
  const [trips, setTrips] = useState<Trip[]>([]);
  const [steps, setSteps] = useState<TripStep[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user) return;
    const fetchData = async () => {
      const [tripsRes, stepsRes] = await Promise.all([
        supabase.from("trips").select("*").eq("user_id", user.id).order("created_at", { ascending: false }),
        supabase.from("trip_steps").select("*").eq("user_id", user.id).order("recorded_at", { ascending: true }),
      ]);
      setTrips(tripsRes.data || []);
      setSteps(stepsRes.data || []);
      setLoading(false);
    };
    fetchData();
  }, [user]);

  const activeTrip = trips.find((t) => t.is_active);
  const countries = [...new Set(steps.map((s) => s.country).filter(Boolean))];
  const cities = [...new Set(steps.map((s) => s.location_name).filter(Boolean))];

  return (
    <div className="flex flex-col gap-10">
      <section className="flex flex-col items-center gap-4 pt-8 text-center">
        <h1 className="font-display text-4xl font-semibold tracking-tight text-foreground md:text-5xl">
          Your Travel Story
        </h1>
        <p className="max-w-lg text-muted-foreground">
          Track every journey, remember every moment.
        </p>
      </section>

      {/* Active trip tracking */}
      {activeTrip && <TrackingControl activeTripId={activeTrip.id} />}

      {/* Stats */}
      <section className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-5">
        <StatCard icon={Globe} label="Countries" value={countries.length} />
        <StatCard icon={MapPin} label="Cities" value={cities.length} />
        <StatCard icon={Route} label="Steps" value={steps.length} />
        <StatCard icon={Compass} label="Trips" value={trips.length} />
        <StatCard icon={Calendar} label="Active" value={activeTrip ? "Yes" : "No"} />
      </section>

      {/* Map */}
      <section className="flex flex-col gap-4">
        <h2 className="font-display text-2xl font-semibold text-foreground">Where You've Been</h2>
        <WorldMap steps={steps} />
      </section>

      {/* Recent trips */}
      <section className="flex flex-col gap-4 pb-12">
        <div className="flex items-center justify-between">
          <h2 className="font-display text-2xl font-semibold text-foreground">Your Trips</h2>
          <Link
            to="/trips/new"
            className="flex items-center gap-2 rounded-xl bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
          >
            <Plus className="h-4 w-4" />
            New Trip
          </Link>
        </div>

        {loading ? (
          <p className="text-muted-foreground">Loading...</p>
        ) : trips.length === 0 ? (
          <div className="flex flex-col items-center gap-3 rounded-2xl bg-card p-12 shadow-card text-center">
            <Globe className="h-10 w-10 text-muted-foreground/50" />
            <p className="text-muted-foreground">No trips yet. Start your first adventure!</p>
            <Link to="/trips/new" className="rounded-xl bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90">
              Create Trip
            </Link>
          </div>
        ) : (
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {trips.map((trip) => {
              const tripSteps = steps.filter((s) => s.trip_id === trip.id);
              const tripCountries = [...new Set(tripSteps.map((s) => s.country).filter(Boolean))];

              return (
                <Link
                  key={trip.id}
                  to={`/trips/${trip.id}`}
                  className="group flex flex-col overflow-hidden rounded-2xl bg-card shadow-card transition-all duration-300 hover:shadow-card-hover hover:-translate-y-1"
                >
                  <div className="relative h-32 bg-gradient-to-br from-primary/20 via-accent/10 to-secondary">
                    {trip.is_active && (
                      <span className="absolute right-3 top-3 rounded-full bg-accent px-2.5 py-0.5 text-xs font-medium text-accent-foreground">
                        Active
                      </span>
                    )}
                    <div className="absolute inset-0 flex items-end p-5">
                      <h3 className="font-display text-xl font-semibold text-foreground">{trip.title}</h3>
                    </div>
                  </div>
                  <div className="flex flex-col gap-2 p-5">
                    <div className="flex items-center gap-2 text-sm text-muted-foreground">
                      <MapPin className="h-3.5 w-3.5" />
                      <span>{tripCountries.length > 0 ? tripCountries.join(", ") : "No locations yet"}</span>
                    </div>
                    <div className="flex items-center gap-2 text-sm text-muted-foreground">
                      <Route className="h-3.5 w-3.5" />
                      <span>{tripSteps.length} steps</span>
                    </div>
                  </div>
                </Link>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
};

export default Dashboard;
