import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Globe, MapPin, Route, Calendar, Compass, Plus, ChevronDown, ChevronUp } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { WorldMap } from "@/components/WorldMap";
import { StatCard } from "@/components/StatCard";
import { Switch } from "@/components/ui/switch";
import type { Tables } from "@/integrations/supabase/types";

type Trip = Tables<"trips">;
type TripStep = Tables<"trip_steps">;

const Dashboard = () => {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [trips, setTrips] = useState<Trip[]>([]);
  const [steps, setSteps] = useState<TripStep[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAddTrip, setShowAddTrip] = useState(false);
  const [title, setTitle] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [trackInBackground, setTrackInBackground] = useState(false);
  const [creating, setCreating] = useState(false);

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

  const isPastTrip = (() => {
    if (!endDate) return false;
    const end = new Date(endDate);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    return end < today;
  })();

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user || !title.trim()) return;
    setCreating(true);
    const { data } = await supabase
      .from("trips")
      .insert({
        user_id: user.id,
        title: title.trim(),
        start_date: startDate || null,
        end_date: endDate || null,
        is_active: trackInBackground && !isPastTrip,
      })
      .select()
      .single();
    if (data) {
      navigate(`/trips/${data.id}`);
    }
    setCreating(false);
  };

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

        {showAddTrip && (
          <form onSubmit={handleCreate} className="flex flex-col gap-4 border-t border-border px-5 pb-5 pt-4">
            <div className="flex flex-col gap-1.5">
              <label className="text-sm font-medium text-foreground">Trip Name *</label>
              <input
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="e.g. Summer in Europe"
                required
                className="rounded-xl border border-border bg-background px-4 py-2.5 text-sm text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="flex flex-col gap-1.5">
                <label className="text-sm font-medium text-foreground">Start Date</label>
                <input
                  type="date"
                  value={startDate}
                  onChange={(e) => setStartDate(e.target.value)}
                  className="rounded-xl border border-border bg-background px-4 py-2.5 text-sm text-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <label className="text-sm font-medium text-foreground">End Date</label>
                <input
                  type="date"
                  value={endDate}
                  onChange={(e) => setEndDate(e.target.value)}
                  min={startDate || undefined}
                  className="rounded-xl border border-border bg-background px-4 py-2.5 text-sm text-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
                />
              </div>
            </div>
            <div className={`flex items-center justify-between rounded-xl border border-border px-4 py-3 transition-opacity ${isPastTrip ? "opacity-40 pointer-events-none" : ""}`}>
              <div className="flex flex-col gap-0.5">
                <span className="text-sm font-medium text-foreground">Track in background</span>
                <span className="text-xs text-muted-foreground">
                  {isPastTrip ? "Not available for past trips" : "Automatically record your location during this trip"}
                </span>
              </div>
              <Switch
                checked={trackInBackground && !isPastTrip}
                onCheckedChange={setTrackInBackground}
                disabled={isPastTrip}
              />
            </div>
            <button
              type="submit"
              disabled={creating || !title.trim()}
              className="rounded-xl bg-primary py-2.5 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50"
            >
              {creating ? "Creating..." : "Add Trip"}
            </button>
          </form>
        )}
      </section>

      {/* Stats */}
      <section className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-5">
        <StatCard icon={Globe} label="Countries" value={countries.length} />
        <StatCard icon={MapPin} label="Cities" value={cities.length} />
        <StatCard icon={Route} label="Steps" value={steps.length} />
        <StatCard icon={Compass} label="Trips" value={trips.length} />
        <StatCard icon={Calendar} label="Active" value={trips.some(t => t.is_active) ? "Yes" : "No"} />
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