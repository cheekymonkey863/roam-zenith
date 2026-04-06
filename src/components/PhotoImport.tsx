import { useState, useCallback, useRef, useEffect } from "react";
import { Upload, X } from "lucide-react";
import { extractExifFromFile, type PhotoExifData } from "@/lib/exif";
import { StagingInbox } from "@/components/StagingInbox";
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
  onProgressChange?: (progress: { importing: boolean; current: number; total: number }) => void;
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

export function PhotoImport({ tripId, onImportComplete, onCancel, existingSteps = [] }: PhotoImportProps) {
  const [dragOver, setDragOver] = useState(false);
  const [files, setFiles] = useState<LocalStagedFile[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Cleanup preview URLs on unmount
  useEffect(() => {
    return () => {
      files.forEach((f) => URL.revokeObjectURL(f.previewUrl));
    };
  }, []); // intentionally empty — cleanup on unmount only

  const handleFiles = useCallback((incoming: File[]) => {
    const mediaFiles = incoming.filter(
      (f) => f.type.startsWith("image/") || f.type.startsWith("video/") ||
        f.name.toLowerCase().endsWith(".heic") || f.name.toLowerCase().endsWith(".heif"),
    );
    if (mediaFiles.length === 0) return;

    // Deduplicate by name+size
    setFiles((prev) => {
      const existingKeys = new Set(prev.map((f) => `${f.fileName}::${f.file.size}`));
      const newFiles: LocalStagedFile[] = [];

      for (const file of mediaFiles) {
        const key = `${file.name}::${file.size}`;
        if (existingKeys.has(key)) continue;
        existingKeys.add(key);

        newFiles.push({
          id: crypto.randomUUID(),
          file,
          previewUrl: URL.createObjectURL(file),
          mimeType: file.type,
          fileName: file.name,
          latitude: null,
          longitude: null,
          takenAt: null,
          cameraMake: null,
          cameraModel: null,
          exifDone: false,
        });
      }

      if (newFiles.length === 0) return prev;

      // Kick off sequential EXIF extraction in background
      extractExifSequentially(newFiles.map((f) => f.id), mediaFiles.filter((_, i) => {
        const key = `${mediaFiles[i].name}::${mediaFiles[i].size}`;
        return newFiles.some((nf) => `${nf.fileName}::${nf.file.size}` === key);
      }));

      return [...prev, ...newFiles];
    });
  }, []);

  // Sequential EXIF extraction — won't freeze the UI
  const extractExifSequentially = useCallback(async (ids: string[], rawFiles: File[]) => {
    for (let i = 0; i < rawFiles.length; i++) {
      const file = rawFiles[i];
      const id = ids[i];
      try {
        // Convert HEIC to JPEG for browser preview
        const isHeic = file.name.toLowerCase().endsWith(".heic") || file.name.toLowerCase().endsWith(".heif") || file.type === "image/heic";
        if (isHeic) {
          try {
            const convertedBlob = await heic2any({ blob: file, toType: "image/jpeg", quality: 0.8 });
            const blob = Array.isArray(convertedBlob) ? convertedBlob[0] : convertedBlob;
            const newPreviewUrl = URL.createObjectURL(blob);
            setFiles((prev) =>
              prev.map((f) => {
                if (f.id === id) {
                  URL.revokeObjectURL(f.previewUrl);
                  return { ...f, previewUrl: newPreviewUrl };
                }
                return f;
              }),
            );
          } catch (heicErr) {
            console.warn("HEIC conversion failed, keeping original:", heicErr);
          }
        }

        const exif = await extractExifFromFile(file);
        setFiles((prev) =>
          prev.map((f) =>
            f.id === id
              ? {
                  ...f,
                  latitude: exif.latitude,
                  longitude: exif.longitude,
                  takenAt: exif.takenAt,
                  cameraMake: exif.cameraMake ?? null,
                  cameraModel: exif.cameraModel ?? null,
                  exifDone: true,
                }
              : f,
          ),
        );
      } catch {
        setFiles((prev) =>
          prev.map((f) => (f.id === id ? { ...f, exifDone: true } : f)),
        );
      }
    }
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragOver(false);
      handleFiles(Array.from(e.dataTransfer.files));
    },
    [handleFiles],
  );

  const handleFileSelect = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      handleFiles(Array.from(e.target.files || []));
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

  const showDropZone = files.length === 0;

  return (
    <div className="flex flex-col gap-6">
      {showDropZone && (
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
              <p className="text-sm text-muted-foreground">
                Files stay local until you click Import
              </p>
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

      {files.length > 0 && (
        <StagingInbox
          tripId={tripId}
          localFiles={files}
          onDeleteFiles={deleteFiles}
          onImportComplete={onImportComplete}
          onCancel={onCancel}
          onAddMore={() => fileInputRef.current?.click()}
          existingSteps={existingSteps}
        />
      )}

      {/* Hidden file input for "Add More" */}
      {!showDropZone && (
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
