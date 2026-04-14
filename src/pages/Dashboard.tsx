import { useEffect, useState } from "react";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { WorldMap } from "@/components/WorldMap";
import { StatCard } from "@/components/StatCard";
import { DashboardTripForm } from "@/components/DashboardTripForm";
import { TripCard } from "@/components/TripCard";
import { Globe, MapPin, Navigation } from "lucide-react";
import type { Tables } from "@/integrations/supabase/types";

type Trip = Tables<"trips">;
type TripStep = Tables<"trip_steps">;

export default function Dashboard() {
  const { user } = useAuth();
  const [trips, setTrips] = useState<Trip[]>([]);
  const [allSteps, setAllSteps] = useState<TripStep[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchData = async () => {
    if (!user) return;

    try {
      // Fetch all trips for this user
      const { data: tripsData, error: tripsError } = await supabase
        .from("trips")
        .select("*")
        .eq("user_id", user.id)
        .order("start_date", { ascending: false });

      if (tripsError) throw tripsError;

      // Fetch all stops/steps for the map and global statistics
      const { data: stepsData, error: stepsError } = await supabase
        .from("trip_steps")
        .select("*")
        .eq("user_id", user.id);

      if (stepsError) throw stepsError;

      setTrips(tripsData || []);
      setAllSteps(stepsData || []);
    } catch (error) {
      console.error("Error fetching dashboard data:", error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();

    // Subscribe to real-time updates
    const channel = supabase
      .channel("dashboard-changes")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "trips", filter: `user_id=eq.${user?.id}` },
        fetchData,
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "trip_steps", filter: `user_id=eq.${user?.id}` },
        fetchData,
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [user]);

  // Calculate unique stats
  const totalCountries = new Set(allSteps.map((s) => s.country).filter(Boolean)).size;

  const totalCities = new Set(
    allSteps
      .map((s) => {
        if (!s.location_name) return null;
        const parts = s.location_name.split(",");
        return parts.length > 1 ? parts[parts.length - 2].trim() : parts[0].trim();
      })
      .filter(Boolean),
  ).size;

  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center bg-background">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background pb-20 pt-24 px-6 sm:px-10 lg:px-16">
      <div className="mx-auto max-w-7xl">
        {/* Header with Logo on the Top Left */}
        <div className="flex flex-col items-start justify-start mb-10">
          <img src="/logo.png" alt="TravelTRKR" className="h-14 w-auto mb-2 object-contain" />
          <p className="text-muted-foreground text-xs">Track every journey, remember every moment.</p>
        </div>

        {/* Create Trip Form Section */}
        <div className="mb-12">
          <DashboardTripForm onTripAdded={fetchData} />
        </div>

        {/* Global Statistics Grid */}
        <div className="grid grid-cols-1 gap-6 mb-12 sm:grid-cols-3">
          <StatCard title="Countries" value={totalCountries} icon={Globe} description="Explored across the globe" />
          <StatCard title="Cities" value={totalCities} icon={MapPin} description="Visited worldwide" />
          <StatCard title="Trips" value={trips.length} icon={Navigation} description="Recorded adventures" />
        </div>

        {/* Global Map Section */}
        <div className="mb-16">
          <h2 className="font-display text-2xl font-bold text-foreground mb-6">Where You've Been</h2>
          <div className="overflow-hidden rounded-2xl border border-border shadow-sm">
            <WorldMap steps={allSteps} singleTrip={false} />
          </div>
        </div>

        {/* Trips Collection */}
        <div>
          <h2 className="font-display text-2xl font-bold text-foreground mb-6">Your Trips</h2>
          {trips.length === 0 ? (
            <div className="rounded-2xl border-2 border-dashed border-border p-12 text-center">
              <p className="text-muted-foreground">You haven't added any trips yet. Start your first journey above!</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-8 md:grid-cols-2 lg:grid-cols-3">
              {trips.map((trip) => (
                <TripCard key={trip.id} trip={trip} />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
