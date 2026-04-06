import { useEffect, useRef, useState, useCallback, Fragment } from "react";
import { MapPin, Image as ImageIcon, Trash2, GripVertical, CheckSquare, Square, X } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { EditStepDialog } from "@/components/EditStepDialog";
import { StepMediaGallery } from "@/components/StepMediaGallery";
import { toast } from "sonner";
import { inferStepVisualType, type StepVisualType } from "@/lib/stepVisuals";
import { getEventType } from "@/lib/eventTypes";
import { getStoredEssence } from "@/lib/mediaMetadata";
import {
  Plane, TrainFront, Bus, Ship, Car, Footprints, Bike, Sailboat, Anchor,
  Hotel, Building, Home, Castle, Trees, Mountain, Tent, Palmtree, Snowflake,
  Map as MapIcon, Camera, UtensilsCrossed, Users, Music, Theater, Sparkles, Heart, Trophy,
  Flag, CircleDot, ArrowRightLeft,
} from "lucide-react";
import type { Tables } from "@/integrations/supabase/types";

type TripStep = Tables<"trip_steps">;
type StepPhoto = Tables<"step_photos">;

const VISUAL_CONFIG: Record<StepVisualType, { icon: React.ElementType; bg: string; text: string }> = {
  flight: { icon: Plane, bg: "bg-blue-500", text: "text-white" },
  train: { icon: TrainFront, bg: "bg-indigo-500", text: "text-white" },
  bus: { icon: Bus, bg: "bg-cyan-600", text: "text-white" },
  ferry: { icon: Ship, bg: "bg-teal-500", text: "text-white" },
  yacht_boat: { icon: Sailboat, bg: "bg-teal-600", text: "text-white" },
  cruise: { icon: Anchor, bg: "bg-teal-700", text: "text-white" },
  car: { icon: Car, bg: "bg-slate-500", text: "text-white" },
  on_foot: { icon: Footprints, bg: "bg-lime-600", text: "text-white" },
  cycling: { icon: Bike, bg: "bg-green-600", text: "text-white" },
  hotel: { icon: Hotel, bg: "bg-violet-500", text: "text-white" },
  apartment_flat: { icon: Building, bg: "bg-violet-400", text: "text-white" },
  private_home: { icon: Home, bg: "bg-rose-400", text: "text-white" },
  villa: { icon: Castle, bg: "bg-amber-600", text: "text-white" },
  safari_accommodation: { icon: Trees, bg: "bg-yellow-600", text: "text-white" },
  glamping: { icon: Mountain, bg: "bg-emerald-600", text: "text-white" },
  camping: { icon: Tent, bg: "bg-green-700", text: "text-white" },
  resort: { icon: Palmtree, bg: "bg-cyan-500", text: "text-white" },
  ski_lodge: { icon: Snowflake, bg: "bg-sky-700", text: "text-white" },
  food: { icon: UtensilsCrossed, bg: "bg-orange-500", text: "text-white" },
  sightseeing: { icon: Camera, bg: "bg-emerald-500", text: "text-white" },
  tour: { icon: MapIcon, bg: "bg-sky-500", text: "text-white" },
  dining: { icon: UtensilsCrossed, bg: "bg-orange-500", text: "text-white" },
  meeting: { icon: Users, bg: "bg-gray-500", text: "text-white" },
  concert: { icon: Music, bg: "bg-pink-500", text: "text-white" },
  theatre: { icon: Theater, bg: "bg-red-600", text: "text-white" },
  live_show: { icon: Sparkles, bg: "bg-fuchsia-500", text: "text-white" },
  wellness: { icon: Heart, bg: "bg-rose-500", text: "text-white" },
  sport: { icon: Trophy, bg: "bg-amber-500", text: "text-white" },
  border: { icon: MapPin, bg: "bg-amber-500", text: "text-white" },
  transport: { icon: ArrowRightLeft, bg: "bg-sky-600", text: "text-white" },
  activity: { icon: Flag, bg: "bg-primary", text: "text-primary-foreground" },
  other: { icon: CircleDot, bg: "bg-muted", text: "text-muted-foreground" },
};

