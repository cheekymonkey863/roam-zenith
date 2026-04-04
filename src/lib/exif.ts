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

const QUICKTIME_LOCATION_KEY = "com.apple.quicktime.location.ISO6709";
const QUICKTIME_CREATIONDATE_KEY = "com.apple.quicktime.creationdate";
const QUICKTIME_SCAN_CHUNK_SIZE = 1024 * 1024;
const QUICKTIME_SCAN_OVERLAP = 4096;
const EXIF_EXTRACTION_CONCURRENCY = 4;

interface QuickTimeTextMetadata {
  latitude: number | null;
  longitude: number | null;
  altitude: number | null;
  creationDate: Date | null;
}

function isHeicLikeFile(file: File) {
  const lowerFileName = file.name.toLowerCase();
  return HEIC_EXTENSIONS.some((extension) => lowerFileName.endsWith(extension)) || HEIC_MIME_TYPES.has(file.type.toLowerCase());
}

function withExtension(fileName: string, extension: string) {
  return `${fileName.replace(/\.[^.]+$/, "")}${extension}`;
}

function isMovLikeVideo(file: File) {
  const lowerFileName = file.name.toLowerCase();
  return file.type === "video/quicktime" || lowerFileName.endsWith(".mov");
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

function parseISO6709Text(text: string): { latitude: number; longitude: number; altitude?: number } | null {
  const match = text.match(/([+-]\d{1,2}(?:\.\d+)?)([+-]\d{1,3}(?:\.\d+)?)(?:([+-]\d+(?:\.\d+)?))?\/?/);
  if (!match) return null;

  const latitude = Number.parseFloat(match[1]);
  const longitude = Number.parseFloat(match[2]);
  const altitude = match[3] ? Number.parseFloat(match[3]) : undefined;

  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
  if (Math.abs(latitude) > 90 || Math.abs(longitude) > 180) return null;
  if (latitude === 0 && longitude === 0) return null;

  return { latitude, longitude, altitude };
}

function createEmptyQuickTimeTextMetadata(): QuickTimeTextMetadata {
  return {
    latitude: null,
    longitude: null,
    altitude: null,
    creationDate: null,
  };
}

function mergeQuickTimeTextMetadata(target: QuickTimeTextMetadata, source: QuickTimeTextMetadata): QuickTimeTextMetadata {
  if (target.latitude === null && source.latitude !== null) target.latitude = source.latitude;
  if (target.longitude === null && source.longitude !== null) target.longitude = source.longitude;
  if (target.altitude === null && source.altitude !== null) target.altitude = source.altitude;
  if (target.creationDate === null && source.creationDate !== null) target.creationDate = source.creationDate;
  return target;
}

async function mapWithConcurrencyLimit<TInput, TOutput>(
  items: TInput[],
  concurrency: number,
  mapper: (item: TInput, index: number) => Promise<TOutput>,
): Promise<TOutput[]> {
  if (items.length === 0) return [];

  const results = new Array<TOutput>(items.length);
  let nextIndex = 0;

  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length) }, async () => {
      while (true) {
        const currentIndex = nextIndex;
        nextIndex += 1;

        if (currentIndex >= items.length) {
          return;
        }

        results[currentIndex] = await mapper(items[currentIndex], currentIndex);
      }
    }),
  );

  return results;
}

function extractQuickTimeTextMetadataFromChunk(text: string): QuickTimeTextMetadata {
  const metadata = createEmptyQuickTimeTextMetadata();

  const locationKeyIndex = text.indexOf(QUICKTIME_LOCATION_KEY);
  if (locationKeyIndex >= 0) {
    const gpsSearchText = text.slice(
      Math.max(0, locationKeyIndex - 128),
      Math.min(text.length, locationKeyIndex + 1024),
    );
    const gps = parseISO6709Text(gpsSearchText);
    if (gps) {
      metadata.latitude = gps.latitude;
      metadata.longitude = gps.longitude;
      metadata.altitude = gps.altitude ?? null;
    }
  }

  const creationKeyIndex = text.indexOf(QUICKTIME_CREATIONDATE_KEY);
  if (creationKeyIndex >= 0) {
    const dateSearchText = text.slice(
      Math.max(0, creationKeyIndex - 64),
      Math.min(text.length, creationKeyIndex + 1024),
    );
    const creationDateMatch = dateSearchText.match(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{4}|[+-]\d{2}:?\d{2})/);
    if (creationDateMatch) {
      metadata.creationDate = normalizeDate(creationDateMatch[0]);
    }
  }

  return metadata;
}

