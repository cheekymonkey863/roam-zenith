import { useCallback, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Plus, ChevronDown, ChevronUp, Image, FileText, Mail, Loader2, X, MapPin } from "lucide-react";
import { format } from "date-fns";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { parseTripCountriesInput } from "@/lib/tripManagement";
import { Switch } from "@/components/ui/switch";
import { toast } from "sonner";
import { setPendingImport, type PendingStop } from "@/lib/pendingImportStore";
import { processImportedMediaFiles } from "@/lib/mediaImport";
import { getEventType } from "@/lib/eventTypes";

// Duplicated text extraction helpers from ItineraryImport (kept lightweight)
async function extractTextFromFile(file: File): Promise<string> {
  if (file.type === "text/plain" || file.name.endsWith(".txt") || file.name.endsWith(".md")) {
    return file.text();
  }
  if (file.type === "application/pdf" || file.name.endsWith(".pdf")) {
    const pdfjsLib = await import("pdfjs-dist");
    pdfjsLib.GlobalWorkerOptions.workerSrc = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjsLib.version}/pdf.worker.min.mjs`;
    const buffer = await file.arrayBuffer();
    const pdf = await pdfjsLib.getDocument({ data: buffer }).promise;
    const parts: string[] = [];
    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i);
      const content = await page.getTextContent();
      parts.push(content.items.map((item: any) => item.str).join(" "));
    }
    return parts.join("\n\n") || "";
  }
  if (file.name.endsWith(".docx")) {
    const JSZip = (await import("jszip")).default;
    const buffer = await file.arrayBuffer();
    const zip = await JSZip.loadAsync(buffer);
    const docXml = zip.file("word/document.xml");
    if (!docXml) return "";
    const xmlStr = await docXml.async("string");
    const paragraphs: string[] = [];
    const paraRegex = /<w:p[\s>]([\s\S]*?)<\/w:p>/g;
    let pMatch;
    while ((pMatch = paraRegex.exec(xmlStr)) !== null) {
      const textParts: string[] = [];
      const wtRegex = /<w:t[^>]*>([^<]*)<\/w:t>/g;
      let tMatch;
      while ((tMatch = wtRegex.exec(pMatch[1])) !== null) textParts.push(tMatch[1]);
      if (textParts.length > 0) paragraphs.push(textParts.join(""));
    }
    return paragraphs.join("\n") || "";
  }
  return file.text();
}

export function DashboardTripForm({ onTripAdded }: { onTripAdded?: () => void }) {
  const { user } = useAuth();
  const navigate = useNavigate();

  const [isOpen, setIsOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [countriesText, setCountriesText] = useState("");
  const [trackInBackground, setTrackInBackground] = useState(false);
  const [creating, setCreating] = useState(false);

  // Import preview state
  const [importType, setImportType] = useState<"photos" | "document" | "inbox" | null>(null);
  const [importedStops, setImportedStops] = useState<PendingStop[]>([]);
  const [pendingFiles, setPendingFiles] = useState<File[]>([]);
  const [extracting, setExtracting] = useState(false);

  const photoInputRef = useRef<HTMLInputElement>(null);
  const docInputRef = useRef<HTMLInputElement>(null);

  const generateTripTitle = (countries: string[], sDate: string, eDate: string): string => {
    const countryPart = countries.length > 0 ? countries.join(", ") : "New Trip";
    if (sDate) {
      const startFormatted = format(new Date(sDate + "T00:00:00"), "MMM-yy");
      const endFormatted = eDate ? format(new Date(eDate + "T00:00:00"), "MMM-yy") : startFormatted;
      return startFormatted === endFormatted
        ? `${countryPart} | ${startFormatted}`
        : `${countryPart} | ${startFormatted} - ${endFormatted}`;
    }
    return countryPart;
  };

  const autoFillFromStops = (stops: PendingStop[]) => {
    const countries = [...new Set(stops.map((s) => s.country).filter(Boolean))];
    const dates = stops
      .map((s) => (s.date ? new Date(s.date) : null))
      .filter(Boolean) as Date[];
    dates.sort((a, b) => a.getTime() - b.getTime());

    if (countries.length > 0) setCountriesText(countries.join(", "));
    if (dates.length > 0) {
      const sd = format(dates[0], "yyyy-MM-dd");
      const ed = format(dates[dates.length - 1], "yyyy-MM-dd");
      setStartDate(sd);
      setEndDate(ed);
    }

    const autoTitle = generateTripTitle(
      countries,
      dates.length > 0 ? format(dates[0], "yyyy-MM-dd") : "",
      dates.length > 0 ? format(dates[dates.length - 1], "yyyy-MM-dd") : ""
    );
    if (!title.trim()) setTitle(autoTitle);
  };

  // Handle photo file selection
  const handlePhotoFiles = useCallback(
    async (files: File[]) => {
      if (files.length === 0) return;
      setExtracting(true);
      setImportType("photos");
      setPendingFiles(files);
      try {
        const result = await processImportedMediaFiles(files);
        const stops: PendingStop[] = result.steps.map((s) => ({
          locationName: s.locationName,
          country: s.country,
          latitude: s.latitude,
          longitude: s.longitude,
          eventType: s.eventType,
          date: s.earliestDate ? s.earliestDate.toISOString() : null,
          description: s.description,
          notes: "",
        }));
        setImportedStops(stops);
        autoFillFromStops(stops);
        toast.success(`Found ${stops.length} stops from ${files.length} files`);
      } catch (err) {
        console.error("Photo extraction error:", err);
        toast.error("Failed to extract photo metadata");
        setImportType(null);
        setPendingFiles([]);
      } finally {
        setExtracting(false);
      }
    },
    [title],
  );

  // Handle document file selection
  const handleDocumentFiles = useCallback(
    async (files: File[]) => {
      const file = files[0];
      if (!file) return;
      setExtracting(true);
      setImportType("document");
      setPendingFiles([file]);
      try {
        const text = await extractTextFromFile(file);
        if (text.length < 20) {
          toast.error("Could not extract enough text from the file");
          setExtracting(false);
          setImportType(null);
          setPendingFiles([]);
          return;
        }
        const { data, error } = await supabase.functions.invoke("parse-itinerary", {
          body: { text },
        });
        if (error) throw error;

        const stops: PendingStop[] = (data?.activities || []).map((a: any) => ({
          locationName: a.locationName || a.activityName || "Unknown Location",
          country: [a.city, a.country].filter(Boolean).join(", "),
          latitude: a.latitude ?? null,
          longitude: a.longitude ?? null,
          eventType: a.eventType || "other",
          date: a.date || null,
          description: a.description || "",
          notes: a.notes || "",
        }));
        setImportedStops(stops);
        autoFillFromStops(stops);
        if (stops.length === 0) {
          toast.error("No stops could be extracted from the document");
        } else {
          toast.success(`Found ${stops.length} stops`);
        }
      } catch (err: any) {
        console.error("Document parse error:", err);
        toast.error(err?.message || "Failed to parse document");
        setImportType(null);
        setPendingFiles([]);
      } finally {
        setExtracting(false);
      }
    },
    [title],
  );

  const clearImport = () => {
    setImportType(null);
    setImportedStops([]);
    setPendingFiles([]);
  };

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;

    const finalTitle = title.trim() || generateTripTitle(
      parseTripCountriesInput(countriesText),
      startDate,
      endDate
    );
    if (!finalTitle || finalTitle === "New Trip") {
      toast.error("Please enter a trip name or import data first");
      return;
    }

    setCreating(true);
    try {
      const countries = parseTripCountriesInput(countriesText);
      const { data, error } = await supabase
        .from("trips")
        .insert({
          user_id: user.id,
          title: finalTitle,
          start_date: startDate || null,
          end_date: endDate || null,
          is_active: trackInBackground,
          countries,
        } as any)
        .select()
        .single();
      if (error) throw error;

      // If we have pending import data, store it for the trip page
      if (importType && pendingFiles.length > 0) {
        setPendingImport({
          type: importType,
          files: pendingFiles,
          stops: importedStops,
          countries,
          startDate: startDate || null,
          endDate: endDate || null,
        });
      }

      toast.success("Trip created!");
      setIsOpen(false);
      setTitle("");
      setCountriesText("");
      setStartDate("");
      setEndDate("");
      clearImport();
      onTripAdded?.();
      navigate(`/trip/${data.id}${importType ? `?import=${importType}` : ""}`);
    } catch {
      toast.error("Failed to create trip");
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className="rounded-2xl border border-border bg-card shadow-sm">
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className="flex w-full items-center justify-between p-5 hover:bg-secondary/30 transition-colors"
      >
        <div className="flex items-center gap-3">
          <Plus className="h-5 w-5 text-primary" />
          <span className="font-display font-semibold">Add a New Trip</span>
        </div>
        {isOpen ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
      </button>

      {isOpen && (
        <form onSubmit={handleCreate} className="p-6 border-t border-border flex flex-col gap-6">
          {/* Import options - at the top */}
          <div className="flex flex-col gap-2">
            <label className="text-xs font-bold text-muted-foreground uppercase">Add stops from</label>
            <div className="grid grid-cols-3 gap-3">
              <button
                type="button"
                disabled={extracting || creating}
                onClick={() => photoInputRef.current?.click()}
                className="flex flex-col items-center gap-2 rounded-xl border border-border bg-background p-4 text-sm font-medium hover:bg-secondary/40 transition-colors disabled:opacity-50"
              >
                <Image className="h-5 w-5 text-primary" />
                <span>Photos</span>
              </button>
              <button
                type="button"
                disabled={extracting || creating}
                onClick={() => docInputRef.current?.click()}
                className="flex flex-col items-center gap-2 rounded-xl border border-border bg-background p-4 text-sm font-medium hover:bg-secondary/40 transition-colors disabled:opacity-50"
              >
                <FileText className="h-5 w-5 text-primary" />
                <span>Document</span>
              </button>
              <button
                type="button"
                disabled={extracting || creating}
                onClick={() => {
                  // Inbox still creates trip immediately since it needs a trip_id for staging
                  if (!user) return;
                  const inboxTitle = title.trim() || "New Trip";
                  setCreating(true);
                  supabase
                    .from("trips")
                    .insert({
                      user_id: user.id,
                      title: inboxTitle,
                      start_date: startDate || null,
                      end_date: endDate || null,
                      is_active: trackInBackground,
                      countries: parseTripCountriesInput(countriesText),
                    } as any)
                    .select()
                    .single()
                    .then(({ data, error }) => {
                      setCreating(false);
                      if (error || !data) {
                        toast.error("Failed to create trip");
                        return;
                      }
                      toast.success("Trip created!");
                      setIsOpen(false);
                      onTripAdded?.();
                      navigate(`/trip/${data.id}?import=inbox`);
                    });
                }}
                className="flex flex-col items-center gap-2 rounded-xl border border-border bg-background p-4 text-sm font-medium hover:bg-secondary/40 transition-colors disabled:opacity-50"
              >
                <Mail className="h-5 w-5 text-primary" />
                <span>Inbox</span>
              </button>
            </div>
            <input
              ref={photoInputRef}
              type="file"
              accept="image/*,video/*,.heic,.heif"
              multiple
              className="hidden"
              onChange={(e) => {
                const files = Array.from(e.target.files || []);
                if (files.length > 0) handlePhotoFiles(files);
                e.target.value = "";
              }}
            />
            <input
              ref={docInputRef}
              type="file"
              accept=".pdf,.docx,.txt,.md"
              className="hidden"
              onChange={(e) => {
                const files = Array.from(e.target.files || []);
                if (files.length > 0) handleDocumentFiles(files);
                e.target.value = "";
              }}
            />
          </div>

          {/* Extracting indicator */}
          {extracting && (
            <div className="flex items-center gap-3 rounded-xl border border-border bg-secondary/20 p-4">
              <Loader2 className="h-4 w-4 animate-spin text-primary" />
              <span className="text-sm text-muted-foreground">Extracting stop data...</span>
            </div>
          )}

          {/* Import preview - confirmed stops */}
          {importedStops.length > 0 && (
            <div className="flex flex-col gap-2">
              <div className="flex items-center justify-between">
                <label className="text-xs font-bold text-muted-foreground uppercase">
                  Confirmed Stops ({importedStops.length})
                </label>
                <button
                  type="button"
                  onClick={clearImport}
                  className="text-xs text-muted-foreground hover:text-foreground transition-colors"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
              <div className="max-h-48 overflow-y-auto rounded-xl border border-border bg-background">
                {importedStops.map((stop, i) => {
                  const evtType = getEventType(stop.eventType);
                  const Icon = evtType?.icon || MapPin;
                  return (
                    <div
                      key={i}
                      className="flex items-center gap-3 px-3 py-2 border-b border-border last:border-0"
                    >
                      <Icon className="h-4 w-4 text-primary shrink-0" />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium truncate">{stop.locationName}</p>
                        <p className="text-xs text-muted-foreground truncate">
                          {[stop.country, stop.date ? format(new Date(stop.date), "MMM d, yyyy") : null]
                            .filter(Boolean)
                            .join(" · ")}
                        </p>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          <div className="flex flex-col gap-2">
            <label className="text-xs font-bold text-muted-foreground uppercase">Trip Name</label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="rounded-xl border border-border bg-background p-3 text-sm"
              placeholder={importedStops.length > 0 ? "Auto-generated from import" : "Trip Name"}
            />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="flex flex-col gap-2">
              <label className="text-xs font-bold text-muted-foreground uppercase">Start Date</label>
              <input
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                className="rounded-xl border border-border bg-background p-3 text-sm"
              />
            </div>
            <div className="flex flex-col gap-2">
              <label className="text-xs font-bold text-muted-foreground uppercase">End Date</label>
              <input
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                className="rounded-xl border border-border bg-background p-3 text-sm"
              />
            </div>
          </div>
          <div className="flex flex-col gap-2">
            <label className="text-xs font-bold text-muted-foreground uppercase">Countries</label>
            <input
              type="text"
              value={countriesText}
              onChange={(e) => setCountriesText(e.target.value)}
              className="rounded-xl border border-border bg-background p-3 text-sm"
              placeholder="e.g. France, Italy, Spain"
            />
            <p className="text-xs text-muted-foreground">Comma-separated list of countries</p>
          </div>
          <div className="flex items-center justify-between py-2">
            <span className="text-sm font-medium">Track in background</span>
            <Switch checked={trackInBackground} onCheckedChange={setTrackInBackground} />
          </div>

          <button
            type="submit"
            disabled={creating || extracting}
            className="rounded-xl bg-primary py-3 text-sm font-bold text-primary-foreground hover:bg-primary/90 transition-all disabled:opacity-50"
          >
            {creating ? "Creating..." : "Add Trip"}
          </button>
        </form>
      )}
    </div>
  );
}
