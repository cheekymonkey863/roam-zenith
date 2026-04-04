import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { EVENT_TYPE_GROUPS, getEventType, getEventTypeGroup } from "@/lib/eventTypes";

interface EventTypeSelectProps {
  value: string;
  onValueChange: (value: string) => void;
}

export function EventTypeSelect({ value, onValueChange }: EventTypeSelectProps) {
  const selected = getEventType(value);
  const activeGroup = selected ? getEventTypeGroup(value) : null;

  return (
    <div className="flex flex-col gap-2">
      <div className="grid grid-cols-3 gap-2">
        {EVENT_TYPE_GROUPS.map((group) => {
          const isActiveGroup = activeGroup === group.label;
          const activeOption = isActiveGroup && selected ? selected : null;

          return (
            <Select
              key={group.label}
              value={isActiveGroup ? value : ""}
              onValueChange={onValueChange}
            >
              <SelectTrigger
                className={`rounded-xl border-2 text-xs h-9 px-2 transition-all ${
                  isActiveGroup
                    ? "border-primary bg-primary/10 text-primary font-semibold"
                    : "border-border bg-background text-muted-foreground hover:border-primary/30"
                }`}
              >
                <SelectValue placeholder={group.label}>
                  {activeOption ? (
                    <span className="flex items-center gap-1.5 truncate">
                      <activeOption.icon className="h-3.5 w-3.5 shrink-0" />
                      <span className="truncate">{activeOption.label}</span>
                    </span>
                  ) : (
                    group.label
                  )}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                {group.options.map((option) => {
                  const Icon = option.icon;
                  return (
                    <SelectItem key={option.value} value={option.value}>
                      <span className="flex items-center gap-2">
                        <Icon className="h-4 w-4" />
                        {option.label}
                      </span>
                    </SelectItem>
                  );
                })}
              </SelectContent>
            </Select>
          );
        })}
      </div>
    </div>
  );
}