async function scanVideoFileForQuickTimeTextMetadata(file: File): Promise<QuickTimeTextMetadata> {
  const metadata = createEmptyQuickTimeTextMetadata();
  const decoder = new TextDecoder("utf-8", { fatal: false });
  let carry = new Uint8Array(0);

  for (let offset = 0; offset < file.size; offset += QUICKTIME_SCAN_CHUNK_SIZE) {
    const buffer = await file.slice(offset, Math.min(file.size, offset + QUICKTIME_SCAN_CHUNK_SIZE)).arrayBuffer();
    const chunk = new Uint8Array(buffer);
    const combined = new Uint8Array(carry.length + chunk.length);
    combined.set(carry);
    combined.set(chunk, carry.length);

    const text = decoder.decode(combined);
    mergeQuickTimeTextMetadata(metadata, extractQuickTimeTextMetadataFromChunk(text));

    if (metadata.latitude !== null && metadata.longitude !== null && metadata.creationDate) {
      break;
    }

    carry = combined.slice(Math.max(0, combined.length - QUICKTIME_SCAN_OVERLAP));
  }

  return metadata;
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

async function extractQuickTimeTextMetadata(file: File): Promise<QuickTimeTextMetadata> {
  const metadata = createEmptyQuickTimeTextMetadata();
  const decoder = new TextDecoder("utf-8", { fatal: false });

  const chunks = await readVideoChunks(file);
  for (const buffer of chunks) {
    const text = decoder.decode(new Uint8Array(buffer));
    mergeQuickTimeTextMetadata(metadata, extractQuickTimeTextMetadataFromChunk(text));
  }

  if (metadata.latitude !== null && metadata.longitude !== null && metadata.creationDate) {
    return metadata;
  }

  return scanVideoFileForQuickTimeTextMetadata(file);
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
  const isMovVideo = isVideo && isMovLikeVideo(file);

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
  let latitude = isMovVideo ? null : embeddedCoordinates.latitude;
  let longitude = isMovVideo ? null : embeddedCoordinates.longitude;
  if (!isMovVideo && latitude !== null && longitude !== null) {
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

  // For videos: MOV GPS is only trusted from keyed QuickTime metadata or server-side parsing.
  if (isVideo) {
    const applyServerVideoMetadata = (
      serverMeta: NonNullable<Awaited<ReturnType<typeof extractVideoMetadataServerSide>>>,
    ) => {
      if ((latitude === null || longitude === null) && serverMeta.latitude !== null && serverMeta.longitude !== null) {
        latitude = serverMeta.latitude;
        longitude = serverMeta.longitude;
        metadataSources.add("video_server_gps");
      }

      if (!takenAt && serverMeta.creationDate) {
        const date = new Date(serverMeta.creationDate);
        if (!Number.isNaN(date.getTime())) {
          takenAt = date;
          metadataSources.add("video_server_time");
        }
      }

      if (duration === null && typeof serverMeta.duration === "number") {
        duration = serverMeta.duration;
      }
      if (!cameraMake && serverMeta.cameraMake) {
        cameraMake = serverMeta.cameraMake;
      }
      if (!cameraModel && serverMeta.cameraModel) {
        cameraModel = serverMeta.cameraModel;
      }
    };

    if (isMovVideo) {
      const quickTimeTextMetadata = await extractQuickTimeTextMetadata(file);

      if (quickTimeTextMetadata.latitude !== null && quickTimeTextMetadata.longitude !== null) {
        latitude = quickTimeTextMetadata.latitude;
        longitude = quickTimeTextMetadata.longitude;
        metadataSources.add("video_quicktime_text_gps");
      }

      if (quickTimeTextMetadata.creationDate) {
        takenAt = quickTimeTextMetadata.creationDate;
        metadataSources.add("video_quicktime_text_time");
      }

      if (latitude === null || longitude === null || !takenAt) {
        const serverMeta = await extractVideoMetadataServerSide(file);
        if (serverMeta) {
          applyServerVideoMetadata(serverMeta);
        }
      }

    } else {
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

      if (latitude === null || longitude === null || !takenAt) {
        const serverMeta = await extractVideoMetadataServerSide(file);
        if (serverMeta) {
          applyServerVideoMetadata(serverMeta);
        }
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
  return mapWithConcurrencyLimit(files, EXIF_EXTRACTION_CONCURRENCY, (file) => extractExifFromFile(file));
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

export interface ReverseGeocodeResult {
  name: string;
  country: string;
  locality: string;
  placeTypes: string[];
}

const GOOGLE_JS_CALLBACK_TIMEOUT_MS = 5000;
const GEOCODE_FETCH_TIMEOUT_MS = 5000;
const EXACT_PLACE_DISTANCE_METERS = 5;
const EXACT_PLACE_NEARBY_RADIUS_METERS = 50;

function getDistanceMeters(lat1: number, lng1: number, lat2: number, lng2: number) {
  const dLat = (lat2 - lat1) * 111320;
  const dLng = (lng2 - lng1) * 111320 * Math.cos((lat1 * Math.PI) / 180);
  return Math.sqrt(dLat * dLat + dLng * dLng);
}

function normalizePlaceType(value: string) {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
}

function pickExactAddressLabel(address: Record<string, unknown>, fallback: string | null = null) {
  const candidates = [
    address.amenity,
    address.attraction,
    address.tourism,
    address.leisure,
    address.shop,
    address.building,
    address.hotel,
    address.house_name,
    address.road,
    address.pedestrian,
    address.footway,
    address.path,
  ];

  for (const candidate of candidates) {
    if (typeof candidate === "string" && candidate.trim().length > 0) {
      return candidate.trim();
    }
  }

  return fallback;
}

function getGoogleResultDistanceMeters(lat: number, lng: number, result: any) {
  if (!result?.geometry?.location) {
    return Number.POSITIVE_INFINITY;
  }

  const resultLat = typeof result.geometry.location.lat === "function" ? result.geometry.location.lat() : result.geometry.location.lat;
  const resultLng = typeof result.geometry.location.lng === "function" ? result.geometry.location.lng() : result.geometry.location.lng;

  if (typeof resultLat !== "number" || typeof resultLng !== "number") {
    return Number.POSITIVE_INFINITY;
  }

  return getDistanceMeters(lat, lng, resultLat, resultLng);
}

function getGoogleResultTypes(result: any) {
  const resultTypes = Array.isArray(result?.types) ? result.types : [];
  const componentTypes = Array.isArray(result?.address_components)
    ? result.address_components.flatMap((component: any) => (Array.isArray(component?.types) ? component.types : []))
    : [];

  return Array.from(
    new Set(
      [...resultTypes, ...componentTypes]
        .filter((value): value is string => typeof value === "string" && value.trim().length > 0)
        .map(normalizePlaceType),
    ),
  );
}

function getGoogleResultLabel(result: any) {
  const components: any[] = Array.isArray(result?.address_components) ? result.address_components : [];
  const preferredComponent = components.find((component) =>
    component?.types?.some((type: string) =>
      [
        "point_of_interest",
        "premise",
        "subpremise",
        "establishment",
        "stadium",
        "tourist_attraction",
        "lodging",
        "restaurant",
        "bar",
        "night_club",
        "museum",
        "airport",
        "train_station",
        "bus_station",
        "subway_station",
        "transit_station",
      ].includes(type),
    ),
  );

  if (typeof preferredComponent?.long_name === "string" && preferredComponent.long_name.trim().length > 0) {
    return preferredComponent.long_name.trim();
  }

  if (typeof result?.formatted_address === "string" && result.formatted_address.trim().length > 0) {
    return result.formatted_address.split(",")[0].trim();
  }

  return null;
}

function isGenericGoogleLabel(label: string, locality: string, country: string) {
  const normalizedLabel = label.trim().toLowerCase();
  return !normalizedLabel || normalizedLabel === locality.trim().toLowerCase() || normalizedLabel === country.trim().toLowerCase();
}

function pickExactGoogleGeocodeMatch(
  results: any[] | null,
  lat: number,
  lng: number,
  locality: string,
  country: string,
): ReverseGeocodeResult | null {
  if (!results?.length) return null;

  const SPECIFIC_TYPES = new Set([
    "point_of_interest",
    "premise",
    "subpremise",
    "establishment",
    "stadium",
    "tourist_attraction",
    "lodging",
    "restaurant",
    "bar",
    "night_club",
    "museum",
    "airport",
    "train_station",
    "bus_station",
    "subway_station",
    "transit_station",
    "street_address",
    "route",
  ]);

  const exactMatches = results
    .map((result) => {
      const label = getGoogleResultLabel(result);
      const placeTypes = getGoogleResultTypes(result);
      const exactDistance = getGoogleResultDistanceMeters(lat, lng, result);
      const specificityScore = placeTypes.reduce((score, type) => {
        return score + (SPECIFIC_TYPES.has(type) ? 2 : 0) + (["point_of_interest", "premise", "subpremise"].includes(type) ? 3 : 0);
      }, 0);

      return { label, placeTypes, exactDistance, specificityScore };
    })
    .filter(
      (
        result,
      ): result is { label: string; placeTypes: string[]; exactDistance: number; specificityScore: number } =>
        typeof result.label === "string" &&
        result.exactDistance <= EXACT_PLACE_DISTANCE_METERS &&
        !isGenericGoogleLabel(result.label, locality, country),
    )
    .sort((a, b) => b.specificityScore - a.specificityScore || a.exactDistance - b.exactDistance);

  if (!exactMatches.length) return null;

  return {
    name: exactMatches[0].label,
    country,
    locality,
    placeTypes: exactMatches[0].placeTypes,
  };
}

function withCallbackTimeout<T>(
  run: (finish: (value: T) => void) => void,
  fallback: T,
  label: string,
  timeoutMs = GOOGLE_JS_CALLBACK_TIMEOUT_MS,
): Promise<T> {
  return new Promise((resolve) => {
    let settled = false;

    const finish = (value: T) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timer);
      resolve(value);
    };

    const timer = window.setTimeout(() => {
      console.warn(`${label} timed out after ${timeoutMs}ms`);
      finish(fallback);
    }, timeoutMs);

    try {
      run(finish);
    } catch (error) {
      console.warn(`${label} failed`, error);
      finish(fallback);
    }
  });
}

async function fetchJsonWithTimeout<T>(url: string, timeoutMs = GEOCODE_FETCH_TIMEOUT_MS): Promise<T | null> {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) return null;
    return (await response.json()) as T;
  } catch {
    return null;
  } finally {
    window.clearTimeout(timer);
  }
}

function getPlacesService(): any | null {
  const g = getGoogle();
  if (!g?.maps?.places) return null;
  if (!_placesServiceHost) {
    _placesServiceHost = document.createElement("div");
  }
  return new g.maps.places.PlacesService(_placesServiceHost);
}

function scoreGooglePlaceTypes(placeTypes: string[]) {
  const TYPE_WEIGHTS: Record<string, number> = {
    stadium: 12,
    live_music_venue: 11,
    concert_hall: 11,
    theatre: 10,
    theater: 10,
    movie_theater: 10,
    night_club: 9,
    tourist_attraction: 8,
    museum: 8,
    lodging: 8,
    restaurant: 8,
    bar: 8,
    airport: 8,
    train_station: 8,
    bus_station: 8,
    subway_station: 8,
    transit_station: 8,
    point_of_interest: 2,
    establishment: 1,
  };

  return placeTypes.reduce((score, type) => score + (TYPE_WEIGHTS[type] ?? 0), 0);
}

async function reverseGeocodeWithJsApi(lat: number, lng: number): Promise<ReverseGeocodeResult | null> {
  try {
    await ensureGoogleMapsLoaded();
    const g = getGoogle();
    if (!g?.maps) return null;

    const location = new g.maps.LatLng(lat, lng);
    const geocoder = new g.maps.Geocoder();
    const geoResult = await withCallbackTimeout<any[] | null>(
      (finish) => {
        geocoder.geocode({ location }, (results: any[], status: string) => {
          if (status !== "OK") {
            if (status && status !== "ZERO_RESULTS") {
              console.warn(`[reverse-geo] Geocoder status ${status} at ${lat},${lng}`);
            }
            finish(null);
            return;
          }

          finish(results?.length > 0 ? results : null);
        });
      },
      null,
      `[reverse-geo] Geocoder at ${lat},${lng}`,
    );

    // If geocoder timed out, retry once with a longer timeout
    if (geoResult === null) {
      const retryResult = await withCallbackTimeout<any[] | null>(
        (finish) => {
          geocoder.geocode({ location }, (results: any[], status: string) => {
            finish(status === "OK" && results?.length > 0 ? results : null);
          });
        },
        null,
        `[reverse-geo] Geocoder retry at ${lat},${lng}`,
        8000,
      );

      if (retryResult) {
        let country = "Unknown";
        let locality = "Unknown";
        for (const result of retryResult) {
          const comps: any[] = result.address_components || [];
          if (country === "Unknown") {
            const countryComp = comps.find((c: any) => c.types.includes("country"));
            if (countryComp) country = countryComp.long_name;
          }
          if (locality === "Unknown") {
            const loc = comps.find((c: any) =>
              c.types.includes("locality") || c.types.includes("sublocality") || c.types.includes("postal_town"),
            );
            if (loc) locality = loc.long_name;
          }
          if (country !== "Unknown" && locality !== "Unknown") break;
        }

        const exactRetryMatch = pickExactGoogleGeocodeMatch(retryResult, lat, lng, locality, country);
        if (exactRetryMatch) return exactRetryMatch;

        if (locality !== "Unknown") {
          return { name: locality, country, locality, placeTypes: ["locality"] };
        }

        if (retryResult[0]?.formatted_address) {
          const name = retryResult[0].formatted_address.split(",")[0].trim();
          return { name, country, locality, placeTypes: getGoogleResultTypes(retryResult[0]) };
        }
      }
    }

    let country = "Unknown";
    let locality = "Unknown";

    if (geoResult) {
      for (const result of geoResult) {
        const comps: any[] = result.address_components || [];
        if (country === "Unknown") {
          const countryComp = comps.find((component: any) => component.types.includes("country"));
          if (countryComp) country = countryComp.long_name;
        }
        if (locality === "Unknown") {
          const loc = comps.find((component: any) =>
            component.types.includes("locality") || component.types.includes("sublocality") || component.types.includes("postal_town"),
          );
          if (loc) locality = loc.long_name;
        }
        if (country !== "Unknown" && locality !== "Unknown") break;
      }
    }

    const exactGeocoderMatch = pickExactGoogleGeocodeMatch(geoResult, lat, lng, locality, country);
    if (exactGeocoderMatch) {
      console.log(`[reverse-geo] Exact geocoder match: "${exactGeocoderMatch.name}" (${country}) at ${lat},${lng}`);
      return exactGeocoderMatch;
    }

    const placesService = getPlacesService();
    if (placesService) {
      const poiResult = await withCallbackTimeout<ReverseGeocodeResult | null>(
        (finish) => {
          placesService.nearbySearch(
            { location, radius: EXACT_PLACE_NEARBY_RADIUS_METERS, type: "point_of_interest" },
            (results: any[], status: string) => {
              if (status !== "OK" || !results?.length) {
                if (status && status !== "ZERO_RESULTS") {
                  console.warn(`[reverse-geo] Places status ${status} at ${lat},${lng}`);
                }
                finish(null);
                return;
              }

              const nearby = results
                .map((result: any) => {
                  if (!result.geometry?.location || typeof result.name !== "string" || !result.name.trim()) {
                    return null;
                  }

                  const resultLat = typeof result.geometry.location.lat === "function" ? result.geometry.location.lat() : result.geometry.location.lat;
                  const resultLng = typeof result.geometry.location.lng === "function" ? result.geometry.location.lng() : result.geometry.location.lng;
                  if (typeof resultLat !== "number" || typeof resultLng !== "number") {
                    return null;
                  }

                  const placeTypes = Array.isArray(result.types)
                    ? result.types.filter((value: unknown): value is string => typeof value === "string").map(normalizePlaceType)
                    : [];

                  return {
                    name: result.name.trim(),
                    placeTypes,
                    exactDistance: getDistanceMeters(lat, lng, resultLat, resultLng),
                  };
                })
                .filter(
                  (result): result is { name: string; placeTypes: string[]; exactDistance: number } =>
                    result !== null && result.exactDistance <= EXACT_PLACE_DISTANCE_METERS,
                )
                .sort((a, b) => scoreGooglePlaceTypes(b.placeTypes) - scoreGooglePlaceTypes(a.placeTypes) || a.exactDistance - b.exactDistance);

              if (!nearby.length) {
                finish(null);
                return;
              }

              finish({
                name: nearby[0].name,
                country,
                locality,
                placeTypes: nearby[0].placeTypes,
              });
            },
          );
        },
        null,
        `[reverse-geo] Places lookup at ${lat},${lng}`,
      );

      if (poiResult) {
        console.log(`[reverse-geo] JS Places API found: "${poiResult.name}" (${country}) at ${lat},${lng}`);
        return poiResult;
      }
    }

    if (locality !== "Unknown") {
      console.log(`[reverse-geo] Geocoder locality: "${locality}" (${country}) at ${lat},${lng}`);
      return { name: locality, country, locality, placeTypes: ["locality"] };
    }

    if (geoResult?.[0]?.formatted_address) {
      const name = geoResult[0].formatted_address.split(",")[0].trim();
      return { name, country, locality, placeTypes: getGoogleResultTypes(geoResult[0]) };
    }

    return null;
  } catch (e) {
    console.warn("[reverse-geo] JS API error:", e);
    return null;
  }
}

export async function reverseGeocode(lat: number, lng: number): Promise<ReverseGeocodeResult> {
  const jsResult = await reverseGeocodeWithJsApi(lat, lng);
  if (jsResult) return jsResult;

  try {
    const data = await fetchJsonWithTimeout<any>(
      `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${lat}&lon=${lng}&zoom=18&addressdetails=1&extratags=1&namedetails=1`,
    );
    if (!data) {
      return { name: "Unknown", country: "Unknown", locality: "Unknown", placeTypes: [] };
    }

    const addr = data.address || {};
    const country = addr.country || "Unknown";
    const nomLocality = addr.city || addr.town || addr.village || addr.hamlet || "Unknown";
    const reverseLat = Number(data.lat);
    const reverseLng = Number(data.lon);
    const exactDistance = Number.isFinite(reverseLat) && Number.isFinite(reverseLng)
      ? getDistanceMeters(lat, lng, reverseLat, reverseLng)
      : Number.POSITIVE_INFINITY;

    const placeTypes = Array.from(
      new Set(
        [
          data.category,
          data.type,
          addr.amenity,
          addr.attraction,
          addr.tourism,
          addr.leisure,
          addr.shop,
          addr.building,
          addr.hotel,
        ]
          .filter((value): value is string => typeof value === "string" && value.trim().length > 0)
          .map(normalizePlaceType),
      ),
    );

    const exactName = pickExactAddressLabel(addr, typeof data.name === "string" ? data.name.trim() : null);

    if (exactName && exactDistance <= EXACT_PLACE_DISTANCE_METERS) {
      return { name: exactName, country, locality: nomLocality, placeTypes };
    }

    return { name: "Unknown", country, locality: nomLocality, placeTypes };
  } catch {
    return { name: "Unknown", country: "Unknown", locality: "Unknown", placeTypes: [] };
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
