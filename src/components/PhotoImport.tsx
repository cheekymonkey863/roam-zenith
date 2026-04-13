import { useState, useCallback, useRef, useEffect } from "react";
import { Upload, X, Loader2 } from "lucide-react";
import { extractExifFromFile } from "@/lib/exif";
import { StagingInbox } from "@/components/StagingInbox";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import heic2any from "heic2any";

export interface LocalStagedFile {
  id: string;
  file: File;
  previewUrl: string;
  mimeType: string;
  fileName: string;
  latitude: number | null;
  longitude: number | null;
  takenAt: Date | null;
  cameraMake: string | null;
  cameraModel: string | null;
  exifDone: boolean;
}

interface PhotoImportProps {
  tripId: string;
  onImportComplete: () => void;
  onCancel?: () => void;
  onProgressChange?: (progress: {
    importing: boolean;
    current: number;
    total: number;
    phase: "upload" | "sorting";
  }) => void;
  existingSteps?: Array<{
    id: string;
    latitude: number;
    longitude: number;
    location_name: string | null;
    country: string | null;
    recorded_at: string;
    event_type: string;
    description: string | null;
  }>;
}

export function PhotoImport({
  tripId,
  onImportComplete,
  onCancel,
  onProgressChange,
  existingSteps = [],
}: PhotoImportProps) {
  const [dragOver, setDragOver] = useState(false);
  const [files, setFiles] = useState<LocalStagedFile[]>([]);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [analysisProgress, setAnalysisProgress] = useState({ done: 0, total: 0 });
  const fileInputRef = useRef<HTMLInputElement>(null);
  const existingFingerprints = useRef<Set<string> | null>(null);

  useEffect(() => {
    async function loadFingerprints() {
      const { data } = await supabase
        .from("step_photos")
        .select("file_name, exif_data")
        .eq("user_id", (await supabase.auth.getUser()).data.user?.id ?? "");

      const { data: stepData } = await supabase.from("trip_steps").select("id").eq("trip_id", tripId);
      const stepIds = new Set((stepData || []).map((s) => s.id));
      const fps = new Set<string>();

      if (stepIds.size > 0) {
        const { data: tripPhotos } = await supabase
          .from("step_photos")
          .select("file_name")
          .in("step_id", Array.from(stepIds).slice(0, 100));
        if (tripPhotos) {
          for (const p of tripPhotos) {
            fps.add(p.file_name);
          }
        }
      }

      existingFingerprints.current = fps;
    }
    loadFingerprints();
  }, [tripId]);

  useEffect(() => {
    return () => {
      files.forEach((f) => URL.revokeObjectURL(f.previewUrl));
    };
  }, [files]);

  const generateVideoThumbnail = (file: File): Promise<string | null> => {
    return new Promise((resolve) => {
      const video = document.createElement("video");
      video.preload = "metadata";
      video.muted = true;
      video.playsInline = true;
      const objectUrl = URL.createObjectURL(file);
      video.src = objectUrl;

      video.onloadeddata = () => {
        video.currentTime = 0.1;
      };

      video.onseeked = () => {
        const canvas = document.createElement("canvas");
        canvas.width = 400;
        canvas.height = (video.videoHeight / video.videoWidth) * 400 || 400;
        const ctx = canvas.getContext("2d");
        ctx?.drawImage(video, 0, 0, canvas.width, canvas.height);
        const dataUrl = canvas.toDataURL("image/jpeg", 0.6);
        URL.revokeObjectURL(objectUrl);
        video.remove();
        resolve(dataUrl);
      };

      video.onerror = () => {
        URL.revokeObjectURL(objectUrl);
        video.remove();
        resolve(null);
      };
    });
  };

  const handleFiles = useCallback(async (incoming: File[]) => {
    const mediaFiles = incoming.filter(
      (f) =>
        f.type.startsWith("image/") ||
        f.type.startsWith("video/") ||
        f.name.toLowerCase().endsWith(".heic") ||
        f.name.toLowerCase().endsWith(".heif"),
    );
    if (mediaFiles.length === 0) return;

    let skippedCount = 0;
    const filtered = mediaFiles.filter((f) => {
      if (existingFingerprints.current?.has(f.name)) {
        skippedCount++;
        return false;
      }
      return true;
    });

    if (skippedCount > 0) {
      toast.info(`Skipped ${skippedCount} duplicate file${skippedCount !== 1 ? "s" : ""}`);
    }

    if (filtered.length === 0) return;

    setIsAnalyzing(true);
    setAnalysisProgress({ done: 0, total: filtered.length });

    const processedFiles: LocalStagedFile[] = [];

    for (let i = 0; i < filtered.length; i++) {
      const file = filtered[i];
      let newPreviewUrl: string | null = null;

      const isVideo = file.type.startsWith("video/");
      const isHeic =
        file.name.toLowerCase().endsWith(".heic") ||
        file.name.toLowerCase().endsWith(".heif") ||
        file.type === "image/heic";

      if (isVideo) {
        const snapshot = await generateVideoThumbnail(file);
        if (snapshot) newPreviewUrl = snapshot;
      } else if (isHeic) {
        try {
          const convertedBlob = await heic2any({ blob: file, toType: "image/jpeg", quality: 0.8 });
          const blob = Array.isArray(convertedBlob) ? convertedBlob[0] : convertedBlob;
          newPreviewUrl = URL.createObjectURL(blob);
        } catch (heicErr) {
          console.warn("HEIC conversion failed, keeping original:", heicErr);
        }
      }

      let exifResult = {
        latitude: null as number | null,
        longitude: null as number | null,
        takenAt: null as Date | null,
        cameraMake: null as string | null,
        cameraModel: null as string | null,
      };

      try {
        const exif = await extractExifFromFile(file);
        exifResult = {
          latitude: exif.latitude,
          longitude: exif.longitude,
          takenAt: exif.takenAt,
          cameraMake: exif.cameraMake ?? null,
          cameraModel: exif.cameraModel ?? null,
        };
      } catch {
        // Fallback silently
      }

      processedFiles.push({
        id: crypto.randomUUID(),
        file,
        previewUrl: newPreviewUrl || URL.createObjectURL(file),
        mimeType: file.type,
        fileName: file.name,
        ...exifResult,
        exifDone: true,
      });

      setAnalysisProgress({ done: i + 1, total: filtered.length });
      await new Promise((r) => setTimeout(r, 10));
    }

    setFiles((prev) => {
      const existingKeys = new Set(prev.map((f) => `${f.fileName}::${f.file.size}`));
      const uniqueNew = processedFiles.filter((f) => !existingKeys.has(`${f.fileName}::${f.file.size}`));
      return [...prev, ...uniqueNew];
    });

    setIsAnalyzing(false);
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragOver(false);
      void handleFiles(Array.from(e.dataTransfer.files));
    },
    [handleFiles],
  );

  const handleFileSelect = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      void handleFiles(Array.from(e.target.files || []));
      if (e.target) e.target.value = "";
    },
    [handleFiles],
  );

  const deleteFiles = useCallback((ids: string[]) => {
    setFiles((prev) => {
      const idSet = new Set(ids);
      const removed = prev.filter((f) => idSet.has(f.id));
      removed.forEach((f) => URL.revokeObjectURL(f.previewUrl));
      return prev.filter((f) => !idSet.has(f.id));
    });
  }, []);

  const analysisPercent =
    analysisProgress.total > 0 ? Math.round((analysisProgress.done / analysisProgress.total) * 100) : 0;

  return (
    <div className="relative z-20 w-full bg-background border border-border shadow-xl rounded-2xl p-6 mb-8">
      {isAnalyzing ? (
        <div className="flex flex-col gap-2 rounded-xl p-8 text-center items-center justify-center">
          <Loader2 className="h-8 w-8 animate-spin text-primary mb-4" />
          <h3 className="font-display text-lg font-semibold text-foreground">Reading image data...</h3>
          <p className="text-sm text-muted-foreground max-w-sm mt-1">
            Processing {analysisProgress.done} of {analysisProgress.total} files.
          </p>
          <div className="h-3 w-full max-w-md overflow-hidden rounded-full bg-muted mt-6 border border-border">
            <div
              className="h-full rounded-full transition-all duration-300 bg-primary"
              style={{ width: `${Math.max(analysisPercent, 2)}%` }}
            />
          </div>
        </div>
      ) : files.length > 0 ? (
        <StagingInbox
          tripId={tripId}
          localFiles={files}
          onDeleteFiles={deleteFiles}
          onImportComplete={onImportComplete}
          onCancel={onCancel}
          onAddMore={() => fileInputRef.current?.click()}
          onProgressChange={onProgressChange}
          existingSteps={existingSteps}
        />
      ) : (
        <div className="flex flex-col gap-3">
          <label
            onDragOver={(e) => {
              e.preventDefault();
              setDragOver(true);
            }}
            onDragLeave={() => setDragOver(false)}
            onDrop={handleDrop}
            className={`flex cursor-pointer flex-col items-center gap-4 rounded-2xl border-2 border-dashed p-12 transition-colors ${
              dragOver ? "border-primary bg-primary/5" : "border-border hover:border-primary/50"
            }`}
          >
            <Upload className="h-10 w-10 text-muted-foreground" />
            <div className="text-center">
              <p className="font-medium text-foreground">Drop photos & videos here</p>
              <p className="text-sm text-muted-foreground">Files stay local until you click Import</p>
            </div>
            <input
              ref={fileInputRef}
              type="file"
              multiple
              accept="image/*,video/*"
              onChange={handleFileSelect}
              className="hidden"
            />
            <span className="rounded-xl bg-primary px-4 py-2 text-sm font-medium text-primary-foreground">
              Browse Files
            </span>
          </label>
          {onCancel && (
            <button
              onClick={onCancel}
              className="self-end flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
            >
              <X className="h-4 w-4" />
              Cancel
            </button>
          )}
        </div>
      )}

      {!isAnalyzing && files.length > 0 && (
        <input
          ref={fileInputRef}
          type="file"
          multiple
          accept="image/*,video/*"
          onChange={handleFileSelect}
          className="hidden"
        />
      )}
    </div>
  );
}
