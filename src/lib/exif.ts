import exifr from "exifr";

export interface PhotoExifData {
  file: File;
  latitude: number | null;
  longitude: number | null;
  takenAt: Date | null;
  thumbnail?: string;
}

export async function extractExifFromFile(file: File): Promise<PhotoExifData> {
  try {
    const exif = await exifr.parse(file, {
      gps: true,
      pick: ["DateTimeOriginal", "CreateDate", "GPSLatitude", "GPSLongitude"],
    });

    let latitude: number | null = null;
    let longitude: number | null = null;
    let takenAt: Date | null = null;

    if (exif) {
      if (exif.latitude !== undefined && exif.longitude !== undefined) {
        latitude = exif.latitude;
        longitude = exif.longitude;
      }
      if (exif.DateTimeOriginal) {
        takenAt = new Date(exif.DateTimeOriginal);
      } else if (exif.CreateDate) {
        takenAt = new Date(exif.CreateDate);
      }
    }

    // Create thumbnail
    const thumbnail = await createThumbnail(file);

    return { file, latitude, longitude, takenAt, thumbnail };
  } catch {
    const thumbnail = await createThumbnail(file);
    return { file, latitude: null, longitude: null, takenAt: null, thumbnail };
  }
}

function createThumbnail(file: File): Promise<string> {
  return new Promise((resolve) => {
    if (!file.type.startsWith("image/")) {
      resolve("");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement("canvas");
        const size = 120;
        const scale = Math.min(size / img.width, size / img.height);
        canvas.width = img.width * scale;
        canvas.height = img.height * scale;
        const ctx = canvas.getContext("2d")!;
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL("image/jpeg", 0.6));
      };
      img.src = reader.result as string;
    };
    reader.readAsDataURL(file);
  });
}

export async function extractExifFromFiles(files: File[]): Promise<PhotoExifData[]> {
  return Promise.all(files.map(extractExifFromFile));
}

// Group photos by proximity (within ~50km)
export function groupPhotosByLocation(photos: PhotoExifData[]): Map<string, PhotoExifData[]> {
  const geoPhotos = photos.filter((p) => p.latitude !== null && p.longitude !== null);
  const groups = new Map<string, PhotoExifData[]>();

  for (const photo of geoPhotos) {
    let foundGroup = false;
    for (const [key, group] of groups) {
      const ref = group[0];
      const dist = haversine(ref.latitude!, ref.longitude!, photo.latitude!, photo.longitude!);
      if (dist < 50000) {
        group.push(photo);
        foundGroup = true;
        break;
      }
    }
    if (!foundGroup) {
      const key = `${photo.latitude!.toFixed(2)},${photo.longitude!.toFixed(2)}`;
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

// Reverse geocode using free Nominatim API
export async function reverseGeocode(lat: number, lng: number): Promise<{ name: string; country: string }> {
  try {
    const res = await fetch(
      `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}&zoom=10&addressdetails=1`,
      { headers: { "User-Agent": "Wanderlust-App" } }
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
