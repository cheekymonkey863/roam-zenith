import { useState } from "react";
import { Link } from "react-router-dom";
import { Calendar, MapPin, MoreVertical, Trash2, Merge } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { MergeTripDialog } from "@/components/MergeTripDialog";
import { Button } from "@/components/ui/button";
import { deleteTripCascade } from "@/lib/tripManagement";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

interface TripCardProps {
  trip: any;
  allTrips?: { id: string; title: string }[];
  onUpdated?: () => void;
}

export function TripCard({ trip, allTrips = [], onUpdated }: TripCardProps) {
  const [showMerge, setShowMerge] = useState(false);
  const [showDelete, setShowDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const startDate = trip.start_date
    ? new Date(trip.start_date).toLocaleDateString("en-US", { month: "short", year: "numeric" })
    : "TBD";

  const handleDelete = async () => {
    setDeleting(true);
    try {
      await deleteTripCascade(trip.id);
      toast.success("Trip deleted");
      setShowDelete(false);
      onUpdated?.();
    } catch (err) {
      console.error(err);
      toast.error("Failed to delete trip");
    } finally {
      setDeleting(false);
    }
  };

  return (
    <>
      <div className="group relative flex flex-col overflow-hidden rounded-2xl border border-border bg-card transition-all hover:shadow-lg hover:-translate-y-1">
        {/* Dropdown menu */}
        <div className="absolute top-2 right-2 z-10 opacity-0 group-hover:opacity-100 transition-opacity">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="secondary"
                size="icon"
                className="h-8 w-8 rounded-full bg-card/80 backdrop-blur-sm shadow-sm"
                onClick={(e) => e.preventDefault()}
              >
                <MoreVertical className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {allTrips.length > 1 && (
                <DropdownMenuItem
                  onClick={(e) => {
                    e.preventDefault();
                    setShowMerge(true);
                  }}
                >
                  <Merge className="h-4 w-4 mr-2" />
                  Merge into…
                </DropdownMenuItem>
              )}
              <DropdownMenuItem
                onClick={(e) => {
                  e.preventDefault();
                  setShowDelete(true);
                }}
                className="text-destructive focus:text-destructive"
              >
                <Trash2 className="h-4 w-4 mr-2" />
                Delete
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        <Link to={`/trip/${trip.id}`} className="flex flex-col flex-1">
          <div className="aspect-[16/9] w-full bg-muted overflow-hidden">
            {trip.image_url ? (
              <img
                src={trip.image_url}
                alt={trip.title}
                className="h-full w-full object-cover transition-transform group-hover:scale-105"
              />
            ) : (
              <div className="flex h-full w-full items-center justify-center bg-primary/5">
                <MapPin className="h-8 w-8 text-primary/20" />
              </div>
            )}
          </div>
          <div className="p-5">
            <h3 className="text-lg font-bold truncate group-hover:text-primary transition-colors">{trip.title}</h3>
            <div className="mt-2 flex items-center gap-2 text-sm text-muted-foreground">
              <Calendar className="h-4 w-4" />
              <span>{startDate}</span>
            </div>
          </div>
        </Link>
      </div>

      {/* Delete confirmation dialog */}
      <AlertDialog open={showDelete} onOpenChange={setShowDelete}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete trip?</AlertDialogTitle>
            <AlertDialogDescription>
              This permanently removes <span className="font-medium text-foreground">{trip.title}</span> and its
              trip steps, media, and sharing links.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={deleting}
              onClick={(e) => {
                e.preventDefault();
                void handleDelete();
              }}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {deleting && <Loader2 className="h-4 w-4 animate-spin mr-1" />}
              {deleting ? "Deleting…" : "Delete trip"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Merge dialog */}
      {showMerge && (
        <MergeTripDialog
          sourceTrip={{ id: trip.id, title: trip.title }}
          allTrips={allTrips}
          open={showMerge}
          onOpenChange={setShowMerge}
          onMerged={onUpdated}
        />
      )}
    </>
  );
}
