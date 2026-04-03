import { Navigation, Square } from "lucide-react";
import { useLocationTracking } from "@/hooks/useLocationTracking";

interface TrackingControlProps {
  activeTripId: string | null;
}

export function TrackingControl({ activeTripId }: TrackingControlProps) {
  const { isTracking, lastPosition, error, startTracking, stopTracking } = useLocationTracking(activeTripId);

  if (!activeTripId) return null;

  return (
    <div className="flex items-center gap-3 rounded-2xl bg-card p-4 shadow-card">
      <button
        onClick={isTracking ? stopTracking : startTracking}
        className={`flex items-center gap-2 rounded-xl px-4 py-2 text-sm font-medium transition-colors ${
          isTracking
            ? "bg-destructive text-destructive-foreground hover:bg-destructive/90"
            : "bg-accent text-accent-foreground hover:bg-accent/90"
        }`}
      >
        {isTracking ? (
          <>
            <Square className="h-3.5 w-3.5" />
            Stop Tracking
          </>
        ) : (
          <>
            <Navigation className="h-3.5 w-3.5" />
            Start Tracking
          </>
        )}
      </button>

      {isTracking && (
        <div className="flex items-center gap-2">
          <div className="h-2 w-2 animate-pulse rounded-full bg-accent" />
          <span className="text-xs text-muted-foreground">
            {lastPosition
              ? `${lastPosition.lat.toFixed(4)}°, ${lastPosition.lng.toFixed(4)}°`
              : "Acquiring location..."}
          </span>
        </div>
      )}

      {error && <span className="text-xs text-destructive">{error}</span>}
    </div>
  );
}
