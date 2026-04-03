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
  const [thumbnail, analysisImage] = await Promise.all([
    createImagePreview(file, 120, 0.6),
    createImagePreview(file, 768, 0.76),
  ]);

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
      // exifr with gps:true provides signed lat/lng on the root
      if (typeof exif.latitude === "number" && typeof exif.longitude === "number") {
        latitude = exif.latitude;
        longitude = exif.longitude;
      } else if (typeof exif.GPSLatitude === "number" && typeof exif.GPSLongitude === "number") {
        // Raw GPS values are unsigned — apply ref to get sign
        latitude = exif.GPSLatitude;
        longitude = exif.GPSLongitude;
        if (exif.GPSLatitudeRef === "S" || exif.GPSLatitudeRef === "s") {
          latitude = -Math.abs(latitude);
        }
        if (exif.GPSLongitudeRef === "W" || exif.GPSLongitudeRef === "w") {
          longitude = -Math.abs(longitude);
        }
      }

      if (exif.DateTimeOriginal) {
        takenAt = new Date(exif.DateTimeOriginal);
      } else if (exif.CreateDate) {
        takenAt = new Date(exif.CreateDate);
      }

      cameraMake = exif.Make || undefined;
      cameraModel = exif.Model || undefined;
      exifRaw = { ...exif };
    }

    return { file, latitude, longitude, takenAt, thumbnail, analysisImage, cameraMake, cameraModel, exifRaw };
  } catch {
    return { file, latitude: null, longitude: null, takenAt: null, thumbnail, analysisImage };
  }
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

export function groupPhotosByLocation(photos: PhotoExifData[], radiusMeters = 10000): Map<string, PhotoExifData[]> {
  const geoPhotos = photos.filter((photo) => photo.latitude !== null && photo.longitude !== null);
  const groups = new Map<string, PhotoExifData[]>();

  for (const photo of geoPhotos) {
    let foundGroup = false;

    for (const [, group] of groups) {
      const ref = group[0];
      const dist = haversine(ref.latitude!, ref.longitude!, photo.latitude!, photo.longitude!);
      if (dist < radiusMeters) {
        group.push(photo);
        foundGroup = true;
        break;
      }
    }

    if (!foundGroup) {
      const key = `${photo.latitude!.toFixed(3)},${photo.longitude!.toFixed(3)}`;
      groups.set(key, [photo]);
    }
  }

  return groups;
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

export async function reverseGeocode(lat: number, lng: number): Promise<{ name: string; country: string }> {
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
