import exifr from "exifr";
import heic2any from "heic2any";
import { supabase } from "@/integrations/supabase/client";
import { createVideoPreviews, type VideoPreviewSource } from "@/lib/videoFrames";

export interface PhotoExifData {
  file: File;
  uploadFile?: File;
  captionId: string;
  caption?: string;
  sceneDescription?: string;
  aiTags?: string[];
  latitude: number | null;
  longitude: number | null;
  takenAt: Date | null;
  thumbnail?: string;
  analysisImage?: string;
  cameraMake?: string;
  cameraModel?: string;
  duration?: number | null;
  metadataSources?: string[];
  previewSource?: VideoPreviewSource;
  exifRaw?: Record<string, unknown>;
}

const DATE_FIELD_PRIORITY = [
  "SubSecDateTimeOriginal",
  "DateTimeOriginal",
  "DateTimeDigitized",
  "CreateDate",
  "DateCreated",
  "CreationDate",
  "MediaCreateDate",
  "TrackCreateDate",
  "ModifyDate",
] as const;

const HEIC_EXTENSIONS = [".heic", ".heif", ".heics", ".heifs"];
const HEIC_MIME_TYPES = new Set([
  "image/heic",
  "image/heif",
  "image/heic-sequence",
  "image/heif-sequence",
]);

function isHeicLikeFile(file: File) {
  const lowerFileName = file.name.toLowerCase();
  return HEIC_EXTENSIONS.some((extension) => lowerFileName.endsWith(extension)) || HEIC_MIME_TYPES.has(file.type.toLowerCase());
}

function withExtension(fileName: string, extension: string) {
  return `${fileName.replace(/\.[^.]+$/, "")}${extension}`;
}

function normalizeDate(value: unknown): Date | null {
  if (!value) return null;

  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value;
  }

  if (typeof value === "number") {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return null;

    const parsed = new Date(trimmed);
    if (!Number.isNaN(parsed.getTime())) return parsed;

    const exifMatch = trimmed.match(
      /^(\d{4})[:.-](\d{2})[:.-](\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?(?:\.(\d{1,3}))?(?:\s?(Z|[+-]\d{2}:?\d{2}))?$/,
    );

    if (exifMatch) {
      const [, year, month, day, hour, minute, second = "0", millisecond = "0", timezone] = exifMatch;

      if (timezone) {
        const normalizedTimezone = timezone.replace(/^([+-]\d{2})(\d{2})$/, "$1:$2");
        const isoLike = `${year}-${month}-${day}T${hour}:${minute}:${second}.${millisecond.padEnd(3, "0")}${normalizedTimezone}`;
        const zonedDate = new Date(isoLike);
        return Number.isNaN(zonedDate.getTime()) ? null : zonedDate;
      }

      const localDate = new Date(
        Number(year),
        Number(month) - 1,
        Number(day),
        Number(hour),
        Number(minute),
        Number(second),
        Number(millisecond.padEnd(3, "0")),
      );
      return Number.isNaN(localDate.getTime()) ? null : localDate;
    }
  }

  return null;
}

function collectNestedValuesByKey(value: unknown, key: string, seen = new WeakSet<object>()): unknown[] {
  if (!value || typeof value !== "object") return [];
  if (value instanceof Date) return [];
  if (seen.has(value)) return [];
  seen.add(value);

  if (Array.isArray(value)) {
    return value.flatMap((item) => collectNestedValuesByKey(item, key, seen));
  }

  const record = value as Record<string, unknown>;
  const matches: unknown[] = [];

  if (key in record) {
    matches.push(record[key]);
  }

  for (const child of Object.values(record)) {
    matches.push(...collectNestedValuesByKey(child, key, seen));
  }

  return matches;
}

