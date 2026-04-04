import { useEffect, useRef, useState } from "react";
import { ArrowRightLeft, Check, ChevronLeft, ChevronRight, Film, Play, Trash2, X } from "lucide-react";
import type { PhotoExifData } from "@/lib/exif";
import { cn } from "@/lib/utils";

function useObjectUrl(file?: File | null): string | null {
  const urlRef = useRef<string | null>(null);
  const prevFileRef = useRef<File | null>(null);

  if (file !== prevFileRef.current) {
    if (urlRef.current) URL.revokeObjectURL(urlRef.current);
    urlRef.current = file ? URL.createObjectURL(file) : null;
    prevFileRef.current = file ?? null;
  }

  useEffect(() => {
    return () => {
      if (urlRef.current) URL.revokeObjectURL(urlRef.current);
    };
  }, []);

  return urlRef.current;
}

function PendingMediaLightbox({
  photos,
  initialIndex,
  onClose,
}: {
  photos: PhotoExifData[];
  initialIndex: number;
  onClose: () => void;
}) {
  const [index, setIndex] = useState(initialIndex);
  const photo = photos[index];
  const fileUrl = useObjectUrl(photo ? (photo.uploadFile ?? photo.file) : null);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
      if (photos.length <= 1) return;

      if (event.key === "ArrowLeft") {
        setIndex((current) => (current > 0 ? current - 1 : photos.length - 1));
      }

      if (event.key === "ArrowRight") {
        setIndex((current) => (current < photos.length - 1 ? current + 1 : 0));
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose, photos.length]);

  if (!photo) return null;

  const isVideo = photo.file.type.startsWith("video/");
  const imageSrc = fileUrl ?? photo.analysisImage ?? photo.thumbnail ?? null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/90 p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <button
        type="button"
        onClick={onClose}
        className="absolute right-4 top-4 z-10 rounded-full bg-black/50 p-2 text-white transition-colors hover:bg-black/70"
      >
        <X className="h-5 w-5" />
      </button>

      {photos.length > 1 && (
        <>
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              setIndex((current) => (current > 0 ? current - 1 : photos.length - 1));
            }}
            className="absolute left-4 z-10 rounded-full bg-black/50 p-2 text-white transition-colors hover:bg-black/70"
          >
            <ChevronLeft className="h-6 w-6" />
          </button>
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              setIndex((current) => (current < photos.length - 1 ? current + 1 : 0));
            }}
            className="absolute right-16 z-10 rounded-full bg-black/50 p-2 text-white transition-colors hover:bg-black/70"
          >
            <ChevronRight className="h-6 w-6" />
          </button>
        </>
      )}

      <div onClick={(event) => event.stopPropagation()} className="max-h-[92vh] max-w-[96vw]">
        {isVideo && fileUrl ? (
          <video
            key={photo.captionId}
            src={fileUrl}
            poster={photo.thumbnail || photo.analysisImage || undefined}
            controls
            autoPlay
            playsInline
            className="max-h-[92vh] max-w-[96vw] rounded-xl shadow-2xl"
          />
        ) : imageSrc ? (
          <img
            src={imageSrc}
            alt={photo.caption || photo.file.name}
            className="max-h-[92vh] max-w-[96vw] rounded-xl object-contain shadow-2xl"
          />
        ) : (
          <div className="flex h-[60vh] w-[60vw] items-center justify-center rounded-xl bg-muted text-sm text-muted-foreground shadow-2xl">
            Preview unavailable
          </div>
        )}
      </div>

      {photos.length > 1 && (
        <div className="absolute bottom-4 text-sm text-white/70">
          {index + 1} / {photos.length}
        </div>
      )}
    </div>
  );
}

function MovePicker({
  steps,
  selectedCount,
  onMove,
  onCancel,
}: {
  steps: Array<{ id: string; label: string }>;
  selectedCount: number;
  onMove: (targetStepId: string) => void;
  onCancel: () => void;
}) {
  return (
    <div className="rounded-lg border border-border bg-popover p-3 shadow-lg">
      <p className="mb-2 text-xs font-medium text-muted-foreground">
        Move {selectedCount} file{selectedCount === 1 ? "" : "s"} to:
      </p>
      <div className="flex max-h-40 flex-col gap-1 overflow-y-auto">
        {steps.map((step) => (
          <button
            key={step.id}
            type="button"
            onClick={() => onMove(step.id)}
            className="rounded-md px-3 py-1.5 text-left text-sm transition-colors hover:bg-accent"
          >
            {step.label}
          </button>
        ))}
      </div>
      <button
        type="button"
        onClick={onCancel}
        className="mt-2 w-full rounded-md border border-border px-3 py-1 text-xs text-muted-foreground transition-colors hover:bg-secondary"
      >
        Cancel
      </button>
    </div>
  );
}

