import { useState, useRef } from "react";
import { X, Play, Trash2, ArrowRightLeft, Check, ChevronLeft, ChevronRight } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { getStoredPreviewThumbnail } from "@/lib/mediaMetadata";
import type { Tables } from "@/integrations/supabase/types";

type StepPhoto = Tables<"step_photos">;

const VIDEO_EXTENSIONS = new Set(["mp4", "mov", "webm", "mkv", "avi", "m4v", "qt", "3gp"]);

function isVideoFile(fileName: string): boolean {
  const ext = fileName.split(".").pop()?.toLowerCase() ?? "";
  return VIDEO_EXTENSIONS.has(ext);
}

function getPhotoUrl(photo: StepPhoto) {
  const { data } = supabase.storage.from("trip-photos").getPublicUrl(photo.storage_path);
  return data.publicUrl;
}

/* ── Lightbox ────────────────────────────────────────────── */

function MediaLightbox({
  photos,
  initialIndex,
  onClose,
}: {
  photos: StepPhoto[];
  initialIndex: number;
  onClose: () => void;
}) {
  const [index, setIndex] = useState(initialIndex);
  const photo = photos[index];
  if (!photo) return null;

  const url = getPhotoUrl(photo);
  const isVideo = isVideoFile(photo.file_name);

  const prev = () => setIndex((i) => (i > 0 ? i - 1 : photos.length - 1));
  const next = () => setIndex((i) => (i < photos.length - 1 ? i + 1 : 0));

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/90 p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <button
        type="button"
        onClick={onClose}
        className="absolute right-4 top-4 z-10 rounded-full bg-black/50 p-2 text-white hover:bg-black/70"
      >
        <X className="h-5 w-5" />
      </button>

      {photos.length > 1 && (
        <>
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); prev(); }}
            className="absolute left-4 z-10 rounded-full bg-black/50 p-2 text-white hover:bg-black/70"
          >
            <ChevronLeft className="h-6 w-6" />
          </button>
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); next(); }}
            className="absolute right-16 z-10 rounded-full bg-black/50 p-2 text-white hover:bg-black/70"
          >
            <ChevronRight className="h-6 w-6" />
          </button>
        </>
      )}

      <div onClick={(e) => e.stopPropagation()} className="max-h-[92vh] max-w-[96vw]">
        {isVideo ? (
          <video
            key={photo.id}
            src={url}
            controls
            autoPlay
            className="max-h-[92vh] max-w-[96vw] rounded-xl shadow-2xl"
          />
        ) : (
          <img
            src={url}
            alt={photo.file_name}
            className="max-h-[92vh] max-w-[96vw] rounded-xl object-contain shadow-2xl"
          />
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

/* ── Move picker ─────────────────────────────────────────── */

function MovePhotoPicker({
  steps,
  currentStepId,
  selectedCount,
  onMove,
  onCancel,
}: {
  steps: { id: string; location_name: string | null }[];
  currentStepId: string;
  selectedCount: number;
  onMove: (targetStepId: string) => void;
  onCancel: () => void;
}) {
  const targets = steps.filter((s) => s.id !== currentStepId);

  return (
    <div className="rounded-lg border border-border bg-popover p-3 shadow-lg">
      <p className="mb-2 text-xs font-medium text-muted-foreground">
        Move {selectedCount} item{selectedCount !== 1 ? "s" : ""} to:
      </p>
      <div className="flex flex-col gap-1 max-h-40 overflow-y-auto">
        {targets.map((s) => (
          <button
            key={s.id}
            type="button"
            onClick={() => onMove(s.id)}
            className="rounded-md px-3 py-1.5 text-left text-sm hover:bg-accent transition-colors truncate"
          >
            {s.location_name || "Unknown"}
          </button>
        ))}
      </div>
      <button
        type="button"
        onClick={onCancel}
        className="mt-2 w-full rounded-md border border-border px-3 py-1 text-xs text-muted-foreground hover:bg-secondary transition-colors"
      >
        Cancel
      </button>
    </div>
  );
}

/* ── Main gallery ────────────────────────────────────────── */

interface StepMediaGalleryProps {
  photos: StepPhoto[];
  stepId: string;
  allSteps: { id: string; location_name: string | null }[];
  onUpdated: () => void;
}

export function StepMediaGallery({ photos, stepId, allSteps, onUpdated }: StepMediaGalleryProps) {
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [showMovePicker, setShowMovePicker] = useState(false);
  const [operating, setOperating] = useState(false);

  const isSelectMode = selected.size > 0;

  const toggleSelect = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleDelete = async () => {
    if (selected.size === 0) return;
    if (!confirm(`Delete ${selected.size} file${selected.size !== 1 ? "s" : ""}? This cannot be undone.`)) return;
    setOperating(true);

    const toDelete = photos.filter((p) => selected.has(p.id));
    // Delete from storage + DB
    for (const photo of toDelete) {
      await supabase.storage.from("trip-photos").remove([photo.storage_path]);
      await supabase.from("step_photos").delete().eq("id", photo.id);
    }

    toast.success(`Deleted ${toDelete.length} file${toDelete.length !== 1 ? "s" : ""}`);
    setSelected(new Set());
    setOperating(false);
    onUpdated();
  };

  const handleMove = async (targetStepId: string) => {
    if (selected.size === 0) return;
    setOperating(true);

    const ids = Array.from(selected);
    const { error } = await supabase
      .from("step_photos")
      .update({ step_id: targetStepId })
      .in("id", ids);

    if (error) {
      toast.error("Failed to move files");
    } else {
      const targetStep = allSteps.find((s) => s.id === targetStepId);
      toast.success(`Moved ${ids.length} file${ids.length !== 1 ? "s" : ""} to ${targetStep?.location_name || "another stop"}`);
    }

    setSelected(new Set());
    setShowMovePicker(false);
    setOperating(false);
    onUpdated();
  };

  if (photos.length === 0) return null;

  return (
    <>
      {/* Action bar when items selected */}
      {isSelectMode && (
        <div className="flex items-center gap-2 text-xs">
          <span className="text-muted-foreground font-medium">{selected.size} selected</span>
          <button
            type="button"
            onClick={() => setSelected(new Set())}
            className="text-muted-foreground hover:text-foreground transition-colors"
          >
            <X className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            onClick={() => {
              if (selected.size === photos.length) setSelected(new Set());
              else setSelected(new Set(photos.map((p) => p.id)));
            }}
            className="rounded px-2 py-0.5 text-muted-foreground hover:bg-secondary transition-colors"
          >
            {selected.size === photos.length ? "Deselect all" : "Select all"}
          </button>
          <div className="flex-1" />
          {allSteps.length > 1 && (
            <button
              type="button"
              onClick={() => setShowMovePicker(true)}
              disabled={operating}
              className="flex items-center gap-1 rounded-md bg-secondary px-2.5 py-1 font-medium text-secondary-foreground hover:bg-secondary/80 disabled:opacity-50 transition-colors"
            >
              <ArrowRightLeft className="h-3 w-3" /> Move
            </button>
          )}
          <button
            type="button"
            onClick={handleDelete}
            disabled={operating}
            className="flex items-center gap-1 rounded-md bg-destructive px-2.5 py-1 font-medium text-destructive-foreground hover:bg-destructive/90 disabled:opacity-50 transition-colors"
          >
            <Trash2 className="h-3 w-3" /> Delete
          </button>
        </div>
      )}

      {/* Move picker dropdown */}
      {showMovePicker && (
        <MovePhotoPicker
          steps={allSteps}
          currentStepId={stepId}
          selectedCount={selected.size}
          onMove={handleMove}
          onCancel={() => setShowMovePicker(false)}
        />
      )}

      {/* Thumbnails grid */}
      <div className="flex gap-2 overflow-x-auto">
        {photos.map((photo, idx) => {
          const url = getPhotoUrl(photo);
          const isVideo = isVideoFile(photo.file_name);
          const poster = getStoredPreviewThumbnail(photo.exif_data);
          const isChecked = selected.has(photo.id);

          return (
            <div
              key={photo.id}
              className={`relative h-20 w-20 shrink-0 rounded-lg overflow-hidden bg-muted cursor-pointer group transition-all ${
                isChecked ? "ring-2 ring-primary ring-offset-1 ring-offset-background" : ""
              }`}
              onClick={() => {
                if (isSelectMode) {
                  toggleSelect(photo.id);
                } else {
                  setLightboxIndex(idx);
                }
              }}
              onContextMenu={(e) => {
                e.preventDefault();
                toggleSelect(photo.id);
              }}
            >
              {isVideo ? (
                poster ? (
                  <img src={poster} alt={photo.file_name} className="h-full w-full object-cover" />
                ) : (
                  <video
                    src={url + "#t=0.5"}
                    className="h-full w-full object-cover"
                    muted
                    playsInline
                    preload="metadata"
                  />
                )
              ) : (
                <img src={url} alt={photo.file_name} className="h-full w-full object-cover" />
              )}

              {/* Video play indicator */}
              {isVideo && !isSelectMode && (
                <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
                  <div className="flex h-7 w-7 items-center justify-center rounded-full bg-black/50 backdrop-blur-sm">
                    <Play className="h-3.5 w-3.5 text-white ml-0.5" fill="white" />
                  </div>
                </div>
              )}

              {/* Select checkbox overlay */}
              {isSelectMode && (
                <div className={`absolute top-1 left-1 flex h-5 w-5 items-center justify-center rounded-sm border-2 transition-colors ${
                  isChecked ? "bg-primary border-primary" : "border-white/70 bg-black/30"
                }`}>
                  {isChecked && <Check className="h-3 w-3 text-primary-foreground" />}
                </div>
              )}

              {/* Hover hint for long press / right click */}
              {!isSelectMode && (
                <div className="absolute inset-0 bg-black/0 group-hover:bg-black/10 transition-colors" />
              )}
            </div>
          );
        })}
        {photos.length > 0 && !isSelectMode && (
          <div className="flex h-20 items-end pb-1 pl-1">
            <span className="text-[10px] text-muted-foreground/50 whitespace-nowrap">
              Right-click to select
            </span>
          </div>
        )}
      </div>

      {/* Lightbox */}
      {lightboxIndex !== null && (
        <MediaLightbox
          photos={photos}
          initialIndex={lightboxIndex}
          onClose={() => setLightboxIndex(null)}
        />
      )}
    </>
  );
}
