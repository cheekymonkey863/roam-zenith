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
    setProcessing(