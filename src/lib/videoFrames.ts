import { FFmpeg } from "@ffmpeg/ffmpeg";
import { fetchFile, toBlobURL } from "@ffmpeg/util";

export type VideoPreviewSource = "html-video" | "ffmpeg" | "none";

export interface VideoPreviewSet {
  thumbnail: string;
  analysisImage: string;
  previewSource: VideoPreviewSource;
}

const ANALYSIS_IMAGE_SIZE = 768;
const THUMBNAIL_SIZE = 120;
const ANALYSIS_IMAGE_QUALITY = 0.76;
const THUMBNAIL_QUALITY = 0.6;
const FFMPEG_CORE_BASE_URL = "https://unpkg.com/@ffmpeg/core@0.12.9/dist/esm";

let ffmpegInstance: FFmpeg | null = null;
let ffmpegLoadPromise: Promise<FFmpeg> | null = null;
let ffmpegAssetUrlsPromise: Promise<{ coreURL: string; wasmURL: string; workerURL: string }> | null = null;
let ffmpegTaskQueue = Promise.resolve();

function isMovLikeFile(file: File) {
  const fileName = file.name.toLowerCase();
  return file.type === "video/quicktime" || fileName.endsWith(".mov") || fileName.endsWith(".qt");
}

function readBlobAsDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(typeof reader.result === "string" ? reader.result : "");
    reader.onerror = () => reject(reader.error ?? new Error("Failed to read blob as data URL"));
    reader.readAsDataURL(blob);
  });
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

function captureFrameWithVideoElement(file: File): Promise<string> {
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

        const scale = Math.min(ANALYSIS_IMAGE_SIZE / video.videoWidth, ANALYSIS_IMAGE_SIZE / video.videoHeight, 1);
        const canvas = document.createElement("canvas");
        canvas.width = Math.max(1, Math.round(video.videoWidth * scale));
        canvas.height = Math.max(1, Math.round(video.videoHeight * scale));

        const ctx = canvas.getContext("2d");
        if (!ctx) {
          finish("");
          return;
        }

        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        const dataUrl = canvas.toDataURL("image/jpeg", ANALYSIS_IMAGE_QUALITY);
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

async function getFfmpegAssetUrls() {
  if (!ffmpegAssetUrlsPromise) {
    ffmpegAssetUrlsPromise = Promise.all([
      toBlobURL(`${FFMPEG_CORE_BASE_URL}/ffmpeg-core.js`, "text/javascript"),
      toBlobURL(`${FFMPEG_CORE_BASE_URL}/ffmpeg-core.wasm`, "application/wasm"),
      toBlobURL(`${FFMPEG_CORE_BASE_URL}/ffmpeg-core.worker.js`, "text/javascript"),
    ]).then(([coreURL, wasmURL, workerURL]) => ({ coreURL, wasmURL, workerURL }));
  }

  return ffmpegAssetUrlsPromise;
}

async function getFfmpeg() {
  if (ffmpegInstance?.loaded) return ffmpegInstance;

  if (!ffmpegLoadPromise) {
    ffmpegLoadPromise = (async () => {
      const ffmpeg = ffmpegInstance ?? new FFmpeg();
      const assets = await getFfmpegAssetUrls();
      await ffmpeg.load(assets);
      ffmpegInstance = ffmpeg;
      return ffmpeg;
    })().catch((error) => {
      ffmpegLoadPromise = null;
      throw error;
    });
  }

  return ffmpegLoadPromise;
}

function queueFfmpegTask<T>(task: () => Promise<T>) {
  const run = ffmpegTaskQueue.then(task, task);
  ffmpegTaskQueue = run.then(() => undefined, () => undefined);
  return run;
}

async function safeDeleteFile(ffmpeg: FFmpeg, path: string) {
  try {
    await ffmpeg.deleteFile(path);
  } catch {
    // Ignore cleanup failures
  }
}

async function readVideoDuration(ffmpeg: FFmpeg, inputName: string) {
  const outputName = `duration-${crypto.randomUUID()}.txt`;

  try {
    const exitCode = await ffmpeg.ffprobe(
      [
        "-v",
        "error",
        "-show_entries",
        "format=duration",
        "-of",
        "default=noprint_wrappers=1:nokey=1",
        inputName,
        "-o",
        outputName,
      ],
      15000,
    );

    if (exitCode !== 0) return null;

    const durationText = await ffmpeg.readFile(outputName, "utf8");
    if (typeof durationText !== "string") return null;

    const duration = Number.parseFloat(durationText.trim());
    return Number.isFinite(duration) && duration > 0 ? duration : null;
  } catch {
    return null;
  } finally {
    await safeDeleteFile(ffmpeg, outputName);
  }
}

async function captureFrameWithFfmpeg(file: File) {
  return queueFfmpegTask(async () => {
    const ffmpeg = await getFfmpeg();
    const extension = file.name.split(".").pop()?.toLowerCase() || "mp4";
    const inputName = `input-${crypto.randomUUID()}.${extension}`;
    const outputName = `frame-${crypto.randomUUID()}.jpg`;

    try {
      await ffmpeg.writeFile(inputName, await fetchFile(file));

      const duration = await readVideoDuration(ffmpeg, inputName);
      const seekSeconds = duration === null ? 0 : Math.min(Math.max(duration * 0.33, 0), Math.max(duration - 0.1, 0));
      const exitCode = await ffmpeg.exec(
        [
          "-ss",
          seekSeconds.toFixed(2),
          "-i",
          inputName,
          "-frames:v",
          "1",
          "-vf",
          `scale=${ANALYSIS_IMAGE_SIZE}:${ANALYSIS_IMAGE_SIZE}:force_original_aspect_ratio=decrease`,
          "-q:v",
          "4",
          outputName,
        ],
        30000,
      );

      if (exitCode !== 0) return "";

      const imageBytes = await ffmpeg.readFile(outputName);
      if (!(imageBytes instanceof Uint8Array) || imageBytes.length === 0) return "";

      const blobBytes = new Uint8Array(imageBytes);
      return readBlobAsDataUrl(new Blob([blobBytes.buffer], { type: "image/jpeg" }));
    } catch {
      return "";
    } finally {
      await Promise.all([safeDeleteFile(ffmpeg, inputName), safeDeleteFile(ffmpeg, outputName)]);
    }
  });
}

export async function createVideoPreviews(file: File): Promise<VideoPreviewSet> {
  const prefersFfmpeg = isMovLikeFile(file);

  let analysisImage = "";
  let previewSource: VideoPreviewSource = "none";

  if (prefersFfmpeg) {
    analysisImage = await captureFrameWithFfmpeg(file);
    previewSource = analysisImage ? "ffmpeg" : "none";
    if (!analysisImage) {
      analysisImage = await captureFrameWithVideoElement(file);
      previewSource = analysisImage ? "html-video" : "none";
    }
  } else {
    analysisImage = await captureFrameWithVideoElement(file);
    previewSource = analysisImage ? "html-video" : "none";
    if (!analysisImage) {
      analysisImage = await captureFrameWithFfmpeg(file);
      previewSource = analysisImage ? "ffmpeg" : "none";
    }
  }

  if (!analysisImage) {
    console.warn(`[video-preview] Could not extract a representative frame for "${file.name}".`);
    return { thumbnail: "", analysisImage: "", previewSource: "none" };
  }

  const thumbnail = await resizeImageDataUrl(analysisImage, THUMBNAIL_SIZE, THUMBNAIL_QUALITY);
  return { thumbnail, analysisImage, previewSource };
}