function sanitizeMetadataValue(value: unknown, depth = 0): unknown {
  if (depth > 8) return null;

  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return value;
  }

  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value.toISOString();
  }

  if (typeof value === "bigint") {
    return value.toString();
  }

  if (ArrayBuffer.isView(value)) {
    return Array.from(new Uint8Array(value.buffer, value.byteOffset, value.byteLength));
  }

  if (value instanceof ArrayBuffer) {
    return null;
  }

  if (Array.isArray(value)) {
    return value
      .map((item) => sanitizeMetadataValue(item, depth + 1))
      .filter((item) => item !== undefined);
  }

  if (typeof value === "object") {
    const result: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      const sanitized = sanitizeMetadataValue(child, depth + 1);
      if (sanitized !== undefined) {
        result[key] = sanitized;
      }
    }
    return result;
  }

  return undefined;
}

function extractCoordinatesFromExif(exif: any): { latitude: number | null; longitude: number | null } {
  let latitude: number | null = null;
  let longitude: number | null = null;

  if (typeof exif?.latitude === "number" && typeof exif?.longitude === "number") {
    latitude = exif.latitude;
    longitude = exif.longitude;
  } else if (typeof exif?.GPSLatitude === "number" && typeof exif?.GPSLongitude === "number") {
    latitude = exif.GPSLatitude;
    longitude = exif.GPSLongitude;
    if (exif.GPSLatitudeRef === "S" || exif.GPSLatitudeRef === "s") latitude = -Math.abs(latitude);
    if (exif.GPSLongitudeRef === "W" || exif.GPSLongitudeRef === "w") longitude = -Math.abs(longitude);
  }

  if (
    latitude === null ||
    longitude === null ||
    Math.abs(latitude) > 90 ||
    Math.abs(longitude) > 180
  ) {
    return { latitude: null, longitude: null };
  }

  return { latitude, longitude };
}

function extractTakenAtFromExif(exif: any): Date | null {
  if (!exif || typeof exif !== "object") return null;

  for (const key of DATE_FIELD_PRIORITY) {
    const directMatch = normalizeDate(exif[key]);
    if (directMatch) return directMatch;

    const nestedMatches = collectNestedValuesByKey(exif, key);
    for (const candidate of nestedMatches) {
      const nestedDate = normalizeDate(candidate);
      if (nestedDate) return nestedDate;
    }
  }

  return null;
}

async function normalizeImageFileForBrowser(file: File): Promise<File> {
  if (!isHeicLikeFile(file)) return file;

  try {
    const converted = await heic2any({ blob: file, toType: "image/jpeg", quality: 0.92 });
    const blob = Array.isArray(converted) ? converted[0] : converted;

    if (!(blob instanceof Blob)) return file;

    return new File([blob], withExtension(file.name, ".jpg"), {
      type: "image/jpeg",
      lastModified: file.lastModified,
    });
  } catch (error) {
    console.warn("HEIC conversion failed, falling back to original image", error);
    return file;
  }
}

async function parseMediaExif(file: File) {
  try {
    return await exifr.parse(file, {
      gps: true,
      tiff: true,
      xmp: true,
      iptc: true,
      jfif: true,
      multiSegment: true,
    });
  } catch {
    return null;
  }
}

/**
 * Try to extract creation date from MP4/MOV file header (mvhd atom).
 * The mvhd atom stores creation_time as seconds since 1904-01-01.
 */
async function readVideoChunks(file: File): Promise<ArrayBuffer[]> {
  const HEAD_SIZE = 256 * 1024;
  const TAIL_SIZE = 512 * 1024;
  const chunks: ArrayBuffer[] = [];
  chunks.push(await file.slice(0, Math.min(file.size, HEAD_SIZE)).arrayBuffer());
  if (file.size > HEAD_SIZE) {
    const tailStart = Math.max(file.size - TAIL_SIZE, HEAD_SIZE);
    chunks.push(await file.slice(tailStart, file.size).arrayBuffer());
  }
  return chunks;
}

