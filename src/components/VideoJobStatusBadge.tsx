import { AlertCircle, CheckCircle2, Clock, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import type { VideoAnalysisJobInfo } from "@/hooks/useVideoAnalysisJobs";

interface Props {
  job: VideoAnalysisJobInfo | undefined;
  className?: string;
}

/**
 * Tiny per-thumbnail status pill for video analysis jobs.
 * - pending     → "Queued" (amber, clock)
 * - processing  → "Analyzing" (primary, spinner)
 * - complete    → "Analyzed" (emerald, check)
 * - failed      → "Failed" (destructive, alert) — title shows exact reason
 */
export function VideoJobStatusBadge({ job, className }: Props) {
  if (!job) return null;

  const status = job.status;
  const cfg =
    status === "pending"
      ? { Icon: Clock, label: "Queued", tone: "bg-amber-600/85 text-white", title: "Waiting for AI analysis" }
      : status === "processing"
        ? { Icon: Loader2, label: "Analyzing", tone: "bg-primary/85 text-primary-foreground", title: "AI is analyzing this video", spin: true }
        : status === "complete"
          ? { Icon: CheckCircle2, label: "Analyzed", tone: "bg-emerald-600/85 text-white", title: "AI analysis complete" }
          : { Icon: AlertCircle, label: "Failed", tone: "bg-destructive/90 text-destructive-foreground", title: job.error || "Analysis failed" };

  return (
    <div
      title={cfg.title}
      className={cn(
        "pointer-events-auto flex items-center gap-0.5 rounded px-1 py-0.5 text-[8px] font-medium uppercase tracking-wider backdrop-blur-sm",
        cfg.tone,
        className,
      )}
    >
      <cfg.Icon className={cn("h-2.5 w-2.5", "spin" in cfg && cfg.spin && "animate-spin")} />
      <span>{cfg.label}</span>
    </div>
  );
}
