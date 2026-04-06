import type { LocalStagedFile } from "@/components/PhotoImport";

export interface StagingGroup {
  key: string;
  locationName: string;
  latitude: number | null;
  longitude: number | null;
  files: LocalStagedFile[];
  earliestDate: Date | null;
}

/** GPS groups split beyond 60m; missing-GPS fallback splits beyond 30 minutes */
export const GROUP_SPLIT_DISTANCE_METERS = 60;
export const GROUP_SPLIT_TIME_MS = 30 * 60 * 1000; // 30 minutes

function hasCoordinates(
  file: LocalStagedFile,
): file is LocalStagedFile & { latitude: number; longitude: number } {
  return file.latitude != null && file.longitude != null;
}

export function haversineDistance(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371000;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function getEarliestDate(files: LocalStagedFile[]) {
  const dates = files.map((file) => file.takenAt).filter((value): value is Date => value instanceof Date);
  if (dates.length === 0) return null;
  return new Date(Math.min(...dates.map((date) => date.getTime())));
}

function getLatestDate(files: LocalStagedFile[]) {
  const dates = files.map((file) => file.takenAt).filter((value): value is Date => value instanceof Date);
  if (dates.length === 0) return null;
  return new Date(Math.max(...dates.map((date) => date.getTime())));
}

function createGroup(file: LocalStagedFile, index: number): StagingGroup {
  return {
    key: `group-${index}`,
    locationName: "",
    latitude: file.latitude ?? null,
    longitude: file.longitude ?? null,
    files: [file],
    earliestDate: file.takenAt,
  };
}

export function getGroupRepresentativeCoordinates(
  group: Pick<StagingGroup, "latitude" | "longitude" | "files">,
) {
  if (group.latitude != null && group.longitude != null) {
    return { latitude: group.latitude, longitude: group.longitude };
  }

  const fileWithCoordinates = group.files.find(hasCoordinates);
  if (!fileWithCoordinates) return null;

  return {
    latitude: fileWithCoordinates.latitude,
    longitude: fileWithCoordinates.longitude,
  };
}

function sortFilesByTime(files: LocalStagedFile[]) {
  return [...files].sort((a, b) => {
    const aTime = a.takenAt?.getTime();
    const bTime = b.takenAt?.getTime();

    if (aTime == null && bTime == null) return 0;
    if (aTime == null) return 1;
    if (bTime == null) return -1;
    return aTime - bTime;
  });
}

/**
 * Groups files in strict chronological order using these boundaries:
 * 1. If both the file and current group have GPS, split immediately when distance > 60m.
 * 2. If either side is missing GPS, fall back to time and split when the gap > 30 minutes.
 */
export function groupLocalFiles(files: LocalStagedFile[]): StagingGroup[] {
  if (files.length === 0) return [];

  // 1. Sort chronologically
  const sorted = [...files].sort((a, b) => {
    const timeA = a.takenAt ? a.takenAt.getTime() : 0;
    const timeB = b.takenAt ? b.takenAt.getTime() : 0;
    return timeA - timeB;
  });

  const groups: StagingGroup[] = [];

  for (const file of sorted) {
    if (groups.length === 0) {
      groups.push({
        key: `group-0`,
        files: [file],
        latitude: file.latitude ?? null,
        longitude: file.longitude ?? null,
        earliestDate: file.takenAt,
        locationName: "",
      });
      continue;
    }

    const currentGroup = groups[groups.length - 1];
    const lastFile = currentGroup.files[currentGroup.files.length - 1];
    let shouldSplit = false;

    // 2. Strict 60m Distance Check (if BOTH have GPS)
    if (file.latitude && file.longitude && lastFile.latitude && lastFile.longitude) {
      const distance = haversineDistance(
        lastFile.latitude, lastFile.longitude,
        file.latitude, file.longitude,
      );
      if (distance > GROUP_SPLIT_DISTANCE_METERS) shouldSplit = true;
    } else {
      // 3. Fallback Time Check (if GPS is missing)
      const timeA = file.takenAt ? file.takenAt.getTime() : 0;
      const timeB = lastFile.takenAt ? lastFile.takenAt.getTime() : 0;
      if (Math.abs(timeA - timeB) > GROUP_SPLIT_TIME_MS) {
        shouldSplit = true;
      }
    }

    if (shouldSplit) {
      groups.push({
        key: `group-${groups.length}`,
        files: [file],
        latitude: file.latitude ?? null,
        longitude: file.longitude ?? null,
        earliestDate: file.takenAt,
        locationName: "",
      });
    } else {
      currentGroup.files.push(file);
    }
  }

  return groups;
}
