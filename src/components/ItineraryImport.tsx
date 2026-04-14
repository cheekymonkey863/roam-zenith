import { useState, useCallback } from "react";
import { FileText, Check, Loader2, X, Pencil, MapPin, Calendar, Clock } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "sonner";

import { ALL_EVENT_TYPES } from "@/lib/eventTypes";

interface ParsedStop {
  locationName: string;
  country: string;
  latitude: number | null;
  longitude: number | null;
  eventType: string;
  date: string | null;
  time: string | null;
  description: string;
  notes: string;
  selected: boolean;
}

interface ItineraryImportProps {
  tripId: string;
  onImportComplete: () => void;
  onCancel?: () => void;
}

async function extractTextFromFile(file: File): Promise<string> {
  if (file.type === "text/plain" || file.name.endsWith(".txt") || file.name.endsWith(".md")) {
    return file.text();
  }

  if (file.type === "application/pdf" || file.name.endsWith(".pdf")) {
    return extractTextFromPDF(file);
  }

  if (
    file.type === "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ||
    file.name.endsWith(".docx")
  ) {
    return extractTextFromDOCX(file);
  }

  return file.text();
}

async function extractTextFromPDF(file: File): Promise<string> {
  const pdfjsLib = await import("pdfjs-dist");
  pdfjsLib.GlobalWorkerOptions.workerSrc = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjsLib.version}/pdf.worker.min.mjs`;

  const buffer = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: buffer }).promise;
  const textParts: string[] = [];

  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    const pageText = content.items
      .map((item: any) => item.str)
      .join(" ");
    textParts.push(pageText);
  }

  const text = textParts.join("\n\n");
  return text || "Could not extract text from PDF. Please try copying and pasting the document text instead.";
}

async function extractTextFromDOCX(file: File): Promise<string> {
  const JSZip = (await import("jszip")).default;
  const buffer = await file.arrayBuffer();
  const zip = await JSZip.loadAsync(buffer);

  const docXml = zip.file("word/document.xml");
  if (!docXml) {
    return "Could not extract text from DOCX. Please try copying and pasting the document text instead.";
  }

  const xmlStr = await docXml.async("string");
  const paragraphs: string[] = [];
  const paraRegex = /<w:p[\s>]([\s\S]*?)<\/w:p>/g;
  let pMatch;

  while ((pMatch = paraRegex.exec(xmlStr)) !== null) {
    const paraContent = pMatch[1];
    const textParts: string[] = [];
    const wtRegex = /<w:t[^>]*>([^<]*)<\/w:t>/g;
    let tMatch;
    while ((tMatch = wtRegex.exec(paraContent)) !== null) {
      textParts.push(tMatch[1]);
    }
    if (textParts.length > 0) {
      paragraphs.push(textParts.join(""));
    }
  }

  const text = paragraphs.join("\n");
  return text || "Could not extract text from DOCX. Please try copying and pasting the document text instead.";
}

export function ItineraryImport({ tripId, onImportComplete, onCancel }: ItineraryImportProps) {
  const { user } = useAuth();
  const [dragOver, setDragOver] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [importing, setImporting] = useState(false);
  const [stops, setStops] = useState<ParsedStop[]>([]);
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [pasteMode, setPasteMode] = useState(false);
  const [pasteText, setPasteText] = useState("");

  const parseDocument = useCallback(async (text: string) => {
    setProcessing(true);
    setStops([]);

    try {
      const { data, error } = await supabase.functions.invoke("parse-itinerary", {
        body: { text },
      });

      if (error) throw error;

      // FIX: Combine the city and country returned by the AI into a single string for the UI
      const parsed: ParsedStop[] = (data?.activities || []).map((a: any) => ({
        ...a,
        locationName: a.locationName || a.activityName || "Unknown Location",
        country: [a.city, a.country].filter(Boolean).join(", "),
        selected: true,
      }));

      if (parsed.length === 0) {
        toast.error("No stops could be extracted from the document");
      } else {
        toast.success(`Found ${parsed.length} stops`);
      }

      setStops(parsed);
    } catch (err: any) {
      console.error("Parse error:", err);
      toast.error(err?.message || "Failed to parse document");
    } finally {
      setProcessing(false);
    }
  }, []);

  const handleFiles = useCallback(async (files: File[]) => {
    const file = files[0];
    if (!file) return;

    setProcessing(true);
    toast.info(`Reading ${file.name}...`);

    try {
      const text = await extractTextFromFile(file);
      if (text.length < 20) {
        toast.error("Could not extract enough text from the file. Try pasting the text instead.");
        setProcessing(false);
        return;
      }
      await parseDocument(text);
    } catch (err) {
      console.error("File read error:", err);
      toast.error("Failed to read file");
      setProcessing(false);
    }
  }, [parseDocument]);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const files = Array.from(e.dataTransfer.files);
    handleFiles(files);
  }, [handleFiles]);

  const handleFileSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    handleFiles(files);
  }, [handleFiles]);

  const handlePasteSubmit = useCallback(() => {
    if (pasteText.trim().length < 20) {
      toast.error("Please paste more text");
      return;
    }
    parseDocument(pasteText);
  }, [pasteText, parseDocument]);

  const toggleStop = (index: number) => {
    setStops((prev) => prev.map((s, i) => (i === index ? { ...s, selected: !s.selected } : s)));
  };

  const updateStop = (index: number, updates: Partial<ParsedStop>) => {
    setStops((prev) => prev.map((s, i) => (i === index ? { ...s, ...updates } : s)));
  };

  const importSelected = async () => {
    if (!user) return;
    const selected = stops.filter((s) => s.selected);
    if (selected.length === 0) return;

    setImporting(true);
    try {
      const rows = [];
      
      for (const a of selected) {
        let recordedAt = new Date().toISOString();
        if (a.date) {
          const dateStr = a.time ? `${a.date}T${a.time}:00` : `${a.date}T12:00:00`;
          const d = new Date(dateStr);
          if (!isNaN(d.getTime())) recordedAt = d.toISOString();
        }

        let lat = a.latitude || 0;
        let lon = a.longitude || 0;

        // If the AI failed to grab coordinates, actively geocode them now so they show up on the map!
        if (lat === 0 && lon === 0 && (a.locationName || a.country)) {
          try {
            const query = encodeURIComponent(`${a.locationName || ''} ${a.country || ''}`.trim());
            const res = await fetch(`https://nominatim.openstreetmap.org/search?format=json&q=${query}&limit=1`);
            if (res.ok) {
              const data = await res.json();
              if (data && data.length > 0) {
                lat = parseFloat(data[0].lat);
                lon = parseFloat(data[0].lon);
              }
            }
            await new Promise(resolve => setTimeout(resolve, 1000));
          } catch (e) {
            console.error("Geocoding fallback failed", e);
          }
        }

        rows.push({
          trip_id: tripId,
          user_id: user.id,
          location_name: a.locationName, // Enforces Place Title
          country: a.country,            // Enforces City, Country Subtitle
          latitude: lat,
          longitude: lon,
          event_type: a.eventType,
          description: a.description,
          notes: a.notes || null,
          recorded_at: recordedAt,
          source: "itinerary_import",
          is_confirmed: true,
        });
      }

      const { error } = await supabase.from("trip_steps").insert(rows);
      if (error) throw error;

      toast.success(`Imported ${rows.length} stops`);
      setStops([]);
      onImportComplete();
    } catch (err: any) {
      console.error("Import error:", err);
      toast.error(err?.message || "Failed to import stops");
    } finally {
      setImporting(false);
    }
  };

  const eventTypeLabel = (val: string) => ALL_EVENT_TYPES.find((t) => t.value === val)?.label || val;

  return (
    <div className="flex flex-col gap-6">
      {stops.length === 0 && !processing && (
        <div className="flex flex-col gap-3">
          {!pasteMode ? (
            <label
              onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
              onDragLeave={() => setDragOver(false)}
              onDrop={handleDrop}
              className={`flex cursor-pointer flex-col items-center gap-4 rounded-2xl border-2 border-dashed p-12 transition-colors ${
                dragOver ? "border-primary bg-primary/5" : "border-border hover:border-primary/50"
              }`}
            >
              <FileText className="h-10 w-10 text-muted-foreground" />
              <div className="text-center">
                <p className="font-medium text-foreground">Drop your document here</p>
                <p className="text-sm text-muted-foreground">Supports PDF, DOCX, and text files</p>
              </div>
              <input
                type="file"
                accept=".pdf,.docx,.doc,.txt,.md,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain"
                onChange={handleFileSelect}
                className="hidden"
              />
              <div className="flex items-center gap-3">
                <span className="rounded-xl bg-primary px-4 py-2 text-sm font-medium text-primary-foreground">Browse Files</span>
                <button
                  type="button"
                  onClick={(e) => { e.preventDefault(); setPasteMode(true); }}
                  className="rounded-xl bg-secondary px-4 py-2 text-sm font-medium text-secondary-foreground hover:bg-secondary/80 transition-colors"
                >
                  Paste Text
                </button>
              </div>
            </label>
          ) : (
            <div className="flex flex-col gap-3 rounded-2xl border border-border p-6">
              <p className="font-medium text-foreground">Paste your document text</p>
              <textarea
                value={pasteText}
                onChange={(e) => setPasteText(e.target.value)}
                placeholder="Paste your booking confirmation or travel plan here..."
                className="min-h-[200px] w-full rounded-xl border border-border bg-background p-4 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/30"
              />
              <div className="flex items-center gap-2 self-end">
                <button
                  onClick={() => { setPasteMode(false); setPasteText(""); }}
                  className="rounded-xl bg-secondary px-4 py-2 text-sm font-medium text-secondary-foreground hover:bg-secondary/80 transition-colors"
                >
                  Back
                </button>
                <button
                  onClick={handlePasteSubmit}
                  disabled={pasteText.trim().length < 20}
                  className="rounded-xl bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50"
                >
                  Parse Document
                </button>
              </div>
            </div>
          )}

          {onCancel && (
            <button onClick={onCancel} className="self-end flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors">
              <X className="h-4 w-4" />
              Cancel
            </button>
          )}
        </div>
      )}

      {processing && (
        <div className="flex flex-col items-center gap-3 rounded-2xl bg-card p-8 shadow-card">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
          <p className="text-sm text-muted-foreground">Parsing your document with AI...</p>
        </div>
      )}

      {stops.length > 0 && (
        <div className="flex flex-col gap-4">
          <div className="flex items-center justify-between">
            <h3 className="font-display text-lg font-semibold text-foreground">
              Trip Stops ({stops.filter((s) => s.selected).length}/{stops.length})
            </h3>
            <div className="flex items-center gap-2">
              {onCancel && (
                <button onClick={onCancel} className="flex items-center gap-1.5 rounded-xl bg-secondary px-4 py-2 text-sm font-medium text-secondary-foreground hover:bg-secondary/80 transition-colors">
                  <X className="h-4 w-4" />
                  Cancel
                </button>
              )}
              <button
                onClick={importSelected}
                disabled={importing || stops.filter((s) => s.selected).length === 0}
                className="flex items-center gap-2 rounded-xl bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50"
              >
                {importing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
                {importing ? "Importing..." : "Import Selected"}
              </button>
            </div>
          </div>

          <div className="flex flex-col gap-3">
            {stops.map((stop, index) => (
              <div
                key={index}
                className={`rounded-xl border p-4 transition-colors ${
                  stop.selected ? "border-primary/30 bg-card" : "border-border bg-muted/30 opacity-60"
                }`}
              >
                <div className="flex items-start gap-3">
                  <button
                    onClick={() => toggleStop(index)}
                    className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded border transition-colors ${
                      stop.selected ? "border-primary bg-primary text-primary-foreground" : "border-border"
                    }`}
                  >
                    {stop.selected && <Check className="h-3 w-3" />}
                  </button>

                  <div className="flex-1 min-w-0">
                    {editingIndex === index ? (
                      <div className="flex flex-col gap-3">
                        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                          <input
                            value={stop.locationName}
                            onChange={(e) => updateStop(index, { locationName: e.target.value })}
                            className="rounded-lg border border-border bg-background px-3 py-1.5 text-sm"
                            placeholder="Location name (Venue, Airport, etc.)"
                          />
                          <input
                            value={stop.country}
                            onChange={(e) => updateStop(index, { country: e.target.value })}
                            className="rounded-lg border border-border bg-background px-3 py-1.5 text-sm"
                            placeholder="City, Country"
                          />
                          <input
                            type="date"
                            value={stop.date || ""}
                            onChange={(e) => updateStop(index, { date: e.target.value || null })}
                            className="rounded-lg border border-border bg-background px-3 py-1.5 text-sm"
                          />
                          <input
                            type="time"
                            value={stop.time || ""}
                            onChange={(e) => updateStop(index, { time: e.target.value || null })}
                            className="rounded-lg border border-border bg-background px-3 py-1.5 text-sm"
                          />
                          <select
                            value={stop.eventType}
                            onChange={(e) => updateStop(index, { eventType: e.target.value })}
                            className="rounded-lg border border-border bg-background px-3 py-1.5 text-sm"
                          >
                            {ALL_EVENT_TYPES.map((t) => (
                              <option key={t.value} value={t.value}>{t.label}</option>
                            ))}
                          </select>
                        </div>
                        <textarea
                          value={stop.description}
                          onChange={(e) => updateStop(index, { description: e.target.value })}
                          className="rounded-lg border border-border bg-background px-3 py-1.5 text-sm"
                          placeholder="Description"
                          rows={2}
                        />
                        <textarea
                          value={stop.notes}
                          onChange={(e) => updateStop(index, { notes: e.target.value })}
                          className="rounded-lg border border-border bg-background px-3 py-1.5 text-sm"
                          placeholder="Notes (booking refs, addresses, etc.)"
                          rows={2}
                        />
                        <button
                          onClick={() => setEditingIndex(null)}
                          className="self-end rounded-lg bg-primary px-3 py-1 text-xs font-medium text-primary-foreground"
                        >
                          Done
                        </button>
                      </div>
                    ) : (
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex flex-col gap-1">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="font-medium text-foreground">{stop.locationName}</span>
                            <span className="rounded-full bg-accent/50 px-2 py-0.5 text-xs text-accent-foreground">
                              {eventTypeLabel(stop.eventType)}
                            </span>
                          </div>
                          <div className="flex items-center gap-3 text-xs text-muted-foreground flex-wrap">
                            {stop.country && (
                              <span className="flex items-center gap-1">
                                <MapPin className="h-3 w-3" />
                                {stop.country}
                              </span>
                            )}
                            {stop.date && (
                              <span className="flex items-center gap-1">
                                <Calendar className="h-3 w-3" />
                                {stop.date}
                              </span>
                            )}
                            {stop.time && (
                              <span className="flex items-center gap-1">
                                <Clock