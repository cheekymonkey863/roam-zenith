import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { ArrowLeft, CalendarIcon } from "lucide-react";
import { Link } from "react-router-dom";
import { Switch } from "@/components/ui/switch";
import { format, parse } from "date-fns";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

const NewTrip = () => {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [title, setTitle] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [trackInBackground, setTrackInBackground] = useState(false);
  const [loading, setLoading] = useState(false);

  const isPastTrip = (() => {
    if (!endDate) return false;
    const end = new Date(endDate);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    return end < today;
  })();

  const isFutureOrCurrent = !isPastTrip;

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user || !title.trim()) return;
    setLoading(true);

    const { data, error } = await supabase
      .from("trips")
      .insert({
        user_id: user.id,
        title: title.trim(),
        start_date: startDate || null,
        end_date: endDate || null,
        is_active: trackInBackground && isFutureOrCurrent,
      })
      .select()
      .single();

    if (data) {
      navigate(`/trips/${data.id}`);
    }
    setLoading(false);
  };

  return (
    <div className="mx-auto max-w-lg py-8">
      <Link to="/" className="mb-6 flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors">
        <ArrowLeft className="h-4 w-4" />
        Back
      </Link>

      <h1 className="font-display text-3xl font-semibold text-foreground mb-6">Add a Trip</h1>

      <form onSubmit={handleCreate} className="flex flex-col gap-5 rounded-2xl bg-card p-6 shadow-card">
        <div className="flex flex-col gap-1.5">
          <label className="text-sm font-medium text-foreground">Trip Name *</label>
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="e.g. Summer in Europe"
            required
            className="rounded-xl border border-border bg-background px-4 py-2.5 text-sm text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
          />
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div className="flex flex-col gap-1.5">
            <label className="text-sm font-medium text-foreground">Start Date</label>
            <Popover>
              <PopoverTrigger asChild>
                <Button
                  variant="outline"
                  className={cn(
                    "w-full justify-start text-left font-normal rounded-xl border-border",
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
          <div className="flex flex-col gap-1.5">
            <label className="text-sm font-medium text-foreground">End Date</label>
            <Popover>
              <PopoverTrigger asChild>
                <Button
                  variant="outline"
                  className={cn(
                    "w-full justify-start text-left font-normal rounded-xl border-border",
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
                  disabled={(date) => startDate ? date < parse(startDate, "yyyy-MM-dd", new Date()) : false}
                  initialFocus
                  className="p-3 pointer-events-auto"
                />
              </PopoverContent>
            </Popover>
          </div>
        </div>

        <div className={`flex items-center justify-between rounded-xl border border-border px-4 py-3 transition-opacity ${isPastTrip ? "opacity-40 pointer-events-none" : ""}`}>
          <div className="flex flex-col gap-0.5">
            <span className="text-sm font-medium text-foreground">Track in background</span>
            <span className="text-xs text-muted-foreground">
              {isPastTrip ? "Not available for past trips" : "Automatically record your location during this trip"}
            </span>
          </div>
          <Switch
            checked={trackInBackground && isFutureOrCurrent}
            onCheckedChange={setTrackInBackground}
            disabled={isPastTrip}
          />
        </div>

        <button
          type="submit"
          disabled={loading || !title.trim()}
          className="mt-1 rounded-xl bg-primary py-2.5 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50"
        >
          {loading ? "Creating..." : "Add Trip"}
        </button>
      </form>
    </div>
  );
};

export default NewTrip;
