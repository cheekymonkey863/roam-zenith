import { useState, useEffect, useRef } from "react";
import { Plus, Plane, Hotel, Utensils, Camera, MapPin, ArrowRightLeft, Flag, CircleDot, X, Search, Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "sonner";

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

interface PlaceResult {
  display_name: string;
  lat: string;
  lon: string;
  address?: {
    country?: string;
    city?: string;
    town?: string;
    village?: string;
    state?: string;
  };
}

interface AddEventFormProps {
  tripId: string;
  onEventAdded: () => void;
}

export function AddEventForm({ tripId, onEventAdded }: AddEventFormProps) {
  const { user } = useAuth();
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [eventType, setEventType] = useState("activity");
  const [activityName, setActivityName] = useState("");
  const [locationQuery, setLocationQuery] = useState("");
  const [locationResults, setLocationResults] = useState<PlaceResult[]>([]);
  const [selectedPlace, setSelectedPlace] = useState<PlaceResult | null>(null);
  const [searching, setSearching] = useState(false);
  const [showResults, setShowResults] = useState(false);
  const [date, setDate] = useState(new Date().toISOString().slice(0, 16));
  const [notes, setNotes] = useState("");
  const searchTimeout = useRef<ReturnType<typeof setTimeout>>();
  const resultsRef = useRef<HTMLDivElement>(null);

  const resetForm = () => {
    setEventType("activity");
    setActivityName("");
    setLocationQuery("");
    setLocationResults([]);
    setSelectedPlace(null);
    setDate(new Date().toISOString().slice(0, 16));
    setNotes("");
  };

  // Debounced location search via Nominatim
  useEffect(() => {
    if (locationQuery.length < 3) {
      setLocationResults([]);
      setShowResults(false);
      return;
    }

    if (searchTimeout.current) clearTimeout(searchTimeout.current);
    searchTimeout.current = setTimeout(async () => {
      setSearching(true);
      try {
        const res = await fetch(
          `https://nominatim.openstreetmap.org/search?format=json&addressdetails=1&limit=5&q=${encodeURIComponent(locationQuery)}`,
          { headers: { "Accept-Language": "en" } }
        );
        const data: PlaceResult[] = await res.json();
        setLocationResults(data);
        setShowResults(true);
      } catch {
        setLocationResults([]);
      }
      setSearching(false);
    }, 400);

    return () => { if (searchTimeout.current) clearTimeout(searchTimeout.current); };
  }, [locationQuery]);

  // Close results on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (resultsRef.current && !resultsRef.current.contains(e.target as Node)) {
        setShowResults(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const selectPlace = (place: PlaceResult) => {
    setSelectedPlace(place);
    setLocationQuery(place.display_name);
    setShowResults(false);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;

    if (!selectedPlace) {
      toast.error("Please search and select a location");
      return;
    }
    if (!activityName.trim()) {
      toast.error("Please enter an activity name");
      return;
    }

    const lat = parseFloat(selectedPlace.lat);
    const lng = parseFloat(selectedPlace.lon);
    const country = selectedPlace.address?.country || null;

    setSaving(true);
    const { error } = await supabase.from("trip_steps").insert({
      trip_id: tripId,
      user_id: user.id,
      latitude: lat,
      longitude: lng,
      location_name: activityName.trim(),
      country,
      notes: notes.trim() || null,
      recorded_at: new Date(date).toISOString(),
      source: "manual",
      event_type: eventType,
    });

    setSaving(false);
    if (error) {
      toast.error("Failed to add activity");
      console.error(error);
    } else {
      toast.success("Activity added!");
      resetForm();
      setOpen(false);
      onEventAdded();
    }
  };

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="flex items-center gap-2 rounded-xl bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors"
      >
        <Plus className="h-4 w-4" />
        Add Activity
      </button>
    );
  }

  const selectedType = EVENT_TYPES.find((t) => t.value === eventType);

  return (
    <div className="rounded-2xl bg-card p-6 shadow-card">
      <div className="mb-5 flex items-center justify-between">
        <h3 className="font-display text-lg font-semibold text-foreground">Add Activity</h3>
        <button onClick={() => { setOpen(false); resetForm(); }} className="rounded-lg p-1.5 text-muted-foreground hover:bg-secondary transition-colors">
          <X className="h-4 w-4" />
        </button>
      </div>

      <form onSubmit={handleSubmit} className="flex flex-col gap-5">
        {/* Event type selector */}
        <div className="flex flex-col gap-2">
          <label className="text-sm font-medium text-foreground">Activity Type</label>
          <div className="grid grid-cols-3 gap-2 sm:grid-cols-5">
            {EVENT_TYPES.map((type) => {
              const Icon = type.icon;
              const isSelected = eventType === type.value;
              return (
                <button
                  key={type.value}
                  type="button"
                  onClick={() => setEventType(type.value)}
                  className={`flex flex-col items-center gap-1.5 rounded-xl border-2 px-2 py-3 text-xs font-medium transition-all ${
                    isSelected
                      ? "border-primary bg-primary/10 text-primary"
                      : "border-border bg-background text-muted-foreground hover:border-primary/30 hover:bg-secondary"
                  }`}
                >
                  <Icon className="h-4 w-4" />
                  {type.label}
                </button>
              );
            })}
          </div>
        </div>

        {/* Activity name */}
        <div className="flex flex-col gap-1.5">
          <label className="text-sm font-medium text-foreground">Activity Name *</label>
          <input
            type="text"
            value={activityName}
            onChange={(e) => setActivityName(e.target.value)}
            placeholder="e.g. Visit Eiffel Tower, Lunch at tapas bar"
            className="rounded-xl border border-border bg-background px-4 py-2.5 text-sm text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
            required
          />
        </div>

        {/* Location search */}
        <div className="relative flex flex-col gap-1.5" ref={resultsRef}>
          <label className="text-sm font-medium text-foreground">Location *</label>
          <div className="relative">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <input
              type="text"
              value={locationQuery}
              onChange={(e) => { setLocationQuery(e.target.value); setSelectedPlace(null); }}
              onFocus={() => locationResults.length > 0 && setShowResults(true)}
              placeholder="Search for a place..."
              className="w-full rounded-xl border border-border bg-background py-2.5 pl-10 pr-10 text-sm text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
            />
            {searching && <Loader2 className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-muted-foreground" />}
            {selectedPlace && !searching && <MapPin className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-accent" />}
          </div>

          {showResults && locationResults.length > 0 && (
            <div className="absolute left-0 right-0 top-full z-50 mt-1 max-h-56 overflow-y-auto rounded-xl border border-border bg-card shadow-lg">
              {locationResults.map((place, i) => (
                <button
                  key={i}
                  type="button"
                  onClick={() => selectPlace(place)}
                  className="flex w-full items-start gap-2.5 px-4 py-3 text-left text-sm hover:bg-secondary/60 transition-colors border-b border-border last:border-b-0"
                >
                  <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                  <span className="text-foreground leading-snug">{place.display_name}</span>
                </button>
              ))}
            </div>
          )}

          {showResults && locationResults.length === 0 && locationQuery.length >= 3 && !searching && (
            <div className="absolute left-0 right-0 top-full z-50 mt-1 rounded-xl border border-border bg-card p-4 text-center text-sm text-muted-foreground shadow-lg">
              No places found
            </div>
          )}
        </div>

        {/* Date & time */}
        <div className="flex flex-col gap-1.5">
          <label className="text-sm font-medium text-foreground">Date & Time</label>
          <input
            type="datetime-local"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className="rounded-xl border border-border bg-background px-4 py-2.5 text-sm text-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
          />
        </div>

        {/* Notes */}
        <div className="flex flex-col gap-1.5">
          <label className="text-sm font-medium text-foreground">Notes</label>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Any details about this activity..."
            rows={3}
            className="resize-none rounded-xl border border-border bg-background px-4 py-2.5 text-sm text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
          />
        </div>

        {/* Submit */}
        <button
          type="submit"
          disabled={saving || !selectedPlace}
          className="flex items-center justify-center gap-2 rounded-xl bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50 transition-colors"
        >
          {saving ? "Saving..." : (
            <>
              {selectedType && <selectedType.icon className="h-4 w-4" />}
              Add {selectedType?.label || "Activity"}
            </>
          )}
        </button>
      </form>
    </div>
  );
}
