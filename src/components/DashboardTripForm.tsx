 import { useState } from "react";
 import { useNavigate } from "react-router-dom";
 import { Upload, FileText, Image, Loader2, X, Check } from "lucide-react";
 import { format } from "date-fns";
 import { cn } from "@/lib/utils";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Switch } from "@/components/ui/switch";
import { toast } from "sonner";
import { type PhotoExifData } from "@/lib/exif";
import { processImportedMediaFiles } from "@/lib/mediaImport";
import { buildStoredMediaMetadata } from "@/lib/mediaMetadata";
import { ImportPreview } from "@/components/ImportPreview";
 
 type ImportMode = "none" | "photo" | "itinerary";
 
 interface PendingPhotoStep {
   key: string;
   locationName: string;
   country: string;
   latitude: number;
   longitude: number;
   earliestDate: Date | null;
   eventType: string;
   description: string;
   photos: PhotoExifData[];
 }
 
 interface PendingActivity {
   locationName: string;
   country: string;
   latitude: number | null;
   longitude: number | null;
   eventType: string;
   date: string | null;
   time: string | null;
   description: string;
   notes: string;
 }
 
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
     return parts.join("\n\n") || "Could not extract text.";
   }
   if (file.name.endsWith(".docx")) {
     const JSZip = (await import("jszip")).default;
     const buffer = await file.arrayBuffer();
     const zip = await JSZip.loadAsync(buffer);
     const docXml = zip.file("word/document.xml");
     if (!docXml) return "";
     const xmlStr = await docXml.async("string");
     const paragraphs: string[] = [];
     const regex = /<w:p[\s>]([\s\S]*?)<\/w:p>/g;
     let m;
     while ((m = regex.exec(xmlStr)) !== null) {
       const texts: string[] = [];
       const tr = /<w:t[^>]*>([^<]*)<\/w:t>/g;
       let tm;
       while ((tm = tr.exec(m[1])) !== null) texts.push(tm[1]);
       if (texts.length > 0) paragraphs.push(texts.join(""));
     }
     return paragraphs.join("\n") || "";
   }
   return file.text();
 }
 
 function buildSuggestedTitle(countries: string[]): string {
   if (countries.length === 0) return "";
   if (countries.length === 1) return `${countries[0]} Trip`;
   if (countries.length === 2) return `${countries[0]} & ${countries[1]} Trip`;
   return `${countries.slice(0, 2).join(", ")} + ${countries.length - 2} more`;
 }
 
 export function DashboardTripForm() {
   const { user } = useAuth();
   const navigate = useNavigate();
 
   const [title, setTitle] = useState("");
   const [startDate, setStartDate] = useState("");
   const [endDate, setEndDate] = useState("");
   const [countries, setCountries] = useState("");
   const [trackInBackground, setTrackInBackground] = useState(false);
    const [creating, setCreating] = useState(false);
    const [importProgress, setImportProgress] = useState({ current: 0, total: 0 });
 
   const [importMode, setImportMode] = useState<ImportMode>("none");
   const [importProcessing, setImportProcessing] = useState(false);
   const [dragOver, setDragOver] = useState(false);
   const [pendingPhotoSteps, setPendingPhotoSteps] = useState<PendingPhotoStep[]>([]);
   const [pendingActivities, setPendingActivities] = useState<PendingActivity[]>([]);
   const [pasteMode, setPasteMode] = useState(false);
   const [pasteText, setPasteText] = useState("");
 
   const isPastTrip = (() => {
     if (!endDate) return false;
     const end = new Date(endDate);
     const today = new Date();
     today.setHours(0, 0, 0, 0);
     return end < today;
   })();
 
   const hasPendingImport = pendingPhotoSteps.length > 0 || pendingActivities.length > 0;
 
   const populateFromDates = (dates: Date[]) => {
     if (dates.length === 0) return;
     const sorted = [...dates].sort((a, b) => a.getTime() - b.getTime());
     setStartDate(format(sorted[0], "yyyy-MM-dd"));
     setEndDate(format(sorted[sorted.length - 1], "yyyy-MM-dd"));
   };
 
   const populateFromCountries = (countriesList: string[]) => {
     const unique = [...new Set(countriesList.filter((c) => c && c !== "Unknown"))];
     if (unique.length === 0) return;
     setCountries(unique.join(", "));
     setTitle(buildSuggestedTitle(unique));
   };
 
  // ─── Photo import ───
  const processPhotoFiles = async (files: File[]) => {
    const mediaFiles = files.filter((f) => f.type.startsWith("image/") || f.type.startsWith("video/"));
    if (mediaFiles.length === 0) {
      toast.error("No image or video files found");
      return;
    }

    setImportProcessing(true);
    toast.info(`Processing ${mediaFiles.length} file(s) with metadata + visual recognition…`);

    try {
      const result = await processImportedMediaFiles(mediaFiles);
      const steps: PendingPhotoStep[] = result.steps.map((step) => ({
        key: step.key,
        locationName: step.locationName,
        country: step.country,
        latitude: step.latitude,
        longitude: step.longitude,
        earliestDate: step.earliestDate,
        eventType: step.eventType,
        description: step.description,
        photos: step.photos,
      }));

      setPendingPhotoSteps(steps);
      setPendingActivities([]);
      populateFromDates(result.allDates);
      populateFromCountries(result.countries);

      const msg = `Detected ${steps.length} location(s) with ${result.resolvedMediaCount}/${result.totalMedia} files`;
      toast.success(msg);
      setImportMode("none");
    } catch (err) {
      console.error("Photo processing error:", err);
      toast.error("Failed to process media");
    } finally {
      setImportProcessing(false);
    }
  };
 
   // ─── Itinerary import ───
   const processItineraryText = async (text: string) => {
     setImportProcessing(true);
 
     try {
       const { data, error } = await supabase.functions.invoke("parse-itinerary", {
         body: { text },
       });
 
       if (error) throw error;
 
       const activities: PendingActivity[] = (data?.activities || []).map((a: any) => ({
         locationName: a.locationName || "",
         country: a.country || "",
         latitude: a.latitude ?? null,
         longitude: a.longitude ?? null,
         eventType: a.eventType || "other",
         date: a.date || null,
         time: a.time || null,
         description: a.description || "",
         notes: a.notes || "",
       }));
 
       if (activities.length === 0) {
         toast.error("No activities could be extracted");
         setImportProcessing(false);
         return;
       }
 
       const dates = activities
         .map((a) => (a.date ? new Date(a.date) : null))
         .filter((d): d is Date => d !== null && !isNaN(d.getTime()));
 
       const countriesList = activities.map((a) => a.country).filter(Boolean);
 
       setPendingActivities(activities);
       setPendingPhotoSteps([]);
       populateFromDates(dates);
       populateFromCountries(countriesList);
 
       toast.success(`Found ${activities.length} activities`);
       setImportMode("none");
       setPasteMode(false);
       setPasteText("");
     } catch (err: any) {
       console.error("Parse error:", err);
       toast.error(err?.message || "Failed to parse itinerary");
     } finally {
       setImportProcessing(false);
     }
   };
 
   const handleItineraryFile = async (file: File) => {
     setImportProcessing(true);
     try {
       const text = await extractTextFromFile(file);
       if (text.length < 20) {
         toast.error("Not enough text extracted. Try pasting instead.");
         setImportProcessing(false);
         return;
       }
       await processItineraryText(text);
     } catch {
       toast.error("Failed to read file");
       setImportProcessing(false);
     }
   };
 
   // ─── Submit ───
   const handleCreate = async (e: React.FormEvent) => {
     e.preventDefault();
     if (!user || !title.trim()) return;
     setCreating(true);
 
     try {
       const { data: trip, error: tripError } = await supabase
         .from("trips")
         .insert({
           user_id: user.id,
           title: title.trim(),
           start_date: startDate || null,
           end_date: endDate || null,
           is_active: trackInBackground && !isPastTrip,
         })
         .select()
         .single();
 
       if (tripError || !trip) {
         toast.error("Failed to create trip");
         setCreating(false);
         return;
       }
 
       // Create photo steps + upload media
       for (const step of pendingPhotoSteps) {
         const { data: stepData } = await supabase
           .from("trip_steps")
           .insert({
             trip_id: trip.id,
             user_id: user.id,
             location_name: step.locationName,
             country: step.country,
             latitude: step.latitude,
             longitude: step.longitude,
             recorded_at: step.earliestDate?.toISOString() || new Date().toISOString(),
             source: "photo_import",
             event_type: step.eventType,
             description: step.description,
             is_confirmed: true,
           })
           .select()
           .single();
 
         if (!stepData) continue;
 
         for (const photo of step.photos) {
           const uploadFile = photo.uploadFile ?? photo.file;
           const ext = uploadFile.name.split(".").pop() || (uploadFile.type.startsWith("video/") ? "mp4" : "jpg");
           const path = `${user.id}/${trip.id}/${stepData.id}/${crypto.randomUUID()}.${ext}`;
           const { error: uploadError } = await supabase.storage
             .from("trip-photos")
             .upload(path, uploadFile, { contentType: uploadFile.type || undefined });
 
           if (!uploadError) {
             await supabase.from("step_photos").insert({
               step_id: stepData.id,
               user_id: user.id,
               storage_path: path,
               file_name: uploadFile.name,
               latitude: photo.latitude,
               longitude: photo.longitude,
               taken_at: photo.takenAt?.toISOString(),
                exif_data: buildStoredMediaMetadata(photo, {
                  locationName: step.locationName,
                  country: step.country,
                }),
             });
           }
         }
       }
 
       // Create itinerary steps
       if (pendingActivities.length > 0) {
         const rows = pendingActivities.map((a) => {
           let recordedAt = new Date().toISOString();
           if (a.date) {
             const dateStr = a.time ? `${a.date}T${a.time}:00` : `${a.date}T12:00:00`;
             const d = new Date(dateStr);
             if (!isNaN(d.getTime())) recordedAt = d.toISOString();
           }
           return {
             trip_id: trip.id,
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
         await supabase.from("trip_steps").insert(rows);
       }
 
       navigate(`/trips/${trip.id}`);
     } catch (err) {
       console.error("Create error:", err);
       toast.error("Something went wrong");
     } finally {
       setCreating(false);
     }
   };
 
   const clearImport = () => {
     setPendingPhotoSteps([]);
     setPendingActivities([]);
   };
 
   return (
     <form onSubmit={handleCreate} className="flex flex-col gap-4 border-t border-border px-5 pb-5 pt-4">
       {/* Import options */}
       <div className="grid grid-cols-2 gap-3">
         <button
           type="button"
           onClick={() => setImportMode(importMode === "photo" ? "none" : "photo")}
           className={cn(
             "flex items-center justify-center gap-2 rounded-xl border-2 border-dashed px-3 py-3 text-sm font-medium transition-colors",
             importMode === "photo"
               ? "border-primary bg-primary/5 text-primary"
               : "border-border text-muted-foreground hover:border-primary/50 hover:text-foreground"
           )}
         >
           <Image className="h-4 w-4" />
           Add from Photo / Video
         </button>
         <button
           type="button"
           onClick={() => {
             setImportMode(importMode === "itinerary" ? "none" : "itinerary");
             setPasteMode(false);
           }}
           className={cn(
             "flex items-center justify-center gap-2 rounded-xl border-2 border-dashed px-3 py-3 text-sm font-medium transition-colors",
             importMode === "itinerary"
               ? "border-primary bg-primary/5 text-primary"
               : "border-border text-muted-foreground hover:border-primary/50 hover:text-foreground"
           )}
         >
           <FileText className="h-4 w-4" />
           Add from Itinerary
         </button>
       </div>
 
       {/* Photo drop zone */}
       {importMode === "photo" && !importProcessing && (
         <label
           onDragOver={(e) => {
             e.preventDefault();
             setDragOver(true);
           }}
           onDragLeave={() => setDragOver(false)}
           onDrop={(e) => {
             e.preventDefault();
             setDragOver(false);
             processPhotoFiles(Array.from(e.dataTransfer.files));
           }}
           className={cn(
             "flex cursor-pointer flex-col items-center gap-3 rounded-xl border-2 border-dashed p-8 transition-colors",
             dragOver ? "border-primary bg-primary/5" : "border-border hover:border-primary/50"
           )}
         >
           <Upload className="h-8 w-8 text-muted-foreground" />
           <p className="text-sm text-muted-foreground">Drop photos & videos or click to browse</p>
           <input
             type="file"
             multiple
             accept="image/*,video/*"
             onChange={(e) => {
               if (e.target.files) processPhotoFiles(Array.from(e.target.files));
               e.target.value = "";
             }}
             className="hidden"
           />
         </label>
       )}
 
       {/* Itinerary drop zone */}
       {importMode === "itinerary" && !importProcessing && (
         !pasteMode ? (
           <label
             onDragOver={(e) => {
               e.preventDefault();
               setDragOver(true);
             }}
             onDragLeave={() => setDragOver(false)}
             onDrop={(e) => {
               e.preventDefault();
               setDragOver(false);
               const file = Array.from(e.dataTransfer.files)[0];
               if (file) handleItineraryFile(file);
             }}
             className={cn(
               "flex cursor-pointer flex-col items-center gap-3 rounded-xl border-2 border-dashed p-8 transition-colors",
               dragOver ? "border-primary bg-primary/5" : "border-border hover:border-primary/50"
             )}
           >
             <FileText className="h-8 w-8 text-muted-foreground" />
             <p className="text-sm text-muted-foreground">Drop itinerary document (PDF, DOCX, TXT)</p>
             <input
               type="file"
               accept=".pdf,.docx,.doc,.txt,.md"
               onChange={(e) => {
                 const file = e.target.files?.[0];
                 if (file) handleItineraryFile(file);
                 if (e.target) e.target.value = "";
               }}
               className="hidden"
             />
             <button
               type="button"
               onClick={(e) => {
                 e.preventDefault();
                 setPasteMode(true);
               }}
               className="rounded-lg bg-secondary px-3 py-1.5 text-xs font-medium text-secondary-foreground hover:bg-secondary/80"
             >
               Or Paste Text
             </button>
           </label>
         ) : (
           <div className="flex flex-col gap-2 rounded-xl border border-border p-4">
             <textarea
               value={pasteText}
               onChange={(e) => setPasteText(e.target.value)}
               placeholder="Paste your itinerary text here…"
               className="min-h-[120px] w-full rounded-lg border border-border bg-background p-3 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary"
             />
             <div className="flex gap-2 self-end">
               <button
                 type="button"
                 onClick={() => {
                   setPasteMode(false);
                   setPasteText("");
                 }}
                 className="rounded-lg bg-secondary px-3 py-1.5 text-xs font-medium text-secondary-foreground"
               >
                 Back
               </button>
               <button
                 type="button"
                 onClick={() => {
                   if (pasteText.trim().length >= 20) processItineraryText(pasteText);
                   else toast.error("Paste more text");
                 }}
                 disabled={pasteText.trim().length < 20}
                 className="rounded-lg bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground disabled:opacity-50"
               >
                 Parse
               </button>
             </div>
           </div>
         )
       )}
 
       {/* Processing spinner */}
       {importProcessing && (
         <div className="flex items-center justify-center gap-3 rounded-xl bg-muted/30 p-6">
           <Loader2 className="h-5 w-5 animate-spin text-primary" />
           <p className="text-sm text-muted-foreground">
             {importMode === "photo" ? "Processing media…" : "Parsing itinerary…"}
           </p>
         </div>
       )}
 
        {/* Pending import preview */}
        {pendingPhotoSteps.length > 0 && (
          <ImportPreview steps={pendingPhotoSteps} onClear={clearImport} />
        )}

        {/* Pending itinerary summary */}
        {pendingActivities.length > 0 && (
          <div className="flex items-center justify-between rounded-xl border border-primary/20 bg-primary/5 px-4 py-2.5">
            <div className="flex items-center gap-2 text-sm">
              <Check className="h-4 w-4 text-primary" />
              <span className="text-foreground">
                {pendingActivities.length} activit{pendingActivities.length === 1 ? "y" : "ies"} ready
              </span>
            </div>
            <button type="button" onClick={clearImport} className="text-muted-foreground hover:text-foreground">
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        )}
 
       {/* Trip Name */}
       <div className="flex flex-col gap-1.5">
         <label className="text-sm font-medium text-foreground">Trip Name *</label>
         <input
           type="text"
           value={title}
           onChange={(e) => setTitle(e.target.value)}
           placeholder="e.g. Summer in Europe"
           required
           className="rounded-xl border border-border bg-background px-4 py-2.5 text-sm text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
         />
       </div>
 
       {/* Dates */}
       <div className="grid grid-cols-2 gap-4">
         <div className="flex flex-col gap-1.5">
           <label className="text-sm font-medium text-foreground">Start Date</label>
           <input
             type="date"
             value={startDate}
             onChange={(e) => setStartDate(e.target.value)}
             className="rounded-xl border border-border bg-background px-4 py-2.5 text-sm text-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
           />
         </div>
         <div className="flex flex-col gap-1.5">
           <label className="text-sm font-medium text-foreground">End Date</label>
           <input
             type="date"
             value={endDate}
             onChange={(e) => setEndDate(e.target.value)}
             min={startDate || undefined}
             className="rounded-xl border border-border bg-background px-4 py-2.5 text-sm text-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
           />
         </div>
       </div>
 
       {/* Countries */}
       <div className="flex flex-col gap-1.5">
         <label className="text-sm font-medium text-foreground">Countries</label>
         <input
           type="text"
           value={countries}
           onChange={(e) => setCountries(e.target.value)}
           placeholder="e.g. France, Italy, Spain"
           className="rounded-xl border border-border bg-background px-4 py-2.5 text-sm text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
         />
       </div>
 
       {/* Background tracking */}
       <div
         className={`flex items-center justify-between rounded-xl border border-border px-4 py-3 transition-opacity ${
           isPastTrip ? "pointer-events-none opacity-40" : ""
         }`}
       >
         <div className="flex flex-col gap-0.5">
           <span className="text-sm font-medium text-foreground">Track in background</span>
           <span className="text-xs text-muted-foreground">
             {isPastTrip ? "Not available for past trips" : "Automatically record your location during this trip"}
           </span>
         </div>
         <Switch checked={trackInBackground && !isPastTrip} onCheckedChange={setTrackInBackground} disabled={isPastTrip} />
       </div>
 
       <button
         type="submit"
         disabled={creating || !title.trim()}
         className="rounded-xl bg-primary py-2.5 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50"
       >
         {creating ? (hasPendingImport ? "Creating & Importing…" : "Creating…") : "Add Trip"}
       </button>
     </form>
   );
 }