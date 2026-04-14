import { useState, useRef } from "react";
import { Plus, X, Search, Loader2, MapPin, FileUp } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "sonner";
import { PendingPhotoUpload, type SelectedFile } from "@/components/ActivityPhotoUpload";
import { useGooglePlacesSearch } from "@/hooks/useGooglePlacesSearch";
import { EventTypeSelect } from "@/components/EventTypeSelect";
import { getEventType } from "@/lib/eventTypes";
import JSZip from "jszip";
import pdfWorkerSrc from "pdfjs-dist/build/pdf.worker.min.mjs?url";

interface AddEventFormProps {
  tripId: string;
  onEventAdded: () => void;
}

async function extractTextFromPDF(file: File): Promise<string> {
  const pdfjsLib = await import("pdfjs-dist");
  const buffer = await file.arrayBuffer();

  try {
    pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerSrc;
    const pdf = await pdfjsLib.getDocument({ data: buffer }).promise;
    const textParts: string[] = [];

    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i);
      const content = await page.getTextContent();
      textParts.push(content.items.map((item: any) => item.str).join(" "));
    }

    return textParts.join("\n\n");
  } catch (workerError) {
    console.error("PDF worker extraction failed, retrying without worker:", workerError);
    const pdf = await pdfjsLib.getDocument({
      data: buffer,
      disableWorker: true,
    } as any).promise;
    const textParts: string[] = [];

    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i);
      const content = await page.getTextContent();
      textParts.push(content.items.map((item: any) => item.str).join(" "));
    }

    return textParts.join("\n\n");
  }
}

