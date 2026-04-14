import { useCallback, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Upload, FileText, Image, Loader2, X, Plus, ChevronDown, ChevronUp } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Switch } from "@/components/ui/switch";
import { toast } from "sonner";
import { buildStoredMediaMetadata } from "@/lib/mediaMetadata"; // Corrected naming
import { processImportedMediaFiles } from "@/lib/mediaImport";

export function DashboardTripForm({ onTripAdded }: { onTripAdded?: () => void }) {
  const { user } = useAuth();
  const navigate = useNavigate();

  // STAYS CLOSED ON START
  const [isOpen, setIsOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [trackInBackground, setTrackInBackground] = useState(false);
  const [creating, setCreating] = useState(false);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user || !title.trim()) return;
    setCreating(true);

    try {
      const { data, error } = await supabase
        .from("trips")
        .insert({
          user_id: user.id,
          title: title.trim(),
          start_date: startDate || null,
          end_date: endDate || null,
          is_active: trackInBackground,
        })
        .select()
        .single();

      if (error) throw error;
      toast.success("Trip created!");
      setIsOpen(false);
      setTitle("");
      if (onTripAdded) onTripAdded();
    } catch (err) {
      toast.error("Failed to create trip");
    } finally {
      setCreating(false);
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
