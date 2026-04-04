import { useState } from "react";
import { Check, ChevronDown, ChevronUp, X, MapPin, Image as ImageIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { getEventType } from "@/lib/eventTypes";
import type { PhotoExifData } from "@/lib/exif";

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
}

function MediaLightbox({ src, onClose }: { src: string; onClose: () => void }) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm"
      onClick={onClose}
    >
      <button
        type="button"
        onClick={onClose}
        className="absolute right-4 top-4 rounded-full bg-black/50 p-2 text-white hover:bg-black/70"
      >
        <X className="h-5 w-5" />
      </button>
      <img
        src={src}
        alt="Preview"
        className="max-h-[85vh] max-w-[90vw] rounded-lg object-contain"
        onClick={(e) => e.stopPropagation()}
      />
    </div>
  );
}

function StepThumbnails({ photos }: { photos: PhotoExifData[] }) {
  const [lightboxSrc, setLightboxSrc] = useState<string | null>(null);
  const previews = photos
    .filter((p) => p.thumbnail || p.analysisImage)
    .slice(0, 6);
  const remaining = photos.length - previews.length;

  if (previews.length === 0) return null;

  return (
    <>
      <div className="flex gap-1.5 overflow-x-auto py-1">
        {previews.map((photo) => {
          const src = photo.thumbnail || photo.analysisImage || "";
          return (
            <button
              key={photo.captionId}
              type="button"
              onClick={() => setLightboxSrc(src)}
              className="group relative h-14 w-14 flex-shrink-0 overflow-hidden rounded-lg border border-border transition-all hover:border-primary hover:ring-2 hover:ring-primary/30"
            >
              <img
                src={src}
                alt={photo.caption || photo.file.name}
                className="h-full w-full object-cover"
              />
              {photo.file.type.startsWith("video/") && (
                <div className="absolute inset-0 flex items-center justify-center bg-black/20">
                  <div className="h-4 w-4 rounded-full bg-white/80 pl-0.5 text-[8px] leading-4 text-black">▶</div>
                </div>
              )}
            </button>
          );
        })}
        {remaining > 0 && (
          <div className="flex h-14 w-14 flex-shrink-0 items-center justify-center rounded-lg border border-border bg-muted text-xs font-medium text-muted-foreground">
            +{remaining}
          </div>
        )}
      </div>
      {lightboxSrc && <MediaLightbox src={lightboxSrc} onClose={() => setLightboxSrc(null)} />}
    </>
  );
}

export function ImportPreview({ steps, onClear }: ImportPreviewProps) {
  const [expanded, setExpanded] = useState(false);
  const totalMedia = steps.reduce((n, s) => n + s.photos.length, 0);

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
                <StepThumbnails photos={step.photos} />
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
