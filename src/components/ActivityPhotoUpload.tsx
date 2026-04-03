import { useState, useRef } from "react";
import { Upload, X, Image as ImageIcon, Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "sonner";

interface ActivityPhotoUploadProps {
  stepId: string;
  tripId: string;
  onPhotosUploaded?: () => void;
}

interface SelectedFile {
  file: File;
  preview: string;
}

export function ActivityPhotoUpload({ stepId, tripId, onPhotosUploaded }: ActivityPhotoUploadProps) {
  const { user } = useAuth();
  const [files, setFiles] = useState<SelectedFile[]>([]);
  const [uploading, setUploading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const addFiles = (newFiles: FileList | File[]) => {
    const imageFiles = Array.from(newFiles).filter((f) => f.type.startsWith("image/") || f.type.startsWith("video/"));
    const newSelected = imageFiles.map((file) => ({
      file,
      preview: URL.createObjectURL(file),
    }));
    setFiles((prev) => [...prev, ...newSelected]);
  };

  const removeFile = (index: number) => {
    setFiles((prev) => {
      URL.revokeObjectURL(prev[index].preview);
      return prev.filter((_, i) => i !== index);
    });
  };

  const uploadAll = async () => {
    if (!user || files.length === 0) return;
    setUploading(true);

    let uploaded = 0;
    for (const { file } of files) {
      const ext = file.name.split(".").pop() || "jpg";
      const path = `${user.id}/${tripId}/${stepId}/${crypto.randomUUID()}.${ext}`;

      const { error: uploadError } = await supabase.storage.from("trip-photos").upload(path, file);
      if (uploadError) {
        console.error("Upload error:", uploadError);
        continue;
      }

      const { error: dbError } = await supabase.from("step_photos").insert({
        step_id: stepId,
        user_id: user.id,
        storage_path: path,
        file_name: file.name,
      });

      if (dbError) {
        console.error("DB error:", dbError);
      } else {
        uploaded++;
      }
    }

    if (uploaded > 0) {
      toast.success(`Uploaded ${uploaded} photo${uploaded > 1 ? "s" : ""}`);
      // Clean up previews
      files.forEach((f) => URL.revokeObjectURL(f.preview));
      setFiles([]);
      onPhotosUploaded?.();
    } else {
      toast.error("Failed to upload photos");
    }
    setUploading(false);
  };

  return (
    <div className="flex flex-col gap-2">
      <label className="text-sm font-medium text-foreground">Photos</label>

      {files.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {files.map((f, i) => (
            <div key={i} className="group relative">
              <img src={f.preview} alt={f.file.name} className="h-16 w-16 rounded-lg object-cover" />
              <button
                type="button"
                onClick={() => removeFile(i)}
                className="absolute -right-1 -top-1 hidden rounded-full bg-destructive p-0.5 text-destructive-foreground group-hover:block"
              >
                <X className="h-3 w-3" />
              </button>
            </div>
          ))}
        </div>
      )}

      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          className="flex items-center gap-2 rounded-xl border border-dashed border-border px-4 py-2 text-sm text-muted-foreground hover:border-primary/50 hover:text-foreground transition-colors"
        >
          <ImageIcon className="h-4 w-4" />
          Add Photos
        </button>
        {files.length > 0 && (
          <button
            type="button"
            onClick={uploadAll}
            disabled={uploading}
            className="flex items-center gap-2 rounded-xl bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50 transition-colors"
          >
            {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
            {uploading ? "Uploading..." : `Upload ${files.length}`}
          </button>
        )}
      </div>

      <input
        ref={inputRef}
        type="file"
        multiple
        accept="image/*,video/*"
        onChange={(e) => { if (e.target.files) addFiles(e.target.files); e.target.value = ""; }}
        className="hidden"
      />
    </div>
  );
}

/** Inline version for forms that don't have a step_id yet - just collects files */
interface PendingPhotoUploadProps {
  files: SelectedFile[];
  onFilesChange: (files: SelectedFile[]) => void;
}

export function PendingPhotoUpload({ files, onFilesChange }: PendingPhotoUploadProps) {
  const inputRef = useRef<HTMLInputElement>(null);

  const addFiles = (newFiles: FileList | File[]) => {
    const imageFiles = Array.from(newFiles).filter((f) => f.type.startsWith("image/") || f.type.startsWith("video/"));
    const newSelected = imageFiles.map((file) => ({
      file,
      preview: URL.createObjectURL(file),
    }));
    onFilesChange([...files, ...newSelected]);
  };

  const removeFile = (index: number) => {
    URL.revokeObjectURL(files[index].preview);
    onFilesChange(files.filter((_, i) => i !== index));
  };

  return (
    <div className="flex flex-col gap-2">
      <label className="text-sm font-medium text-foreground">Photos</label>

      {files.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {files.map((f, i) => (
            <div key={i} className="group relative">
              <img src={f.preview} alt={f.file.name} className="h-16 w-16 rounded-lg object-cover" />
              <button
                type="button"
                onClick={() => removeFile(i)}
                className="absolute -right-1 -top-1 hidden rounded-full bg-destructive p-0.5 text-destructive-foreground group-hover:block"
              >
                <X className="h-3 w-3" />
              </button>
            </div>
          ))}
        </div>
      )}

      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        className="flex items-center gap-2 rounded-xl border border-dashed border-border px-4 py-2 text-sm text-muted-foreground hover:border-primary/50 hover:text-foreground transition-colors"
      >
        <ImageIcon className="h-4 w-4" />
        {files.length > 0 ? `${files.length} selected — Add more` : "Add Photos"}
      </button>

      <input
        ref={inputRef}
        type="file"
        multiple
        accept="image/*,video/*"
        onChange={(e) => { if (e.target.files) addFiles(e.target.files); e.target.value = ""; }}
        className="hidden"
      />
    </div>
  );
}

export type { SelectedFile };
