import { useState, useCallback } from "react";
import { FileText, Check, Loader2, X, Pencil, MapPin, Calendar, Clock } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "sonner";

import { ALL_EVENT_TYPES } from "@/lib/eventTypes";

interface ParsedActivity {
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
  return text || "Could not extract text from PDF. Please try copying and pasting the itinerary text instead.";
}

async function extractTextFromDOCX(file: File): Promise<string> {
  const JSZip = (await import("jszip")).default;
  const buffer = await file.arrayBuffer();
  const zip = await JSZip.loadAsync(buffer);

  const docXml = zip.file("word/document.xml");
  if (!docXml) {
    return "Could not extract text from DOCX. Please try copying and pasting the itinerary text instead.";
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
  return text || "Could not extract text from DOCX. Please try copying and pasting the itinerary text instead.";
}

export function ItineraryImport({ tripId, onImportComplete, onCancel }: ItineraryImportProps) {
  const { user } = useAuth();
  const [dragOver, setDragOver] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [importing, setImporting] = useState(false);
  const [activities, setActivities] = useState<ParsedActivity[]>([]);
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [pasteMode, setPasteMode] = useState(false);
  const [pasteText, setPasteText] = useState("");

  const parseItinerary = useCallback(async (text: string) => {
    setProcessing(true);
    setActivities([]);

    try {
      const { data, error } = await supabase.functions.invoke("parse-itinerary", {
        body: { text },
      });

      if (error) throw error;

      const parsed: ParsedActivity[] = (data?.activities || []).map((a: any) => ({
        ...a,
        selected: true,
      }));

      if (parsed.length === 0) {
        toast.error("No activities could be extracted from the document");
      } else {
        toast.success(`Found ${parsed.length} activities`);
      }

      setActivities(parsed);
    } catch (err: any) {
      console.error("Parse error:", err);
      toast.error(err?.message || "Failed to parse itinerary");
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
      await parseItinerary(text);
    } catch (err) {
      console.error("File read error:", err);
      toast.error("Failed to read file");
      setProcessing(false);
    }
  }, [parseItinerary]);

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
      toast.error("Please paste more itinerary text");
      return;
    }
    parseItinerary(pasteText);
  }, [pasteText, parseItinerary]);

  const toggleActivity = (index: number) => {
    setActivities((prev) => prev.map((a, i) => (i === index ? { ...a, selected: !a.selected } : a)));
  };

  const updateActivity = (index: number, updates: Partial<ParsedActivity>) => {
    setActivities((prev) => prev.map((a, i) => (i === index ? { ...a, ...updates } : a)));
  };

  const importSelected = async () => {
    if (!user) return;
    const selected = activities.filter((a) => a.selected);
    if (selected.length === 0) return;

    setImporting(true);
    try {
      const rows = selected.map((a) => {
        let recordedAt = new Date().toISOString();
        if (a.date) {
          const dateStr = a.time ? `${a.date}T${a.time}:00` : `${a.date}T12:00:00`;
          const d = new Date(dateStr);
          if (!isNaN(d.getTime())) recordedAt = d.toISOString();
        }

        return {
          trip_id: tripId,
          user_id: user.id,
          location_name: a.locationName,
          country: a.country,
          latitude: a.latitude || 0,
          longitude: a.longitude || 0,
          event_type: a.eventType,
          description: a.description,
          notes: a.notes || null,
          recorded_at: recordedAt,
          source: "itinerary_import",
          is_confirmed: true,
        };
      });

      const { error } = await supabase.from("trip_steps").insert(rows);
      if (error) throw error;

      toast.success(`Imported ${rows.length} activities`);
      setActivities([]);
      onImportComplete();
    } catch (err: any) {
      console.error("Import error:", err);
      toast.error(err?.message || "Failed to import activities");
    } finally {
      setImporting(false);
    }
  };

  const eventTypeLabel = (val: string) => ALL_EVENT_TYPES.find((t) => t.value === val)?.label || val;

  return (
    <div className="flex flex-col gap-6">
      {activities.length === 0 && !processing && (
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
                <p className="font-medium text-foreground">Drop your itinerary document here</p>
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
              <p className="font-medium text-foreground">Paste your itinerary text</p>
              <textarea
                value={pasteText}
                onChange={(e) => setPasteText(e.target.value)}
                placeholder="Paste your trip itinerary, booking confirmation, or travel plan here..."
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
                  Parse Itinerary
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
          <p className="text-sm text-muted-foreground">Parsing your itinerary with AI...</p>
        </div>
      )}

      {activities.length > 0 && (
        <div className="flex flex-col gap-4">
          <div className="flex items-center justify-between">
            <h3 className="font-display text-lg font-semibold text-foreground">
              Parsed Activities ({activities.filter((a) => a.selected).length}/{activities.length})
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
                disabled={importing || activities.filter((a) => a.selected).length === 0}
                className="flex items-center gap-2 rounded-xl bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50"
              >
                {importing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
                {importing ? "Importing..." : "Import Selected"}
              </button>
            </div>
          </div>

          <div className="flex flex-col gap-3">
            {activities.map((activity, index) => (
              <div
                key={index}
                className={`rounded-xl border p-4 transition-colors ${
                  activity.selected ? "border-primary/30 bg-card" : "border-border bg-muted/30 opacity-60"
                }`}
              >
                <div className="flex items-start gap-3">
                  <button
                    onClick={() => toggleActivity(index)}
                    className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded border transition-colors ${
                      activity.selected ? "border-primary bg-primary text-primary-foreground" : "border-border"
                    }`}
                  >
                    {activity.selected && <Check className="h-3 w-3" />}
                  </button>

                  <div className="flex-1 min-w-0">
                    {editingIndex === index ? (
                      <div className="flex flex-col gap-3">
                        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                          <input
                            value={activity.locationName}
                            onChange={(e) => updateActivity(index, { locationName: e.target.value })}
                            className="rounded-lg border border-border bg-background px-3 py-1.5 text-sm"
                            placeholder="Location name"
                          />
                          <input
                            value={activity.country}
                            onChange={(e) => updateActivity(index, { country: e.target.value })}
                            className="rounded-lg border border-border bg-background px-3 py-1.5 text-sm"
                            placeholder="Country"
                          />
                          <input
                            type="date"
                            value={activity.date || ""}
                            onChange={(e) => updateActivity(index, { date: e.target.value || null })}
                            className="rounded-lg border border-border bg-background px-3 py-1.5 text-sm"
                          />
                          <input
                            type="time"
                            value={activity.time || ""}
                            onChange={(e) => updateActivity(index, { time: e.target.value || null })}
                            className="rounded-lg border border-border bg-background px-3 py-1.5 text-sm"
                          />
                          <select
                            value={activity.eventType}
                            onChange={(e) => updateActivity(index, { eventType: e.target.value })}
                            className="rounded-lg border border-border bg-background px-3 py-1.5 text-sm"
                          >
                            {EVENT_TYPES.map((t) => (
                              <option key={t.value} value={t.value}>{t.label}</option>
                            ))}
                          </select>
                        </div>
                        <textarea
                          value={activity.description}
                          onChange={(e) => updateActivity(index, { description: e.target.value })}
                          className="rounded-lg border border-border bg-background px-3 py-1.5 text-sm"
                          placeholder="Description"
                          rows={2}
                        />
                        <textarea
                          value={activity.notes}
                          onChange={(e) => updateActivity(index, { notes: e.target.value })}
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
                            <span className="font-medium text-foreground">{activity.locationName}</span>
                            <span className="rounded-full bg-accent/50 px-2 py-0.5 text-xs text-accent-foreground">
                              {eventTypeLabel(activity.eventType)}
                            </span>
                          </div>
                          <div className="flex items-center gap-3 text-xs text-muted-foreground flex-wrap">
                            {activity.country && (
                              <span className="flex items-center gap-1">
                                <MapPin className="h-3 w-3" />
                                {activity.country}
                              </span>
                            )}
                            {activity.date && (
                              <span className="flex items-center gap-1">
                                <Calendar className="h-3 w-3" />
                                {activity.date}
                              </span>
                            )}
                            {activity.time && (
                              <span className="flex items-center gap-1">
                                <Clock className="h-3 w-3" />
                                {activity.time}
                              </span>
                            )}
                          </div>
                          {activity.description && (
                            <p className="text-xs text-muted-foreground mt-0.5">{activity.description}</p>
                          )}
                          {activity.notes && (
                            <p className="text-xs text-muted-foreground/70 italic mt-0.5">{activity.notes}</p>
                          )}
                        </div>
                        <button
                          onClick={() => setEditingIndex(index)}
                          className="shrink-0 rounded-lg p-1.5 text-muted-foreground hover:bg-accent/30 hover:text-foreground transition-colors"
                        >
                          <Pencil className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
