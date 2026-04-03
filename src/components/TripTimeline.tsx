import { useEffect, useState } from "react";
import { MapPin, Image as ImageIcon } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { EditStepDialog } from "@/components/EditStepDialog";
import type { Tables } from "@/integrations/supabase/types";

type TripStep = Tables<"trip_steps">;
type StepPhoto = Tables<"step_photos">;

function formatStepDate(dateStr: string) {
  return new Date(dateStr).toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

export function TripTimeline({ steps, onUpdated }: { steps: TripStep[]; onUpdated: () => void }) {
  const [photosByStep, setPhotosByStep] = useState<Record<string, StepPhoto[]>>({});

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

  return (
    <div className="relative">
      <div className="absolute left-5 top-0 h-full w-px bg-border" />
      <div className="flex flex-col gap-0">
        {steps.map((step, index) => {
          const photos = photosByStep[step.id] || [];
          return (
            <div key={step.id} className="relative flex gap-5 pb-8 last:pb-0">
              <div className="relative z-10 flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-card shadow-card ring-4 ring-background">
                <MapPin className="h-4 w-4 text-primary" />
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
                  </div>
                </div>
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
                  <span className="rounded bg-secondary px-1.5 py-0.5 text-[10px]">{step.source}</span>
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