async function parseVideoCreationDate(file: File): Promise<Date | null> {
  try {
    const chunks = await readVideoChunks(file);
    for (const buffer of chunks) {
      const view = new DataView(buffer);
      const bytes = new Uint8Array(buffer);

      for (let i = 0; i < view.byteLength - 16; i++) {
        if (view.getUint8(i) === 0x6D && view.getUint8(i + 1) === 0x76 && view.getUint8(i + 2) === 0x68 && view.getUint8(i + 3) === 0x64) {
          const version = view.getUint8(i + 4);
          let creationTime: number;
          if (version === 0) {
            if (i + 12 > view.byteLength) continue;
            creationTime = view.getUint32(i + 8);
          } else {
            if (i + 16 > view.byteLength) continue;
            creationTime = view.getUint32(i + 8) * 0x100000000 + view.getUint32(i + 12);
          }
          if (creationTime === 0) continue;
          const date = new Date((creationTime - 2082844800) * 1000);
          if (date.getFullYear() >= 2000 && date.getFullYear() <= 2100) {
            console.log(`[video-date] Found mvhd in ${file.name}: ${date.toISOString()}`);
            return date;
          }
        }
      }

      // Search for ©day atom
      for (let i = 0; i < bytes.length - 12; i++) {
        if (bytes[i] === 0xA9 && bytes[i + 1] === 0x64 && bytes[i + 2] === 0x61 && bytes[i + 3] === 0x79) {
          const text = new TextDecoder().decode(bytes.slice(i + 8, Math.min(i + 48, bytes.length))).replace(/\0/g, "").trim();
          if (text.length > 0) {
            const date = new Date(text);
            if (!isNaN(date.getTime()) && date.getFullYear() >= 2000) {
              console.log(`[video-date] Found ©day in ${file.name}: ${date.toISOString()}`);
              return date;
            }
          }
        }
      }
    }
  } catch {
    // Ignore parse errors
  }
  return null;
}

/**
 * Try to extract GPS from MP4/MOV metadata (©xyz atom used by iPhones).
 * Format: "+34.1234-118.4567/" (ISO 6709)
 */
async function parseVideoGPS(file: File): Promise<{ latitude: number; longitude: number } | null> {
  try {
    const chunks = await readVideoChunks(file);
    for (const buffer of chunks) {
      const bytes = new Uint8Array(buffer);
      const view = new DataView(buffer);

      // ©xyz atom — iPhone GPS in ISO 6709
      for (let i = 0; i < bytes.length - 20; i++) {
        if (bytes[i] === 0xA9 && bytes[i + 1] === 0x78 && bytes[i + 2] === 0x79 && bytes[i + 3] === 0x7A) {
          const text = new TextDecoder().decode(bytes.slice(i + 4, Math.min(i + 64, bytes.length)));
          const match = text.match(/([+-]\d+\.?\d*)([+-]\d+\.?\d*)/);
          if (match) {
            const lat = parseFloat(match[1]);
            const lng = parseFloat(match[2]);
            if (Math.abs(lat) <= 90 && Math.abs(lng) <= 180 && !(lat === 0 && lng === 0)) {
              console.log(`[video-gps] Found ©xyz in ${file.name}: ${lat}, ${lng}`);
              return { latitude: lat, longitude: lng };
            }
          }
        }
      }

      // 'loci' atom — Android 3GPP GPS
      for (let i = 0; i < bytes.length - 20; i++) {
        if (bytes[i] === 0x6C && bytes[i + 1] === 0x6F && bytes[i + 2] === 0x63 && bytes[i + 3] === 0x69) {
          let pos = i + 4 + 4 + 2;
          while (pos < bytes.length && bytes[pos] !== 0) pos++;
          pos += 2;
          if (pos + 8 <= view.byteLength) {
            const lat = view.getInt32(pos) / 65536.0;
            const lng = view.getInt32(pos + 4) / 65536.0;
            if (Math.abs(lat) <= 90 && Math.abs(lng) <= 180 && !(lat === 0 && lng === 0)) {
              console.log(`[video-gps] Found loci in ${file.name}: ${lat}, ${lng}`);
              return { latitude: lat, longitude: lng };
            }
          }
        }
      }
    }
  } catch {
    // Ignore parse errors
  }
  return null;
}