function formatStepDate(dateStr: string) {
  return new Date(dateStr).toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

const VIDEO_EXTENSIONS = new Set(["mp4", "mov", "webm", "mkv", "avi", "m4v", "qt", "3gp"]);

function isVideoFile(fileName: string): boolean {
  const ext = fileName.split(".").pop()?.toLowerCase() ?? "";
  return VIDEO_EXTENSIONS.has(ext);
}

export function TripTimeline({
  steps,
  onUpdated,
  visualTypes = {},
  onStepInView,
}: {
  steps: TripStep[];
  onUpdated: () => void;
  visualTypes?: Record<string, StepVisualType>;
  onStepInView?: (stepId: string) => void;
}) {
  const [photosByStep, setPhotosByStep] = useState<Record<string, StepPhoto[]>>({});
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const stepRefs = useRef<Map<string, HTMLDivElement>>(new Map());

  // Multi-select state
  const [selectMode, setSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkDeleting, setBulkDeleting] = useState(false);

  // Drag state
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [overIndex, setOverIndex] = useState<number | null>(null);

  // Scroll-based detection
  useEffect(() => {
    if (!onStepInView || steps.length === 0) return;

    let lastReportedId = "";
    let ticking = false;

    const findCenterStep = () => {
      const centerY = window.innerHeight * 0.35;
      let closestId = "";
      let closestDist = Infinity;

      stepRefs.current.forEach((el, id) => {
        const rect = el.getBoundingClientRect();
        const elCenter = rect.top + rect.height / 2;
        const dist = Math.abs(elCenter - centerY);
        if (dist < closestDist) {
          closestDist = dist;
          closestId = id;
        }
      });

      if (closestId && closestId !== lastReportedId) {
        lastReportedId = closestId;
        onStepInView(closestId);
      }
      ticking = false;
    };

    const onScroll = () => {
      if (!ticking) {
        ticking = true;
        requestAnimationFrame(findCenterStep);
      }
    };

    window.addEventListener("scroll", onScroll, { passive: true });
    const timer = setTimeout(findCenterStep, 200);

    return () => {
      window.removeEventListener("scroll", onScroll);
      clearTimeout(timer);
    };
  }, [steps, onStepInView]);

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
    if (error) {
      toast.error("Failed to delete activity");
    } else {
      toast.success("Activity deleted");
      onUpdated();
    }
    setDeletingId(null);
  };

  // Multi-select helpers
  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const exitSelectMode = () => {
    setSelectMode(false);
    setSelectedIds(new Set());
  };

  const handleBulkDelete = async () => {
    if (selectedIds.size === 0) return;
    if (!confirm(`Delete ${selectedIds.size} activit${selectedIds.size === 1 ? "y" : "ies"}? This cannot be undone.`)) return;
    setBulkDeleting(true);
    const ids = Array.from(selectedIds);
    const { error } = await supabase.from("trip_steps").delete().in("id", ids);
    if (error) {
      toast.error("Failed to delete activities");
    } else {
      toast.success(`${ids.length} activit${ids.length === 1 ? "y" : "ies"} deleted`);
      exitSelectMode();
      onUpdated();
    }
    setBulkDeleting(false);
  };

  // Drag and drop handlers
  const handleDragStart = (e: React.DragEvent, index: number) => {
    setDragIndex(index);
    e.dataTransfer.effectAllowed = "move";
    // Make drag image semi-transparent
    if (e.currentTarget instanceof HTMLElement) {
      e.dataTransfer.setDragImage(e.currentTarget, 0, 0);
    }
  };

  const handleDragOver = (e: React.DragEvent, index: number) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    setOverIndex(index);
  };

  const handleDragEnd = async () => {
    if (dragIndex === null || overIndex === null || dragIndex === overIndex) {
      setDragIndex(null);
      setOverIndex(null);
      return;
    }

    // Reorder the steps array
    const reordered = [...steps];
    const [moved] = reordered.splice(dragIndex, 1);
    reordered.splice(overIndex, 0, moved);

    // Update sort_order in DB
    const updates = reordered.map((step, i) => ({
      id: step.id,
      sort_order: i + 1,
    }));

    setDragIndex(null);
    setOverIndex(null);

    // Batch update
    const promises = updates.map((u) =>
      supabase.from("trip_steps").update({ sort_order: u.sort_order }).eq("id", u.id)
    );
    const results = await Promise.all(promises);
    const hasError = results.some((r) => r.error);

    if (hasError) {
      toast.error("Failed to reorder");
    } else {
      toast.success("Reordered");
    }
    onUpdated();
  };

  return (
    <div className="relative">
      {/* Select mode toolbar */}
      {steps.length > 1 && (
        <div className="mb-4 flex items-center gap-2">
          {!selectMode ? (
            <button
              onClick={() => setSelectMode(true)}
              className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium text-muted-foreground hover:bg-secondary transition-colors"
            >
              <CheckSquare className="h-3.5 w-3.5" /> Select
            </button>
          ) : (
            <>
              <button
                onClick={exitSelectMode}
                className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium text-muted-foreground hover:bg-secondary transition-colors"
              >
                <X className="h-3.5 w-3.5" /> Cancel
              </button>
              <button
                onClick={() => {
                  if (selectedIds.size === steps.length) setSelectedIds(new Set());
                  else setSelectedIds(new Set(steps.map((s) => s.id)));
                }}
                className="rounded-lg px-3 py-1.5 text-xs font-medium text-muted-foreground hover:bg-secondary transition-colors"
              >
                {selectedIds.size === steps.length ? "Deselect All" : "Select All"}
              </button>
              {selectedIds.size > 0 && (
                <button
                  onClick={handleBulkDelete}
                  disabled={bulkDeleting}
                  className="flex items-center gap-1.5 rounded-lg bg-destructive px-3 py-1.5 text-xs font-medium text-destructive-foreground hover:bg-destructive/90 disabled:opacity-50 transition-colors"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  Delete {selectedIds.size}
                </button>
              )}
            </>
          )}
        </div>
      )}

      <div className="absolute left-5 top-0 h-full w-px bg-border" />
      <div className="flex flex-col gap-0">
        {steps.map((step, index) => {
          const photos = photosByStep[step.id] || [];
          const visualType = visualTypes[step.id] || inferStepVisualType(step);
          const config = VISUAL_CONFIG[visualType] || VISUAL_CONFIG.other;
          const StepIcon = config.icon;
          const isSelected = selectedIds.has(step.id);
          const isDragOver = overIndex === index && dragIndex !== null && dragIndex !== index;

          return (
            <div
              key={step.id}
              data-step-id={step.id}
              ref={(el) => { if (el) stepRefs.current.set(step.id, el); }}
              draggable={!selectMode}
              onDragStart={(e) => handleDragStart(e, index)}
              onDragOver={(e) => handleDragOver(e, index)}
              onDragEnd={handleDragEnd}
              onDragLeave={() => setOverIndex(null)}
              className={`relative flex gap-5 pb-8 last:pb-0 transition-all ${
                dragIndex === index ? "opacity-40" : ""
              } ${isDragOver ? "translate-y-1" : ""}`}
            >
              {/* Drop indicator line */}
              {isDragOver && (
                <div className="absolute -top-1 left-0 right-0 h-0.5 rounded-full bg-primary z-20" />
              )}

              {/* Drag handle + select checkbox area */}
              <div className="relative z-10 flex flex-col items-center gap-1">
                {selectMode ? (
                  <button
                    onClick={() => toggleSelect(step.id)}
                    className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full ring-4 ring-background transition-colors ${
                      isSelected ? "bg-primary" : "bg-card border-2 border-border"
                    }`}
                  >
                    {isSelected ? (
                      <CheckSquare className="h-4 w-4 text-primary-foreground" />
                    ) : (
                      <Square className="h-4 w-4 text-muted-foreground" />
                    )}
                  </button>
                ) : (
                  <div className={`group relative flex h-10 w-10 shrink-0 items-center justify-center rounded-full shadow-card ring-4 ring-background ${config.bg} cursor-grab active:cursor-grabbing`}>
                    <StepIcon className={`h-4 w-4 ${config.text} group-hover:hidden`} />
                    <GripVertical className={`h-4 w-4 ${config.text} hidden group-hover:block`} />
                  </div>
                )}
              </div>

              <div className={`relative z-10 flex flex-1 min-w-0 flex-col gap-2 rounded-2xl bg-card p-5 shadow-card transition-all break-words ${
                isSelected ? "ring-2 ring-primary" : ""
              } ${selectMode ? "cursor-pointer" : ""}`}
                onClick={selectMode ? () => toggleSelect(step.id) : undefined}
              >
                <div className="flex items-center justify-between gap-4">
                  <div>
                    <h4 className="font-display text-lg font-semibold text-foreground">
                      {step.location_name && !step.location_name.toLowerCase().includes("unknown")
                        ? step.location_name
                        : step.latitude && step.longitude
                          ? (
                            <span className="flex items-center gap-2">
                              <span className="text-muted-foreground">{step.latitude.toFixed(4)}°, {step.longitude.toFixed(4)}°</span>
                              <span className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2.5 py-0.5 text-xs font-medium text-primary animate-pulse">
                                Populating trip details…
                              </span>
                            </span>
                          )
                          : "Unknown Location"
                      }
                    </h4>
                    {step.country && <p className="text-sm text-muted-foreground">{step.country}</p>}
                  </div>
                  {!selectMode && (
                    <div className="flex items-center gap-2">
                      <span className="shrink-0 rounded-full bg-secondary px-3 py-1 text-xs font-medium text-secondary-foreground">
                        {formatStepDate(step.recorded_at)}
                      </span>
                      <EditStepDialog step={step} onUpdated={onUpdated} />
                      <button
                        onClick={() => handleDelete(step.id)}
                        disabled={deletingId === step.id}
                        className="rounded-lg p-1 text-muted-foreground transition-colors hover:text-destructive disabled:opacity-50"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  )}
                  {selectMode && (
                    <span className="shrink-0 rounded-full bg-secondary px-3 py-1 text-xs font-medium text-secondary-foreground">
                      {formatStepDate(step.recorded_at)}
                    </span>
                  )}
                </div>

                {step.description && <p className="text-sm leading-relaxed text-foreground">{step.description}</p>}
                {step.notes && <p className="text-sm leading-relaxed text-muted-foreground">{step.notes}</p>}

                {/* Essence description from media analysis */}
                {(() => {
                  const essences = photos
                    .map((p) => getStoredEssence(p.exif_data))
                    .filter((e): e is string => e !== null);
                  const essence = essences[0];
                  return essence && !step.description ? (
                    <p className="text-sm leading-relaxed text-foreground/80 italic">{essence}</p>
                  ) : null;
                })()}

                {photos.length > 0 && (
                  <div className="mt-2">
                    <StepMediaGallery
                      photos={photos}
                      stepId={step.id}
                      allSteps={steps.map((s) => ({ id: s.id, location_name: s.location_name }))}
                      onUpdated={onUpdated}
                    />
                  </div>
                )}

                <div className="mt-1 flex items-center gap-2 text-xs text-muted-foreground/60">
                  <span>Stop {index + 1}</span>
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
