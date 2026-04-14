import { useEffect, useState } from "react";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { WorldMap } from "@/components/WorldMap";
import { StatCard } from "@/components/StatCard";
import { DashboardTripForm } from "@/components/DashboardTripForm";
import { TripCard } from "@/components/TripCard";
import { Globe, MapPin, Navigation } from "lucide-react";

export default function Dashboard() {
  const { user } = useAuth();
  const [trips, setTrips] = useState<any[]>([]);
  const [allSteps, setAllSteps] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchData = async () => {
    if (!user) return;
    const { data: tripsData } = await supabase
      .from("trips")
      .select("*")
      .eq("user_id", user.id)
      .order("start_date", { ascending: false });
    const { data: stepsData } = await supabase.from("trip_steps").select("*").eq("user_id", user.id);
    setTrips(tripsData || []);
    setAllSteps(stepsData || []);
    setLoading(false);
  };

  useEffect(() => {
    if (user) {
      fetchData();
    } else {
      setLoading(false);
    }
  }, [user]);

  const totalCountries = new Set(allSteps.map((s) => s.country).filter(Boolean)).size;
  const totalCities = new Set(allSteps.map((s) => s.location_name?.split(",")[0]).filter(Boolean)).size;

  if (loading) return null;

  return (
    <div className="min-h-screen bg-background pb-20 pt-24 px-6 sm:px-10 lg:px-16">
      <div className="mx-auto max-w-7xl">
        <div className="mb-10 flex flex-col items-center text-center">
          <img src="/logo.png" alt="TravelTRKR" className="h-[84px] w-auto object-contain" />
          <p className="mt-1 text-xs text-muted-foreground">Track every journey, remember every moment.</p>
        </div>

        <div className="mb-12">
          <DashboardTripForm onTripAdded={fetchData} />
        </div>

        <div className="grid grid-cols-1 gap-6 mb-12 sm:grid-cols-3">
          <StatCard title="Countries" value={totalCountries} icon={Globe} />
          <StatCard title="Cities" value={totalCities} icon={MapPin} />
          <StatCard title="Trips" value={trips.length} icon={Navigation} />
        </div>

        <div className="mb-16">
          <h2 className="text-2xl font-bold mb-6">Where You've Been</h2>
          <div className="h-[400px] rounded-2xl border overflow-hidden">
            <WorldMap steps={allSteps} />
          </div>
        </div>

        <h2 className="text-2xl font-bold mb-6">Your Trips</h2>
        <div className="grid grid-cols-1 gap-8 md:grid-cols-2 lg:grid-cols-3">
          {trips.map((trip) => (
            <TripCard key={trip.id} trip={trip} />
          ))}
        </div>
      </div>
    </div>
  );
}
