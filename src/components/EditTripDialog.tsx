import { useState, useEffect, useRef } from "react";
import { Pencil, CalendarIcon, ImageIcon, Upload, X, Loader2 } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { format, parse, differenceInDays, addDays } from "date-fns";
import { cn } from "@/lib/utils";
import type { Tables } from "@/integrations/supabase/types";
import { parseTripCountriesInput, syncTripCountries } from "@/lib/tripManagement";

type Trip = Tables<"trips">;

interface EditTripDialogProps {
  trip: Trip;
  tripCountries?: string[];
  onUpdated: () => void | Promise<void>;
  trigger?: React.ReactNode;
}

export function EditTripDialog({ trip, tripCountries = [], onUpdated, trigger }: EditTripDialogProps) {
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [title, setTitle] = useState(trip.title);
  const [startDate, setStartDate] = useState(trip.start_date || "");
  const [endDate, setEndDate] = useState(trip.end_date || "");
  const [countriesText, setCountriesText] = useState(tripCountries.join(", "));
  const [coverUrl, setCoverUrl] = useState((trip as any).cover_image_url || "");
  const [uploading, setUploading] = useState(false);
  const [tripPhotos, setTripPhotos] = useState<{ url: string; path: string }[]>([]);
  const [showPhotoPicker, setShowPhotoPicker] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Fetch trip photos for the picker
  useEffect(() => {
    if (!open) return;
    (async () => {
      const { data: steps } = await supabase
        .from("trip_steps")
        .select("id")
        .eq("trip_id", trip.id);
      if (!steps || steps.length === 0) { setTripPhotos([]); return; }
      const stepIds = steps.map((s) => s.id);
      const { data: photos } = await supabase
        .from("step_photos")
        .select("storage_path")
        .in("step_id", stepIds)
        .limit(50);
      if (!photos) { setTripPhotos([]); return; }
      const urls = photos.map((p) => {
        const { data } = supabase.storage.from("trip-photos").getPublicUrl(p.storage_path);
        return { url: data.publicUrl, path: p.storage_path };
      });
      setTripPhotos(urls);
    })();
  }, [open, trip.id]);

  const resetForm = () => {
    setTitle(trip.title);
    setStartDate(trip.start_date || "");
    setEndDate(trip.end_date || "");
    setCountriesText(tripCountries.join(", "));
    setCoverUrl((trip as any).cover_image_url || "");
    setShowPhotoPicker(false);
  };

  const computeTripDurationDays = () => {
    if (!startDate || !endDate) return null;
    try {
      const s = parse(startDate, "yyyy-MM-dd", new Date());
      const e = parse(endDate, "yyyy-MM-dd", new Date());
      const diff = differenceInDays(e, s);
      return diff > 0 ? diff : null;
    } catch {
      return null;
    }
  };

  const handleStartDateChange = (d: Date | undefined) => {
    if (!d) { setStartDate(""); return; }
    const duration = computeTripDurationDays();
    const newStart = format(d, "yyyy-MM-dd");
    setStartDate(newStart);
    if (duration !== null) {
      setEndDate(format(addDays(d, duration), "yyyy-MM-dd"));
    }
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      const ext = file.name.split(".").pop();
      const path = `covers/${trip.id}.${ext}`;
      const { error } = await supabase.storage.from("trip-photos").upload(path, file, { upsert: true });
      if (error) throw error;
      const { data } = supabase.storage.from("trip-photos").getPublicUrl(path);
      setCoverUrl(data.publicUrl);
    } catch (err) {
      console.error(err);
      toast.error("Failed to upload image");
    } finally {
      setUploading(false);
    }
  };

  const handleSave = async () => {
    if (!title.trim()) { toast.error("Title is required"); return; }
    if (startDate && endDate) {
      const parsedStart = parse(startDate, "yyyy-MM-dd", new Date());
      const parsedEnd = parse(endDate, "yyyy-MM-dd", new Date());
      if (differenceInDays(parsedEnd, parsedStart) <= 0) {
        toast.error("End date must be after start date");
        return;
      }
    }

    setSaving(true);
    const currentCountries = parseTripCountriesInput(tripCountries.join(", "));
    const nextCountries = parseTripCountriesInput(countriesText);

    const { error } = await supabase
      .from("trips")
      .update({
        title: title.trim(),
        start_date: startDate || null,
        end_date: endDate || null,
        countries: nextCountries,
        cover_image_url: coverUrl || null,
      } as any)
      .eq("id", trip.id);

    if (error) {
      toast.error("Failed to update trip");
      console.error(error);
    } else {
      if (currentCountries.join("|") !== nextCountries.join("|")) {
        try {
          await syncTripCountries({ tripId: trip.id, currentCountries, nextCountries });
        } catch (syncError) {
          toast.error(syncError instanceof Error ? syncError.message : "Failed to update countries");
          console.error(syncError);
          setSaving(false);
          await onUpdated();
          return;
        }
      }
      toast.success("Trip updated");
      setOpen(false);
      await onUpdated();
    }
    setSaving(false);
  };

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => { setOpen(nextOpen); if (nextOpen) resetForm(); }}>
      <DialogTrigger asChild>
        {trigger ?? (
          <Button type="button" variant="secondary" size="icon" className="rounded-xl">
            <Pencil className="h-4 w-4" />
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Edit Trip</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-4 pt-2">
          {/* Cover Image */}
          <div className="flex flex-col gap-2">
            <Label>Cover Image</Label>
            {coverUrl ? (
              <div className="relative rounded-xl overflow-hidden border border-border">
                <img src={coverUrl} alt="Cover" className="w-full h-40 object-cover" />
                <button
                  onClick={() => setCoverUrl("")}
                  className="absolute top-2 right-2 rounded-full bg-background/80 p-1 hover:bg-background transition-colors"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            ) : (
              <div className="flex h-28 items-center justify-center rounded-xl border-2 border-dashed border-border bg-muted/30">
                <span className="text-sm text-muted-foreground">No cover image</span>
              </div>
            )}
            <div className="flex gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={uploading}
                onClick={() => fileInputRef.current?.click()}
              >
                {uploading ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <Upload className="h-4 w-4 mr-1" />}
                Upload
              </Button>
              {tripPhotos.length > 0 && (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setShowPhotoPicker(!showPhotoPicker)}
                >
                  <ImageIcon className="h-4 w-4 mr-1" />
                  {showPhotoPicker ? "Hide trip photos" : "Pick from trip"}
                </Button>
              )}
              <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={handleFileUpload} />
            </div>
            {showPhotoPicker && (
              <div className="grid grid-cols-4 gap-2 max-h-48 overflow-y-auto rounded-lg border border-border p-2">
                {tripPhotos.map((photo, i) => (
                  <button
                    key={i}
                    onClick={() => { setCoverUrl(photo.url); setShowPhotoPicker(false); }}
                    className={cn(
                      "aspect-square rounded-lg overflow-hidden border-2 transition-all hover:border-primary",
                      coverUrl === photo.url ? "border-primary ring-2 ring-primary/30" : "border-transparent"
                    )}
                  >
                    <img src={photo.url} alt="" className="h-full w-full object-cover" />
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Title */}
          <div className="flex flex-col gap-2">
            <Label htmlFor="trip-title">Title</Label>
            <Input id="trip-title" value={title} onChange={(e) => setTitle(e.target.value)} />
          </div>

          {/* Dates */}
          <div className="flex gap-4">
            <div className="flex flex-1 flex-col gap-2">
              <Label>Start Date</Label>
              <Popover>
                <PopoverTrigger asChild>
                  <Button variant="outline" className={cn("w-full justify-start text-left font-normal", !startDate && "text-muted-foreground")}>
                    <CalendarIcon className="mr-2 h-4 w-4" />
                    {startDate ? format(parse(startDate, "yyyy-MM-dd", new Date()), "PPP") : <span>Pick date</span>}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="start">
                  <Calendar
                    mode="single"
                    selected={startDate ? parse(startDate, "yyyy-MM-dd", new Date()) : undefined}
                    onSelect={handleStartDateChange}
                    defaultMonth={startDate ? parse(startDate, "yyyy-MM-dd", new Date()) : undefined}
                    initialFocus
                    className="p-3 pointer-events-auto"
                  />
                </PopoverContent>
              </Popover>
            </div>
            <div className="flex flex-1 flex-col gap-2">
              <Label>End Date</Label>
              <Popover>
                <PopoverTrigger asChild>
                  <Button variant="outline" className={cn("w-full justify-start text-left font-normal", !endDate && "text-muted-foreground")}>
                    <CalendarIcon className="mr-2 h-4 w-4" />
                    {endDate ? format(parse(endDate, "yyyy-MM-dd", new Date()), "PPP") : <span>Pick date</span>}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="start">
                  <Calendar
                    mode="single"
                    selected={endDate ? parse(endDate, "yyyy-MM-dd", new Date()) : undefined}
                    onSelect={(d) => setEndDate(d ? format(d, "yyyy-MM-dd") : "")}
                    defaultMonth={startDate ? parse(startDate, "yyyy-MM-dd", new Date()) : undefined}
                    disabled={(date) => startDate ? date <= parse(startDate, "yyyy-MM-dd", new Date()) : false}
                    initialFocus
                    className="p-3 pointer-events-auto"
                  />
                </PopoverContent>
              </Popover>
            </div>
          </div>

          {/* Countries */}
          <div className="flex flex-col gap-2">
            <Label htmlFor="trip-countries">Countries</Label>
            <Input id="trip-countries" value={countriesText} onChange={(e) => setCountriesText(e.target.value)} placeholder="e.g. France, Italy" />
            <p className="text-xs text-muted-foreground">Rename or merge the countries already attached to this trip&apos;s steps.</p>
          </div>

          <Button onClick={handleSave} disabled={saving}>
            {saving ? "Saving..." : "Save Changes"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
