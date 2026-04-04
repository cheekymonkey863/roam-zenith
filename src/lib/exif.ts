import exifr from "exifr";

export interface PhotoExifData {
  file: File;
  latitude: number | null;
  longitude: number | null;
  takenAt: Date | null;
  thumbnail?: string;
  analysisImage?: string;
  cameraMake?: string;
  cameraModel?: string;
  exifRaw?: Record<string, unknown>;
}

export async function extractExifFromFile(file: File): Promise<PhotoExifData> {
  const isVideo = file.type.startsWith("video/");

  const [thumbnail, analysisImage] = await Promise.all([
    isVideo ? createVideoThumbnail(file, 120, 0.6) : createImagePreview(file, 120, 0.6),
    isVideo ? createVideoThumbnail(file, 768, 0.76) : createImagePreview(file, 768, 0.76),
  ]);

  // For videos, try to get date from file metadata, but exifr won't work well
  if (isVideo) {
    // Try exifr anyway (works on some MP4s)
    try {
      const exif = await exifr.parse(file, { gps: true });
      if (exif) {
        let latitude: number | null = null;
        let longitude: number | null = null;
        let takenAt: Date | null = null;

        if (typeof exif.latitude === "number" && typeof exif.longitude === "number") {
          latitude = exif.latitude;
          longitude = exif.longitude;
        } else if (typeof exif.GPSLatitude === "number" && typeof exif.GPSLongitude === "number") {
          latitude = exif.GPSLatitude;
          longitude = exif.GPSLongitude;
          if (exif.GPSLatitudeRef === "S" || exif.GPSLatitudeRef === "s") latitude = -Math.abs(latitude);
          if (exif.GPSLongitudeRef === "W" || exif.GPSLongitudeRef === "w") longitude = -Math.abs(longitude);
        }

        if (exif.DateTimeOriginal) takenAt = new Date(exif.DateTimeOriginal);
        else if (exif.CreateDate) takenAt = new Date(exif.CreateDate);

        return { file, latitude, longitude, takenAt, thumbnail, analysisImage, exifRaw: { ...exif } };
      }
    } catch {
      // exifr failed on video, use lastModified as fallback date
    }

    // Fallback: use file's lastModified date
    const takenAt = file.lastModified ? new Date(file.lastModified) : null;
    return { file, latitude: null, longitude: null, takenAt, thumbnail, analysisImage };
  }

  // Image handling (unchanged)
  try {
    const exif = await exifr.parse(file, {
      gps: true,
      pick: [
        "DateTimeOriginal", "CreateDate",
        "GPSLatitude", "GPSLongitude",
        "GPSLatitudeRef", "GPSLongitudeRef",
        "Make", "Model", "LensModel",
        "ExposureTime", "FNumber", "ISO",
        "ImageWidth", "ImageHeight",
        "GPSAltitude",
      ],
    });

    let latitude: number | null = null;
    let longitude: number | null = null;
    let takenAt: Date | null = null;
    let cameraMake: string | undefined;
    let cameraModel: string | undefined;
    let exifRaw: Record<string, unknown> | undefined;

    if (exif) {
      if (typeof exif.latitude === "number" && typeof exif.longitude === "number") {
        latitude = exif.latitude;
        longitude = exif.longitude;
      } else if (typeof exif.GPSLatitude === "number" && typeof exif.GPSLongitude === "number") {
        latitude = exif.GPSLatitude;
        longitude = exif.GPSLongitude;
        if (exif.GPSLatitudeRef === "S" || exif.GPSLatitudeRef === "s") latitude = -Math.abs(latitude);
        if (exif.GPSLongitudeRef === "W" || exif.GPSLongitudeRef === "w") longitude = -Math.abs(longitude);
      }

      if (exif.DateTimeOriginal) takenAt = new Date(exif.DateTimeOriginal);
      else if (exif.CreateDate) takenAt = new Date(exif.CreateDate);

      cameraMake = exif.Make || undefined;
      cameraModel = exif.Model || undefined;
      exifRaw = { ...exif };
    }

    return { file, latitude, longitude, takenAt, thumbnail, analysisImage, cameraMake, cameraModel, exifRaw };
  } catch {
    return { file, latitude: null, longitude: null, takenAt: null, thumbnail, analysisImage };
  }
}

function createVideoThumbnail(file: File, size: number, quality: number): Promise<string> {
  return new Promise((resolve) => {
    const video = document.createElement("video");
    video.preload = "metadata";
    video.muted = true;
    video.playsInline = true;

    const url = URL.createObjectURL(file);
    video.src = url;

    const cleanup = () => URL.revokeObjectURL(url);

    video.onerror = () => { cleanup(); resolve(""); };

    video.onloadeddata = () => {
      // Seek to 1 second or 10% of duration
      video.currentTime = Math.min(1, video.duration * 0.1);
    };

    video.onseeked = () => {
      try {
        const scale = Math.min(size / video.videoWidth, size / video.videoHeight, 1);
        const canvas = document.createElement("canvas");
        canvas.width = Math.max(1, Math.round(video.videoWidth * scale));
        canvas.height = Math.max(1, Math.round(video.videoHeight * scale));

        const ctx = canvas.getContext("2d");
        if (!ctx) { cleanup(); resolve(""); return; }

        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        const dataUrl = canvas.toDataURL("image/jpeg", quality);
        cleanup();
        resolve(dataUrl);
      } catch {
        cleanup();
        resolve("");
      }
    };

    // Timeout fallback
    setTimeout(() => { cleanup(); resolve(""); }, 10000);
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
        if (!ctx) { resolve(""); return; }

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

/**
 * Groups photos by location AND date. Photos within `radiusMeters` AND
 * taken on the same calendar day are grouped together. Photos at the same
 * location but on different days become separate groups.
 */
export function groupPhotosByLocation(photos: PhotoExifData[], radiusMeters = 2000): Map<string, PhotoExifData[]> {
  const geoPhotos = photos.filter((photo) => photo.latitude !== null && photo.longitude !== null);
  const groups = new Map<string, PhotoExifData[]>();

  for (const photo of geoPhotos) {
    let foundGroup = false;
    const photoDay = photo.takenAt ? dayKey(photo.takenAt) : "no-date";

    for (const [key, group] of groups) {
      const ref = group[0];
      const dist = haversine(ref.latitude!, ref.longitude!, photo.latitude!, photo.longitude!);
      const refDay = ref.takenAt ? dayKey(ref.takenAt) : "no-date";

      if (dist < radiusMeters && photoDay === refDay) {
        group.push(photo);
        foundGroup = true;
        break;
      }
    }

    if (!foundGroup) {
      const key = `${photo.latitude!.toFixed(3)},${photo.longitude!.toFixed(3)}-${photoDay}`;
      groups.set(key, [photo]);
    }
  }

  return groups;
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
        c.types.includes("point_of_interest") || c.types.includes("natural_feature") || 
        c.types.includes("park") || c.types.includes("tourist_attraction") || c.types.includes("establishment")
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
