import exifr from "exifr";
import heic2any from "heic2any";

export interface PhotoExifData {
  file: File;
  uploadFile?: File;
  latitude: number | null;
  longitude: number | null;
  takenAt: Date | null;
  thumbnail?: string;
  analysisImage?: string;
  cameraMake?: string;
  cameraModel?: string;
  exifRaw?: Record<string, unknown>;
}

const EXIF_FIELDS = [
  "DateTimeOriginal",
  "CreateDate",
  "GPSLatitude",
  "GPSLongitude",
  "GPSLatitudeRef",
  "GPSLongitudeRef",
  "Make",
  "Model",
  "LensModel",
  "ExposureTime",
  "FNumber",
  "ISO",
  "ImageWidth",
  "ImageHeight",
  "GPSAltitude",
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
  const date = value instanceof Date ? value : new Date(value as string | number);
  return Number.isNaN(date.getTime()) ? null : date;
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

function extractTakenAtFromExif(exif: any, fallbackTimestamp?: number): Date | null {
  const fromExif = normalizeDate(exif?.DateTimeOriginal) ?? normalizeDate(exif?.CreateDate);
  if (fromExif) return fromExif;
  return typeof fallbackTimestamp === "number" && fallbackTimestamp > 0 ? normalizeDate(fallbackTimestamp) : null;
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
      pick: [...EXIF_FIELDS],
    });
  } catch {
    return null;
  }
}

export async function extractExifFromFile(file: File): Promise<PhotoExifData> {
  const isVideo = file.type.startsWith("video/");

  const [uploadFile, exif] = await Promise.all([
    isVideo ? Promise.resolve(file) : normalizeImageFileForBrowser(file),
    parseMediaExif(file),
  ]);

  const [thumbnail, analysisImage] = await Promise.all([
    isVideo ? createVideoThumbnail(file, 120, 0.6) : createImagePreview(uploadFile, 120, 0.6),
    isVideo ? createVideoThumbnail(file, 768, 0.76) : createImagePreview(uploadFile, 768, 0.76),
  ]);

  const { latitude, longitude } = extractCoordinatesFromExif(exif);
  const takenAt = extractTakenAtFromExif(exif, file.lastModified);

  return {
    file,
    uploadFile,
    latitude,
    longitude,
    takenAt,
    thumbnail,
    analysisImage,
    cameraMake: typeof exif?.Make === "string" ? exif.Make : undefined,
    cameraModel: typeof exif?.Model === "string" ? exif.Model : undefined,
    exifRaw: exif ? { ...exif } : undefined,
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
        finish(canvas.toDataURL("image/jpeg", quality));
      } catch {
        finish("");
      }
    };

    video.preload = "metadata";
    video.muted = true;
    video.playsInline = true;
    video.src = url;
    video.onerror = () => finish("");
    video.onloadedmetadata = () => {
      if (!Number.isFinite(video.duration) || video.duration <= 0.1) {
        captureFrame();
        return;
      }

      const targetTime = Math.min(Math.max(video.duration * 0.1, 0.1), video.duration - 0.05);
      video.currentTime = targetTime;
    };
    video.onloadeddata = () => {
      if (video.currentTime === 0) captureFrame();
    };
    video.onseeked = captureFrame;

    const timeoutId = window.setTimeout(() => finish(""), 10000);
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

const EXTENDED_TIME_WINDOW_MS = 12 * 60 * 60 * 1000;
const SHORT_WINDOW_MS = 3 * 60 * 60 * 1000;
const RELAXED_DISTANCE_MULTIPLIER = 3;

export function groupPhotosByLocation(photos: PhotoExifData[], radiusMeters = 2000): Map<string, PhotoExifData[]> {
  const geoPhotos = photos
    .filter((photo) => photo.latitude !== null && photo.longitude !== null)
    .sort((a, b) => (a.takenAt?.getTime() ?? a.file.lastModified ?? 0) - (b.takenAt?.getTime() ?? b.file.lastModified ?? 0));

  const groups = new Map<string, PhotoExifData[]>();

  for (const photo of geoPhotos) {
    let bestGroupKey: string | null = null;
    let bestScore = Number.POSITIVE_INFINITY;

    for (const [key, group] of groups) {
      const closestDistance = getClosestGroupDistance(photo, group);
      const centerDistance = getGroupCenterDistance(photo, group);
      const closestTimeDistance = getClosestGroupTimeDistance(photo, group);
      const sharesDay = isCompatibleDay(photo, group);
      const withinTimeWindow = closestTimeDistance === null || closestTimeDistance <= EXTENDED_TIME_WINDOW_MS;
      const closestLocationDistance = Math.min(closestDistance, centerDistance);
      const strictLocationMatch = closestLocationDistance <= radiusMeters;
      const relaxedLocationMatch =
        closestTimeDistance !== null &&
        closestTimeDistance <= SHORT_WINDOW_MS &&
        closestLocationDistance <= radiusMeters * RELAXED_DISTANCE_MULTIPLIER;

      if (sharesDay && withinTimeWindow && (strictLocationMatch || relaxedLocationMatch)) {
        const score = closestLocationDistance + (closestTimeDistance ?? 0) / 1000;
        if (score < bestScore) {
          bestScore = score;
          bestGroupKey = key;
        }
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

const GOOGLE_MAPS_API_KEY = "AIzaSyCHXGKSMbpkEN5Amr0VRDF44cLcOg_JUD8";

export async function reverseGeocode(lat: number, lng: number): Promise<{ name: string; country: string }> {
  try {
    const gRes = await fetch(
      `https://maps.googleapis.com/maps/api/geocode/json?latlng=${lat},${lng}&key=${GOOGLE_MAPS_API_KEY}&result_type=point_of_interest|natural_feature|park|tourist_attraction|establishment`
    );
    const gData = await gRes.json();

    if (gData.status === "OK" && gData.results?.length > 0) {
      const result = gData.results[0];
      const comps: any[] = result.address_components || [];
      const poiName = comps.find((c: any) =>
        c.types.includes("point_of_interest") ||
        c.types.includes("natural_feature") ||
        c.types.includes("park") ||
        c.types.includes("tourist_attraction") ||
        c.types.includes("establishment")
      )?.long_name;
      const country = comps.find((c: any) => c.types.includes("country"))?.long_name || "Unknown";
      const name = poiName || result.formatted_address?.split(",")[0] || "Unknown";
      return { name, country };
    }

    const fallbackRes = await fetch(
      `https://maps.googleapis.com/maps/api/geocode/json?latlng=${lat},${lng}&key=${GOOGLE_MAPS_API_KEY}`
    );
    const fallbackData = await fallbackRes.json();

    if (fallbackData.status === "OK" && fallbackData.results?.length > 0) {
      const result = fallbackData.results[0];
      const comps: any[] = result.address_components || [];
      const country = comps.find((c: any) => c.types.includes("country"))?.long_name || "Unknown";
      const locality = comps.find((c: any) => c.types.includes("locality"))?.long_name;
      const sublocality = comps.find((c: any) => c.types.includes("sublocality"))?.long_name;
      const name = result.formatted_address?.split(",")[0] || locality || sublocality || "Unknown";
      return { name, country };
    }
  } catch {
    // Fall through to Nominatim
  }

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
