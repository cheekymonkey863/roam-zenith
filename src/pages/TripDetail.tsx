import { useParams, Link, useNavigate } from "react-router-dom";
import { useEffect, useState, useRef, useCallback } from "react";
import { ArrowLeft, Calendar, MapPin, Route, Navigation, Image as ImageIcon, FileText, Trash2, Loader2, Video } from "lucide-react";
import { getTripStatus, getTripStatusLabel, getTripStatusStyle, formatTripDateRange } from "@/lib/tripStatus";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useStepVisualTypes } from "@/hooks/useStepVisualTypes";
import { useResolvedCities } from "@/hooks/useResolvedCities";
import { TripTimeline } from "@/components/TripTimeline";

import { PhotoImport } from "@/components/PhotoImport";
import { ItineraryImport } from "@/components/ItineraryImport";
import { WorldMap, type WorldMapHandle } from "@/components/WorldMap";
import { AddEventForm } from "@/components/AddEventForm";
import { EditTripDialog } from "@/components/EditTripDialog";
import { DeleteTripDialog } from "@/components/DeleteTripDialog";
import { ShareTripDialog } from "@/components/ShareTripDialog";
import { Button } from "@/components/ui/button";
import { useIsMobile } from "@/hooks/use-mobile";
import type { Tables } from "@/integrations/supabase/types";

type Trip = Tables<"trips">;
type TripStep = Tables<"trip_steps">;

function formatDate(dateStr: string | null) {
  if (!dateStr) return "—";
  return new Date(dateStr).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
}

