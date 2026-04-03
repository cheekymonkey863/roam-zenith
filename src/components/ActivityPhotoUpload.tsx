import { useState, useRef, useEffect, useCallback } from "react";
import { Upload, X, Image as ImageIcon, Loader2, GripVertical, Trash2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "sonner";
import type { Tables } from "@/integrations/supabase/types";

type StepPhoto = Tables<"step_photos">;

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
  const [existingPhotos, setExistingPhotos] = useState<StepPhoto[]>([]);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const fetchExisting = useCallback(async () => {
    const { data } = await supabase
      .from("step_photos")
      .select("*")
      .eq("step_id", stepId)
      .order("created_at", { ascending: true });
    setExistingPhotos(data || []);
  }, [stepId]);

  useEffect(() => {
    fetchExisting();
  }, [fetchExisting]);

  const getPhotoUrl = (photo: StepPhoto) => {
    const { data } = supabase.storage.from("trip-photos").getPublicUrl(photo.storage_path);
    return data.publicUrl;
  };

  const deletePhoto = async (photo: StepPhoto) => {
    setDeletingId(photo.id);
    // Delete from storage
    await supabase.storage.from("trip-photos").remove([photo.storage_path]);
    // Delete from DB
    const { error } = await supabase.from("step_photos").delete().eq("id", photo.id);
    if (error) {
      toast.error("Failed to delete photo");
    } else {
      setExistingPhotos((prev) => prev.filter((p) => p.id !== photo.id));
      onPhotosUploaded?.();
    }
    setDeletingId(null);
  };

  // Drag and drop reorder for existing photos
  const handleDragStart = (index: number) => setDragIndex(index);
  const handleDragOver = (e: React.DragEvent, index: number) => {
    e.preventDefault();
    setDragOverIndex(index);
  };
  const handleDrop = (index: number) => {
    if (dragIndex === null || dragIndex === index) {
      setDragIndex(null);
      setDragOverIndex(null);
      return;
    }
    const reordered = [...existingPhotos];
    const [moved] = reordered.splice(dragIndex, 1);
    reordered.splice(index, 0, moved);
    setExistingPhotos(reordered);
    setDragIndex(null);
    setDragOverIndex(null);
  };

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
      if (uploadError) { console.error("Upload error:", uploadError); continue; }
      const { error: dbError } = await supabase.from("step_photos").insert({
        step_id: stepId, user_id: user.id, storage_path: path, file_name: file.name,
      });
      if (!dbError) uploaded++;
    }
    if (uploaded > 0) {
      toast.success(`Uploaded ${uploaded} photo${uploaded > 1 ? "s" : ""}`);
      files.forEach((f) => URL.revokeObjectURL(f.preview));
      setFiles([]);
      fetchExisting();
      onPhotosUploaded?.();
    } else {
      toast.error("Failed to upload photos");
    }
    setUploading(false);
  };

  return (
    <div className="flex flex-col gap-3">
      <label className="text-sm font-medium text-foreground">Photos</label>

      {/* Existing photos with drag reorder + delete */}
      {existingPhotos.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {existingPhotos.map((photo, i) => (
            <div
              key={photo.id}
              draggable
              onDragStart={() => handleDragStart(i)}
              onDragOver={(e) => handleDragOver(e, i)}
              onDrop={() => handleDrop(i)}
              onDragEnd={() => { setDragIndex(null); setDragOverIndex(null); }}
              className={`group relative cursor-grab active:cursor-grabbing transition-transform ${
                dragOverIndex === i ? "scale-110 ring-2 ring-primary rounded-lg" : ""
              } ${dragIndex === i ? "opacity-40" : ""}`}
            >
              <img src={getPhotoUrl(photo)} alt={photo.file_name} className="h-16 w-16 rounded-lg object-cover" />
              <div className="absolute inset-0 rounded-lg bg-black/0 group-hover:bg-black/30 transition-colors" />
              <button
                type="button"
                onClick={() => deletePhoto(photo)}
                disabled={deletingId === photo.id}
                className="absolute -right-1 -top-1 hidden rounded-full bg-destructive p-0.5 text-destructive-foreground group-hover:block"
              >
                {deletingId === photo.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <X className="h-3 w-3" />}
              </button>
              <GripVertical className="absolute bottom-0.5 left-0.5 hidden h-3 w-3 text-white drop-shadow group-hover:block" />
            </div>
          ))}
        </div>
      )}

      {/* Pending new photos */}
      {files.length > 0 && (
        <div className="flex flex-wrap gap-2 border-t border-dashed border-border pt-2">
          {files.map((f, i) => (
            <div key={i} className="group relative">
              <img src={f.preview} alt={f.file.name} className="h-16 w-16 rounded-lg object-cover ring-2 ring-primary/30" />
              <button type="button" onClick={() => removeFile(i)}
                className="absolute -right-1 -top-1 hidden rounded-full bg-destructive p-0.5 text-destructive-foreground group-hover:block">
                <X className="h-3 w-3" />
              </button>
            </div>
          ))}
        </div>
      )}

      <div className="flex gap-2">
        <button type="button" onClick={() => inputRef.current?.click()}
          className="flex items-center gap-2 rounded-xl border border-dashed border-border px-4 py-2 text-sm text-muted-foreground hover:border-primary/50 hover:text-foreground transition-colors">
          <ImageIcon className="h-4 w-4" />
          Add Photos
        </button>
        {files.length > 0 && (
          <button type="button" onClick={uploadAll} disabled={uploading}
            className="flex items-center gap-2 rounded-xl bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50 transition-colors">
            {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
            {uploading ? "Uploading..." : `Upload ${files.length}`}
          </button>
        )}
      </div>

      <input ref={inputRef} type="file" multiple accept="image/*,video/*"
        onChange={(e) => { if (e.target.files) addFiles(e.target.files); e.target.value = ""; }}
        className="hidden" />
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
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);

  const addFiles = (newFiles: FileList | File[]) => {
    const imageFiles = Array.from(newFiles).filter((f) => f.type.startsWith("image/") || f.type.startsWith("video/"));
    const newSelected = imageFiles.map((file) => ({ file, preview: URL.createObjectURL(file) }));
    onFilesChange([...files, ...newSelected]);
  };

  const removeFile = (index: number) => {
    URL.revokeObjectURL(files[index].preview);
    onFilesChange(files.filter((_, i) => i !== index));
  };

  const handleDrop = (index: number) => {
    if (dragIndex === null || dragIndex === index) { setDragIndex(null); setDragOverIndex(null); return; }
    const reordered = [...files];
    const [moved] = reordered.splice(dragIndex, 1);
    reordered.splice(index, 0, moved);
    onFilesChange(reordered);
    setDragIndex(null);
    setDragOverIndex(null);
  };

  return (
    <div className="flex flex-col gap-2">
      <label className="text-sm font-medium text-foreground">Photos</label>
      {files.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {files.map((f, i) => (
            <div key={i}
              draggable
              onDragStart={() => setDragIndex(i)}
              onDragOver={(e) => { e.preventDefault(); setDragOverIndex(i); }}
              onDrop={() => handleDrop(i)}
              onDragEnd={() => { setDragIndex(null); setDragOverIndex(null); }}
              className={`group relative cursor-grab active:cursor-grabbing transition-transform ${
                dragOverIndex === i ? "scale-110 ring-2 ring-primary rounded-lg" : ""
              } ${dragIndex === i ? "opacity-40" : ""}`}>
              <img src={f.preview} alt={f.file.name} className="h-16 w-16 rounded-lg object-cover" />
              <button type="button" onClick={() => removeFile(i)}
                className="absolute -right-1 -top-1 hidden rounded-full bg-destructive p-0.5 text-destructive-foreground group-hover:block">
                <X className="h-3 w-3" />
              </button>
              <GripVertical className="absolute bottom-0.5 left-0.5 hidden h-3 w-3 text-white drop-shadow group-hover:block" />
            </div>
          ))}
        </div>
      )}
      <button type="button" onClick={() => inputRef.current?.click()}
        className="flex items-center gap-2 rounded-xl border border-dashed border-border px-4 py-2 text-sm text-muted-foreground hover:border-primary/50 hover:text-foreground transition-colors">
        <ImageIcon className="h-4 w-4" />
        {files.length > 0 ? `${files.length} selected — Add more` : "Add Photos"}
      </button>
      <input ref={inputRef} type="file" multiple accept="image/*,video/*"
        onChange={(e) => { if (e.target.files) addFiles(e.target.files); e.target.value = ""; }}
        className="hidden" />
    </div>
  );
}

export type { SelectedFile };