async function extractTextFromFile(file: File): Promise<string> {
  const name = file.name.toLowerCase();

  if (name.endsWith(".txt") || name.endsWith(".md")) {
    return file.text();
  }

  if (name.endsWith(".pdf")) {
    return extractTextFromPDF(file);
  }

  if (name.endsWith(".docx")) {
    const zip = await JSZip.loadAsync(await file.arrayBuffer());
    const xml = await zip.file("word/document.xml")?.async("string");
    if (!xml) return "";
    return xml
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  return file.text();
}

export function AddEventForm({
  tripId,
  onEventAdded,
  isOpen,
  onClose,
}: AddEventFormProps & { isOpen?: boolean; onClose?: () => void }) {
  const { user } = useAuth();
  const [internalOpen, setInternalOpen] = useState(false);
  const open = isOpen ?? internalOpen;
  const setOpen = onClose
    ? (v: boolean) => {
        if (!v) onClose();
      }
    : setInternalOpen;
  const [saving, setSaving] = useState(false);
  const [parsing, setParsing] = useState(false);
  const [eventType, setEventType] = useState("");
  const [activityName, setActivityName] = useState("");
  const [description, setDescription] = useState("");
  const [date, setDate] = useState(new Date().toISOString().slice(0, 16));
  const [notes, setNotes] = useState("");
  const [pendingPhotos, setPendingPhotos] = useState<SelectedFile[]>([]);
  const places = useGooglePlacesSearch();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const resetForm = () => {
    setEventType("");
    setActivityName("");
    setDescription("");
    setDate(new Date().toISOString().slice(0, 16));
    setNotes("");
    pendingPhotos.forEach((f) => URL.revokeObjectURL(f.preview));
    setPendingPhotos([]);
    places.reset();
  };

  const uploadPhotosForStep = async (stepId: string) => {
    if (!user || pendingPhotos.length === 0) return;

    for (const { file } of pendingPhotos) {
      const ext = file.name.split(".").pop() || "jpg";
      const path = `${user.id}/${tripId}/${stepId}/${crypto.randomUUID()}.${ext}`;
      const { error: uploadError } = await supabase.storage.from("trip-photos").upload(path, file);

      if (uploadError) {
        console.error("Upload error:", uploadError);
        continue;
      }

      await supabase.from("step_photos").insert({
        step_id: stepId,
        user_id: user.id,
        storage_path: path,
        file_name: file.name,
      });
    }
  };

  const handleConfirmationUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (fileInputRef.current) fileInputRef.current.value = "";

    setParsing(true);

    try {
      const text = await extractTextFromFile(file);
      if (text.trim().length < 5) {
        toast.error("Could not extract text from this file");
        setParsing(false);
        return;
      }

      const { data, error } = await supabase.functions.invoke("parse-confirmation", {
        body: { text },
      });

      if (error || !data?.event) {
        toast.error("Failed to parse confirmation");
        console.error(error);
        setParsing(false);
        return;
      }

      const evt = data.event;

      if (evt.eventType) setEventType(evt.eventType);
      if (evt.activityName) setActivityName(evt.activityName);
      if (evt.description) setDescription(evt.description);
      if (evt.notes) setNotes(evt.notes);
      if (evt.date) {
        const time = evt.time || "12:00";
        setDate(`${evt.date}T${time}`);
      }

      if (evt.latitude && evt.longitude && evt.locationName) {
        const displayName = [evt.locationName, evt.city, evt.country].filter(Boolean).join(", ");
        places.setQuery(displayName);
        places.setSelectedPlace({
          display_name: displayName,
          lat: String(evt.latitude),
          lon: String(evt.longitude),
          address: {
            city: evt.city || "",
            country: evt.country || "",
          },
        });
      }

      toast.success("Confirmation parsed! Review and save.");
    } catch (err) {
      console.error(err);
      toast.error("Error parsing confirmation document");
    }

    setParsing(false);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;
    if (!eventType) {
      toast.error("Please choose an event type");
      return;
    }
    if (!places.selectedPlace) {
      toast.error("Please search and select a location");
      return;
    }
    if (!activityName.trim()) {
      toast.error("Please enter a place name");
      return;
    }

    setSaving(true);

    // FIX: Extract City, State/Country cleanly from the selected place object
    let formattedCountry = null;
    if (places.selectedPlace.address) {
      const addr = places.selectedPlace.address;
      const city = addr.city || addr.town || addr.village || addr.county || "";
      const state = addr.state || "";
      const cc = addr.country || (addr.country_code ? addr.country_code.toUpperCase() : "");
      formattedCountry = [city, state || cc].filter(Boolean).join(", ");
    } else {
      // Fallback if the address object isn't perfectly structured
      const parts = places.selectedPlace.display_name.split(",");
      if (parts.length >= 3) {
        formattedCountry = [parts[parts.length - 3].trim(), parts[parts.length - 1].trim()].join(", ");
      } else if (parts.length > 1) {
        formattedCountry = parts[parts.length - 1].trim();
      } else {
        formattedCountry = places.selectedPlace.display_name;
      }
    }

    const { data, error } = await supabase
      .from("trip_steps")
      .insert({
        trip_id: tripId,
        user_id: user.id,
        latitude: parseFloat(places.selectedPlace.lat),
        longitude: parseFloat(places.selectedPlace.lon),
        location_name: activityName.trim(), // Enforces Place Title
        country: formattedCountry, // Enforces City, Country Subtitle
        description: description.trim() || null,
        notes: notes.trim() || null,
        recorded_at: new Date(date).toISOString(),
        source: "manual",
        event_type: eventType,
        is_confirmed: true, // It's manual, so no AI override needed
      })
      .select()
      .single();

    if (error || !data) {
      toast.error("Failed to add stop");
      console.error(error);
    } else {
      await uploadPhotosForStep(data.id);
      toast.success("Stop added successfully!");
      resetForm();
      setOpen(false);
      onEventAdded();
    }

    setSaving(false);
  };

  if (!open) {
    if (isOpen !== undefined) return null;
    return (
      <button
        onClick={() => setInternalOpen(true)}
        className="flex items-center gap-2 rounded-xl bg-secondary px-4 py-2.5 text-sm font-medium text-secondary-foreground hover:bg-secondary/80 transition-colors"
      >
        <Plus className="h-4 w-4" /> Add Trip Stop
      </button>
    );
  }

  const selectedType = getEventType(eventType);

  return (
    <div className="rounded-2xl bg-card p-6 shadow-card">
      <div className="mb-5 flex items-center justify-between">
        <h3 className="font-display text-lg font-semibold text-foreground">Add Trip Stop</h3>
        <button
          onClick={() => {
            setOpen(false);
            resetForm();
          }}
          className="rounded-lg p-1.5 text-muted-foreground hover:bg-secondary transition-colors"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <form onSubmit={handleSubmit} className="flex flex-col gap-5">
        <div>
          <input
            ref={fileInputRef}
            type="file"
            accept=".pdf,.docx,.txt,.md,.html"
            onChange={handleConfirmationUpload}
            className="hidden"
          />
          <button
            type="button"
            disabled={parsing}
            onClick={() => fileInputRef.current?.click()}
            className="flex w-full items-center justify-center gap-2 rounded-xl border-2 border-dashed border-primary/30 bg-primary/5 px-4 py-3 text-sm font-medium text-primary hover:border-primary/50 hover:bg-primary/10 disabled:opacity-50 transition-colors"
          >
            {parsing ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" /> Parsing document...
              </>
            ) : (
              <>
                <FileUp className="h-4 w-4" /> Import from Document
              </>
            )}
          </button>
        </div>

        <div className="flex flex-col gap-2">
          <label className="text-sm font-medium text-foreground">Event Type</label>
          <EventTypeSelect value={eventType} onValueChange={setEventType} />
        </div>

        <div className="flex flex-col gap-1.5">
          <label className="text-sm font-medium text-foreground">Place / Venue Name *</label>
          <input
            type="text"
            value={activityName}
            onChange={(e) => setActivityName(e.target.value)}
            placeholder="e.g. Eiffel Tower, The British Museum"
            className="rounded-xl border border-border bg-background px-4 py-2.5 text-sm text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
            required
          />
        </div>

        <div className="relative flex flex-col gap-1.5" ref={places.resultsRef}>
          <label className="text-sm font-medium text-foreground">City / Exact Location *</label>
          <div className="relative">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <input
              type="text"
              value={places.query}
              onChange={(e) => {
                places.setQuery(e.target.value);
                places.setSelectedPlace(null);
              }}
              onFocus={() => places.results.length > 0 && places.setShowResults(true)}
              placeholder="Search for a city or address to pin on map..."
              className="w-full rounded-xl border border-border bg-background py-2.5 pl-10 pr-10 text-sm text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
            />
            {places.searching && (
              <Loader2 className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-muted-foreground" />
            )}
            {places.selectedPlace && !places.searching && (
              <MapPin className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-accent" />
            )}
          </div>

          {places.showResults && places.results.length > 0 && (
            <div className="absolute left-0 right-0 top-full z-50 mt-1 max-h-56 overflow-y-auto rounded-xl border border-border bg-card shadow-lg">
              {places.results.map((place, i) => (
                <button
                  key={i}
                  type="button"
                  onClick={() => places.selectPlace(place)}
                  className="flex w-full items-start gap-2.5 border-b border-border px-4 py-3 text-left text-sm transition-colors last:border-b-0 hover:bg-secondary/60"
                >
                  <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                  <span className="leading-snug text-foreground">{place.display_name}</span>
                </button>
              ))}
            </div>
          )}

          {places.showResults && places.results.length === 0 && places.query.length >= 3 && !places.searching && (
            <div className="absolute left-0 right-0 top-full z-50 mt-1 rounded-xl border border-border bg-card p-4 text-center text-sm text-muted-foreground shadow-lg">
              No places found
            </div>
          )}
        </div>

        <div className="flex flex-col gap-1.5">
          <label className="text-sm font-medium text-foreground">Date & Time</label>
          <input
            type="datetime-local"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className="rounded-xl border border-border bg-background px-4 py-2.5 text-sm text-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <label className="text-sm font-medium text-foreground">Description</label>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="A short description of this stop..."
            rows={2}
            className="resize-none rounded-xl border border-border bg-background px-4 py-2.5 text-sm text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <label className="text-sm font-medium text-foreground">Notes</label>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Any details, booking references, etc."
            rows={2}
            className="resize-none rounded-xl border border-border bg-background px-4 py-2.5 text-sm text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
          />
        </div>

        <PendingPhotoUpload files={pendingPhotos} onFilesChange={setPendingPhotos} />

        <button
          type="submit"
          disabled={saving || !places.selectedPlace}
          className="flex items-center justify-center gap-2 rounded-xl bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50"
        >
          {saving ? (
            "Saving..."
          ) : (
            <>
              {selectedType && <selectedType.icon className="h-4 w-4" />} Add {selectedType?.label || "Stop"}
            </>
          )}
        </button>
      </form>
    </div>
  );
}
