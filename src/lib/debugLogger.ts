import { supabase } from "@/integrations/supabase/client";

let installed = false;
const recentMessages = new Map<string, number>();
const DEDUPE_MS = 5000;

async function send(level: string, message: string, extra: {
  stack?: string; source?: string; line_no?: number; col_no?: number; context?: any;
}) {
  try {
    // Dedupe identical messages within 5s
    const key = `${level}:${message}`;
    const now = Date.now();
    const last = recentMessages.get(key);
    if (last && now - last < DEDUPE_MS) return;
    recentMessages.set(key, now);

    const { data: { user } } = await supabase.auth.getUser();
    await supabase.from("debug_logs").insert({
      level,
      message: String(message).slice(0, 4000),
      stack: extra.stack?.slice(0, 8000) ?? null,
      source: extra.source?.slice(0, 500) ?? null,
      line_no: extra.line_no ?? null,
      col_no: extra.col_no ?? null,
      route: typeof window !== "undefined" ? window.location.pathname : null,
      user_agent: typeof navigator !== "undefined" ? navigator.userAgent.slice(0, 500) : null,
      actor_user_id: user?.id ?? null,
      context: extra.context ?? {},
    });
  } catch {
    // Never throw from logger
  }
}

export function installDebugLogger() {
  if (installed || typeof window === "undefined") return;
  installed = true;

  window.addEventListener("error", (e: ErrorEvent) => {
    send("error", e.message || "Unknown error", {
      stack: e.error?.stack,
      source: e.filename,
      line_no: e.lineno,
      col_no: e.colno,
    });
  });

  window.addEventListener("unhandledrejection", (e: PromiseRejectionEvent) => {
    const reason: any = e.reason;
    const msg = reason?.message || String(reason) || "Unhandled promise rejection";
    send("error", msg, { stack: reason?.stack, context: { kind: "unhandledrejection" } });
  });

  // Wrap console.error
  const origError = console.error.bind(console);
  console.error = (...args: any[]) => {
    origError(...args);
    const msg = args.map((a) => (a instanceof Error ? a.message : typeof a === "string" ? a : JSON.stringify(a))).join(" ");
    const stack = args.find((a) => a instanceof Error)?.stack;
    send("error", msg, { stack, context: { kind: "console.error" } });
  };

  const origWarn = console.warn.bind(console);
  console.warn = (...args: any[]) => {
    origWarn(...args);
    const msg = args.map((a) => (typeof a === "string" ? a : JSON.stringify(a))).join(" ");
    send("warning", msg, { context: { kind: "console.warn" } });
  };
}

export function logDebug(message: string, context?: any) {
  send("info", message, { context });
}
