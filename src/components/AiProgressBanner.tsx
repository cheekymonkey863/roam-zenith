import { useEffect, useState } from "react";
import { CheckCircle, Sparkles } from "lucide-react";
import type { Tables } from "@/integrations/supabase/types";

type TripStep = Tables<"trip_steps">;

interface AiProgressBannerProps {
  steps: TripStep[];
}

export function AiProgressBanner({ steps }: AiProgressBannerProps) {
  const [showComplete, setShowComplete] = useState(false);
  const [hidden, setHidden] = useState(false);
  const [hadPending, setHadPending] = useState(false);

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

  if (hidden || (!hadPending && pendingCount === 0)) return null;

  if (showComplete) {
    return (
      <div className="sticky top-[35vh] lg:top-[40vh] z-45 mx-auto max-w-3xl w-full px-4">
        <div className="flex items-center gap-3 rounded-xl border border-green-500/30 bg-green-500/10 backdrop-blur-sm px-4 py-2.5 text-sm transition-all animate-in fade-in duration-300">
          <CheckCircle className="h-4 w-4 text-green-500 shrink-0" />
          <span className="text-foreground font-medium">Timeline Complete!</span>
        </div>
      </div>
    );
  }

  if (pendingCount > 0) {
    return (
      <div className="sticky top-[35vh] lg:top-[40vh] z-45 mx-auto max-w-3xl w-full px-4">
        <div className="flex items-center gap-3 rounded-xl border border-primary/20 bg-primary/5 backdrop-blur-sm px-4 py-2.5 text-sm">
          <Sparkles className="h-4 w-4 text-primary shrink-0 animate-pulse" />
          <span className="text-foreground">
            ✨ AI is detailing your journey...{" "}
            <strong>
              ({pendingCount} {pendingCount === 1 ? "stop" : "stops"} remaining)
            </strong>
          </span>
        </div>
      </div>
    );
  }

  return null;
}
