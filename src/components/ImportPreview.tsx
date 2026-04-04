import { useState } from "react";
import { Check, ChevronDown, ChevronUp, X, MapPin, Image as ImageIcon } from "lucide-react";
import { getEventType } from "@/lib/eventTypes";
import type { PhotoExifData } from "@/lib/exif";
import { PendingMediaGallery } from "@/components/PendingMediaGallery";

interface PendingStep {
  key: string;
  locationName: string;
  country: string;
  eventType: string;
  description: string;
  photos: PhotoExifData[];
}

interface ImportPreviewProps {
  steps: PendingStep[];
  onClear: () => void;
  onMoveMedia: (sourceStepKey: string, targetStepKey: string, photoIds: string[]) => void;
  onRemoveMedia: (stepKey: string, photoIds: string[]) => void;
}

export function ImportPreview({ steps, onClear, onMoveMedia, onRemoveMedia }: ImportPreviewProps) {
  const [expanded, setExpanded] = useState(true);
  const totalMedia = steps.reduce((n, s) => n + s.photos.length, 0);
  const stepTargets = steps.map((step) => ({ id: step.key, label: step.locationName || "Untitled stop" }));

  return (
    <div className="rounded-xl border border-primary/20 bg-primary/5 overflow-hidden">
      <div className="flex items-center gap-2 px-4 py-2.5">
        <button
          type="button"
          onClick={() => setExpanded(!expanded)}
          className="flex flex-1 items-center justify-between gap-3 text-left"
        >
          <div className="flex items-center gap-2 text-sm">
            <Check className="h-4 w-4 text-primary" />
              <span className="text-foreground font-medium">
              {steps.length} location{steps.length !== 1 ? "s" : ""}, {totalMedia} media file{totalMedia !== 1 ? "s" : ""} ready
            </span>
          </div>
          {expanded ? (
            <ChevronUp className="h-4 w-4 text-muted-foreground" />
          ) : (
            <ChevronDown className="h-4 w-4 text-muted-foreground" />
          )}
        </button>

        <button
          type="button"
          onClick={onClear}
          className="ml-1 text-muted-foreground hover:text-foreground"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>

      {/* Expanded location list */}
      {expanded && (
        <div className="border-t border-primary/10 px-3 pb-3 pt-2 flex flex-col gap-2.5 max-h-[400px] overflow-y-auto">
          {steps.map((step) => {
            const eventInfo = getEventType(step.eventType);
            const EventIcon = eventInfo?.icon;
            return (
              <div
                key={step.key}
                className="rounded-lg border border-border bg-background p-3 flex flex-col gap-2"
              >
                <div className="flex items-start gap-2.5">
                  {EventIcon && (
                    <div className="mt-0.5 flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
                      <EventIcon className="h-3.5 w-3.5" />
                    </div>
                  )}
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-foreground truncate">
                      {step.locationName}
                    </p>
                    <div className="flex items-center gap-2 text-xs text-muted-foreground mt-0.5">
                      {step.country && step.country !== "Unknown" && (
                        <span className="flex items-center gap-0.5">
                          <MapPin className="h-3 w-3" />
                          {step.country}
                        </span>
                      )}
                      {eventInfo && (
                        <span className="rounded-full bg-muted px-2 py-0.5">
                          {eventInfo.label}
                        </span>
                      )}
                      <span className="flex items-center gap-0.5">
                        <ImageIcon className="h-3 w-3" />
                        {step.photos.length}
                      </span>
                    </div>
                  </div>
                </div>
                 <PendingMediaGallery
                   photos={step.photos}
                   stepId={step.key}
                   allSteps={stepTargets}
                   onMove={onMoveMedia}
                   onRemove={onRemoveMedia}
                 />
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
