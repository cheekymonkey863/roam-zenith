import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { ActivityLog } from "@/components/ActivityLog";

interface TripOption { id: string; title: string; }

export default function ActivityLogPage() {
  const { user } = useAuth();
  const [trips, setTrips] = useState<TripOption[]>([]);
  const [selectedTrip, setSelectedTrip] = useState<string>("all");

  useEffect(() => {
    if (!user) return;
    (async () => {
      const { data } = await supabase
        .from("trips")
        .select("id, title")
        .order("start_date", { ascending: false });
      setTrips((data || []) as TripOption[]);
    })();
  }, [user]);

  return (
    <div className="mx-auto max-w-4xl px-6 py-10 pl-20">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="font-display text-3xl text-foreground" style={{ color: "#1e3a5f" }}>
            Activity Log
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Every change to your trips, steps, photos and sharing.
          </p>
        </div>
        <select
          value={selectedTrip}
          onChange={(e) => setSelectedTrip(e.target.value)}
          className="rounded-xl border border-border bg-card px-4 py-2 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-primary/40"
        >
          <option value="all">All trips</option>
          {trips.map((t) => (
            <option key={t.id} value={t.id}>{t.title}</option>
          ))}
        </select>
      </div>
      <ActivityLog tripId={selectedTrip === "all" ? null : selectedTrip} />
    </div>
  );
}
