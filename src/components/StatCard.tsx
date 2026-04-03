import type { LucideIcon } from "lucide-react";

interface StatCardProps {
  icon: LucideIcon;
  label: string;
  value: string | number;
  suffix?: string;
}

export function StatCard({ icon: Icon, label, value, suffix }: StatCardProps) {
  return (
    <div className="flex items-center gap-4 rounded-2xl bg-card p-5 shadow-card">
      <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-primary/10">
        <Icon className="h-5 w-5 text-primary" />
      </div>
      <div>
        <p className="text-sm text-muted-foreground">{label}</p>
        <p className="font-display text-2xl font-semibold text-foreground">
          {typeof value === "number" ? value.toLocaleString() : value}
          {suffix && <span className="ml-1 text-base font-normal text-muted-foreground">{suffix}</span>}
        </p>
      </div>
    </div>
  );
}