function PendingMediaThumbnail({
  photo,
  isSelectMode,
  isSelected,
  onClick,
}: {
  photo: PhotoExifData;
  isSelectMode: boolean;
  isSelected: boolean;
  onClick: () => void;
}) {
  const isVideo = photo.file.type.startsWith("video/");
  const previewImage = photo.thumbnail || photo.analysisImage || null;
  // For images without a preview, create an object URL from the file
  const fileUrl = useObjectUrl(!isVideo && !previewImage ? (photo.uploadFile ?? photo.file) : null);
  const imageSrc = !isVideo ? previewImage || fileUrl : previewImage;

  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "group relative h-20 w-20 overflow-hidden rounded-lg border border-border bg-muted transition-all",
        isSelected && "ring-2 ring-primary ring-offset-1 ring-offset-background",
      )}
    >
      {isVideo ? (
        imageSrc ? (
          <img src={imageSrc} alt={photo.caption || photo.file.name} className="h-full w-full object-cover" />
        ) : (
          <div className="flex h-full w-full flex-col items-center justify-center gap-1 bg-muted">
            <Film className="h-5 w-5 text-muted-foreground" />
            <span className="max-w-[70px] truncate text-[9px] text-muted-foreground">{photo.file.name}</span>
          </div>
        )
      ) : imageSrc ? (
        <img src={imageSrc} alt={photo.caption || photo.file.name} className="h-full w-full object-cover" />
      ) : null}

      {isVideo && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <div className="flex h-7 w-7 items-center justify-center rounded-full bg-black/55 backdrop-blur-sm">
            <Play className="ml-0.5 h-3.5 w-3.5 text-white" fill="white" />
          </div>
        </div>
      )}

      {isSelectMode ? (
        <div
          className={cn(
            "absolute left-1 top-1 flex h-5 w-5 items-center justify-center rounded-sm border-2 transition-colors",
            isSelected ? "border-primary bg-primary" : "border-white/70 bg-black/30",
          )}
        >
          {isSelected && <Check className="h-3 w-3 text-primary-foreground" />}
        </div>
      ) : (
        <div className="absolute inset-0 bg-black/0 transition-colors group-hover:bg-black/10" />
      )}
    </button>
  );
}

interface PendingMediaGalleryProps {
  photos: PhotoExifData[];
  stepId: string;
  allSteps: Array<{ id: string; label: string }>;
  onMove: (sourceStepId: string, targetStepId: string, photoIds: string[]) => void;
  onRemove: (stepId: string, photoIds: string[]) => void;
}

export function PendingMediaGallery({ photos, stepId, allSteps, onMove, onRemove }: PendingMediaGalleryProps) {
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [selectMode, setSelectMode] = useState(false);
  const [showMovePicker, setShowMovePicker] = useState(false);

  useEffect(() => {
    const validIds = new Set(photos.map((photo) => photo.captionId));
    setSelected((current) => {
      const next = new Set(Array.from(current).filter((id) => validIds.has(id)));
      return next.size === current.size ? current : next;
    });
  }, [photos]);

  const targets = allSteps.filter((step) => step.id !== stepId);
  const isSelecting = selectMode || selected.size > 0;

  const toggleSelect = (id: string) => {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const resetSelection = () => {
    setSelected(new Set());
    setSelectMode(false);
    setShowMovePicker(false);
  };

  const handleRemove = () => {
    if (selected.size === 0) return;
    if (!window.confirm(`Remove ${selected.size} file${selected.size === 1 ? "" : "s"} from this import?`)) return;
    onRemove(stepId, Array.from(selected));
    resetSelection();
  };

  const handleMove = (targetStepId: string) => {
    if (selected.size === 0) return;
    onMove(stepId, targetStepId, Array.from(selected));
    resetSelection();
  };

  if (photos.length === 0) return null;

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2 text-xs">
        {!isSelecting ? (
          <>
            <button
              type="button"
              onClick={() => setSelectMode(true)}
              className="rounded-md bg-secondary px-2.5 py-1 font-medium text-secondary-foreground transition-colors hover:bg-secondary/80"
            >
              Select media
            </button>
            <span className="text-muted-foreground">Click a thumbnail to open it full-size or play the video</span>
          </>
        ) : (
          <>
            <span className="font-medium text-muted-foreground">{selected.size} selected</span>
            <button
              type="button"
              onClick={() => {
                if (selected.size === photos.length) setSelected(new Set());
                else setSelected(new Set(photos.map((photo) => photo.captionId)));
              }}
              className="rounded px-2 py-0.5 text-muted-foreground transition-colors hover:bg-secondary"
            >
              {selected.size === photos.length ? "Deselect all" : "Select all"}
            </button>
            {targets.length > 0 && (
              <button
                type="button"
                disabled={selected.size === 0}
                onClick={() => setShowMovePicker((current) => !current)}
                className="flex items-center gap-1 rounded-md bg-secondary px-2.5 py-1 font-medium text-secondary-foreground transition-colors hover:bg-secondary/80 disabled:opacity-50"
              >
                <ArrowRightLeft className="h-3 w-3" /> Move
              </button>
            )}
            <button
              type="button"
              disabled={selected.size === 0}
              onClick={handleRemove}
              className="flex items-center gap-1 rounded-md bg-destructive px-2.5 py-1 font-medium text-destructive-foreground transition-colors hover:bg-destructive/90 disabled:opacity-50"
            >
              <Trash2 className="h-3 w-3" /> Remove
            </button>
            <button
              type="button"
              onClick={resetSelection}
              className="rounded px-2 py-0.5 text-muted-foreground transition-colors hover:bg-secondary"
            >
              Cancel
            </button>
          </>
        )}
      </div>

      {showMovePicker && targets.length > 0 && selected.size > 0 && (
        <MovePicker
          steps={targets}
          selectedCount={selected.size}
          onMove={handleMove}
          onCancel={() => setShowMovePicker(false)}
        />
      )}

      <div className="flex flex-wrap gap-2">
        {photos.map((photo, index) => (
          <PendingMediaThumbnail
            key={photo.captionId}
            photo={photo}
            isSelectMode={isSelecting}
            isSelected={selected.has(photo.captionId)}
            onClick={() => {
              if (isSelecting) toggleSelect(photo.captionId);
              else setLightboxIndex(index);
            }}
          />
        ))}
      </div>

      {lightboxIndex !== null && (
        <PendingMediaLightbox
          photos={photos}
          initialIndex={lightboxIndex}
          onClose={() => setLightboxIndex(null)}
        />
      )}
    </div>
  );
}