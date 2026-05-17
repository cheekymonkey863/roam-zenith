import { useState, useCallback, useRef, useEffect } from "react";
import { Upload, X, Loader2, Sparkles } from "lucide-react";
import { extractExifFromFile } from "@/lib/exif";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import heic2any from "heic2any";
import { cn } from "@/lib/utils";
import { useAuth } from "@/hooks/useAuth";
import { groupLocalFiles, getGroupRepresentativeCoordinates } from "@/lib/stagingGrouping";
import { resumableUpload } from "@/lib/resumableUpload";
import { queueVideoAnalysisJob } from "@/lib/videoAnalysisQueue";

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
  initialFiles?: File[];
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

function getDistanceFromLatLonInM(lat1: number, lon1: number, lat2: number, lon2: number) {
  const R = 6371e3;
  const dLat = (lat2 - lat1) * (Math.PI / 180);
  const dLon = (lon2 - lon1) * (Math.PI / 180);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * (Math.PI / 180)) * Math.cos(lat2 * (Math.PI / 180)) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

export function PhotoImport({ tripId, onImportComplete, onCancel, initialFiles, existingSteps = [] }: PhotoImportProps) {
  const { user } = useAuth();
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const existingFingerprints = useRef<Set<string> | null>(null);
  const [fingerprintsReady, setFingerprintsReady] = useState(false);

  const [uploadState, setUploadState] = useState<{
    phase: "idle" | "reading" | "uploading" | "finalizing";
    current: number;
    total: number;
    message: string;
  }>({ phase: "idle", current: 0, total: 0, message: "" });

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
      setFingerprintsReady(true);
    }
    loadFingerprints();
  }, [tripId]);

  // Auto-start import if initialFiles are provided
  const initialFilesProcessed = useRef(false);
  useEffect(() => {
    console.log("[PhotoImport] initialFiles effect:", initialFiles?.length ?? 0, "fingerprintsReady:", fingerprintsReady, "processed:", initialFilesProcessed.current);
    if (initialFiles && initialFiles.length > 0 && !initialFilesProcessed.current && fingerprintsReady) {
      console.log("[PhotoImport] Auto-starting import with", initialFiles.length, "files");
      initialFilesProcessed.current = true;
      handleFiles(initialFiles);
    }
  }, [initialFiles, fingerprintsReady]);

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

  const handleFiles = async (incoming: File[]) => {
    if (!user) return;

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

    if (skippedCount > 0) toast.info(`Skipped ${skippedCount} duplicate files`);
    if (filtered.length === 0) return;

    setUploadState({ phase: "reading", current: 0, total: filtered.length, message: "Reading EXIF data..." });
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
        } catch (e) {}
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
      } catch (e) {}

      processedFiles.push({
        id: crypto.randomUUID(),
        file,
        previewUrl: newPreviewUrl || URL.createObjectURL(file),
        mimeType: file.type,
        fileName: file.name,
        ...exifResult,
        exifDone: true,
      });

      setUploadState((p) => ({ ...p, current: i + 1 }));
      await new Promise((r) => setTimeout(r, 10));
    }

    setUploadState({
      phase: "reading",
      current: filtered.length,
      total: filtered.length,
      message: "Grouping media...",
    });
    const rawGroups = groupLocalFiles(processedFiles);

    setUploadState({
      phase: "uploading",
      current: 0,
      total: processedFiles.length,
      message: "Uploading directly to cloud...",
    });
    let completedUploads = 0;
    const allNewStepIds: string[] = [];

    let lastValidCoords =
      existingSteps.length > 0
        ? {
            latitude: existingSteps[existingSteps.length - 1].latitude,
            longitude: existingSteps[existingSteps.length - 1].longitude,
          }
        : { latitude: 0, longitude: 0 };

    for (const group of rawGroups) {
      const rawCoords = getGroupRepresentativeCoordinates(group);
      let coords = rawCoords && (rawCoords.latitude !== 0 || rawCoords.longitude !== 0) ? rawCoords : null;
      if (coords) lastValidCoords = coords;
      else coords = lastValidCoords;

      let targetStepId: string | null = null;

      for (const step of existingSteps) {
        if (step.latitude && step.longitude) {
          const distance = getDistanceFromLatLonInM(coords.latitude, coords.longitude, step.latitude, step.longitude);
          if (distance <= 10) {
            targetStepId = step.id;
            break;
          }
        }
      }

      if (!targetStepId) {
        targetStepId = crypto.randomUUID();

        let fallbackName = `${coords.latitude.toFixed(4)}°, ${coords.longitude.toFixed(4)}°`;
        let fallbackCountry = "";

        try {
          const res = await fetch(
            `https://nominatim.openstreetmap.org/reverse?format=json&lat=${coords.latitude}&lon=${coords.longitude}&zoom=18&addressdetails=1`,
          );
          if (res.ok) {
            const data = await res.json();
            const addr = data?.address;
            if (addr) {
              const place = addr.amenity || addr.leisure || addr.tourism || addr.shop || addr.historic || addr.building;
              const road = addr.road || addr.pedestrian || addr.path;
              const city = addr.city || addr.town || addr.village || addr.county || "";
              const state = addr.state || "";
              const cc = addr.country || (addr.country_code ? addr.country_code.toUpperCase() : "");

              // FIX: Strictly apply formatting for Place (Name) and City/State (Country)
              if (place) {
                fallbackName = place;
                fallbackCountry = [city, state || cc].filter(Boolean).join(", ");
              } else if (road) {
                fallbackName = road;
                fallbackCountry = [city, state || cc].filter(Boolean).join(", ");
              } else if (city) {
                fallbackName = city;
                fallbackCountry = state || cc;
              } else {
                fallbackName = "Unknown Location";
                fallbackCountry = cc;
              }
            }
          }
        } catch (e) {}

        const earliest = group.earliestDate?.toISOString() ?? new Date().toISOString();

        await supabase.from("trip_steps").insert({
          id: targetStepId,
          trip_id: tripId,
          user_id: user.id,
          latitude: coords.latitude,
          longitude: coords.longitude,
          recorded_at: earliest,
          source: "photo_import",
          event_type: "other",
          is_confirmed: false,
          location_name: fallbackName,
          country: fallbackCountry || null,
          description: "null",
        });

        allNewStepIds.push(targetStepId);
        existingSteps.push({
          id: targetStepId,
          latitude: coords.latitude,
          longitude: coords.longitude,
          location_name: fallbackName,
          country: fallbackCountry || null,
          recorded_at: earliest,
          event_type: "other",
          description: null,
        });
      }

      const uploadedFiles = [];
      for (const f of group.files) {
        const ext = f.fileName.split(".").pop() || "jpg";
        const objectName = `${user.id}/${tripId}/staging/${crypto.randomUUID()}.${ext}`;

        await resumableUpload({
          bucketName: "trip-photos",
          objectName,
          file: f.file,
          contentType: f.mimeType || undefined,
        });
        uploadedFiles.push({ file: f, objectName });

        completedUploads++;
        setUploadState((p) => ({ ...p, current: completedUploads }));
      }

      const photoRows = uploadedFiles.map(({ file, objectName }) => ({
        step_id: targetStepId,
        user_id: user.id,
        storage_path: objectName,
        file_name: file.fileName,
        latitude: file.latitude ?? null,
        longitude: file.longitude ?? null,
        taken_at: file.takenAt?.toISOString() ?? null,
        exif_data: {
          latitude: file.latitude,
          longitude: file.longitude,
          cameraMake: file.cameraMake,
          cameraModel: file.cameraModel,
        },
      }));
      await supabase.from("step_photos").insert(photoRows);

      for (const { file, objectName } of uploadedFiles) {
        if (file.mimeType.startsWith("video/")) {
          queueVideoAnalysisJob({
            captionId: file.id,
            userId: user.id,
            tripId,
            storagePath: objectName,
            fileName: file.fileName,
            mimeType: file.mimeType,
            takenAt: file.takenAt?.toISOString() ?? null,
            latitude: coords.latitude,
            longitude: coords.longitude,
            locationName: "",
            country: "",
            nearbyPlaces: [],
            itinerarySteps: [],
          }).catch(() => {});
        }
      }
    }

    setUploadState({ phase: "finalizing", current: 0, total: 0, message: "Initiating AI visual recognition..." });
    if (allNewStepIds.length > 0) {
      supabase.functions.invoke("process-trip-steps", { body: { step_ids: allNewStepIds } }).catch(() => {});
    }

    toast.success("Upload complete! AI is finalizing locations.");
    setTimeout(() => {
      onImportComplete();
    }, 1500);
  };

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

  if (uploadState.phase !== "idle") {
    const percent = uploadState.total > 0 ? Math.round((uploadState.current / uploadState.total) * 100) : 100;
    return (
      <div className="relative z-20 w-full bg-background border border-border shadow-xl rounded-2xl p-10 mb-8 flex flex-col items-center justify-center text-center">
        {uploadState.phase === "finalizing" ? (
          <Sparkles className="h-10 w-10 animate-pulse text-blue-500 mb-4" />
        ) : (
          <Loader2 className="h-10 w-10 animate-spin text-primary mb-4" />
        )}
        <h3 className="font-display text-xl font-semibold text-foreground mb-2">
          {uploadState.phase === "reading" ? "Trip Media" : "Uploading directly to cloud..."}
        </h3>
        {uploadState.phase !== "finalizing" && (
          <p className="text-sm text-muted-foreground max-w-sm mb-6">
            {uploadState.phase === "reading"
              ? `Reading GPS data from file ${uploadState.current} of ${uploadState.total}...`
              : `Securing ${uploadState.current} of ${uploadState.total} files in the cloud...`}
          </p>
        )}
        <div className="h-3 w-full max-w-md overflow-hidden rounded-full bg-muted border border-border relative">
          <div
            className={cn(
              "h-full rounded-full transition-all duration-300",
              uploadState.phase === "finalizing" ? "bg-blue-500" : "bg-primary",
            )}
            style={{ width: `${Math.max(percent, 5)}%` }}
          />
        </div>
        {uploadState.phase === "uploading" && (
          <p className="text-xs font-medium text-amber-600 mt-4">
            ⚠️ Do not switch tabs. Backgrounding this page may pause the upload.
          </p>
        )}
      </div>
    );
  }

  return (
    <div className="relative z-20 w-full bg-background border border-border shadow-xl rounded-2xl p-6 mb-8">
      <div className="flex flex-col gap-3">
        <label
          onDragOver={(e) => {
            e.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={handleDrop}
          className={`flex cursor-pointer flex-col items-center gap-4 rounded-2xl border-2 border-dashed p-12 transition-colors ${dragOver ? "border-primary bg-primary/5" : "border-border hover:border-primary/50"}`}
        >
          <Upload className="h-10 w-10 text-muted-foreground" />
          <div className="text-center">
            <p className="font-medium text-foreground">Drop photos & videos here</p>
            <p className="text-sm text-muted-foreground">Files will instantly upload and be analyzed by AI</p>
          </div>
          <input
            ref={fileInputRef}
            type="file"
            multiple
            accept="image/*,video/*"
            onChange={handleFileSelect}
            className="hidden"
          />
          <span className="rounded-xl bg-primary px-6 py-2.5 text-sm font-semibold text-primary-foreground shadow-md">
            Browse Files
          </span>
        </label>
        {onCancel && (
          <button
            onClick={onCancel}
            className="self-end flex items-center gap-1.5 text-sm font-medium text-muted-foreground hover:text-foreground transition-colors mt-2"
          >
            <X className="h-4 w-4" /> Cancel
          </button>
        )}
      </div>
    </div>
  );
}
