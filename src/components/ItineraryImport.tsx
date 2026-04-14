import { useState, useCallback } from "react";
import { FileText, Check, Loader2, X, Pencil, Calendar, Clock } from "lucide-react";
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
        let finalLocationName = a.locationName;
        let finalCountry = a.country;

        // FIX: Included `&addressdetails=1` so we can extract exact City/State data and enforce the format
        if (lat === 0 && lon === 0 && (a.locationName || a.country)) {
          try {
            const query = encodeURIComponent(`${a.locationName || ''} ${a.country || ''}`.trim());
            const res = await fetch(`https://nominatim.openstreetmap.org/search?format=json&q=${query}&limit=1&addressdetails=1`);
            if (res.ok) {
              const data = await res.json();
              if (data && data.length > 0) {
                lat = parseFloat(data[0].lat);
                lon = parseFloat(data[0].lon);
                
                const addr = data[0].address;
                if (addr) {
                  const city = addr.city || addr.town || addr.village || addr.county || "";
                  const state = addr.state || "";
                  const cc = addr.country || (addr.country_code ? addr.country_code.toUpperCase() : "");

                  const formattedCountry = [city, state || cc].filter(Boolean).join(", ");
                  if (city) {
                    finalCountry = formattedCountry;
                  }
                }
              }
            }
            await new Promise(resolve => setTimeout(resolve, 1000));
          } catch (e) {
            console.error("Geocoding fallback failed", e);
          }
        }