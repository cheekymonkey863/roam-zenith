import { useParams, Link } from "react-router-dom";
import { useEffect, useState } from "react";
import { ArrowLeft, Calendar, MapPin, Route, Navigation, Image as ImageIcon, FileText } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { TripTimeline } from "@/components/TripTimeline";
import { TrackingControl } from "@/components/TrackingControl";
import { PhotoImport } from "@/components/PhotoImport";
import { ItineraryImport } from "@/components/ItineraryImport";
import { WorldMap } from "@/components/WorldMap";
import { AddEventForm } from "@/components/AddEventForm";
import { EditTripDialog } from "@/components/EditTripDialog";
import type { Tables } from "@/integrations/supabase/types";

type Trip = Tables<"trips">;
type TripStep = Tables<"trip_steps">;

function formatDate(dateStr: string | null) {
  if (!dateStr) return "—";
  return new Date(dateStr).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
}

const TripDetail = () => {
  const { id } = useParams<{ id: string }>();
  const { user } = useAuth();
  const [trip, setTrip] = useState<Trip | null>(null);
  const [steps, setSteps] = useState<TripStep[]>([]);
  const [loading, setLoading] = useState(true);
  const [showPhotoImport, setShowPhotoImport] = useState(false);
  const [showItineraryImport, setShowItineraryImport] = useState(false);

  const fetchData = async () => {
    if (!user || !id) return;
    const [tripRes, stepsRes] = await Promise.all([
      supabase.from("trips").select("*").eq("id", id).eq("user_id", user.id).single(),
      supabase.from("trip_steps").select("*").eq("trip_id", id).eq("user_id", user.id).order("recorded_at", { ascending: true }),
    ]);
    setTrip(tripRes.data);
    setSteps(stepsRes.data || []);
    setLoading(false);
  };

  useEffect(() => {
    fetchData();
  }, [user, id]);

  if (loading) return <div className="py-20 text-center text-muted-foreground">Loading...</div>;

  if (!trip) {
    return (
      <div className="flex flex-col items-center gap-4 py-20 text-center">
        <h2 className="font-display text-2xl font-semibold text-foreground">Trip not found</h2>
        <Link to="/" className="text-primary hover:underline">Back to dashboard</Link>
      </div>
    );
  }

  const countries = [...new Set(steps.map((s) => s.country).filter(Boolean))];

  return (
    <div className="flex flex-col gap-8 py-8">
      <div className="flex flex-col gap-4">
        <Link to="/" className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors">
          <ArrowLeft className="h-4 w-4" />
          Back to dashboard
        </Link>

        <div className="rounded-2xl bg-gradient-to-br from-primary/15 via-accent/10 to-secondary p-8">
          <div className="flex items-start justify-between">
            <h1 className="font-display text-3xl font-semibold text-foreground md:text-4xl">{trip.title}</h1>
            <div className="flex items-center gap-2">
              {trip.is_active && (
                <span className="rounded-full bg-accent px-3 py-1 text-xs font-medium text-accent-foreground">Active</span>
              )}
              <EditTripDialog trip={trip} onUpdated={fetchData} />
            </div>
          </div>

          <div className="mt-4 flex flex-wrap items-center gap-4 text-sm text-muted-foreground">
            <span className="flex items-center gap-1.5">
              <Calendar className="h-4 w-4" />
              {formatDate(trip.start_date)}
            </span>
            {countries.length > 0 && (
              <span className="flex items-center gap-1.5">
                <MapPin className="h-4 w-4" />
                {countries.join(", ")}
              </span>
            )}
            <span className="flex items-center gap-1.5">
              <Route className="h-4 w-4" />
              {steps.length} steps
            </span>
          </div>
        </div>
      </div>

      {trip.is_active && <TrackingControl activeTripId={trip.id} />}

      <div className="flex flex-wrap gap-3">
        <AddEventForm tripId={trip.id} onEventAdded={fetchData} />
        <button
          onClick={() => { setShowPhotoImport(!showPhotoImport); if (!showPhotoImport) setShowItineraryImport(false); }}
          className={`flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-medium transition-colors ${
            showPhotoImport
              ? "bg-primary text-primary-foreground hover:bg-primary/90"
              : "bg-secondary text-secondary-foreground hover:bg-secondary/80"
          }`}
        >
          <ImageIcon className="h-4 w-4" />
          Import Photos
        </button>
        <button
          onClick={() => { setShowItineraryImport(!showItineraryImport); if (!showItineraryImport) setShowPhotoImport(false); }}
          className={`flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-medium transition-colors ${
            showItineraryImport
              ? "bg-primary text-primary-foreground hover:bg-primary/90"
              : "bg-secondary text-secondary-foreground hover:bg-secondary/80"
          }`}
        >
          <FileText className="h-4 w-4" />
          Import Itinerary
        </button>
      </div>

      {showPhotoImport && (
        <PhotoImport
          tripId={trip.id}
          onImportComplete={fetchData}
          onCancel={() => setShowPhotoImport(false)}
        />
      )}

      {showItineraryImport && (
        <ItineraryImport
          tripId={trip.id}
          onImportComplete={fetchData}
          onCancel={() => setShowItineraryImport(false)}
        />
      )}

      {steps.length > 0 && (
        <div className="flex flex-col gap-4">
          <h2 className="font-display text-2xl font-semibold text-foreground">Route Map</h2>
          <WorldMap steps={steps} singleTrip />
        </div>
      )}

      <div className="flex flex-col gap-4">
        <h2 className="font-display text-2xl font-semibold text-foreground">Journey Timeline</h2>
        {steps.length === 0 ? (
          <div className="flex flex-col items-center gap-3 rounded-2xl bg-card p-12 shadow-card text-center">
            <Navigation className="h-8 w-8 text-muted-foreground/50" />
            <p className="text-muted-foreground">No steps yet. Start tracking or import photos to auto-detect locations.</p>
          </div>
        ) : (
          <TripTimeline steps={steps} onUpdated={fetchData} />
        )}
      </div>
    </div>
  );
};

export default TripDetail;
