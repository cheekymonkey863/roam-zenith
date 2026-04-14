import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Globe, MapPin, Compass, Plus, ChevronDown, ChevronUp, Calendar, Pencil, Trash2 } from "lucide-react";
import { getTripStatus, getTripStatusLabel, getTripStatusStyle, formatTripDateRange } from "@/lib/tripStatus";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useResolvedCities } from "@/hooks/useResolvedCities";
import { WorldMap } from "@/components/WorldMap";
import { StatCard } from "@/components/StatCard";
import { DashboardTripForm } from "@/components/DashboardTripForm";
import { Button } from "@/components/ui/button";
import { EditTripDialog } from "@/components/EditTripDialog";
import { DeleteTripDialog } from "@/components/DeleteTripDialog";
import type { Tables } from "@/integrations/supabase/types";

type Trip = Tables<"trips">;
type TripStep = Tables<"trip_steps">;

const Dashboard = () => {
  const { user } = useAuth();
  const [trips, setTrips] = useState<Trip[]>([]);
  const [steps, setSteps] = useState<TripStep[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAddTrip, setShowAddTrip] = useState(false);

  const fetchData = useCallback(async () => {
    if (!user) {
      setTrips([]);
      setSteps([]);
      setLoading(false);
      return;
    }

    setLoading(true);

    const [tripsRes, stepsRes] = await Promise.all([
      supabase.from("trips").select("*").order("start_date", { ascending: true, nullsFirst: false }),
      supabase.from("trip_steps").select("*").order("recorded_at", { ascending: true }),
    ]);

    if (tripsRes.error) console.error(tripsRes.error);
    if (stepsRes.error) console.error(stepsRes.error);

    setTrips(tripsRes.data || []);
    setSteps(stepsRes.data || []);
    setLoading(false);
  }, [user]);

  useEffect(() => {
    void fetchData();
  }, [fetchData]);

  const countries = [...new Set(steps.map((s) => s.country).filter(Boolean))];
  const cities = [...new Set(steps.map((s) => s.location_name).filter(Boolean))];
  const { cityCount, isResolvingCities } = useResolvedCities(steps);

  return (
    <div className="flex flex-col gap-10">
      <section className="flex flex-col items-center gap-4 pt-8 text-center">
        <h1 className="font-display text-4xl font-semibold tracking-tight text-foreground md:text-5xl">
          Your Travel Story
        </h1>
        <p className="max-w-lg text-muted-foreground">Track every journey, remember every moment.</p>
      </section>

      {/* Add Trip */}
      <section className="rounded-2xl bg-card shadow-card overflow-hidden">
        <button
          onClick={() => setShowAddTrip(!showAddTrip)}
          className="flex w-full items-center justify-between px-5 py-4 text-left"
        >
          <div className="flex items-center gap-2">
            <Plus className="h-5 w-5 text-primary" />
            <span className="font-display text-lg font-semibold text-foreground">Add Trip</span>
          </div>
          {showAddTrip ? (
            <ChevronUp className="h-4 w-4 text-muted-foreground" />
          ) : (
            <ChevronDown className="h-4 w-4 text-muted-foreground" />
          )}
        </button>

        {showAddTrip && <DashboardTripForm />}
      </section>

      {/* Stats */}
      <section className="grid grid-cols-2 gap-4 md:grid-cols-3">
        <StatCard icon={Globe} label="Countries" value={countries.length} />
        <StatCard icon={MapPin} label="Cities" value={cities.length} />
        <StatCard icon={MapPin} label="Cities" value={isResolvingCities && steps.length > 0 ? "…" : cityCount} />
        <StatCard icon={Compass} label="Trips" value={trips.length} />
      </section>

      {/* Map */}
      <section className="flex flex-col gap-4">
        <h2 className="font-display text-2xl font-semibold text-foreground">Where You've Been</h2>
        <WorldMap steps={steps} />
      </section>

      {/* Recent trips */}
      <section className="flex flex-col gap-4 pb-12">
        <h2 className="font-display text-2xl font-semibold text-foreground">Your Trips</h2>

        {loading ? (
          <p className="text-muted-foreground">Loading...</p>
        ) : trips.length === 0 ? (
          <div className="flex flex-col items-center gap-3 rounded-2xl bg-card p-12 shadow-card text-center">
            <Globe className="h-10 w-10 text-muted-foreground/50" />
            <p className="text-muted-foreground">No trips yet. Start your first adventure!</p>
          </div>
        ) : (
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {trips.map((trip) => {
              const tripSteps = steps.filter((s) => s.trip_id === trip.id);
              const tripCountries = [...new Set(tripSteps.map((s) => s.country).filter(Boolean))];
              const status = getTripStatus(trip.start_date, trip.end_date);
              const isOwner = trip.user_id === user?.id;

              return (
                <div
                  key={trip.id}
                  className="group flex flex-col overflow-hidden rounded-2xl bg-card shadow-card transition-all duration-300 hover:shadow-card-hover hover:-translate-y-1"
                >
                  <div className="relative h-32 bg-gradient-to-br from-primary/20 via-accent/10 to-secondary">
                    {isOwner && (
                      <div className="absolute left-3 top-3 z-10 flex items-center gap-2">
                        <EditTripDialog
                          trip={trip}
                          tripCountries={tripCountries}
                          onUpdated={fetchData}
                          trigger={
                            <Button
                              type="button"
                              variant="secondary"
                              size="icon"
                              className="h-8 w-8 rounded-full shadow-sm"
                            >
                              <Pencil className="h-4 w-4" />
                            </Button>
                          }
                        />
                        <DeleteTripDialog
                          tripId={trip.id}
                          tripTitle={trip.title}
                          onDeleted={fetchData}
                          trigger={
                            <Button
                              type="button"
                              variant="secondary"
                              size="icon"
                              className="h-8 w-8 rounded-full shadow-sm"
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          }
                        />
                      </div>
                    )}
                    <div className="absolute right-3 top-3 z-10 flex items-center gap-1.5">
                      {!isOwner && (
                        <span className="rounded-full bg-accent/80 px-2.5 py-0.5 text-xs font-medium text-accent-foreground">
                          Shared
                        </span>
                      )}
                      <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${getTripStatusStyle(status)}`}>
                        {getTripStatusLabel(status)}
                      </span>
                    </div>
                    <Link to={`/trips/${trip.id}`} className="absolute inset-0 flex items-end p-5">
                      <h3 className="font-display text-xl font-semibold text-foreground">{trip.title}</h3>
                    </Link>
                  </div>
                  <Link to={`/trips/${trip.id}`} className="flex flex-col gap-2 p-5">
                    <div className="flex items-center gap-2 text-sm text-muted-foreground">
                      <Calendar className="h-3.5 w-3.5" />
                      <span>{formatTripDateRange(trip.start_date, trip.end_date)}</span>
                    </div>
                    <div className="flex items-center gap-2 text-sm text-muted-foreground">
                      <MapPin className="h-3.5 w-3.5" />
                      <span>{tripCountries.length > 0 ? tripCountries.join(", ") : "No locations yet"}</span>
                    </div>
                  </Link>
                </div>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
};
