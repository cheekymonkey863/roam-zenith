import { useEffect, useState } from "react";
import { CheckCircle, Sparkles, X } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import type { Tables } from "@/integrations/supabase/types";

type TripStep = Tables<"trip_steps">;

interface AiProgressBannerProps {
  steps: TripStep[];
  tripId: string;
  onCancelled?: () => void;
}

export function AiProgressBanner({ steps, tripId, onCancelled }: AiProgressBannerProps) {
  const [showComplete, setShowComplete] = useState(false);
  const [hidden, setHidden] = useState(false);
  const [hadPending, setHadPending] = useState(false);
  const [cancelling, setCancelling] = useState(false);

  const pendingCount = steps.filter(
    (s) => !s.location_name || s.location_name.trim() === ""
  ).length;

  useEffect(() => {
    if (pendingCount > 0) {
      setHadPending(true);
      setShowComplete(false);
      setHidden(false);
    }
  }, [pendingCount]);

  useEffect(() => {
    if (hadPending && pendingCount === 0) {
      setShowComplete(true);
      const timer = setTimeout(() => {
        setShowComplete(false);
        setHidden(true);
      }, 3000);
      return () => clearTimeout(timer);
    }
  }, [hadPending, pendingCount]);

  const handleCancel = async () => {
    setCancelling(true);
    try {
      // Cancel stuck video analysis jobs
      await supabase
        .from("video_analysis_jobs")
        .update({ status: "failed", error: "Cancelled by user" })
        .eq("trip_id", tripId)
        .in("status", ["pending", "processing"]);

      // For steps missing location_name, set a fallback so they stop showing as pending
      const pendingStepIds = steps
        .filter((s) => !s.location_name || s.location_name.trim() === "")
        .map((s) => s.id);

      if (pendingStepIds.length > 0) {
        for (const stepId of pendingStepIds) {
          await supabase
            .from("trip_steps")
            .update({ location_name: "Unresolved location" })
            .eq("id", stepId);
        }
      }

      toast.success("Stuck jobs cancelled. You can re-import files.");
      setHidden(true);
      onCancelled?.();
    } catch {
      toast.error("Failed to cancel jobs");
    } finally {
      setCancelling(false);
    }
  };

  if (hidden || (!hadPending && pendingCount === 0)) return null;

  if (showComplete) {
    return (
      <div className="sticky top-[35vh] lg:top-[40vh] z-45 mx-auto max-w-3xl w-full px-4 pt-3">
        <div className="flex items-center gap-3 rounded-xl border border-green-500/30 bg-green-500/10 backdrop-blur-sm px-4 py-2.5 text-sm transition-all animate-in fade-in duration-300">
          <CheckCircle className="h-4 w-4 text-green-500 shrink-0" />
          <span className="text-foreground font-medium">Timeline Complete!</span>
        </div>
      </div>
    );
  }

  if (pendingCount > 0) {
    return (
      <div className="sticky top-[35vh] lg:top-[40vh] z-45 mx-auto max-w-3xl w-full px-4 pt-3">
        <div className="flex items-center gap-3 rounded-xl border border-primary/20 bg-primary/5 backdrop-blur-sm px-4 py-2.5 text-sm">
          <Sparkles className="h-4 w-4 text-primary shrink-0 animate-pulse" />
          <span className="text-foreground flex-1">
            ✨ Populating trip details...{" "}
            <strong>
              ({pendingCount} {pendingCount === 1 ? "stop" : "stops"} remaining)
            </strong>
          </span>
          <button
            onClick={handleCancel}
            disabled={cancelling}
            className="flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors disabled:opacity-50"
          >
            <X className="h-3 w-3" />
            {cancelling ? "Cancelling..." : "Cancel"}
          </button>
        </div>
      </div>
    );
  }

  return null;
}
