import { FFmpeg } from "@ffmpeg/ffmpeg";
import { fetchFile, toBlobURL } from "@ffmpeg/util";

import { supabase } from "@/integrations/supabase/client";

export type VideoPreviewSource = "html-video" | "ffmpeg" | "none";
export type { VideoPreviewSource as VideoPreviewSourceType };

export interface VideoPreviewSet {
  thumbnail: string;
  analysisImage: string;
  previewSource: VideoPreviewSource;
}

const ANALYSIS_IMAGE_SIZE = 768;
const THUMBNAIL_SIZE = 120;
const ANALYSIS_IMAGE_QUALITY = 0.76;
const THUMBNAIL_QUALITY = 0.6;

function isMovLikeFile(file: File) {
  const fileName = file.name.toLowerCase();
  return file.type === "video/quicktime" || fileName.endsWith(".mov") || fileName.endsWith(".qt");
}

function resizeImageDataUrl(dataUrl: string, size: number, quality: number): Promise<string> {
  return new Promise((resolve) => {
    if (!dataUrl) {
      resolve("");
      return;
    }

    const image = new Image();
    image.onerror = () => resolve("");
    image.onload = () => {
      const scale = Math.min(size / image.width, size / image.height, 1);
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(image.width * scale));
      canvas.height = Math.max(1, Math.round(image.height * scale));

      const ctx = canvas.getContext("2d");
      if (!ctx) {
        resolve("");
        return;
      }

      ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
      resolve(canvas.toDataURL("image/jpeg", quality));
    };
    image.src = dataUrl;
  });
}

function captureFrameWithVideoElement(file: File, targetSize = ANALYSIS_IMAGE_SIZE, targetQuality = ANALYSIS_IMAGE_QUALITY): Promise<string> {
  return new Promise((resolve) => {
    const video = document.createElement("video");
    const url = URL.createObjectURL(file);
    let settled = false;
    let seekAttempted = false;

    const finish = (value: string) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timeoutId);
      URL.revokeObjectURL(url);
      resolve(value);
    };

    const capture = () => {
      try {
        if (!video.videoWidth || !video.videoHeight) {
          finish("");
          return;
        }

        const scale = Math.min(targetSize / video.videoWidth, targetSize / video.videoHeight, 1);
        const canvas = document.createElement("canvas");
        canvas.width = Math.max(1, Math.round(video.videoWidth * scale));
        canvas.height = Math.max(1, Math.round(video.videoHeight * scale));

        const ctx = canvas.getContext("2d");
        if (!ctx) {
          finish("");
          return;
        }

        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        const dataUrl = canvas.toDataURL("image/jpeg", targetQuality);
        finish(dataUrl.length >= 500 ? dataUrl : "");
      } catch {
        finish("");
      }
    };

    video.preload = "auto";
    video.muted = true;
    video.playsInline = true;
    video.crossOrigin = "anonymous";
    video.src = url;

    video.onerror = () => finish("");
    video.onseeked = capture;
    video.oncanplaythrough = () => {
      if (!seekAttempted && !settled) capture();
    };
    video.onloadedmetadata = () => {
      if (!Number.isFinite(video.duration) || video.duration <= 0.1) {
        seekAttempted = true;
        video.currentTime = 0;
        return;
      }

      const targetTime = Math.min(Math.max(video.duration * 0.33, 0.5), Math.max(video.duration - 0.1, 0));
      seekAttempted = true;
      video.currentTime = targetTime;
    };

    const timeoutMs = Math.min(Math.max(12000, file.size / 120000), 25000);
    const timeoutId = window.setTimeout(() => {
      if (video.videoWidth && video.videoHeight) {
        capture();
      } else {
        finish("");
      }
    }, timeoutMs);
  });
}

/**
 * Server-side frame extraction for MOV/QuickTime files that browsers can't decode.
 * Sends a small chunk to the extract-video-metadata edge function which also
 * returns a base64 JPEG frame if available.
 */
async function captureFrameServerSide(file: File): Promise<string> {
  try {
    // Read first 512KB - enough for the server to find a keyframe in many cases
    const CHUNK_SIZE = 512 * 1024;
    const chunk = file.slice(0, Math.min(file.size, CHUNK_SIZE));
    const buffer = await chunk.arrayBuffer();
    const bytes = new Uint8Array(buffer);
    const chunkSize = 0x8000;
    let binary = "";
    for (let i = 0; i < bytes.length; i += chunkSize) {
      const subChunk = bytes.subarray(i, i + chunkSize);
      binary += String.fromCharCode(...subChunk);
    }
    const base64 = btoa(binary);

    const { data, error } = await supabase.functions.invoke("extract-video-metadata", {
      body: { videoBase64: base64, extractFrame: true },
    });

    if (error || !data?.frameBase64) return "";

    const frameDataUrl = data.frameBase64.startsWith("data:")
      ? data.frameBase64
      : `data:image/jpeg;base64,${data.frameBase64}`;

    return frameDataUrl.length >= 500 ? frameDataUrl : "";
  } catch {
    return "";
  }
}

export async function createVideoPreviews(file: File): Promise<VideoPreviewSet> {
  const isMov = isMovLikeFile(file);

  let analysisImage = "";
  let previewSource: VideoPreviewSource = "none";

  // Try HTML5 video element first (works for MP4, WebM, etc.)
  analysisImage = await captureFrameWithVideoElement(file);
  if (analysisImage) {
    previewSource = "html-video";
  }

  // For MOV files that failed HTML5 playback, we note no preview but don't block
  // The AI inference will still work with filename/date context
  if (!analysisImage && isMov) {
    console.info(`[video-preview] MOV file "${file.name}" — no browser-side frame available, AI will use filename context.`);
  }

  if (!analysisImage) {
    return { thumbnail: "", analysisImage: "", previewSource: "none" };
  }

  const thumbnail = await resizeImageDataUrl(analysisImage, THUMBNAIL_SIZE, THUMBNAIL_QUALITY);
  return { thumbnail, analysisImage, previewSource };
}