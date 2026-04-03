import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { ArrowLeft } from "lucide-react";
import { Link } from "react-router-dom";

const NewTrip = () => {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [title, setTitle] = useState("");
  const [startDate, setStartDate] = useState("");
  const [loading, setLoading] = useState(false);

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
        is_active: true,
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

      <h1 className="font-display text-3xl font-semibold text-foreground mb-6">Start a New Trip</h1>

      <form onSubmit={handleCreate} className="flex flex-col gap-4 rounded-2xl bg-card p-6 shadow-card">
        <div className="flex flex-col gap-1.5">
          <label className="text-sm font-medium text-foreground">Trip Name</label>
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="e.g. Summer in Europe"
            required
            className="rounded-xl border bg-background px-4 py-2.5 text-sm text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <label className="text-sm font-medium text-foreground">Start Date (optional)</label>
          <input
            type="date"
            value={startDate}
            onChange={(e) => setStartDate(e.target.value)}
            className="rounded-xl border bg-background px-4 py-2.5 text-sm text-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
          />
        </div>

        <button
          type="submit"
          disabled={loading || !title.trim()}
          className="mt-2 rounded-xl bg-primary py-2.5 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50"
        >
          {loading ? "Creating..." : "Create & Start Tracking"}
        </button>
      </form>
    </div>
  );
};

export default NewTrip;
