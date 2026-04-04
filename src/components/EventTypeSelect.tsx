import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from "@/components/ui/select";
import { EVENT_TYPE_GROUPS, getEventType } from "@/lib/eventTypes";

interface EventTypeSelectProps {
  value: string;
  onValueChange: (value: string) => void;
}

export function EventTypeSelect({ value, onValueChange }: EventTypeSelectProps) {
  const selected = getEventType(value);

  return (
    <Select value={value} onValueChange={onValueChange}>
      <SelectTrigger className="rounded-xl border-border bg-background">
        <SelectValue placeholder="Select activity type">
          {selected && (
            <span className="flex items-center gap-2">
              <selected.icon className="h-4 w-4" />
              {selected.label}
            </span>
          )}
        </SelectValue>
      </SelectTrigger>
      <SelectContent>
        {EVENT_TYPE_GROUPS.map((group) => (
          <SelectGroup key={group.label}>
            <SelectLabel className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              {group.label}
            </SelectLabel>
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
          </SelectGroup>
        ))}
      </SelectContent>
    </Select>
  );
}
