import { MapPin } from "lucide-react";
import type { TripStep } from "@/data/trips";

function formatStepDate(dateStr: string) {
  return new Date(dateStr).toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

export function TripTimeline({ steps }: { steps: TripStep[] }) {
  return (
    <div className="relative">
      {/* Timeline line */}
      <div className="absolute left-5 top-0 h-full w-px bg-border" />

      <div className="flex flex-col gap-0">
        {steps.map((step, index) => (
          <div key={step.id} className="relative flex gap-5 pb-8 last:pb-0">
            {/* Dot */}
            <div className="relative z-10 flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-card shadow-card ring-4 ring-background">
              <MapPin className="h-4 w-4 text-primary" />
            </div>

            {/* Content */}
            <div className="flex flex-1 flex-col gap-2 rounded-2xl bg-card p-5 shadow-card">
              <div className="flex items-center justify-between gap-4">
                <div>
                  <h4 className="font-display text-lg font-semibold text-foreground">
                    {step.location}
                  </h4>
                  <p className="text-sm text-muted-foreground">{step.country}</p>
                </div>
                <span className="shrink-0 rounded-full bg-secondary px-3 py-1 text-xs font-medium text-secondary-foreground">
                  {formatStepDate(step.date)}
                </span>
              </div>

              <p className="text-sm leading-relaxed text-muted-foreground">
                {step.description}
              </p>

              <div className="mt-1 flex items-center gap-1 text-xs text-muted-foreground/60">
                <span>Step {index + 1}</span>
                <span>·</span>
                <span>{step.lat.toFixed(2)}°, {step.lng.toFixed(2)}°</span>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
