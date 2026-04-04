import { useEffect, useState } from "react";
import { MapPin, Image as ImageIcon, Trash2, Plane, Hotel, Utensils, Camera, ArrowRightLeft, Flag, CircleDot } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { EditStepDialog } from "@/components/EditStepDialog";
import { toast } from "sonner";
import type { Tables } from "@/integrations/supabase/types";

type TripStep = Tables<"trip_steps">;
type StepPhoto = Tables<"step_photos">;

const EVENT_TYPE_CONFIG: Record<string, { icon: React.ElementType; bg: string; text: string }> = {
  arrival: { icon: Plane, bg: "bg-blue-500", text: "text-white" },
  departure: { icon: Plane, bg: "bg-blue-500", text: "text-white" },
  accommodation: { icon: Hotel, bg: "bg-violet-500", text: "text-white" },
  transport: { icon: ArrowRightLeft, bg: "bg-blue-500", text: "text-white" },
  activity: { icon: Flag, bg: "bg-primary", text: "text-primary-foreground" },
  food: { icon: Utensils, bg: "bg-orange-500", text: "text-white" },
  sightseeing: { icon: Camera, bg: "bg-emerald-500", text: "text-white" },
  border_crossing: { icon: MapPin, bg: "bg-amber-500", text: "text-white" },
  other: { icon: CircleDot, bg: "bg-muted", text: "text-muted-foreground" },
};
const DEFAULT_CONFIG = { icon: MapPin, bg: "bg-card", text: "text-primary" };

function formatStepDate(dateStr: string) {
  return new Date(dateStr).toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

export function TripTimeline({ steps, onUpdated }: { steps: TripStep[]; onUpdated: () => void }) {
  const [photosByStep, setPhotosByStep] = useState<Record<string, StepPhoto[]>>({});
  const [deletingId, setDeletingId] = useState<string | null>(null);

  useEffect(() => {
    const stepIds = steps.map((s) => s.id);
    if (stepIds.length === 0) return;

    supabase
      .from("step_photos")
      .select("*")
      .in("step_id", stepIds)
      .then(({ data }) => {
        if (!data) return;
        const grouped: Record<string, StepPhoto[]> = {};
        for (const photo of data) {
          if (!photo.step_id) continue;
          if (!grouped[photo.step_id]) grouped[photo.step_id] = [];
          grouped[photo.step_id].push(photo);
        }
        setPhotosByStep(grouped);
      });
  }, [steps]);

  const getPhotoUrl = (photo: StepPhoto) => {
    const { data } = supabase.storage.from("trip-photos").getPublicUrl(photo.storage_path);
    return data.publicUrl;
  };

  const handleDelete = async (stepId: string) => {
    if (!confirm("Delete this activity? This cannot be undone.")) return;
    setDeletingId(stepId);
    const { error } = await supabase.from("trip_steps").delete().eq("id", stepId);
    if (error) { toast.error("Failed to delete activity"); }
    else { toast.success("Activity deleted"); onUpdated(); }
    setDeletingId(null);
  };

  return (
    <div className="relative">
      <div className="absolute left-5 top-0 h-full w-px bg-border" />
      <div className="flex flex-col gap-0">
        {steps.map((step, index) => {
          const photos = photosByStep[step.id] || [];
          const config = EVENT_TYPE_CONFIG[step.event_type] || DEFAULT_CONFIG;
          const StepIcon = config.icon;
          return (
            <div key={step.id} className="relative flex gap-5 pb-8 last:pb-0">
              <div className={`relative z-10 flex h-10 w-10 shrink-0 items-center justify-center rounded-full shadow-card ring-4 ring-background ${config.bg}`}>
                <StepIcon className={`h-4 w-4 ${config.text}`} />
              </div>
              <div className="flex flex-1 flex-col gap-2 rounded-2xl bg-card p-5 shadow-card">
                <div className="flex items-center justify-between gap-4">
                  <div>
                    <h4 className="font-display text-lg font-semibold text-foreground">
                      {step.location_name || "Unknown Location"}
                    </h4>
                    {step.country && <p className="text-sm text-muted-foreground">{step.country}</p>}
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="shrink-0 rounded-full bg-secondary px-3 py-1 text-xs font-medium text-secondary-foreground">
                      {formatStepDate(step.recorded_at)}
                    </span>
                    <EditStepDialog step={step} onUpdated={onUpdated} />
                    <button
                      onClick={() => handleDelete(step.id)}
                      disabled={deletingId === step.id}
                      className="rounded-lg p-1 text-muted-foreground hover:text-destructive transition-colors disabled:opacity-50"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>
                {step.description && (
                  <p className="text-sm leading-relaxed text-foreground">{step.description}</p>
                )}
                {step.notes && (
                  <p className="text-sm leading-relaxed text-muted-foreground">{step.notes}</p>
                )}

                {photos.length > 0 && (
                  <div className="mt-2 flex gap-2 overflow-x-auto">
                    {photos.slice(0, 6).map((photo) => (
                      <img
                        key={photo.id}
                        src={getPhotoUrl(photo)}
                        alt={photo.file_name}
                        className="h-20 w-20 shrink-0 rounded-lg object-cover"
                      />
                    ))}
                    {photos.length > 6 && (
                      <div className="flex h-20 w-20 shrink-0 items-center justify-center rounded-lg bg-muted text-xs font-medium text-muted-foreground">
                        +{photos.length - 6}
                      </div>
                    )}
                  </div>
                )}

                <div className="mt-1 flex items-center gap-2 text-xs text-muted-foreground/60">
                  <span>Step {index + 1}</span>
                  <span>·</span>
                  <span>{step.latitude.toFixed(2)}°, {step.longitude.toFixed(2)}°</span>
                  <span>·</span>
                  <span className="rounded bg-secondary px-1.5 py-0.5 text-[10px]">{step.event_type}</span>
                  {photos.length > 0 && (
                    <>
                      <span>·</span>
                      <span className="flex items-center gap-1">
                        <ImageIcon className="h-3 w-3" />
                        {photos.length}
                      </span>
                    </>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