function arrayBufferToBase64(buffer: ArrayBuffer) {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  const chunkSize = 0x8000;

  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode(...chunk);
  }

  return btoa(binary);
}

/**
 * Send the first ~2MB of a video file to the server-side metadata extraction
 * edge function for robust MP4/MOV atom tree parsing.
 */
async function extractVideoMetadataServerSide(
  file: File
): Promise<{
  latitude: number | null;
  longitude: number | null;
  creationDate: string | null;
  duration: number | null;
  cameraMake: string | null;
  cameraModel: string | null;
} | null> {
  try {
    const CHUNK_SIZE = 2 * 1024 * 1024;
    // Reduce to fit edge function payload limits (base64 adds ~33%)
    const headBuffer = await file.slice(0, Math.min(file.size, CHUNK_SIZE)).arrayBuffer();
    const buffers = [headBuffer];

    if (file.size > CHUNK_SIZE) {
      const tailStart = Math.max(file.size - CHUNK_SIZE, CHUNK_SIZE);
      const tailBuffer = await file.slice(tailStart, file.size).arrayBuffer();
      if (tailBuffer.byteLength > 0) buffers.push(tailBuffer);
    }

    const videoPartsBase64 = buffers.map(arrayBufferToBase64);

    const { data, error } = await supabase.functions.invoke("extract-video-metadata", {
      body: { videoPartsBase64 },
    });

    if (error) {
      console.warn("[video-metadata] Server-side extraction failed:", error);
      return null;
    }

    return data as {
      latitude: number | null;
      longitude: number | null;
      creationDate: string | null;
      duration: number | null;
      cameraMake: string | null;
      cameraModel: string | null;
    };
  } catch (e) {
    console.warn("[video-metadata] Server-side extraction error:", e);
    return null;
  }
}

export async function extractExifFromFile(file: File): Promise<PhotoExifData> {
  const isVideo = file.type.startsWith("video/");

  const [uploadFile, exif, videoPreviews] = await Promise.all([
    isVideo ? Promise.resolve(file) : normalizeImageFileForBrowser(file),
    parseMediaExif(file),
    isVideo ? createVideoPreviews(file) : Promise.resolve(null),
  ]);

  const [thumbnail, analysisImage] = isVideo && videoPreviews
    ? [videoPreviews.thumbnail, videoPreviews.analysisImage]
    : await Promise.all([
        createImagePreview(uploadFile, 120, 0.6),
        createImagePreview(uploadFile, 768, 0.76),
      ]);

  const metadataSources = new Set<string>();
  const previewSource = videoPreviews?.previewSource;
  if (previewSource && previewSource !== "none") {
    metadataSources.add(`preview_${previewSource}`);
  }

  const embeddedCoordinates = extractCoordinatesFromExif(exif);
  let { latitude, longitude } = embeddedCoordinates;
  if (latitude !== null && longitude !== null) {
    metadataSources.add("embedded_gps");
  }

  const embeddedDate = extractTakenAtFromExif(exif);
  let takenAt = embeddedDate;
  if (embeddedDate) {
    metadataSources.add("embedded_capture_time");
  }

  let cameraMake: string | undefined = typeof exif?.Make === "string" ? exif.Make : undefined;
  let cameraModel: string | undefined = typeof exif?.Model === "string" ? exif.Model : undefined;
  let duration: number | null = null;

  if (cameraMake || cameraModel) {
    metadataSources.add("embedded_camera");
  }

  // For videos: use server-side metadata extraction for robust MP4/MOV parsing
  if (isVideo) {
    // Client-side video atom parsing — reads head + tail of file
    if (latitude === null || longitude === null) {
      const videoGPS = await parseVideoGPS(file);
      if (videoGPS) {
        latitude = videoGPS.latitude;
        longitude = videoGPS.longitude;
        metadataSources.add("video_container_gps");
      }
    }

    if (!embeddedDate && !takenAt) {
      const videoDate = await parseVideoCreationDate(file);
      if (videoDate) {
        takenAt = videoDate;
        metadataSources.add("video_container_time");
      }
    }

    // Server-side fallback only when client-side didn't find everything
    if (latitude === null || longitude === null || !takenAt) {
      const serverMeta = await extractVideoMetadataServerSide(file);
      if (serverMeta) {
        if ((latitude === null || longitude === null) && serverMeta.latitude !== null && serverMeta.longitude !== null) {
          latitude = serverMeta.latitude; longitude = serverMeta.longitude; metadataSources.add("video_server_gps");
        }
        if (!takenAt && serverMeta.creationDate) {
          const d = new Date(serverMeta.creationDate);
          if (!isNaN(d.getTime())) { takenAt = d; metadataSources.add("video_server_time"); }
        }
        if (duration === null && typeof serverMeta.duration === "number") { duration = serverMeta.duration; }
        if (!cameraMake && serverMeta.cameraMake) cameraMake = serverMeta.cameraMake;
        if (!cameraModel && serverMeta.cameraModel) cameraModel = serverMeta.cameraModel;
      }
    }
  }

  console.log(`[exif] ${file.name}: GPS=${latitude},${longitude} date=${takenAt?.toISOString() ?? "none"} sources=[${Array.from(metadataSources).join(",")}]`);

  const sanitizedExif = sanitizeMetadataValue(exif);

  return {
    file,
    uploadFile,
    captionId: crypto.randomUUID(),
    latitude,
    longitude,
    takenAt,
    thumbnail,
    analysisImage,
    cameraMake,
    cameraModel,
    duration,
    metadataSources: Array.from(metadataSources),
    previewSource: previewSource ?? "none",
    aiTags: [],
    exifRaw:
      sanitizedExif && typeof sanitizedExif === "object" && !Array.isArray(sanitizedExif)
        ? (sanitizedExif as Record<string, unknown>)
        : undefined,
  };
}

