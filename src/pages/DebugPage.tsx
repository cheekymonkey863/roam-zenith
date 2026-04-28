import { useEffect, useState } from "react";
import { format } from "date-fns";
import { Loader2, Bug, Trash2, ShieldAlert } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

interface DebugEntry {
  id: string;
  created_at: string;
  level: string;
  message: string;
  stack: string | null;
  source: string | null;
  line_no: number | null;
  col_no: number | null;
  route: string | null;
  user_agent: string | null;
  actor_user_id: string | null;
  context: any;
}

const LEVEL_COLOR: Record<string, string> = {
  error: "bg-red-100 text-red-700 border-red-200",
  warning: "bg-amber-100 text-amber-700 border-amber-200",
  info: "bg-blue-100 text-blue-700 border-blue-200",
};

export default function DebugPage() {
  const { user } = useAuth();
  const [isAdmin, setIsAdmin] = useState<boolean | null>(null);
  const [entries, setEntries] = useState<DebugEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [levelFilter, setLevelFilter] = useState<string>("all");
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  useEffect(() => {
    if (!user) return;
    supabase.from("admins").select("user_id").eq("user_id", user.id).maybeSingle()
      .then(({ data }) => setIsAdmin(!!data));
  }, [user]);

  useEffect(() => {
    if (!isAdmin) return;
    let cancelled = false;
    async function load() {
      setLoading(true);
      let q = supabase.from("debug_logs").select("*").order("created_at", { ascending: false }).limit(500);
      if (levelFilter !== "all") q = q.eq("level", levelFilter);
      const { data } = await q;
      if (!cancelled) {
        setEntries((data || []) as DebugEntry[]);
        setLoading(false);
      }
    }
    load();
    return () => { cancelled = true; };
  }, [isAdmin, levelFilter]);

  async function clearAll() {
    if (!confirm("Delete all debug logs? This cannot be undone.")) return;
    await supabase.from("debug_logs").delete().neq("id", "00000000-0000-0000-0000-000000000000");
    setEntries([]);
  }

  function downloadJson() {
    const blob = new Blob([JSON.stringify(entries, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `debug-logs-${new Date().toISOString()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  if (isAdmin === null) {
    return <div className="flex min-h-[60vh] items-center justify-center"><Loader2 className="h-6 w-6 animate-spin" /></div>;
  }

  if (!isAdmin) {
    return (
      <div className="max-w-2xl mx-auto p-12 text-center">
        <ShieldAlert className="h-12 w-12 mx-auto mb-4 text-muted-foreground" />
        <h1 className="font-display text-2xl mb-2">Restricted</h1>
        <p className="text-muted-foreground">This page is only available to administrators.</p>
      </div>
    );
  }

  return (
    <div className="max-w-5xl mx-auto p-6 md:p-10">
      <div className="flex items-center justify-between mb-6 gap-4 flex-wrap">
        <div>
          <h1 className="font-display text-3xl text-foreground flex items-center gap-2">
            <Bug className="h-7 w-7" /> Debug Logs
          </h1>
          <p className="text-sm text-muted-foreground mt-1">Client errors, warnings, and unhandled rejections.</p>
        </div>
        <div className="flex items-center gap-2">
          <Select value={levelFilter} onValueChange={setLevelFilter}>
            <SelectTrigger className="w-36"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All levels</SelectItem>
              <SelectItem value="error">Errors</SelectItem>
              <SelectItem value="warning">Warnings</SelectItem>
              <SelectItem value="info">Info</SelectItem>
            </SelectContent>
          </Select>
          <Button variant="outline" size="sm" onClick={downloadJson} disabled={entries.length === 0}>
            Export JSON
          </Button>
          <Button variant="outline" size="sm" onClick={clearAll} disabled={entries.length === 0}>
            <Trash2 className="h-4 w-4 mr-1" /> Clear
          </Button>
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center p-12 text-muted-foreground">
          <Loader2 className="h-5 w-5 animate-spin mr-2" /> Loading...
        </div>
      ) : entries.length === 0 ? (
        <div className="flex flex-col items-center justify-center p-12 text-muted-foreground border border-dashed border-border rounded-xl">
          <Bug className="h-8 w-8 mb-2 opacity-50" />
          <p className="text-sm">No debug logs yet.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {entries.map((e) => {
            const isOpen = !!expanded[e.id];
            return (
              <div key={e.id} className="rounded-lg border border-border bg-card">
                <button
                  onClick={() => setExpanded((s) => ({ ...s, [e.id]: !s[e.id] }))}
                  className="w-full text-left p-3 flex items-start gap-3"
                >
                  <span className={`text-[10px] font-semibold uppercase px-2 py-0.5 rounded border shrink-0 ${LEVEL_COLOR[e.level] || ""}`}>
                    {e.level}
                  </span>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-foreground truncate font-mono">{e.message}</p>
                    <p className="text-[11px] text-muted-foreground mt-0.5">
                      {format(new Date(e.created_at), "MMM d, HH:mm:ss")}
                      {e.route && <> · <span className="font-mono">{e.route}</span></>}
                      {e.source && <> · {e.source.split("/").pop()}{e.line_no ? `:${e.line_no}` : ""}</>}
                    </p>
                  </div>
                </button>
                {isOpen && (
                  <div className="px-3 pb-3 space-y-2 border-t border-border pt-3">
                    {e.stack && (
                      <pre className="text-[11px] font-mono bg-muted/50 p-2 rounded overflow-x-auto whitespace-pre-wrap">{e.stack}</pre>
                    )}
                    <div className="text-[11px] text-muted-foreground space-y-0.5 font-mono">
                      {e.source && <div>source: {e.source}</div>}
                      {e.user_agent && <div className="truncate">UA: {e.user_agent}</div>}
                      {e.actor_user_id && <div>user: {e.actor_user_id}</div>}
                      {e.context && Object.keys(e.context).length > 0 && (
                        <div>context: {JSON.stringify(e.context)}</div>
                      )}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
