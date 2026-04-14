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
    <div className="rounded-2xl border border-border bg-card p-6 shadow-sm">
      <div className="flex items-center gap-4">
        <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-primary/10">
          <Icon className="h-6 w-6 text-primary" />
        </div>
        <div>
          <p className="text-sm font-medium text-muted-foreground">{title || label}</p>
          <h3 className="text-2xl font-bold text-foreground">{value}</h3>
        </div>
      </div>
      {description && <p className="mt-2 text-xs text-muted-foreground">{description}</p>}
    </div>
  );
}
