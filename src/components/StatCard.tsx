import { LucideIcon } from "lucide-react";

interface StatCardProps {
  title?: string;
  label?: string;
  value: number | string;
  icon: LucideIcon;
  description?: string;
}

export function StatCard({ title, label, value, icon: Icon, description }: StatCardProps) {
  return (
    <div className="rounded-2xl border border-border bg-card p-3 sm:p-6 shadow-sm">
      <div className="flex flex-col sm:flex-row items-center sm:items-center gap-2 sm:gap-4 text-center sm:text-left">
        <div className="flex h-9 w-9 sm:h-12 sm:w-12 items-center justify-center rounded-xl bg-primary/10 shrink-0">
          <Icon className="h-4 w-4 sm:h-6 sm:w-6 text-primary" />
        </div>
        <div className="min-w-0">
          <p className="text-xs sm:text-sm font-medium text-muted-foreground truncate">{title || label}</p>
          <h3 className="text-lg sm:text-2xl font-bold text-foreground">{value}</h3>
        </div>
      </div>
      {description && <p className="mt-2 text-xs text-muted-foreground">{description}</p>}
    </div>
  );
}
