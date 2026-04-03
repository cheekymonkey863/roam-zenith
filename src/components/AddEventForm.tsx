import { useState } from "react";
import { Plus, Plane, Hotel, Utensils, Camera, MapPin, ArrowRightLeft, Flag, CircleDot, X } from "lucide-react";
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

interface AddEventFormProps {
  tripId: string;
  onEventAdded: () => void;
}

export function AddEventForm({ tripId, onEventAdded }: AddEventFormProps) {
  const { user } = useAuth();
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [eventType, setEventType] = useState("activity");
  const [locationName, setLocationName] = useState("");
  const [country, setCountry] = useState("");
  const [latitude, setLatitude] = useState("");
  const [longitude, setLongitude] = useState("");
  const [date, setDate] = useState(new Date().toISOString().slice(0, 16));
  const [notes, setNotes] = useState("");

  const resetForm = () => {
    setEventType("activity");
    setLocationName("");
    setCountry("");
    setLatitude("");
    setLongitude("");
    setDate(new Date().toISOString().slice(0, 16));
    setNotes("");
  };

  const useCurrentLocation = () => {
    if (!navigator.geolocation) {
      toast.error("Geolocation not supported");
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setLatitude(pos.coords.latitude.toFixed(6));
        setLongitude(pos.coords.longitude.toFixed(6));
        toast.success("Location captured");
      },
      () => toast.error("Could not get location")
    );
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;

    const lat = parseFloat(latitude);
    const lng = parseFloat(longitude);
    if (isNaN(lat) || isNaN(lng)) {
      toast.error("Please enter valid coordinates or use current location");
      return;
    }
    if (!locationName.trim()) {
      toast.error("Please enter a location name");
      return;
    }

    setSaving(true);
    const { error } = await supabase.from("trip_steps").insert({
      trip_id: tripId,
      user_id: user.id,
      latitude: lat,
      longitude: lng,
      location_name: locationName.trim(),
      country: country.trim() || null,
      notes: notes.trim() || null,
      recorded_at: new Date(date).toISOString(),
      source: "manual",
      event_type: eventType,
    });

    setSaving(false);
    if (error) {
      toast.error("Failed to add event");
      console.error(error);
    } else {
      toast.success("Event added!");
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
        Add Event
      </button>
    );
  }

  const selectedType = EVENT_TYPES.find((t) => t.value === eventType);

  return (
    <div className="rounded-2xl bg-card p-6 shadow-card">
      <div className="mb-5 flex items-center justify-between">
        <h3 className="font-display text-lg font-semibold text-foreground">Add Trip Event</h3>
        <button onClick={() => { setOpen(false); resetForm(); }} className="rounded-lg p-1.5 text-muted-foreground hover:bg-secondary transition-colors">
          <X className="h-4 w-4" />
        </button>
      </div>

      <form onSubmit={handleSubmit} className="flex flex-col gap-5">
        {/* Event type selector */}
        <div className="flex flex-col gap-2">
          <label className="text-sm font-medium text-foreground">Event Type</label>
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

        {/* Location name */}
        <div className="flex flex-col gap-1.5">
          <label className="text-sm font-medium text-foreground">Location Name *</label>
          <input
            type="text"
            value={locationName}
            onChange={(e) => setLocationName(e.target.value)}
            placeholder="e.g. Eiffel Tower, Barcelona Airport"
            className="rounded-xl border border-border bg-background px-4 py-2.5 text-sm text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
            required
          />
        </div>

        {/* Country */}
        <div className="flex flex-col gap-1.5">
          <label className="text-sm font-medium text-foreground">Country</label>
          <input
            type="text"
            value={country}
            onChange={(e) => setCountry(e.target.value)}
            placeholder="e.g. France"
            className="rounded-xl border border-border bg-background px-4 py-2.5 text-sm text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
          />
        </div>

        {/* Coordinates */}
        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between">
            <label className="text-sm font-medium text-foreground">Coordinates *</label>
            <button
              type="button"
              onClick={useCurrentLocation}
              className="flex items-center gap-1.5 rounded-lg bg-accent/15 px-3 py-1 text-xs font-medium text-accent-foreground hover:bg-accent/25 transition-colors"
            >
              <MapPin className="h-3 w-3" />
              Use current location
            </button>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <input
              type="number"
              step="any"
              value={latitude}
              onChange={(e) => setLatitude(e.target.value)}
              placeholder="Latitude"
              className="rounded-xl border border-border bg-background px-4 py-2.5 text-sm text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
              required
            />
            <input
              type="number"
              step="any"
              value={longitude}
              onChange={(e) => setLongitude(e.target.value)}
              placeholder="Longitude"
              className="rounded-xl border border-border bg-background px-4 py-2.5 text-sm text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
              required
            />
          </div>
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
            placeholder="Any details about this stop..."
            rows={3}
            className="resize-none rounded-xl border border-border bg-background px-4 py-2.5 text-sm text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
          />
        </div>

        {/* Submit */}
        <button
          type="submit"
          disabled={saving}
          className="flex items-center justify-center gap-2 rounded-xl bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50 transition-colors"
        >
          {saving ? "Saving..." : (
            <>
              {selectedType && <selectedType.icon className="h-4 w-4" />}
              Add {selectedType?.label || "Event"}
            </>
          )}
        </button>
      </form>
    </div>
  );
}
