import { useState, useEffect } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Loader2, ChevronLeft, Plus, Calendar, Map as MapIcon, FileText, Settings, Share2 } from "lucide-react";
import { toast } from "sonner";

// Components
import { TripTimeline } from "@/components/TripTimeline";
import { WorldMap } from "@/components/WorldMap";
import { AddEventForm } from "@/components/AddEventForm";
import { ItineraryImport } from "@/components/ItineraryImport";
import { EditTripDialog } from "@/components/EditTripDialog";

export default function TripDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();

  const [activeTab, setActiveTab] = useState<"timeline" | "map">("timeline");
  const [isAddEventOpen, setIsAddEventOpen] = useState(false);
  const [isImportOpen, setIsImportOpen] = useState(false);

  // Fetch Trip Details
  const {
    data: trip,
    isLoading: isTripLoading,
    refetch: refetchTrip,
  } = useQuery({
    queryKey: ["trip", id],
    queryFn: async () => {
      const { data, error } = await supabase.from("trips").select("*").eq("id", id).single();
      if (error) throw error;
      return data;
    },
    enabled: !!id,
  });

  // Fetch Trip Stops (Steps)
  const {
    data: steps,
    isLoading: isStepsLoading,
    refetch: refetchSteps,
  } = useQuery({
    queryKey: ["trip_steps", id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("trip_steps")
        .select("*")
        .eq("trip_id", id)
        .order("recorded_at", { ascending: true });
      if (error) throw error;
      return data;
    },
    enabled: !!id,
  });

  if (isTripLoading || isStepsLoading) {
    return (
      <div className="flex h-screen items-center justify-center bg-background">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!trip) {
    return (
      <div className="flex flex-col items-center justify-center h-screen gap-4">
        <p className="text-muted-foreground font-medium">Trip not found</p>
        <button onClick={() => navigate("/")} className="text-primary hover:underline">
          Return to Dashboard
        </button>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background pb-20 pt-24 px-4 sm:px-10">
      <div className="mx-auto max-w-5xl">
        {/* Navigation & Header */}
        <div className="mb-8">
          <button
            onClick={() => navigate("/")}
            className="group mb-6 flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
          >
            <ChevronLeft className="h-4 w-4 transition-transform group-hover:-translate-x-1" />
            Back to Dashboard
          </button>

          <div className="flex flex-col md:flex-row md:items-end justify-between gap-6">
            <div>
              <h1 className="text-4xl font-display font-bold text-foreground mb-2">{trip.title}</h1>
              <div className="flex items-center gap-4 text-muted-foreground">
                <div className="flex items-center gap-1.5 text-sm">
                  <Calendar className="h-4 w-4" />
                  <span>
                    {new Date(trip.start_date).toLocaleDateString()} — {new Date(trip.end_date).toLocaleDateString()}
                  </span>
                </div>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <EditTripDialog trip={trip} onUpdated={() => { refetchTrip(); }} />
              <button className="flex items-center gap-2 rounded-xl bg-secondary px-4 py-2.5 text-sm font-medium hover:bg-secondary/80 transition-colors">
                <Share2 className="h-4 w-4" /> Share
              </button>
            </div>
          </div>
        </div>

        {/* View Toggles & Actions */}
        <div className="mb-8 flex flex-col sm:flex-row items-center justify-between gap-4 border-b border-border pb-4">
          <div className="flex p-1 bg-muted rounded-xl">
            <button
              onClick={() => setActiveTab("timeline")}
              className={`flex items-center gap-2 px-4 py-1.5 text-sm font-medium rounded-lg transition-all ${activeTab === "timeline" ? "bg-background shadow-sm text-foreground" : "text-muted-foreground hover:text-foreground"}`}
            >
              <FileText className="h-4 w-4" /> Timeline
            </button>
            <button
              onClick={() => setActiveTab("map")}
              className={`flex items-center gap-2 px-4 py-1.5 text-sm font-medium rounded-lg transition-all ${activeTab === "map" ? "bg-background shadow-sm text-foreground" : "text-muted-foreground hover:text-foreground"}`}
            >
              <MapIcon className="h-4 w-4" /> Map
            </button>
          </div>

          <div className="flex items-center gap-3">
            <button
              onClick={() => setIsImportOpen(!isImportOpen)}
              className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-muted-foreground hover:text-foreground hover:bg-secondary/50 rounded-xl transition-all"
            >
              <Plus className="h-4 w-4" /> Import Itinerary
            </button>
            <button
              onClick={() => setIsAddEventOpen(true)}
              className="flex items-center gap-2 bg-primary text-primary-foreground px-4 py-2 rounded-xl text-sm font-medium hover:bg-primary/90 transition-all shadow-sm"
            >
              <Plus className="h-4 w-4" /> Add Stop
            </button>
          </div>
        </div>

        {/* Conditional Sections: Import & Add Event */}
        {isImportOpen && (
          <div className="mb-8 animate-in fade-in slide-in-from-top-4 duration-300">
            <div className="rounded-2xl border border-primary/20 bg-primary/5 p-6">
              <div className="flex items-center justify-between mb-4">
                <h3 className="font-semibold text-foreground">Import from Document</h3>
                <button onClick={() => setIsImportOpen(false)}>
                  <X className="h-4 w-4" />
                </button>
              </div>
              <ItineraryImport
                tripId={trip.id}
                onImportComplete={() => {
                  setIsImportOpen(false);
                  refetchSteps();
                }}
              />
            </div>
          </div>
        )}

        <AddEventForm
          tripId={trip.id}
          isOpen={isAddEventOpen}
          onClose={() => setIsAddEventOpen(false)}
          onEventAdded={refetchSteps}
        />

        {/* Main Content Area */}
        <div className="space-y-8">
          {activeTab === "timeline" ? (
            <TripTimeline steps={steps || []} onUpdated={refetchSteps} />
          ) : (
            <div className="h-[600px] w-full overflow-hidden rounded-3xl border border-border shadow-card">
              <WorldMap steps={steps || []} singleTrip={true} />
            </div>
          )}
        </div>

        {steps?.length === 0 && !isImportOpen && !isAddEventOpen && (
          <div className="mt-12 text-center py-20 rounded-3xl border-2 border-dashed border-border">
            <MapIcon className="h-12 w-12 text-muted-foreground/20 mx-auto mb-4" />
            <h3 className="text-lg font-medium text-foreground">No stops yet</h3>
            <p className="text-muted-foreground mb-6">
              Add your first stop or import an itinerary to start your timeline.
            </p>
            <div className="flex justify-center gap-4">
              <button onClick={() => setIsAddEventOpen(true)} className="text-primary font-medium">
                Add Manual Stop
              </button>
              <span className="text-muted-foreground">•</span>
              <button onClick={() => setIsImportOpen(true)} className="text-primary font-medium">
                Import Document
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// Add this helper for the close button in the import section
function X({ className }: { className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      <path d="M18 6 6 18" />
      <path d="m6 6 12 12" />
    </svg>
  );
}
