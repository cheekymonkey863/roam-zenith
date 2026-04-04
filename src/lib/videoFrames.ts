import { FFmpeg } from "@ffmpeg/ffmpeg";
import { fetchFile, toBlobURL } from "@ffmpeg/util";

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
const FFMPEG_CORE_BASE_URL = "https://unpkg.com/@ffmpeg/core@0.12.9/dist/umd";

let ffmpegInstancePromise: Promise<FFmpeg> | null = null;
let ffmpegTaskQueue: Promise<void> = Promise.resolve();

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

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onerror = () => resolve("");
    reader.onload = () => resolve(typeof reader.result === "string" ? reader.result : "");
    reader.readAsDataURL(blob);
  });
}

async function getFfmpegInstance(): Promise<FFmpeg> {
  if (!ffmpegInstancePromise) {
    ffmpegInstancePromise = (async () => {
      const ffmpeg = new FFmpeg();
      const [coreURL, wasmURL] = await Promise.all([
        toBlobURL(`${FFMPEG_CORE_BASE_URL}/ffmpeg-core.js`, "text/javascript"),
        toBlobURL(`${FFMPEG_CORE_BASE_URL}/ffmpeg-core.wasm`, "application/wasm"),
      ]);

      await ffmpeg.load({ coreURL, wasmURL });
      return ffmpeg;
    })().catch((error) => {
      ffmpegInstancePromise = null;
      throw error;
    });
  }

  return ffmpegInstancePromise;
}

function queueFfmpegTask<T>(task: () => Promise<T>): Promise<T> {
  const run = ffmpegTaskQueue.then(task, task);
  ffmpegTaskQueue = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
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

async function captureFrameWithFfmpeg(file: File): Promise<string> {
  return queueFfmpegTask(async () => {
    let ffmpeg: FFmpeg | null = null;
    let inputName = "";
    let outputName = "";

    try {
      ffmpeg = await getFfmpegInstance();
      const extension = file.name.split(".").pop()?.toLowerCase() || "mov";
      inputName = `input-${crypto.randomUUID()}.${extension}`;
      outputName = `frame-${crypto.randomUUID()}.jpg`;

      await ffmpeg.writeFile(inputName, await fetchFile(file));
      const exitCode = await ffmpeg.exec([
        "-i",
        inputName,
        "-vf",
        "thumbnail=120",
        "-frames:v",
        "1",
        "-q:v",
        "4",
        outputName,
      ], 45000);

      if (exitCode !== 0) return "";

      const output = await ffmpeg.readFile(outputName);
      if (typeof output === "string" || !output.byteLength) return "";

      const dataUrl = await blobToDataUrl(new Blob([output.buffer as ArrayBuffer], { type: "image/jpeg" }));
      return resizeImageDataUrl(dataUrl, ANALYSIS_IMAGE_SIZE, ANALYSIS_IMAGE_QUALITY);
    } catch (error) {
      console.warn(`[video-preview] FFmpeg fallback failed for "${file.name}"`, error);
      return "";
    } finally {
      if (ffmpeg) {
        await Promise.allSettled([
          inputName ? ffmpeg.deleteFile(inputName) : Promise.resolve(),
          outputName ? ffmpeg.deleteFile(outputName) : Promise.resolve(),
        ]);
      }
    }
  });
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

  // For MOV files that failed HTML5 playback, fall back to ffmpeg.wasm extraction.
  if (!analysisImage && isMov) {
    console.info(`[video-preview] MOV file "${file.name}" — trying ffmpeg fallback...`);
    analysisImage = await captureFrameWithFfmpeg(file);
    if (analysisImage) {
      previewSource = "ffmpeg";
    } else {
      console.info(`[video-preview] MOV file "${file.name}" — no frame available, AI will use filename context.`);
    }
  }

  if (!analysisImage) {
    return { thumbnail: "", analysisImage: "", previewSource: "none" };
  }

  const thumbnail = await resizeImageDataUrl(analysisImage, THUMBNAIL_SIZE, THUMBNAIL_QUALITY);
  return { thumbnail, analysisImage, previewSource };
}