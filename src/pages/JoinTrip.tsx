import { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Loader2, Check, X } from "lucide-react";

export default function JoinTrip() {
  const { token } = useParams<{ token: string }>();
  const { user, loading: authLoading } = useAuth();
  const navigate = useNavigate();
  const [status, setStatus] = useState<"loading" | "success" | "error" | "auth_required">("loading");
  const [errorMsg, setErrorMsg] = useState("");
  const [tripTitle, setTripTitle] = useState("");

  useEffect(() => {
    if (authLoading) return;

    if (!user) {
      setStatus("auth_required");
      return;
    }

    const joinTrip = async () => {
      try {
        // Find the share by token
        const { data: share, error: shareError } = await supabase
          .from("trip_shares")
          .select("*")
          .eq("share_token", token!)
          .maybeSingle();

        if (shareError || !share) {
          setErrorMsg("This invite link is invalid or has expired.");
          setStatus("error");
          return;
        }

        // Get trip title
        const { data: trip } = await supabase
          .from("trips")
          .select("title")
          .eq("id", (share as any).trip_id)
          .maybeSingle();

        setTripTitle(trip?.title || "a trip");

        // Check if this is a link-invite (email = "link-invite")
        const shareData = share as any;
        if (shareData.email === "link-invite") {
          // Create a new share record for this specific user
          const { error: insertError } = await supabase.from("trip_shares").insert({
            trip_id: shareData.trip_id,
            invited_by: shareData.invited_by,
            email: user.email!,
            user_id: user.id,
            status: "accepted",
          });

          if (insertError && insertError.code !== "23505") {
            setErrorMsg("Failed to join this trip.");
            setStatus("error");
            return;
          }
        } else {
          // Email invite - update status to accepted
          if (shareData.user_id && shareData.user_id !== user.id) {
            setErrorMsg("This invite was sent to a different account.");
            setStatus("error");
            return;
          }

          await supabase
            .from("trip_shares")
            .update({ user_id: user.id, status: "accepted" })
            .eq("id", shareData.id);
        }

        setStatus("success");
        setTimeout(() => navigate(`/trips/${shareData.trip_id}`), 2000);
      } catch {
        setErrorMsg("Something went wrong.");
        setStatus("error");
      }
    };

    joinTrip();
  }, [user, authLoading, token]);

  if (status === "auth_required") {
    return (
      <div className="flex flex-col items-center gap-6 py-20 text-center">
        <h2 className="font-display text-2xl font-semibold text-foreground">Sign in to join this trip</h2>
        <p className="text-muted-foreground">You need an account to collaborate on trips.</p>
        <button
          onClick={() => navigate(`/auth?redirect=/join/${token}`)}
          className="rounded-xl bg-primary px-6 py-3 text-sm font-medium text-primary-foreground hover:bg-primary/90"
        >
          Sign in or Sign up
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center gap-6 py-20 text-center">
      {status === "loading" && (
        <>
          <Loader2 className="h-10 w-10 animate-spin text-primary" />
          <p className="text-muted-foreground">Joining trip…</p>
        </>
      )}
      {status === "success" && (
        <>
          <div className="flex h-16 w-16 items-center justify-center rounded-full bg-primary/10">
            <Check className="h-8 w-8 text-primary" />
          </div>
          <h2 className="font-display text-2xl font-semibold text-foreground">
            You've joined "{tripTitle}"!
          </h2>
          <p className="text-muted-foreground">Redirecting you to the trip…</p>
        </>
      )}
      {status === "error" && (
        <>
          <div className="flex h-16 w-16 items-center justify-center rounded-full bg-destructive/10">
            <X className="h-8 w-8 text-destructive" />
          </div>
          <h2 className="font-display text-2xl font-semibold text-foreground">Couldn't join trip</h2>
          <p className="text-muted-foreground">{errorMsg}</p>
          <button
            onClick={() => navigate("/")}
            className="rounded-xl bg-primary px-6 py-3 text-sm font-medium text-primary-foreground hover:bg-primary/90"
          >
            Go to Dashboard
          </button>
        </>
      )}
    </div>
  );
}
