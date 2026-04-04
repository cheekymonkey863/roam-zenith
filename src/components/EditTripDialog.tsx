import { useState } from "react";
import { Pencil, CalendarIcon } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { format, parse } from "date-fns";
import { cn } from "@/lib/utils";
import type { Tables } from "@/integrations/supabase/types";

type Trip = Tables<"trips">;

interface EditTripDialogProps {
  trip: Trip;
  onUpdated: () => void;
}

export function EditTripDialog({ trip, onUpdated }: EditTripDialogProps) {
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [title, setTitle] = useState(trip.title);
  const [startDate, setStartDate] = useState(trip.start_date || "");
  const [endDate, setEndDate] = useState(trip.end_date || "");

  const handleSave = async () => {
    if (!title.trim()) {
      toast.error("Title is required");
      return;
    }
    setSaving(true);
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
      toast.success("Trip updated");
      setOpen(false);
      onUpdated();
    }
    setSaving(false);
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { setOpen(v); if (v) { setTitle(trip.title); setStartDate(trip.start_date || ""); setEndDate(trip.end_date || ""); } }}>
      <DialogTrigger asChild>
        <button className="rounded-xl bg-secondary p-2 text-secondary-foreground hover:bg-secondary/80 transition-colors">
          <Pencil className="h-4 w-4" />
        </button>
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
                    onSelect={(d) => setStartDate(d ? format(d, "yyyy-MM-dd") : "")}
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
          <Button onClick={handleSave} disabled={saving}>
            {saving ? "Saving..." : "Save Changes"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
