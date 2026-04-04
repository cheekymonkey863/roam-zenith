import { useState, type ReactNode } from "react";
import { Pencil, CalendarIcon } from "lucide-react";
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
  trigger?: ReactNode;
}

export function EditTripDialog({ trip, tripCountries = [], onUpdated, trigger }: EditTripDialogProps) {
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [title, setTitle] = useState(trip.title);
  const [startDate, setStartDate] = useState(trip.start_date || "");
  const [endDate, setEndDate] = useState(trip.end_date || "");
  const [countriesText, setCountriesText] = useState(tripCountries.join(", "));

  const resetForm = () => {
    setTitle(trip.title);
    setStartDate(trip.start_date || "");
    setEndDate(trip.end_date || "");
    setCountriesText(tripCountries.join(", "));
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
    if (!d) {
      setStartDate("");
      return;
    }
    const duration = computeTripDurationDays();
    const newStart = format(d, "yyyy-MM-dd");
    setStartDate(newStart);
    if (duration !== null) {
      setEndDate(format(addDays(d, duration), "yyyy-MM-dd"));
    }
  };

  const handleSave = async () => {
    if (!title.trim()) {
      toast.error("Title is required");
      return;
    }

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
      })
      .eq("id", trip.id);

    if (error) {
      toast.error("Failed to update trip");
      console.error(error);
    } else {
      if (currentCountries.join("|") !== nextCountries.join("|")) {
        try {
          await syncTripCountries({
            tripId: trip.id,
            currentCountries,
            nextCountries,
          });
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
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        setOpen(nextOpen);
        if (nextOpen) resetForm();
      }}
    >
      <DialogTrigger asChild>
        {trigger ?? (
          <Button type="button" variant="secondary" size="icon" className="rounded-xl">
            <Pencil className="h-4 w-4" />
          </Button>
        )}
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Edit Trip</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-4 pt-2">
          <div className="flex flex-col gap-2">
            <Label htmlFor="trip-title">Title</Label>
            <Input id="trip-title" value={title} onChange={(e) => setTitle(e.target.value)} />
          </div>
          <div className="flex gap-4">
            <div className="flex flex-1 flex-col gap-2">
              <Label>Start Date</Label>
              <Popover>
                <PopoverTrigger asChild>
                  <Button
                    variant="outline"
                    className={cn(
                      "w-full justify-start text-left font-normal",
                      !startDate && "text-muted-foreground"
                    )}
                  >
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
                  <Button
                    variant="outline"
                    className={cn(
                      "w-full justify-start text-left font-normal",
                      !endDate && "text-muted-foreground"
                    )}
                  >
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
          <div className="flex flex-col gap-2">
            <Label htmlFor="trip-countries">Countries</Label>
            <Input
              id="trip-countries"
              value={countriesText}
              onChange={(e) => setCountriesText(e.target.value)}
              placeholder="e.g. France, Italy"
            />
            <p className="text-xs text-muted-foreground">
              Rename or merge the countries already attached to this trip&apos;s steps.
            </p>
          </div>
          <Button onClick={handleSave} disabled={saving}>
            {saving ? "Saving..." : "Save Changes"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
