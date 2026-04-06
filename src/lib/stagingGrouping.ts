import type { LocalStagedFile } from "@/components/PhotoImport";

export interface StagingGroup {
  key: string;
  locationName: string;
  latitude: number | null;
  longitude: number | null;
  files: LocalStagedFile[];
  earliestDate: Date | null;
}

export const UNIFIED_IMPORT_SPLIT_DISTANCE_METERS = 1000;

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

    const anchorCoordinates = getGroupRepresentativeCoordinates(currentGroup);

    if (anchorCoordinates && hasCoordinates(file)) {
      const distance = haversineDistance(
        anchorCoordinates.latitude,
        anchorCoordinates.longitude,
        file.latitude,
        file.longitude,
      );

      if (distance > UNIFIED_IMPORT_SPLIT_DISTANCE_METERS) {
        currentGroup = createGroup(file, groups.length);
        groups.push(currentGroup);
        continue;
      }
    }

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