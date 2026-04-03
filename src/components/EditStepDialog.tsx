import { useState, useEffect } from "react";
import { Pencil, Trash2, Search, Loader2, Plane, Hotel, Utensils, Camera, MapPin, ArrowRightLeft, Flag, CircleDot } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { ActivityPhotoUpload } from "@/components/ActivityPhotoUpload";
import { useGooglePlacesSearch } from "@/hooks/useGooglePlacesSearch";
import type { Tables } from "@/integrations/supabase/types";

type TripStep = Tables<"trip_steps">;

const EVENT_TYPES = [
  { value: "arrival", label: "Arrival", icon: Plane },
  { value: "departure", label: "Departure", icon: Plane },
  { value: "accommodation", label: "Accommodation", icon: Hotel },
  { value: "transport", label: "Transport", icon: ArrowRightLeft },
  { value: "activity", label: "Activity", icon: Flag },
  { value: "food", label: "Food & Drink", icon: Utensils },
  { value: "sightseeing", label: "Sightseeing", icon: Camera },
  { value: "border_crossing", label: "Border Crossing", icon: MapPin },
  { value: "other", label: "Other", icon: CircleDot },
] as const;

interface EditStepDialogProps {
  step: TripStep;
  onUpdated: () => void;
}

export function EditStepDialog({ step, onUpdated }: EditStepDialogProps) {
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [eventType, setEventType] = useState(step.event_type);
  const [activityName, setActivityName] = useState(step.location_name || "");
  const [description, setDescription] = useState((step as any).description || "");
  const [latitude, setLatitude] = useState(step.latitude);
  const [longitude, setLongitude] = useState(step.longitude);
  const [country, setCountry] = useState(step.country || "");
  const [currentLocationLabel, setCurrentLocationLabel] = useState("");
  const [notes, setNotes] = useState(step.notes || "");
  const [date, setDate] = useState(step.recorded_at ? new Date(step.recorded_at).toISOString().slice(0, 16) : "");
  const places = useGooglePlacesSearch();

  // Reverse geocode the current coordinates to show a label
  useEffect(() => {
    if (!open) return;
    fetch(`https://nominatim.openstreetmap.org/reverse?format=json&lat=${step.latitude}&lon=${step.longitude}&addressdetails=1`, {
      headers: { "Accept-Language": "en" },
    })
      .then((r) => r.json())
      .then((data) => setCurrentLocationLabel(data.display_name || `${step.latitude}, ${step.longitude}`))
      .catch(() => setCurrentLocationLabel(`${step.latitude.toFixed(4)}, ${step.longitude.toFixed(4)}`));
  }, [open, step.latitude, step.longitude]);

  const resetForm = () => {
    setEventType(step.event_type);
    setActivityName(step.location_name || "");
    setDescription((step as any).description || "");
    setLatitude(step.latitude);
    setLongitude(step.longitude);
    setCountry(step.country || "");
    setNotes(step.notes || "");
    setDate(step.recorded_at ? new Date(step.recorded_at).toISOString().slice(0, 16) : "");
    places.reset();
  };

  const handleSelectPlace = (place: typeof places.results[0]) => {
    places.selectPlace(place);
    setLatitude(parseFloat(place.lat));
    setLongitude(parseFloat(place.lon));
    setCountry(place.address?.country || "");
    setCurrentLocationLabel(place.display_name);
  };

  const handleSave = async () => {
    if (!activityName.trim()) { toast.error("Please enter an activity name"); return; }
    setSaving(true);
    const { error } = await supabase.from("trip_steps").update({
      event_type: eventType,
      location_name: activityName.trim(),
      description: description.trim() || null,
      latitude, longitude,
      country: country || null,
      notes: notes.trim() || null,
      recorded_at: date ? new Date(date).toISOString() : step.recorded_at,
    }).eq("id", step.id);

    if (error) { toast.error("Failed to update activity"); console.error(error); }
    else { toast.success("Activity updated"); setOpen(false); onUpdated(); }
    setSaving(false);
  };

  const handleDelete = async () => {
    if (!confirm("Delete this activity? This cannot be undone.")) return;
    setDeleting(true);
    const { error } = await supabase.from("trip_steps").delete().eq("id", step.id);
    if (error) { toast.error("Failed to delete activity"); }
    else { toast.success("Activity deleted"); setOpen(false); onUpdated(); }
    setDeleting(false);
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { setOpen(v); if (v) resetForm(); }}>
      <DialogTrigger asChild>
        <button className="rounded-lg p-1 text-muted-foreground hover:text-foreground transition-colors">
          <Pencil className="h-3.5 w-3.5" />
        </button>
      </DialogTrigger>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Edit Activity</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-5 pt-2">
          {/* Event type selector */}
          <div className="flex flex-col gap-2">
            <label className="text-sm font-medium text-foreground">Activity Type</label>
            <div className="grid grid-cols-3 gap-2 sm:grid-cols-5">
              {EVENT_TYPES.map((type) => {
                const Icon = type.icon;
                const isSelected = eventType === type.value;
                return (
                  <button key={type.value} type="button" onClick={() => setEventType(type.value)}
                    className={`flex flex-col items-center gap-1.5 rounded-xl border-2 px-2 py-3 text-xs font-medium transition-all ${
                      isSelected ? "border-primary bg-primary/10 text-primary" : "border-border bg-background text-muted-foreground hover:border-primary/30 hover:bg-secondary"
                    }`}>
                    <Icon className="h-4 w-4" /> {type.label}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Activity name */}
          <div className="flex flex-col gap-1.5">
            <label className="text-sm font-medium text-foreground">Activity Name *</label>
            <input type="text" value={activityName} onChange={(e) => setActivityName(e.target.value)}
              placeholder="e.g. Visit Eiffel Tower"
              className="rounded-xl border border-border bg-background px-4 py-2.5 text-sm text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary" />
          </div>

          {/* Description */}
          <div className="flex flex-col gap-1.5">
            <label className="text-sm font-medium text-foreground">Description</label>
            <textarea value={description} onChange={(e) => setDescription(e.target.value)}
              placeholder="A short description of this activity..."
              rows={2}
              className="resize-none rounded-xl border border-border bg-background px-4 py-2.5 text-sm text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary" />
          </div>

          {/* Location search */}
          <div className="relative flex flex-col gap-1.5" ref={places.resultsRef}>
            <label className="text-sm font-medium text-foreground">Location</label>
            <p className="text-xs text-muted-foreground truncate">{currentLocationLabel || "Loading..."}</p>
            <div className="relative">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <input type="text" value={places.query}
                onChange={(e) => { places.setQuery(e.target.value); places.setSelectedPlace(null); }}
                onFocus={() => places.results.length > 0 && places.setShowResults(true)}
                placeholder="Search new location..."
                className="w-full rounded-xl border border-border bg-background py-2.5 pl-10 pr-10 text-sm text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary" />
              {places.searching && <Loader2 className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-muted-foreground" />}
              {places.selectedPlace && !places.searching && <MapPin className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-accent" />}
            </div>
            {places.showResults && places.results.length > 0 && (
              <div className="absolute left-0 right-0 top-full z-50 mt-1 max-h-56 overflow-y-auto rounded-xl border border-border bg-card shadow-lg">
                {places.results.map((place, i) => (
                  <button key={i} type="button" onClick={() => handleSelectPlace(place)}
                    className="flex w-full items-start gap-2.5 px-4 py-3 text-left text-sm hover:bg-secondary/60 transition-colors border-b border-border last:border-b-0">
                    <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                    <span className="text-foreground leading-snug">{place.display_name}</span>
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Date & time */}
          <div className="flex flex-col gap-1.5">
            <label className="text-sm font-medium text-foreground">Date & Time</label>
            <input type="datetime-local" value={date} onChange={(e) => setDate(e.target.value)}
              className="rounded-xl border border-border bg-background px-4 py-2.5 text-sm text-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary" />
          </div>

          {/* Notes */}
          <div className="flex flex-col gap-1.5">
            <label className="text-sm font-medium text-foreground">Notes</label>
            <textarea value={notes} onChange={(e) => setNotes(e.target.value)}
              placeholder="Any details about this activity..." rows={3}
              className="resize-none rounded-xl border border-border bg-background px-4 py-2.5 text-sm text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary" />
          </div>

          {/* Photos */}
          <ActivityPhotoUpload stepId={step.id} tripId={step.trip_id} onPhotosUploaded={onUpdated} />

          {/* Actions */}
          <div className="flex gap-3">
            <button onClick={handleSave} disabled={saving}
              className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50 transition-colors">
              {saving ? "Saving..." : "Save Changes"}
            </button>
            <button onClick={handleDelete} disabled={deleting}
              className="flex items-center justify-center rounded-xl bg-destructive px-4 py-2.5 text-sm font-medium text-destructive-foreground hover:bg-destructive/90 disabled:opacity-50 transition-colors">
              <Trash2 className="h-4 w-4" />
            </button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
