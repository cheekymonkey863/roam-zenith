import { useState, useEffect } from "react";
import { Share2, Copy, Check, X, Mail, Link2, Loader2, Users } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogDescription,
} from "@/components/ui/dialog";

interface ShareTripDialogProps {
  tripId: string;
  tripTitle: string;
}

interface ShareRecord {
  id: string;
  email: string;
  user_id: string | null;
  status: string;
  share_token: string;
  created_at: string;
}

export function ShareTripDialog({ tripId, tripTitle }: ShareTripDialogProps) {
  const { user } = useAuth();
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [shares, setShares] = useState<ShareRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [sending, setSending] = useState(false);
  const [copied, setCopied] = useState(false);
  const [shareLink, setShareLink] = useState("");

  const fetchShares = async () => {
    if (!user) return;
    setLoading(true);
    const { data } = await supabase
      .from("trip_shares")
      .select("*")
      .eq("trip_id", tripId);
    setShares((data as ShareRecord[] | null) || []);
    setLoading(false);
  };

  useEffect(() => {
    if (open) fetchShares();
  }, [open]);

  const generateShareLink = async () => {
    // Create a share with no specific user (link-based)
    const token = crypto.randomUUID();
    const { error } = await supabase.from("trip_shares").insert({
      trip_id: tripId,
      invited_by: user!.id,
      email: "link-invite",
      share_token: token,
      status: "pending",
    });

    if (error) {
      // If link already exists, find it
      const existing = shares.find((s) => s.email === "link-invite");
      if (existing) {
        const link = `${window.location.origin}/join/${existing.share_token}`;
        setShareLink(link);
        return;
      }
      toast.error("Failed to generate link");
      return;
    }

    const link = `${window.location.origin}/join/${token}`;
    setShareLink(link);
    fetchShares();
  };

  const copyLink = async () => {
    if (!shareLink) await generateShareLink();
    if (shareLink) {
      await navigator.clipboard.writeText(shareLink);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
      toast.success("Link copied!");
    }
  };

  const inviteByEmail = async () => {
    if (!email.trim() || !user) return;
    setSending(true);

    try {
      // Check if user exists in profiles
      const { data: profile } = await supabase
        .from("profiles")
        .select("user_id, display_name")
        .eq("user_id", (
          await supabase.rpc("get_user_id_by_email" as never, { _email: email.trim().toLowerCase() } as never)
        ).data)
        .maybeSingle();

      // Create the share record
      const { error } = await supabase.from("trip_shares").insert({
        trip_id: tripId,
        invited_by: user.id,
        email: email.trim().toLowerCase(),
        user_id: profile?.user_id || null,
        status: profile?.user_id ? "pending" : "pending",
      });

      if (error) {
        if (error.code === "23505") {
          toast.error("This person has already been invited");
        } else {
          toast.error("Failed to send invite");
        }
        setSending(false);
        return;
      }

      toast.success(`Invite sent to ${email.trim()}`);
      setEmail("");
      fetchShares();
    } catch {
      toast.error("Failed to send invite");
    } finally {
      setSending(false);
    }
  };

  const removeShare = async (shareId: string) => {
    const { error } = await supabase
      .from("trip_shares")
      .delete()
      .eq("id", shareId);

    if (error) {
      toast.error("Failed to remove");
      return;
    }
    toast.success("Access removed");
    fetchShares();
  };

  const userShares = shares.filter((s) => s.email !== "link-invite");
  const linkShare = shares.find((s) => s.email === "link-invite");

  useEffect(() => {
    if (linkShare) {
      setShareLink(`${window.location.origin}/join/${linkShare.share_token}`);
    }
  }, [linkShare]);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <button className="flex items-center gap-2 rounded-xl bg-secondary px-4 py-2.5 text-sm font-medium text-secondary-foreground transition-colors hover:bg-secondary/80">
          <Share2 className="h-4 w-4" />
          Share
        </button>
      </DialogTrigger>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Users className="h-5 w-5" />
            Share "{tripTitle}"
          </DialogTitle>
          <DialogDescription>
            Invite others to add photos and events to this trip.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-5 pt-2">
          {/* Invite by email */}
          <div className="flex flex-col gap-2">
            <label className="text-sm font-medium text-foreground">Invite by email</label>
            <div className="flex gap-2">
              <div className="relative flex-1">
                <Mail className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="friend@example.com"
                  onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), inviteByEmail())}
                  className="w-full rounded-xl border border-border bg-background py-2.5 pl-10 pr-4 text-sm placeholder:text-muted-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
                />
              </div>
              <button
                onClick={inviteByEmail}
                disabled={sending || !email.trim()}
                className="rounded-xl bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50"
              >
                {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Invite"}
              </button>
            </div>
          </div>

          {/* Share link */}
          <div className="flex flex-col gap-2">
            <label className="text-sm font-medium text-foreground">Or share a link</label>
            <div className="flex gap-2">
              {shareLink ? (
                <div className="flex flex-1 items-center gap-2 rounded-xl border border-border bg-muted/30 px-3 py-2.5">
                  <Link2 className="h-4 w-4 shrink-0 text-muted-foreground" />
                  <span className="truncate text-sm text-muted-foreground">{shareLink}</span>
                </div>
              ) : (
                <button
                  onClick={generateShareLink}
                  className="flex flex-1 items-center justify-center gap-2 rounded-xl border-2 border-dashed border-border px-3 py-2.5 text-sm text-muted-foreground transition-colors hover:border-primary/50 hover:text-foreground"
                >
                  <Link2 className="h-4 w-4" />
                  Generate share link
                </button>
              )}
              {shareLink && (
                <button
                  onClick={copyLink}
                  className="rounded-xl bg-secondary px-4 py-2.5 text-sm font-medium text-secondary-foreground transition-colors hover:bg-secondary/80"
                >
                  {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                </button>
              )}
            </div>
          </div>

          {/* Shared with list */}
          {userShares.length > 0 && (
            <div className="flex flex-col gap-2">
              <label className="text-sm font-medium text-foreground">
                Shared with ({userShares.length})
              </label>
              <div className="flex flex-col gap-1">
                {userShares.map((share) => (
                  <div
                    key={share.id}
                    className="flex items-center justify-between rounded-xl bg-muted/30 px-4 py-2.5"
                  >
                    <div className="flex flex-col">
                      <span className="text-sm text-foreground">{share.email}</span>
                      <span className="text-xs text-muted-foreground">
                        {share.status === "accepted" ? "Can add content" : "Pending invite"}
                      </span>
                    </div>
                    <button
                      onClick={() => removeShare(share.id)}
                      className="rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {loading && (
            <div className="flex items-center justify-center py-4">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