function createVideoThumbnail(file: File, size: number, quality: number): Promise<string> {
  return new Promise((resolve) => {
    const video = document.createElement("video");
    const url = URL.createObjectURL(file);
    let settled = false;

    const finish = (value: string) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timeoutId);
      URL.revokeObjectURL(url);
      if (!value) {
        console.warn(`[video-thumbnail] Failed to capture frame from "${file.name}" (${file.type}, ${(file.size / 1024 / 1024).toFixed(1)}MB)`);
      }
      resolve(value);
    };

    const captureFrame = () => {
      try {
        if (!video.videoWidth || !video.videoHeight) {
          finish("");
          return;
        }

        const scale = Math.min(size / video.videoWidth, size / video.videoHeight, 1);
        const canvas = document.createElement("canvas");
        canvas.width = Math.max(1, Math.round(video.videoWidth * scale));
        canvas.height = Math.max(1, Math.round(video.videoHeight * scale));

        const ctx = canvas.getContext("2d");
        if (!ctx) {
          finish("");
          return;
        }

        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        const dataUrl = canvas.toDataURL("image/jpeg", quality);
        // Verify we got a real image (not just the empty canvas header)
        if (dataUrl.length < 500) {
          console.warn(`[video-thumbnail] Frame capture produced tiny output for "${file.name}"`);
          finish("");
          return;
        }
        finish(dataUrl);
      } catch (e) {
        console.warn(`[video-thumbnail] Draw error for "${file.name}":`, e);
        finish("");
      }
    };

    video.preload = "auto";
    video.muted = true;
    video.playsInline = true;
    video.crossOrigin = "anonymous";
    video.src = url;

    video.onerror = (e) => {
      console.warn(`[video-thumbnail] Video element error for "${file.name}" (${file.type}):`, e);
      finish("");
    };

    let seekAttempted = false;

    video.onloadedmetadata = () => {
      if (!Number.isFinite(video.duration) || video.duration <= 0.1) {
        // Very short or unknown duration — try frame at 0
        video.currentTime = 0;
        seekAttempted = true;
        return;
      }

      const targetTime = Math.min(Math.max(video.duration * 0.33, 0.5), video.duration - 0.1);
      video.currentTime = targetTime;
      seekAttempted = true;
    };

    // Fallback: if data is loaded but no seek happened, try capturing at current position
    video.oncanplaythrough = () => {
      if (!seekAttempted && !settled) {
        captureFrame();
      }
    };

    video.onseeked = captureFrame;

    // Increase timeout for larger files
    const timeoutMs = Math.min(Math.max(15000, file.size / 100000), 30000);
    const timeoutId = window.setTimeout(() => {
      console.warn(`[video-thumbnail] Timeout after ${timeoutMs}ms for "${file.name}"`);
      // Last-ditch attempt: try to capture whatever frame is showing
      if (video.videoWidth && video.videoHeight) {
        captureFrame();
      } else {
        finish("");
      }
    }, timeoutMs);
  });
}

