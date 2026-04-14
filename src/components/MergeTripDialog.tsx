import { useState } from "react";
import { Loader2, Merge } from "lucide-react";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { mergeTripInto } from "@/lib/tripManagement";

interface MergeTripDialogProps {
  sourceTrip: { id: string; title: string };
  allTrips: { id: string; title: string }[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onMerged?: () => void;
}

export function MergeTripDialog({ sourceTrip, allTrips, open, onOpenChange, onMerged }: MergeTripDialogProps) {
  const [targetId, setTargetId] = useState<string>("");
  const [merging, setMerging] = useState(false);

  const targets = allTrips.filter((t) => t.id !== sourceTrip.id);
  const targetTrip = targets.find((t) => t.id === targetId);

  const handleMerge = async () => {
    if (!targetId) return;
    setMerging(true);
    try {
      await mergeTripInto(sourceTrip.id, targetId);
      toast.success(`Merged into "${targetTrip?.title}"`);
      onOpenChange(false);
      onMerged?.();
    } catch (err) {
      console.error(err);
      toast.error("Failed to merge trips");
    } finally {
      setMerging(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Merge className="h-5 w-5" />
            Merge Trip
          </DialogTitle>
          <DialogDescription>
            Move all stops and photos from <span className="font-medium text-foreground">{sourceTrip.title}</span> into
            another trip, then delete the source trip.
          </DialogDescription>
        </DialogHeader>

        <div className="py-4">
          <label className="text-sm font-medium text-foreground mb-2 block">Merge into:</label>
          <Select value={targetId} onValueChange={setTargetId}>
            <SelectTrigger>
              <SelectValue placeholder="Select a trip…" />
            </SelectTrigger>
            <SelectContent>
              {targets.map((t) => (
                <SelectItem key={t.id} value={t.id}>
                  {t.title}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <DialogFooter>
          <Button variant="outline" disabled={merging} onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button disabled={merging || !targetId} onClick={handleMerge}>
            {merging && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
            Merge & Delete Source
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
