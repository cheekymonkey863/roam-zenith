import { useParams, useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Loader2, ChevronLeft } from "lucide-react";

export default function TripDetail() {
  const { id } = useParams();
  const navigate = useNavigate();

  const { data: trip, isLoading } = useQuery({
    queryKey: ["trip", id],
    queryFn: async () => {
      const { data, error } = await supabase.from("trips").select("*").eq("id", id).single();
      if (error) throw error;
      return data;
    },
  });

  if (isLoading)
    return (
      <div className="flex h-screen items-center justify-center">
        <Loader2 className="animate-spin" />
      </div>
    );
  if (!trip) return <div className="p-20 text-center">Trip not found</div>;

  return (
    <div className="min-h-screen bg-background p-10 pt-24">
      <button
        onClick={() => navigate("/")}
        className="mb-6 flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground"
      >
        <ChevronLeft className="h-4 w-4" /> Back to Dashboard
      </button>
      <h1 className="text-4xl font-display font-bold">{trip.title}</h1>
      <p className="text-muted-foreground mt-2">
        {trip.start_date} — {trip.end_date}
      </p>
      {/* Rest of your timeline components go here */}
    </div>
  );
}