function createImagePreview(file: File, size: number, quality: number): Promise<string> {
  return new Promise((resolve) => {
    if (!file.type.startsWith("image/")) {
      resolve("");
      return;
    }

    const reader = new FileReader();
    reader.onerror = () => resolve("");
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => resolve("");
      img.onload = () => {
        const scale = Math.min(size / img.width, size / img.height, 1);
        const canvas = document.createElement("canvas");
        canvas.width = Math.max(1, Math.round(img.width * scale));
        canvas.height = Math.max(1, Math.round(img.height * scale));

        const ctx = canvas.getContext("2d");
        if (!ctx) {
          resolve("");
          return;
        }

        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL("image/jpeg", quality));
      };
      img.src = reader.result as string;
    };

    reader.readAsDataURL(file);
  });
}

export async function extractExifFromFiles(files: File[]): Promise<PhotoExifData[]> {
  return Promise.all(files.map(extractExifFromFile));
}

const DEFAULT_LOCATION_GROUP_MAX_GAP_HOURS = 6;

export function groupPhotosByLocation(
  photos: PhotoExifData[],
  radiusMeters = 500,
  maxGapHours = DEFAULT_LOCATION_GROUP_MAX_GAP_HOURS
): Map<string, PhotoExifData[]> {
  const geoPhotos = photos
    .filter((photo) => photo.latitude !== null && photo.longitude !== null)
    .sort((a, b) => (a.takenAt?.getTime() ?? a.file.lastModified ?? 0) - (b.takenAt?.getTime() ?? b.file.lastModified ?? 0));

  const groups = new Map<string, PhotoExifData[]>();
  const maxGapMs = maxGapHours * 60 * 60 * 1000;

  for (const photo of geoPhotos) {
    let bestGroupKey: string | null = null;
    let bestScore = Number.POSITIVE_INFINITY;

    for (const [key, group] of groups) {
      const closestDistance = getClosestGroupDistance(photo, group);
      const centerDistance = getGroupCenterDistance(photo, group);
      const closestTimeDistance = getClosestGroupTimeDistance(photo, group);
      const sharesDay = isCompatibleDay(photo, group);
      const withinTimeWindow = closestTimeDistance === null || closestTimeDistance <= maxGapMs;
      const closestLocationDistance = Math.min(closestDistance, centerDistance);

      if (!sharesDay || !withinTimeWindow || closestLocationDistance > radiusMeters) {
        continue;
      }

      const score = closestLocationDistance + (closestTimeDistance ?? 0) / 1000;
      if (score < bestScore) {
        bestScore = score;
        bestGroupKey = key;
      }
    }

    if (bestGroupKey) {
      groups.get(bestGroupKey)?.push(photo);
    } else {
      const day = photo.takenAt ? dayKey(photo.takenAt) : "no-date";
      const timeKey = photo.takenAt?.getTime() ?? groups.size;
      groups.set(`${day}-${timeKey}`, [photo]);
    }
  }

  return groups;
}

