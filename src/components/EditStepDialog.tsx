import { useState, useEffect, useRef } from "react";
import { Pencil, Trash2, Search } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import type { Tables } from "@/integrations/supabase/types";
import { Constants } from "@/integrations/supabase/types";

type TripStep = Tables<"trip_steps">;

interface PlaceResult {
  display_name: string;
  lat: string;
  lon: string;
  address?: { country?: string; city?: string; town?: string; village?: string; state?: string };
}

interface EditStepDialogProps {
  step: TripStep;
  onUpdated: () => void;
}

export function EditStepDialog({ step, onUpdated }: EditStepDialogProps) {
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [eventType, setEventType] = useState(step.event_type);
  const [locationName, setLocationName] = useState(step.location_name || "");
  const [locationQuery, setLocationQuery] = useState("");
  const [locationResults, setLocationResults] = useState<PlaceResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [showResults, setShowResults] = useState(false);
  const [latitude, setLatitude] = useState(step.latitude);
  const [longitude, setLongitude] = useState(step.longitude);
  const [country, setCountry] = useState(step.country || "");
  const [notes, setNotes] = useState(step.notes || "");
  const [date, setDate] = useState(step.recorded_at ? new Date(step.recorded_at).toISOString().slice(0, 16) : "");
  const searchTimeout = useRef<ReturnType<typeof setTimeout>>();
  const resultsRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!locationQuery || locationQuery.length < 3) {
      setLocationResults([]);
      return;
    }
    clearTimeout(searchTimeout.current);
    searchTimeout.current = setTimeout(async () => {
      setSearching(true);
      try {
        const res = await fetch(
          `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(locationQuery)}&limit=5&addressdetails=1`
        );
        const data = await res.json();
        setLocationResults(data);
        setShowResults(true);
      } catch {
        setLocationResults([]);
      }
      setSearching(false);
    }, 400);
  }, [locationQuery]);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (resultsRef.current && !resultsRef.current.contains(e.target as Node)) setShowResults(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const selectPlace = (place: PlaceResult) => {
    const city = place.address?.city || place.address?.town || place.address?.village || place.address?.state || "";
    const name = city || place.display_name.split(",")[0];
    setLocationName(name);
    setLatitude(parseFloat(place.lat));
    setLongitude(parseFloat(place.lon));
    setCountry(place.address?.country || "");
    setLocationQuery("");
    setShowResults(false);
  };

  const handleSave = async () => {
    setSaving(true);
    const { error } = await supabase
      .from("trip_steps")
      .update({
        event_type: eventType,
        location_name: locationName,
        latitude,
        longitude,
        country: country || null,
        notes: notes || null,
        recorded_at: date ? new Date(date).toISOString() : step.recorded_at,
      })
      .eq("id", step.id);

    if (error) {
      toast.error("Failed to update step");
      console.error(error);
    } else {
      toast.success("Step updated");
      setOpen(false);
      onUpdated();
    }
    setSaving(false);
  };

  const handleDelete = async () => {
    if (!confirm("Delete this step? This cannot be undone.")) return;
    setDeleting(true);
    const { error } = await supabase.from("trip_steps").delete().eq("id", step.id);
    if (error) {
      toast.error("Failed to delete step");
    } else {
      toast.success("Step deleted");
      setOpen(false);
      onUpdated();
    }
    setDeleting(false);
  };

  const resetForm = () => {
    setEventType(step.event_type);
    setLocationName(step.location_name || "");
    setLatitude(step.latitude);
    setLongitude(step.longitude);
    setCountry(step.country || "");
    setNotes(step.notes || "");
    setDate(step.recorded_at ? new Date(step.recorded_at).toISOString().slice(0, 16) : "");
    setLocationQuery("");
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { setOpen(v); if (v) resetForm(); }}>
      <DialogTrigger asChild>
        <button className="rounded-lg p-1 text-muted-foreground hover:text-foreground transition-colors">
          <Pencil className="h-3.5 w-3.5" />
        </button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Edit Step</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-4 pt-2">
          <div className="flex flex-col gap-2">
            <Label>Event Type</Label>
            <Select value={eventType} onValueChange={setEventType}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {Constants.public.Enums.step_event_type.map((type) => (
                  <SelectItem key={type} value={type}>
                    {type.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="flex flex-col gap-2">
            <Label>Location</Label>
            <div className="text-sm text-foreground font-medium">{locationName || "No location set"}</div>
            <div className="relative" ref={resultsRef}>
              <div className="relative">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  placeholder="Search new location..."
                  value={locationQuery}
                  onChange={(e) => setLocationQuery(e.target.value)}
                  className="pl-9"
                />
              </div>
              {showResults && locationResults.length > 0 && (
                <div className="absolute z-50 mt-1 w-full rounded-xl border bg-popover shadow-lg">
                  {locationResults.map((place, i) => (
                    <button
                      key={i}
                      onClick={() => selectPlace(place)}
                      className="w-full px-3 py-2 text-left text-sm hover:bg-accent first:rounded-t-xl last:rounded-b-xl"
                    >
                      {place.display_name}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor="step-date">Date & Time</Label>
            <Input id="step-date" type="datetime-local" value={date} onChange={(e) => setDate(e.target.value)} />
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor="step-notes">Notes</Label>
            <Textarea id="step-notes" value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} />
          </div>

          <div className="flex gap-3">
            <Button onClick={handleSave} disabled={saving} className="flex-1">
              {saving ? "Saving..." : "Save Changes"}
            </Button>
            <Button variant="destructive" onClick={handleDelete} disabled={deleting}>
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
