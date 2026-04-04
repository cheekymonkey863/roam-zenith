import * as tus from "tus-js-client";
import { supabase } from "@/integrations/supabase/client";

export interface ResumableUploadOptions {
  bucketName: string;
  objectName: string;
  file: File;
  contentType?: string;
  onProgress?: (percent: number) => void;
  onError?: (error: Error) => void;
}

/**
 * Upload a file to Supabase Storage using the TUS resumable protocol.
 * Breaks the file into 6MB chunks so large 4K videos don't spike browser memory.
 * Automatically retries on network drops.
 *
 * Returns the storage object name on success.
 */
export function resumableUpload({
  bucketName,
  objectName,
  file,
  contentType,
  onProgress,
  onError,
}: ResumableUploadOptions): Promise<string> {
  return new Promise(async (resolve, reject) => {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) {
      const err = new Error("User must be authenticated to upload");
      onError?.(err);
      reject(err);
      return;
    }

    const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
    const endpoint = `${supabaseUrl}/storage/v1/upload/resumable`;

    const upload = new tus.Upload(file, {
      endpoint,
      retryDelays: [0, 3000, 5000, 10000, 20000],
      headers: {
        authorization: `Bearer ${session.access_token}`,
        "x-upsert": "true",
      },
      uploadDataDuringCreation: true,
      removeFingerprintOnSuccess: true,
      metadata: {
        bucketName,
        objectName,
        contentType: contentType || file.type || "video/mp4",
        cacheControl: "3600",
      },
      // Supabase enforces exactly 6MB chunks
      chunkSize: 6 * 1024 * 1024,
      onError: (error) => {
        console.error("[resumable-upload] failed:", error);
        const err = error instanceof Error ? error : new Error(String(error));
        onError?.(err);
        reject(err);
      },
      onProgress: (bytesUploaded, bytesTotal) => {
        const percent = Math.round((bytesUploaded / bytesTotal) * 100);
        onProgress?.(percent);
      },
      onSuccess: () => {
        resolve(objectName);
      },
    });

    // Resume a previously interrupted upload if possible
    const previousUploads = await upload.findPreviousUploads();
    if (previousUploads.length > 0) {
      upload.resumeFromPreviousUpload(previousUploads[0]);
    }

    upload.start();
  });
}