export function groupMediaByTime(photos: PhotoExifData[], maxGapHours = 6): Map<string, PhotoExifData[]> {
  const sortedPhotos = [...photos].sort(
    (a, b) => (a.takenAt?.getTime() ?? a.file.lastModified ?? 0) - (b.takenAt?.getTime() ?? b.file.lastModified ?? 0)
  );
  const groups = new Map<string, PhotoExifData[]>();
  const maxGapMs = maxGapHours * 60 * 60 * 1000;

  for (const photo of sortedPhotos) {
    if (!photo.takenAt) {
      groups.set(`no-date-${groups.size}`, [photo]);
      continue;
    }

    let bestGroupKey: string | null = null;
    let bestGap = Number.POSITIVE_INFINITY;

    for (const [key, group] of groups) {
      if (!isCompatibleDay(photo, group)) continue;
      const gap = getClosestGroupTimeDistance(photo, group);
      if (gap !== null && gap <= maxGapMs && gap < bestGap) {
        bestGap = gap;
        bestGroupKey = key;
      }
    }

    if (bestGroupKey) {
      groups.get(bestGroupKey)?.push(photo);
    } else {
      groups.set(`${dayKey(photo.takenAt)}-${photo.takenAt.getTime()}`, [photo]);
    }
  }

  return groups;
}

function isCompatibleDay(photo: PhotoExifData, group: PhotoExifData[]) {
  if (!photo.takenAt) return true;
  return group.some((member) => !member.takenAt || dayKey(member.takenAt) === dayKey(photo.takenAt));
}

function getClosestGroupDistance(photo: PhotoExifData, group: PhotoExifData[]) {
  return Math.min(
    ...group.map((member) => haversine(member.latitude!, member.longitude!, photo.latitude!, photo.longitude!))
  );
}

function getGroupCenterDistance(photo: PhotoExifData, group: PhotoExifData[]) {
  const { latitude, longitude } = getRepresentativeCoordinates(group);
  return haversine(latitude, longitude, photo.latitude!, photo.longitude!);
}

function getRepresentativeCoordinates(group: PhotoExifData[]) {
  const latitudes = group.map((member) => member.latitude).filter((value): value is number => value !== null).sort((a, b) => a - b);
  const longitudes = group.map((member) => member.longitude).filter((value): value is number => value !== null).sort((a, b) => a - b);
  const midpoint = Math.floor(latitudes.length / 2);
  return { latitude: latitudes[midpoint], longitude: longitudes[midpoint] };
}

function getClosestGroupTimeDistance(photo: PhotoExifData, group: PhotoExifData[]): number | null {
  if (!photo.takenAt) return null;

  const distances = group
    .map((member) => (member.takenAt ? Math.abs(member.takenAt.getTime() - photo.takenAt.getTime()) : null))
    .filter((value): value is number => value !== null);

  return distances.length > 0 ? Math.min(...distances) : null;
}

function dayKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function haversine(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371000;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

import { ensureGoogleMapsLoaded, getGoogle, GOOGLE_MAPS_API_KEY } from "@/hooks/useGooglePlacesSearch";

let _placesServiceHost: HTMLDivElement | null = null;

function getPlacesService(): any | null {
  const g = getGoogle();
  if (!g?.maps?.places) return null;
  if (!_placesServiceHost) {
    _placesServiceHost = document.createElement("div");
  }
  return new g.maps.places.PlacesService(_placesServiceHost);
}

async function reverseGeocodeWithJsApi(lat: number, lng: number): Promise<{ name: string; country: string } | null> {
  try {
    await ensureGoogleMapsLoaded();
    const g = getGoogle();
    if (!g?.maps) return null;

    const location = new g.maps.LatLng(lat, lng);

    // Use Geocoder for country + locality
    const geocoder = new g.maps.Geocoder();
    const geoResult = await new Promise<any>((resolve) => {
      geocoder.geocode({ location }, (results: any[], status: string) => {
        resolve(status === "OK" && results?.length > 0 ? results : null);
      });
    });

    let country = "Unknown";
    let locality = "Unknown";

    if (geoResult) {
      for (const result of geoResult) {
        const comps: any[] = result.address_components || [];
        if (country === "Unknown") {
          const countryComp = comps.find((c: any) => c.types.includes("country"));
          if (countryComp) country = countryComp.long_name;
        }
        if (locality === "Unknown") {
          const loc = comps.find((c: any) =>
            c.types.includes("locality") || c.types.includes("sublocality") || c.types.includes("postal_town")
          );
          if (loc) locality = loc.long_name;
        }
        if (country !== "Unknown" && locality !== "Unknown") break;
      }
    }

    // Use PlacesService.nearbySearch for POI name
    const placesService = getPlacesService();
    if (placesService) {
      const poiName = await new Promise<string | null>((resolve) => {
        placesService.nearbySearch(
          { location, rankBy: g.maps.places.RankBy.DISTANCE, type: "point_of_interest" },
          (results: any[], status: string) => {
            if (status !== "OK" || !results?.length) {
              resolve(null);
              return;
            }

            const POI_TYPES = new Set([
              "tourist_attraction", "stadium", "museum", "park", "church",
              "airport", "train_station", "transit_station", "amusement_park",
              "zoo", "aquarium", "art_gallery", "campground", "university",
              "lodging", "restaurant", "bar", "cafe", "shopping_mall",
              "natural_feature", "point_of_interest", "establishment",
            ]);

            const poi = results.find((r: any) =>
              r.types?.some((t: string) => POI_TYPES.has(t))
            ) || results[0];

            resolve(poi?.name || null);
          },
        );
      });

      if (poiName) {
        console.log(`[reverse-geo] JS Places API found: "${poiName}" (${country}) at ${lat},${lng}`);
        return { name: poiName, country };
      }
    }

    // Fall back to geocoder locality
    if (locality !== "Unknown") {
      console.log(`[reverse-geo] Geocoder locality: "${locality}" (${country}) at ${lat},${lng}`);
      return { name: locality, country };
    }

    if (geoResult?.[0]?.formatted_address) {
      const name = geoResult[0].formatted_address.split(",")[0];
      return { name, country };
    }

    return null;
  } catch (e) {
    console.warn("[reverse-geo] JS API error:", e);
    return null;
  }
}

export async function reverseGeocode(lat: number, lng: number): Promise<{ name: string; country: string }> {
  // Primary: Google Maps JavaScript API (no CORS issues)
  const jsResult = await reverseGeocodeWithJsApi(lat, lng);
  if (jsResult) return jsResult;

  // Fallback: Nominatim
  try {
    const res = await fetch(
      `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}&zoom=10&addressdetails=1`
    );
    const data = await res.json();
    const addr = data.address || {};
    const name = addr.city || addr.town || addr.village || addr.county || data.name || "Unknown";
    const country = addr.country || "Unknown";
    return { name, country };
  } catch {
    return { name: "Unknown", country: "Unknown" };
  }
}

export async function geocodeLocationName(
  locationName: string,
  country?: string
): Promise<{ latitude: number; longitude: number } | null> {
  const query = [locationName, country].filter(Boolean).join(", ");
  if (!query) return null;

  try {
    const gRes = await fetch(
      `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(query)}&key=${GOOGLE_MAPS_API_KEY}`
    );
    const gData = await gRes.json();
    const location = gData.results?.[0]?.geometry?.location;

    if (typeof location?.lat === "number" && typeof location?.lng === "number") {
      return { latitude: location.lat, longitude: location.lng };
    }
  } catch {
    // Fall through to Nominatim
  }

  try {
    const res = await fetch(
      `https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&q=${encodeURIComponent(query)}`
    );
    const data = await res.json();
    const match = Array.isArray(data) ? data[0] : null;
    const latitude = Number(match?.lat);
    const longitude = Number(match?.lon);

    if (Number.isFinite(latitude) && Number.isFinite(longitude)) {
      return { latitude, longitude };
    }
  } catch {
    return null;
  }

  return null;
}
