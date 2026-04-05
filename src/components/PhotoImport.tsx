import { useState, useCallback, useRef } from "react";
import { Upload, X } from "lucide-react";
import { useStagingInbox } from "@/hooks/useStagingInbox";
import { StagingInbox } from "@/components/StagingInbox";

interface PhotoImportProps {
  tripId: string;
  onImportComplete: () => void;
  onCancel?: () => void;
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
  const fileInputRef = useRef<HTMLInputElement>(null);
  const staging = useStagingInbox(tripId);

  const handleFiles = useCallback(
    (files: File[]) => {
      staging.stageFiles(files);
    },
    [staging.stageFiles],
  );

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
    },
    [handleFiles],
  );

  const showDropZone = staging.stagedFiles.length === 0 && !staging.isUploading;

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
                Files upload instantly to the cloud — you can close your browser safely
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

      {(staging.stagedFiles.length > 0 || staging.isUploading) && (
        <StagingInbox
          tripId={tripId}
          stagedFiles={staging.stagedFiles}
          uploads={staging.uploads}
          isUploading={staging.isUploading}
          overallProgress={staging.overallProgress}
          onDeleteFiles={staging.deleteStagedFiles}
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