const TripDetail = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { user } = useAuth();
  const isMobile = useIsMobile();
  const [trip, setTrip] = useState<Trip | null>(null);
  const [steps, setSteps] = useState<TripStep[]>([]);
  const [loading, setLoading] = useState(true);
  const [isOwner, setIsOwner] = useState(false);
  const [showPhotoImport, setShowPhotoImport] = useState(false);
  const [showItineraryImport, setShowItineraryImport] = useState(false);
  const [activeStepId, setActiveStepId] = useState<string | null>(null);
  const [pendingVideoJobs, setPendingVideoJobs] = useState(0);
  const visualTypes = useStepVisualTypes(steps);
  const { cityCount, isResolvingCities } = useResolvedCities(steps);
  const mapRef = useRef<WorldMapHandle>(null);

  const fetchData = async () => {
    if (!user || !id) return;
    const tripRes = await supabase.from("trips").select("*").eq("id", id).single();
    const stepsRes = await supabase.from("trip_steps").select("*").eq("trip_id", id).order("sort_order", { ascending: true }).order("recorded_at", { ascending: true });
    setTrip(tripRes.data);
    setSteps(stepsRes.data || []);
    setIsOwner(tripRes.data?.user_id === user.id);
    setLoading(false);
  };

  // Fetch pending video analysis jobs count
  const fetchPendingJobs = async () => {
    if (!user || !id) return;
    const { count } = await supabase
      .from("video_analysis_jobs")
      .select("id", { count: "exact", head: true })
      .eq("user_id", user.id)
      .in("status", ["pending", "processing"]);
    setPendingVideoJobs(count ?? 0);
  };

  useEffect(() => {
    fetchData();
    fetchPendingJobs();
  }, [user, id]);

  // Subscribe to video analysis job updates via Realtime
  useEffect(() => {
    if (!user || !id) return;

    const channel = supabase
      .channel(`video-jobs-${id}`)
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "video_analysis_jobs",
        },
        (payload) => {
          const newStatus = (payload.new as { status: string }).status;
          if (newStatus === "complete" || newStatus === "failed") {
            fetchPendingJobs();
            if (newStatus === "complete") {
              fetchData(); // Refresh timeline with new AI metadata
            }
          }
        },
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [user, id]);

  const handleStepInView = useCallback((stepId: string) => {
    setActiveStepId(stepId);
    const step = steps.find((s) => s.id === stepId);
    if (step && mapRef.current) {
      mapRef.current.flyToStep(step);
      mapRef.current.highlightStep(stepId);
    }
  }, [steps]);

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

  const headerContent = (
    <>
      <div className="flex flex-col gap-4">
        <Link to="/" className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors">
          <ArrowLeft className="h-4 w-4" />
          Back to dashboard
        </Link>

        <div className="rounded-2xl bg-gradient-to-br from-primary/15 via-accent/10 to-secondary p-8">
          <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
            <h1 className="font-display text-3xl font-semibold text-foreground md:text-4xl">{trip.title}</h1>
            <div className="flex shrink-0 items-center gap-2 self-start">
              <span className={`rounded-full px-3 py-1 text-xs font-medium ${getTripStatusStyle(getTripStatus(trip.start_date, trip.end_date))}`}>
                {getTripStatusLabel(getTripStatus(trip.start_date, trip.end_date))}
              </span>
              {isOwner && <ShareTripDialog tripId={trip.id} tripTitle={trip.title} />}
              {isOwner && <EditTripDialog trip={trip} tripCountries={countries} onUpdated={fetchData} />}
              {isOwner && (
                <DeleteTripDialog
                  tripId={trip.id}
                  tripTitle={trip.title}
                  onDeleted={() => navigate("/")}
                  trigger={
                    <Button type="button" variant="secondary" size="icon" className="rounded-xl">
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  }
                />
              )}
            </div>
          </div>

          <div className="mt-4 flex flex-wrap items-center gap-4 text-sm text-muted-foreground">
            <span className="flex items-center gap-1.5">
              <Calendar className="h-4 w-4" />
              {formatTripDateRange(trip.start_date, trip.end_date)}
            </span>
            {countries.length > 0 && (
              <span className="flex items-center gap-1.5">
                <MapPin className="h-4 w-4" />
                {countries.join(", ")}
              </span>
            )}
            {!isResolvingCities && cityCount > 0 && (
              <span className="flex items-center gap-1.5">
                <Route className="h-4 w-4" />
                {cityCount} {cityCount === 1 ? "city" : "cities"}
              </span>
            )}
          </div>
        </div>
      </div>

      {pendingVideoJobs > 0 && (
        <div className="flex items-center gap-3 rounded-xl border border-primary/20 bg-primary/5 px-4 py-3 text-sm">
          <Loader2 className="h-4 w-4 animate-spin text-primary" />
          <Video className="h-4 w-4 text-primary" />
          <span className="text-foreground">
            <strong>{pendingVideoJobs}</strong> video{pendingVideoJobs === 1 ? "" : "s"} being analyzed in the background.
            You can safely close this page — we'll update your trip when done.
          </span>
        </div>
      )}

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
          Add from Photo / Video
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
          Add from Itinerary
        </button>
      </div>

      {showPhotoImport && (
        <PhotoImport
          tripId={trip.id}
          onImportComplete={fetchData}
          onCancel={() => setShowPhotoImport(false)}
          existingSteps={steps.map(s => ({ id: s.id, latitude: s.latitude, longitude: s.longitude, location_name: s.location_name, country: s.country, recorded_at: s.recorded_at, event_type: s.event_type, description: s.description }))}
        />
      )}

      {showItineraryImport && (
        <ItineraryImport
          tripId={trip.id}
          onImportComplete={fetchData}
          onCancel={() => setShowItineraryImport(false)}
        />
      )}
    </>
  );

  // Mobile: stacked layout with sticky map on top
  if (isMobile) {
    return (
      <div className="flex flex-col gap-8 py-8">
        {headerContent}

        {steps.length > 0 && (
          <div className="sticky top-0 z-20">
            <WorldMap
              ref={mapRef}
              steps={steps}
              singleTrip
              visualTypes={visualTypes}
              activeStepId={activeStepId}
              className="w-full overflow-hidden rounded-2xl shadow-card"
              style={{ height: 250 }}
            />
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
            <TripTimeline steps={steps} onUpdated={fetchData} visualTypes={visualTypes} onStepInView={handleStepInView} />
          )}
        </div>
      </div>
    );
  }

  // Desktop: side-by-side layout with sticky map
  return (
    <div className="flex flex-col gap-8 py-8">
      {headerContent}

      {steps.length > 0 ? (
        <div className="flex gap-8 relative">
          {/* Timeline - scrollable left side */}
          <div className="flex-1 min-w-0 flex flex-col gap-4 pb-12">
            <h2 className="font-display text-2xl font-semibold text-foreground">Journey Timeline</h2>
            <TripTimeline steps={steps} onUpdated={fetchData} visualTypes={visualTypes} onStepInView={handleStepInView} />
          </div>

          {/* Map - sticky right side */}
          <div className="w-[45%] shrink-0">
            <div className="sticky top-4" style={{ height: "calc(100vh - 2rem)" }}>
              <WorldMap
                ref={mapRef}
                steps={steps}
                singleTrip
                visualTypes={visualTypes}
                activeStepId={activeStepId}
                className="w-full h-full overflow-hidden rounded-2xl shadow-card"
              />
            </div>
          </div>
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          <h2 className="font-display text-2xl font-semibold text-foreground">Journey Timeline</h2>
          <div className="flex flex-col items-center gap-3 rounded-2xl bg-card p-12 shadow-card text-center">
            <Navigation className="h-8 w-8 text-muted-foreground/50" />
            <p className="text-muted-foreground">No steps yet. Start tracking or import photos to auto-detect locations.</p>
          </div>
        </div>
      )}
    </div>
  );
};

export default TripDetail;
