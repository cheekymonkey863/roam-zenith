import { useEffect, useState } from "react";
import { format } from "date-fns";
import { Loader2, Activity } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";

interface ActivityLogProps {
  tripId?: string | null;
}

interface AuditEntry {
  id: string;
  trip_id: string | null;
  actor_user_id: string | null;
  entity_type: string;
  entity_id: string | null;
  action: string;
  changes: any;
  summary: string | null;
  created_at: string;
}

const ENTITY_LABEL: Record<string, string> = {
  trips: "Trip",
  trip_steps: "Step",
  step_photos: "Photo",
  trip_shares: "Share",
};

const ACTION_COLOR: Record<string, string> = {
  create: "bg-emerald-100 text-emerald-700",
  update: "bg-amber-100 text-amber-700",
  delete: "bg-red-100 text-red-700",
};

function renderDiff(changes: any, action: string) {
  if (!changes || typeof changes !== "object") return null;

  if (action === "update") {
    const keys = Object.keys(changes);
    if (keys.length === 0) return null;
    return (
      <ul className="mt-2 space-y-1 text-xs text-muted-foreground">
        {keys.slice(0, 8).map((k) => {
          const v = changes[k];
          const oldV = v?.old;
          const newV = v?.new;
          return (
            <li key={k} className="font-mono">
              <span className="text-foreground/80">{k}:</span>{" "}
              <span className="line-through opacity-60">{JSON.stringify(oldV)}</span>{" "}
              <span className="text-foreground">→ {JSON.stringify(newV)}</span>
            </li>
          );
        })}
        {keys.length > 8 && (
          <li className="text-[10px] italic">+ {keys.length - 8} more fields</li>
        )}
      </ul>
    );
  }

  // create / delete: show a few headline fields
  const headline: Record<string, any> = {};
  ["title", "location_name", "country", "start_date", "end_date", "file_name", "email", "status", "event_type"].forEach((k) => {
    if (changes[k] !== undefined && changes[k] !== null) headline[k] = changes[k];
  });
  if (Object.keys(headline).length === 0) return null;
  return (
    <ul className="mt-2 space-y-0.5 text-xs text-muted-foreground font-mono">
      {Object.entries(headline).map(([k, v]) => (
        <li key={k}>
          <span className="text-foreground/80">{k}:</span> {JSON.stringify(v)}
        </li>
      ))}
    </ul>
  );
}

export function ActivityLog({ tripId }: ActivityLogProps) {
  const [entries, setEntries] = useState<AuditEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [actorNames, setActorNames] = useState<Record<string, string>>({});

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      let q = supabase
        .from("audit_logs")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(200);
      if (tripId) q = q.eq("trip_id", tripId);
      const { data } = await q;
      if (cancelled) return;
      const rows = (data || []) as AuditEntry[];
      setEntries(rows);

      const ids = Array.from(new Set(rows.map((r) => r.actor_user_id).filter(Boolean))) as string[];
      if (ids.length > 0) {
        const { data: profs } = await supabase
          .from("profiles")
          .select("user_id, display_name")
          .in("user_id", ids);
        const m: Record<string, string> = {};
        (profs || []).forEach((p) => { m[p.user_id] = p.display_name || "Unknown"; });
        if (!cancelled) setActorNames(m);
      }
      setLoading(false);
    }
    load();
    return () => { cancelled = true; };
  }, [tripId]);

  if (loading) {
    return (
      <div className="flex items-center justify-center p-12 text-muted-foreground">
        <Loader2 className="h-5 w-5 animate-spin mr-2" /> Loading activity...
      </div>
    );
  }

  if (entries.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center p-12 text-muted-foreground">
        <Activity className="h-8 w-8 mb-2 opacity-50" />
        <p className="text-sm">No activity recorded yet.</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {entries.map((e) => (
        <div key={e.id} className="rounded-xl border border-border bg-card p-4">
          <div className="flex items-start justify-between gap-3">
            <div className="flex-1 min-w-0">
              <div className="flex flex-wrap items-center gap-2 mb-1">
                <span className={`text-[10px] font-semibold uppercase tracking-wide px-2 py-0.5 rounded ${ACTION_COLOR[e.action] || "bg-muted text-muted-foreground"}`}>
                  {e.action}
                </span>
                <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                  {ENTITY_LABEL[e.entity_type] || e.entity_type}
                </span>
              </div>
              <p className="font-display text-sm text-foreground">{e.summary || "Change recorded"}</p>
              {renderDiff(e.changes, e.action)}
            </div>
            <div className="text-right shrink-0">
              <p className="text-xs text-muted-foreground">
                {format(new Date(e.created_at), "MMM d, yyyy")}
              </p>
              <p className="text-[10px] text-muted-foreground/70">
                {format(new Date(e.created_at), "HH:mm")}
              </p>
              <p className="text-[10px] text-muted-foreground/70 mt-1">
                by {e.actor_user_id ? (actorNames[e.actor_user_id] || "User") : "System"}
              </p>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
