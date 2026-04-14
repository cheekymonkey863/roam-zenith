import { useState, useEffect, useCallback } from "react";
import { Globe, Loader2, Check, Download, X, Search } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "sonner";
import { ensureGoogleMapsLoaded, GOOGLE_MAPS_API_KEY } from "@/hooks/useGooglePlacesSearch";

interface WebImageSearchProps {
  stepId: string;
  tripId: string;
  locationName: string | null;
  latitude: number;
  longitude: number;
  onPhotosAdded: () => void;
}

interface PlacePhoto {
  url: string;
  attribution: string;
  width: number;
  height: number;
}

export function WebImageSearch({
  stepId,
  tripId,
  locationName,
  latitude,
  longitude,
  onPhotosAdded,
}: WebImageSearchProps) {
  const { user } = useAuth();
  const [open, setOpen] = useState(false);
  const [photos, setPhotos] = useState<PlacePhoto[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [query, setQuery] = useState(locationName || "");
  const [searched, setSearched] = useState(false);

  const searchPlacePhotos = useCallback(async (searchQuery: string) => {
    if (!searchQuery.trim()) return;
    setLoading(true);
    setPhotos([]);
    setSelected(new Set());
    setSearched(true);

    try {
      await ensureGoogleMapsLoaded();
      const google = (window as any).google;
      if (!google?.maps?.places) {
        toast.error("Google Maps not available");
        setLoading(false);
        return;
      }

      const mapDiv = document.createElement("div");
      const service = new google.maps.places.PlacesService(mapDiv);

      const request: any = {
        query: searchQuery,
        location: new google.maps.LatLng(latitude, longitude),
        radius: 5000,
      };

      service.textSearch(request, (results: any[], status: string) => {
        if (status !== "OK" || !results?.length) {
          setPhotos([]);
          setLoading(false);
          return;
        }

        // Get the first result with photos, or try multiple results
        const allPhotos: PlacePhoto[] = [];
        for (const result of results.slice(0, 3)) {
          if (result.photos) {
            for (const photo of result.photos) {
              allPhotos.push({
                url: photo.getUrl({ maxWidth: 800 }),
                attribution: photo.html_attributions?.[0] || "",
                width: photo.width || 800,
                height: photo.height || 600,
              });
            }
          }
        }
        setPhotos(allPhotos);
        setLoading(false);
      });
    } catch (err) {
      console.error("Place photo search error:", err);
      toast.error("Failed to search for photos");
      setLoading(false);
    }
  }, [latitude, longitude]);

  useEffect(() => {
    if (open && !searched && locationName) {
      setQuery(locationName);
      searchPlacePhotos(locationName);
    }
  }, [open, searched, locationName, searchPlacePhotos]);

  const toggleSelect = (idx: number) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(idx)) next.delete(idx);
      else next.add(idx);
      return next;
    });
  };

  const handleSave = async () => {
    if (!user || selected.size === 0) return;
    setSaving(true);

    try {
      const selectedPhotos = Array.from(selected).map((i) => photos[i]);
      let savedCount = 0;

      for (const photo of selectedPhotos) {
        try {
          // Fetch the image
          const response = await fetch(photo.url);
          const blob = await response.blob();
          const ext = blob.type.includes("png") ? "png" : "jpg";
          const fileName = `web_${crypto.randomUUID()}.${ext}`;
          const storagePath = `${user.id}/${tripId}/${stepId}/${fileName}`;

          // Upload to storage
          const { error: uploadError } = await supabase.storage
            .from("trip-photos")
            .upload(storagePath, blob, { contentType: blob.type });

          if (uploadError) {
            console.error("Upload error:", uploadError);
            continue;
          }

          // Insert DB record
          const { error: dbError } = await supabase.from("step_photos").insert({
            step_id: stepId,
            user_id: user.id,
            storage_path: storagePath,
            file_name: fileName,
            is_suggested: false,
          });

          if (!dbError) savedCount++;
        } catch (err) {
          console.error("Error saving photo:", err);
        }
      }

      if (savedCount > 0) {
        toast.success(`${savedCount} image${savedCount > 1 ? "s" : ""} added`);
        onPhotosAdded();
        setOpen(false);
        setSearched(false);
        setPhotos([]);
        setSelected(new Set());
      } else {
        toast.error("Failed to save images");
      }
    } catch (err) {
      toast.error("Failed to save images");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => {
      setOpen(v);
      if (!v) {
        setSearched(false);
        setPhotos([]);
        setSelected(new Set());
      }
    }}>
      <DialogTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className="rounded-full gap-2 text-xs font-medium border-primary/20 text-primary hover:bg-primary hover:text-primary-foreground transition-colors"
        >
          <Globe className="h-3.5 w-3.5" />
          Add Images from Web
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-2xl max-h-[80vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle className="font-display">Add Images from Web</DialogTitle>
        </DialogHeader>

        <form
          className="flex gap-2 mt-2"
          onSubmit={(e) => {
            e.preventDefault();
            searchPlacePhotos(query);
          }}
        >
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search for a place..."
            className="flex-1"
          />
          <Button type="submit" size="sm" disabled={loading || !query.trim()}>
            <Search className="h-4 w-4" />
          </Button>
        </form>

        <div className="flex-1 overflow-y-auto mt-4 min-h-0">
          {loading ? (
            <div className="flex flex-col items-center justify-center gap-3 py-12">
              <Loader2 className="h-6 w-6 animate-spin text-primary" />
              <p className="text-sm text-muted-foreground">Searching for photos…</p>
            </div>
          ) : photos.length > 0 ? (
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              {photos.map((photo, idx) => {
                const isSelected = selected.has(idx);
                return (
                  <button
                    key={idx}
                    type="button"
                    onClick={() => toggleSelect(idx)}
                    className={`relative group aspect-[4/3] overflow-hidden rounded-xl border-2 transition-all ${
                      isSelected
                        ? "border-primary ring-2 ring-primary/20"
                        : "border-transparent hover:border-border"
                    }`}
                  >
                    <img
                      src={photo.url}
                      alt={`Place photo ${idx + 1}`}
                      className="h-full w-full object-cover"
                      loading="lazy"
                    />
                    <div
                      className={`absolute inset-0 transition-colors ${
                        isSelected ? "bg-primary/10" : "bg-black/0 group-hover:bg-black/10"
                      }`}
                    />
                    {isSelected && (
                      <div className="absolute top-2 right-2 flex h-6 w-6 items-center justify-center rounded-full bg-primary text-primary-foreground shadow">
                        <Check className="h-3.5 w-3.5" />
                      </div>
                    )}
                  </button>
                );
              })}
            </div>
          ) : searched ? (
            <div className="flex flex-col items-center justify-center gap-2 py-12 text-center">
              <Globe className="h-8 w-8 text-muted-foreground/40" />
              <p className="text-sm text-muted-foreground">No photos found. Try a different search.</p>
            </div>
          ) : null}
        </div>

        {selected.size > 0 && (
          <div className="flex items-center justify-between pt-4 border-t border-border mt-2">
            <p className="text-sm text-muted-foreground">
              {selected.size} image{selected.size > 1 ? "s" : ""} selected
            </p>
            <Button onClick={handleSave} disabled={saving} size="sm" className="gap-2">
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
              {saving ? "Saving…" : "Add Selected"}
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
