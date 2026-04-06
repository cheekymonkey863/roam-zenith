import { useParams, Link, useNavigate } from "react-router-dom";
import { useEffect, useState, useRef, useCallback } from "react";
import { ArrowLeft, Calendar, MapPin, Route, Navigation, Image as ImageIcon, FileText, Trash2, Loader2, Video, XCircle, Plus } from "lucide-react";
import { getTripStatus, getTripStatusLabel, getTripStatusStyle, formatTripDateRange } from "@/lib/tripStatus";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useStepVisualTypes } from "@/hooks/useStepVisualTypes";
import { useResolvedCities } from "@/hooks/useResolvedCities";
import { supabase as supabaseClient } from "@/integrations/supabase/client";
import { TripTimeline } from "@/components/TripTimeline";
import { AiProgressBanner } from "@/components/AiProgressBanner";
import { toast } from "sonner";

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
  const { user, loading: authLoading } = useAuth();
  const isMobile = useIsMobile();
  const [trip, setTrip] = useState<Trip | null>(null);
  const [steps, setSteps] = useState<TripStep[]>([]);
  const [loading, setLoading] = useState(true);
  const [isOwner, setIsOwner] = useState(false);
  const [showPhotoImport, setShowPhotoImport] = useState(false);
  const [showItineraryImport, setShowItineraryImport] = useState(false);
  const [showAddEvent, setShowAddEvent] = useState(false);
  const [activeStepId, setActiveStepId] = useState<string | null>(null);
  const [pendingVideoJobs, setPendingVideoJobs] = useState(0);
  const [importProgress, setImportProgress] = useState({ importing: false, current: 0, total: 0, phase: "upload" as "upload" | "sorting" });
  const [hasStagedFiles, setHasStagedFiles] = useState(false);
  const visualTypes = useStepVisualTypes(steps);
  const { cityCount, isResolvingCities } = useResolvedCities(steps);
  const mapRef = useRef<WorldMapHandle>(null);

  const fetchData = useCallback(async () => {
    if (!id) {
      setTrip(null);
      setSteps([]);
      setIsOwner(false);
      setLoading(false);
      return;
    }

    if (authLoading) {
      setLoading(true);
      return;
    }

    if (!user) {
      setTrip(null);
      setSteps([]);
      setIsOwner(false);
      setLoading(false);
      return;
    }

    setLoading(true);

    const [tripRes, stepsRes] = await Promise.all([
      supabase.from("trips").select("*").eq("id", id).single(),
      supabase
        .from("trip_steps")
        .select("*")
        .eq("trip_id", id)
        .order("sort_order", { ascending: true })
        .order("recorded_at", { ascending: true }),
    ]);

    if (tripRes.error) {
      if (tripRes.error.code === "PGRST116") {
        setTrip(null);
        setSteps([]);
        setIsOwner(false);
        setLoading(false);
        return;
      }

      console.error("Failed to fetch trip", tripRes.error);
      setTrip(null);
      setSteps([]);
      setIsOwner(false);
      setLoading(false);
      return;
    }

    if (stepsRes.error) {
      console.error("Failed to fetch trip steps", stepsRes.error);
      setSteps([]);
    } else {
      setSteps(stepsRes.data || []);
    }

    setTrip(tripRes.data);
    setIsOwner(tripRes.data.user_id === user.id);
    setLoading(false);
  }, [authLoading, id, user]);

  // Fetch pending video analysis jobs count
  const fetchPendingJobs = useCallback(async () => {
    if (authLoading || !user || !id) return;

    const { count } = await supabase
      .from("video_analysis_jobs")
      .select("id", { count: "exact", head: true })
      .eq("user_id", user.id)
      .in("status", ["pending", "processing"]);
    setPendingVideoJobs(count ?? 0);
  }, [authLoading, id, user]);

  useEffect(() => {
    if (authLoading) {
      setLoading(true);
      return;
    }

    void fetchData();
    void fetchPendingJobs();

    // Check for staged files to auto-show import panel
    if (user && id) {
      supabaseClient
        .from("pending_media_imports")
        .select("id", { count: "exact", head: true })
        .eq("trip_id", id)
        .eq("user_id", user.id)
        .then(({ count }) => {
          if (count && count > 0) {
            setHasStagedFiles(true);
            setShowPhotoImport(true);
          }
        });
    }
  }, [authLoading, fetchData, fetchPendingJobs, user, id]);

  // Subscribe to video analysis job updates via Realtime
  useEffect(() => {
    if (authLoading || !user || !id) return;

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
            void fetchPendingJobs();
            if (newStatus === "complete") {
              void fetchData();
            }
          }
        },
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [authLoading, fetchData, fetchPendingJobs, id, user]);

  // Subscribe to trip_steps updates for real-time enrichment
  useEffect(() => {
    if (authLoading || !user || !id) return;

    const channel = supabase
      .channel(`trip-steps-${id}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "trip_steps",
          filter: `trip_id=eq.${id}`,
        },
        () => {
          void fetchData();
        },
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [authLoading, fetchData, id, user]);

  const handleStepInView = useCallback((stepId: string) => {
    setActiveStepId(stepId);
    const step = steps.find((s) => s.id === stepId);
    if (step && mapRef.current) {
      mapRef.current.flyToStep(step);
      mapRef.current.highlightStep(stepId);
    }
  }, [steps]);

  const handleCancelVideoJobs = useCallback(async () => {
    if (!id || !user) return;
    await supabase
      .from("video_analysis_jobs")
      .update({ status: "failed", error: "Cancelled by user" })
      .eq("trip_id", id)
      .in("status", ["pending", "processing"]);
    setPendingVideoJobs(0);
    toast.success("Video analysis stopped");
  }, [id, user]);

  const handleClearAllSteps = useCallback(async () => {
    if (!id || !user) return;
    if (!confirm(`Delete all ${steps.length} stops and their photos from this trip? This cannot be undone.`)) return;

    const stepIds = steps.map((s) => s.id);
    if (stepIds.length === 0) return;

    try {
      // Cancel video jobs FIRST
      await supabase
        .from("video_analysis_jobs")
        .update({ status: "failed", error: "Cleared by user" })
        .eq("trip_id", id)
        .in("status", ["pending", "processing"]);
      // Delete photos, then steps
      await supabase.from("step_photos").delete().in("step_id", stepIds);
      await supabase.from("trip_steps").delete().in("id", stepIds);

      setPendingVideoJobs(0);
      toast.success("All stops cleared");
      void fetchData();
    } catch (err) {
      console.error("Clear all stops failed:", err);
      toast.error("Failed to clear stops");
    }
  }, [id, user, steps, fetchData]);

  if (authLoading || loading) return <div className="py-20 text-center text-muted-foreground">Loading...</div>;

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
          <span className="text-foreground flex-1">
            <strong>{pendingVideoJobs}</strong> video{pendingVideoJobs === 1 ? "" : "s"} being analyzed in the background.
          </span>
          <button
            onClick={handleCancelVideoJobs}
            className="flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors"
          >
            <XCircle className="h-3 w-3" />
            Stop Analysis
          </button>
        </div>
      )}

      {/* Button row — fixed height, never deforms */}
      <div className="flex flex-wrap gap-3">
        <button
          onClick={() => { setShowAddEvent(!showAddEvent); if (!showAddEvent) { setShowPhotoImport(false); setShowItineraryImport(false); } }}
          className={`flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-medium transition-colors ${
            showAddEvent
              ? "bg-secondary/80 text-secondary-foreground ring-2 ring-primary/20"
              : "bg-secondary text-secondary-foreground hover:bg-secondary/80"
          }`}
        >
          <Plus className="h-4 w-4" />
          Add Trip Stop
        </button>
        <button
          onClick={() => { setShowPhotoImport(!showPhotoImport); if (!showPhotoImport) { setShowItineraryImport(false); setShowAddEvent(false); } }}
          className={`flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-medium transition-colors ${
            showPhotoImport
              ? "bg-secondary/80 text-secondary-foreground ring-2 ring-primary/20"
              : "bg-secondary text-secondary-foreground hover:bg-secondary/80"
          }`}
        >
          <ImageIcon className="h-4 w-4" />
          Add from Photo / Video
        </button>
        <button
          onClick={() => { setShowItineraryImport(!showItineraryImport); if (!showItineraryImport) { setShowPhotoImport(false); setShowAddEvent(false); } }}
          className={`flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-medium transition-colors ${
            showItineraryImport
              ? "bg-secondary/80 text-secondary-foreground ring-2 ring-primary/20"
              : "bg-secondary text-secondary-foreground hover:bg-secondary/80"
          }`}
        >
          <FileText className="h-4 w-4" />
          Add from Itinerary
        </button>
        {steps.length > 0 && (
          <button
            onClick={handleClearAllSteps}
            className="flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-medium text-destructive bg-destructive/10 hover:bg-destructive/20 transition-colors"
          >
            <XCircle className="h-4 w-4" />
            Clear All Stops
          </button>
        )}
      </div>

      {/* Forms render BELOW the button row */}
      {showAddEvent && (
        <AddEventForm tripId={trip.id} onEventAdded={() => { fetchData(); setShowAddEvent(false); }} isOpen onClose={() => setShowAddEvent(false)} />
      )}

      {showPhotoImport && (
        <PhotoImport
          tripId={trip.id}
          onImportComplete={async () => {
            await fetchData();
            // 3-second delay so user sees the completed waterfall before unmount
            setTimeout(() => setShowPhotoImport(false), 3000);
          }}
          onCancel={() => setShowPhotoImport(false)}
          onProgressChange={setImportProgress}
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

  return (
    <div className="flex flex-col gap-8 py-8">
      {headerContent}

      {steps.length > 0 ? (
        <div className="flex flex-col">
          {/* Sticky Top Map */}
          <div className="sticky top-0 z-50 w-full h-[35vh] lg:h-[40vh] shadow-md bg-background">
            <WorldMap
              ref={mapRef}
              steps={steps}
              singleTrip
              visualTypes={visualTypes}
              activeStepId={activeStepId}
              className="w-full h-full overflow-hidden rounded-b-2xl"
            />
          </div>

          {/* Progress Banner */}
          <AiProgressBanner steps={steps} tripId={trip.id} onCancelled={fetchData} />

          {/* Timeline below map */}
          <div className="relative z-10 flex flex-col gap-4 px-4 py-8">
            <h2 className="max-w-3xl mx-auto w-full font-display text-2xl font-semibold text-foreground">Journey Timeline</h2>
            <div className="max-w-3xl mx-auto w-full">
              <TripTimeline steps={steps} onUpdated={fetchData} visualTypes={visualTypes} onStepInView={handleStepInView} />
            </div>
          </div>
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          <h2 className="font-display text-2xl font-semibold text-foreground">Journey Timeline</h2>
          <div className="flex flex-col items-center gap-3 rounded-2xl bg-card p-12 shadow-card text-center">
            <Navigation className="h-8 w-8 text-muted-foreground/50" />
            <p className="text-muted-foreground">No stops yet. Start tracking or import photos to auto-detect locations.</p>
          </div>
        </div>
      )}
    </div>
  );
};

export default TripDetail;
