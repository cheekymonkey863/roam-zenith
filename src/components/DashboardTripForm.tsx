import { useCallback, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Plus, ChevronDown, ChevronUp, Image, FileText, Mail } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { parseTripCountriesInput } from "@/lib/tripManagement";
import { Switch } from "@/components/ui/switch";
import { toast } from "sonner";

export function DashboardTripForm({ onTripAdded }: { onTripAdded?: () => void }) {
  const { user } = useAuth();
  const navigate = useNavigate();

  const [isOpen, setIsOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [countriesText, setCountriesText] = useState("");
  const [trackInBackground, setTrackInBackground] = useState(false);
  const [creating, setCreating] = useState(false);

  const createTrip = async (): Promise<string | null> => {
    if (!user || !title.trim()) return null;
    setCreating(true);
    try {
      const countries = parseTripCountriesInput(countriesText);
      const { data, error } = await supabase
        .from("trips")
        .insert({
          user_id: user.id,
          title: title.trim(),
          start_date: startDate || null,
          end_date: endDate || null,
          is_active: trackInBackground,
          countries,
        } as any)
        .select()
        .single();
      if (error) throw error;
      setIsOpen(false);
      setTitle("");
      onTripAdded?.();
      return data.id;
    } catch {
      toast.error("Failed to create trip");
      return null;
    } finally {
      setCreating(false);
    }
  };

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    const id = await createTrip();
    if (id) {
      toast.success("Trip created!");
      navigate(`/trip/${id}`);
    }
  };

  const handleCreateAndImport = async (importType: "photos" | "document" | "inbox") => {
    if (!title.trim()) {
      toast.error("Please enter a trip name first");
      return;
    }
    const id = await createTrip();
    if (id) {
      toast.success("Trip created!");
      navigate(`/trip/${id}?import=${importType}`);
    }
  };

  return (
    <div className="rounded-2xl border border-border bg-card shadow-sm">
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className="flex w-full items-center justify-between p-5 hover:bg-secondary/30 transition-colors"
      >
        <div className="flex items-center gap-3">
          <Plus className="h-5 w-5 text-primary" />
          <span className="font-display font-semibold">Add a New Trip</span>
        </div>
        {isOpen ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
      </button>

      {isOpen && (
        <form onSubmit={handleCreate} className="p-6 border-t border-border flex flex-col gap-6">
          <div className="flex flex-col gap-2">
            <label className="text-xs font-bold text-muted-foreground uppercase">Trip Name *</label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="rounded-xl border border-border bg-background p-3 text-sm"
              placeholder="Summer in Europe"
              required
            />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="flex flex-col gap-2">
              <label className="text-xs font-bold text-muted-foreground uppercase">Start Date</label>
              <input
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                className="rounded-xl border border-border bg-background p-3 text-sm"
              />
            </div>
            <div className="flex flex-col gap-2">
              <label className="text-xs font-bold text-muted-foreground uppercase">End Date</label>
              <input
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                className="rounded-xl border border-border bg-background p-3 text-sm"
              />
            </div>
          </div>
          <div className="flex items-center justify-between py-2">
            <span className="text-sm font-medium">Track in background</span>
            <Switch checked={trackInBackground} onCheckedChange={setTrackInBackground} />
          </div>

          {/* Import options */}
          <div className="flex flex-col gap-2">
            <label className="text-xs font-bold text-muted-foreground uppercase">Add stops from</label>
            <div className="grid grid-cols-3 gap-3">
              <button
                type="button"
                disabled={creating}
                onClick={() => handleCreateAndImport("photos")}
                className="flex flex-col items-center gap-2 rounded-xl border border-border bg-background p-4 text-sm font-medium hover:bg-secondary/40 transition-colors disabled:opacity-50"
              >
                <Image className="h-5 w-5 text-primary" />
                <span>Photos</span>
              </button>
              <button
                type="button"
                disabled={creating}
                onClick={() => handleCreateAndImport("document")}
                className="flex flex-col items-center gap-2 rounded-xl border border-border bg-background p-4 text-sm font-medium hover:bg-secondary/40 transition-colors disabled:opacity-50"
              >
                <FileText className="h-5 w-5 text-primary" />
                <span>Document</span>
              </button>
              <button
                type="button"
                disabled={creating}
                onClick={() => handleCreateAndImport("inbox")}
                className="flex flex-col items-center gap-2 rounded-xl border border-border bg-background p-4 text-sm font-medium hover:bg-secondary/40 transition-colors disabled:opacity-50"
              >
                <Mail className="h-5 w-5 text-primary" />
                <span>Inbox</span>
              </button>
            </div>
          </div>

          <button
            type="submit"
            disabled={creating}
            className="rounded-xl bg-primary py-3 text-sm font-bold text-primary-foreground hover:bg-primary/90 transition-all disabled:opacity-50"
          >
            {creating ? "Creating..." : "Add Trip"}
          </button>
        </form>
      )}
    </div>
  );
}
