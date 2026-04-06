import type { LocalStagedFile } from "@/components/PhotoImport";

export interface StagingGroup {
  key: string;
  locationName: string;
  latitude: number | null;
  longitude: number | null;
  files: LocalStagedFile[];
  earliestDate: Date | null;
}

/** Only split when BOTH distance > 60m AND time gap > 2 hours */
export const GROUP_SPLIT_DISTANCE_METERS = 60;
export const GROUP_SPLIT_TIME_MS = 2 * 60 * 60 * 1000; // 2 hours

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
 * Groups files using a dual-threshold approach:
 * A new group is created ONLY when BOTH conditions are met:
 * 1. GPS distance from group anchor > 60m
 * 2. Time gap from the latest file in the group > 2 hours
 * 
 * If either condition is NOT met, the file stays in the current group.
 */
export function groupLocalFiles(files: LocalStagedFile[]): StagingGroup[] {
  const sortedFiles = sortFilesByTime(files);
  if (sortedFiles.length === 0) return [];

  const groups: StagingGroup[] = [];
  let currentGroup: StagingGroup | null = null;

  for (const file of sortedFiles) {
    if (!currentGroup) {
      currentGroup = createGroup(file, groups.length);
      groups.push(currentGroup);
      continue;
    }

    // Check distance condition
    const anchorCoordinates = getGroupRepresentativeCoordinates(currentGroup);
    let distanceExceeded = false;
    if (anchorCoordinates && hasCoordinates(file)) {
      const distance = haversineDistance(
        anchorCoordinates.latitude,
        anchorCoordinates.longitude,
        file.latitude,
        file.longitude,
      );
      distanceExceeded = distance > GROUP_SPLIT_DISTANCE_METERS;
    }

    // Check time condition
    let timeExceeded = false;
    const latestInGroup = getLatestDate(currentGroup.files);
    if (latestInGroup && file.takenAt) {
      const gap = file.takenAt.getTime() - latestInGroup.getTime();
      timeExceeded = gap > GROUP_SPLIT_TIME_MS;
    }

    // Only split when BOTH thresholds are exceeded
    if (distanceExceeded && timeExceeded) {
      currentGroup = createGroup(file, groups.length);
      groups.push(currentGroup);
      continue;
    }

    // Otherwise keep in current group
    currentGroup.files.push(file);

    if (!anchorCoordinates && hasCoordinates(file)) {
      currentGroup.latitude = file.latitude;
      currentGroup.longitude = file.longitude;
    }

    const fileTime = file.takenAt?.getTime();
    const earliestTime = currentGroup.earliestDate?.getTime();
    if (fileTime != null && (earliestTime == null || fileTime < earliestTime)) {
      currentGroup.earliestDate = file.takenAt;
    }
  }

  return groups.map((group, index) => {
    const representativeCoordinates = getGroupRepresentativeCoordinates(group);

    return {
      ...group,
      key: `group-${index}`,
      latitude: representativeCoordinates?.latitude ?? null,
      longitude: representativeCoordinates?.longitude ?? null,
      earliestDate: getEarliestDate(group.files),
    };
  });
}
