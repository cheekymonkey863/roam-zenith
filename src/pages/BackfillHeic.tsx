import { useEffect, useState } from "react";
import heic2any from "heic2any";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Loader2, CheckCircle2, AlertTriangle } from "lucide-react";
import { toast } from "sonner";

type Row = { id: string; storage_path: string; file_name: string };

export default function BackfillHeic() {
  const { user } = useAuth();
  const [rows, setRows] = useState<Row[]>([]);
  const [running, setRunning] = useState(false);
  const [done, setDone] = useState(0);
  const [failed, setFailed] = useState<{ name: string; reason: string }[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user) return;
    (async () => {
      const { data, error } = await supabase
        .from("step_photos")
        .select("id, storage_path, file_name")
        .eq("user_id", user.id)
        .is("thumbnail_path", null);
      if (error) toast.error(error.message);
      const heic = (data ?? []).filter((r) => /\.(heic|heif)$/i.test(r.storage_path));
      setRows(heic);
      setLoading(false);
    })();
  }, [user]);

  async function run() {
    if (!user || running) return;
    setRunning(true);
    setDone(0);
    setFailed([]);
    for (const r of rows) {
      try {
        const { data: signed, error: signErr } = await supabase.storage
          .from("trip-photos")
          .createSignedUrl(r.storage_path, 600);
        if (signErr || !signed?.signedUrl) throw new Error(signErr?.message ?? "no signed url");

        const res = await fetch(signed.signedUrl);
        const blob = await res.blob();
        const converted = await heic2any({ blob, toType: "image/jpeg", quality: 0.8 });
        const jpegBlob = Array.isArray(converted) ? converted[0] : converted;

        const thumbName = `${user.id}/backfill/${crypto.randomUUID()}.jpg`;
        const { error: upErr } = await supabase.storage
          .from("trip-photos")
          .upload(thumbName, jpegBlob, { contentType: "image/jpeg", upsert: false });
        if (upErr) throw upErr;

        const { error: updErr } = await supabase
          .from("step_photos")
          .update({ thumbnail_path: thumbName })
          .eq("id", r.id);
        if (updErr) throw updErr;

        setDone((d) => d + 1);
      } catch (e: any) {
        setFailed((f) => [...f, { name: r.file_name, reason: e?.message ?? String(e) }]);
      }
    }
    setRunning(false);
    toast.success("Backfill complete");
  }

  return (
    <div className="mx-auto max-w-2xl px-6 py-12">
      <h1 className="font-display text-3xl mb-2">HEIC Thumbnail Backfill</h1>
      <p className="text-muted-foreground mb-8">
        Converts your existing HEIC photos to JPEG sidecars so they render on the map and in galleries.
      </p>

      {loading ? (
        <Loader2 className="h-5 w-5 animate-spin" />
      ) : (
        <>
          <div className="rounded-2xl border border-border bg-card p-6 mb-6">
            <div className="text-sm text-muted-foreground">HEIC photos missing a thumbnail</div>
            <div className="font-display text-4xl mt-1">{rows.length}</div>
          </div>

          <button
            onClick={run}
            disabled={running || rows.length === 0}
            className="rounded-xl bg-primary px-6 py-3 text-sm font-semibold text-primary-foreground shadow-md disabled:opacity-50"
          >
            {running ? (
              <span className="flex items-center gap-2">
                <Loader2 className="h-4 w-4 animate-spin" /> Processing {done}/{rows.length}…
              </span>
            ) : rows.length === 0 ? (
              "Nothing to backfill"
            ) : (
              `Start backfill (${rows.length})`
            )}
          </button>

          {(done > 0 || failed.length > 0) && (
            <div className="mt-8 space-y-2 text-sm">
              <div className="flex items-center gap-2 text-emerald-600">
                <CheckCircle2 className="h-4 w-4" /> Converted: {done}
              </div>
              {failed.length > 0 && (
                <div>
                  <div className="flex items-center gap-2 text-amber-600 mb-1">
                    <AlertTriangle className="h-4 w-4" /> Failed: {failed.length}
                  </div>
                  <ul className="ml-6 list-disc text-muted-foreground">
                    {failed.slice(0, 20).map((f, i) => (
                      <li key={i}>
                        <span className="font-mono">{f.name}</span> — {f.reason}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}
