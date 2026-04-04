import { supabase } from "@/integrations/supabase/client";
import { dedupeTags } from "@/lib/mediaMetadata";
import {
  extractExifFromFiles,
  geocodeLocationName,
  groupMediaByTime,
  groupPhotosByLocation,
  reverseGeocode,
  type PhotoExifData,
} from "@/lib/exif";

export type StepConfidence = "high" | "medium" | "low";

export interface MediaInsightResult {
  captionId: string;
  caption: string;
  sceneDescription?: string;
  richTags?: string[];
}

interface HybridLocationResult {
  key: string;
  locationName: string;
  country: string;
  latitude: number | null;
  longitude: number | null;
  confidence: StepConfidence;
  summary: string;
  eventDescription?: string;
  photoCaptions?: MediaInsightResult[];
}

export interface ImportedMediaStep {
  key: string;
  locationName: string;
  country: string;
  latitude: number;
  longitude: number;
  photos: PhotoExifData[];
  earliestDate: Date | null;
  selected: boolean;
  confidence: StepConfidence;
  summary: string;
  description: string;
}

export interface ProcessedMediaImport {
  steps: ImportedMediaStep[];
  noGpsPhotos: PhotoExifData[];
  allDates: Date[];
  countries: string[];
  totalMedia: number;
  resolvedMediaCount: number;
  unresolvedCount: number;
}

const LOCATION_GROUP_RADIUS_METERS = 500;
const LOCATION_GROUP_MAX_GAP_HOURS = 6;
const UNGROUPED_MEDIA_MATCH_WINDOW_MS = LOCATION_GROUP_MAX_GAP_HOURS * 60 * 60 * 1000;

const CONFIDENCE_RANK: Record<StepConfidence, number> = {
  low: 0,
  medium: 1,
  high: 2,
};

function sortMediaByCapturedTime<T extends PhotoExifData>(media: T[]) {
  return [...media].sort(
    (a, b) => (a.takenAt?.getTime() ?? a.file.lastModified ?? 0) - (b.takenAt?.getTime() ?? b.file.lastModified ?? 0),
  );
}

function isKnownLocationName(value: string) {
  const normalized = value.trim().toLowerCase();
  return normalized.length > 0 && normalized !== "unknown" && normalized !== "unknown location";
}

function buildLocationSummary(locationName: string, country: string) {
  if (!isKnownLocationName(locationName)) {
    return "Grouped nearby media from the same travel stop.";
  }

  return country && country !== "Unknown"
    ? `Grouped media around ${locationName}, ${country}.`
    : `Grouped media around ${locationName}.`;
}

function buildEventDescription(locationName: string, country: string) {
  if (!isKnownLocationName(locationName)) {
    return "Travel event created from nearby media captured in the same time range.";
  }

  return country && country !== "Unknown"
    ? `Travel event around ${locationName}, ${country}.`
    : `Travel event around ${locationName}.`;
}

function buildMediaCaption(photo: PhotoExifData, locationName: string) {
  const isVideo = photo.file.type.startsWith("video/");
  if (!isKnownLocationName(locationName)) {
    return isVideo ? "Video from this travel stop" : "Photo from this travel stop";
  }

  return isVideo ? `Video taken at ${locationName}` : `Photo taken at ${locationName}`;
}

function applyMediaInsights(
  photos: PhotoExifData[],
  photoCaptions: MediaInsightResult[] | undefined,
  locationName: string,
): PhotoExifData[] {
  const captionMap = new Map(
    (photoCaptions ?? [])
      .filter((item) => item.captionId.trim().length > 0)
      .map((item) => [item.captionId, item]),
  );

  return sortMediaByCapturedTime(photos).map((photo) => {
    const insight = captionMap.get(photo.captionId);

    return {
      ...photo,
      caption: insight?.caption?.trim() || photo.caption || buildMediaCaption(photo, locationName),
      sceneDescription: insight?.sceneDescription?.trim() || photo.sceneDescription,
      aiTags: dedupeTags([...(photo.aiTags ?? []), ...((insight?.richTags ?? []).map((tag) => tag.trim()))]),
    };
  });
}

function pickHigherConfidence(left: StepConfidence, right: StepConfidence): StepConfidence {
  return CONFIDENCE_RANK[left] >= CONFIDENCE_RANK[right] ? left : right;
}

function getRepresentativeCoordinates(photos: PhotoExifData[]) {
  const latitudes = photos.map((p) => p.latitude).filter((v): v is number => v !== null).sort((a, b) => a - b);
  const longitudes = photos.map((p) => p.longitude).filter((v): v is number => v !== null).sort((a, b) => a - b);
  const mid = Math.floor(latitudes.length / 2);
  return { latitude: latitudes[mid], longitude: longitudes[mid] };
}

function isSameCalendarDay(a: Date, b: Date) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

function getClosestTimeDistanceMs(step: ImportedMediaStep, targetDate: Date) {
  const distances = step.photos
    .map((photo) => (photo.takenAt ? Math.abs(photo.takenAt.getTime() - targetDate.getTime()) : null))
    .filter((value): value is number => value !== null);

  return distances.length > 0 ? Math.min(...distances) : Number.POSITIVE_INFINITY;
}

function findStepForUngroupedMedia(media: PhotoExifData, steps: ImportedMediaStep[]) {
  if (!media.takenAt) return null;

  const candidates = steps
    .filter((step) => step.photos.some((photo) => photo.takenAt && isSameCalendarDay(photo.takenAt, media.takenAt!)))
    .map((step) => ({ step, diffMs: getClosestTimeDistanceMs(step, media.takenAt!) }))
    .sort((a, b) => a.diffMs - b.diffMs);

  if (candidates.length === 0) return null;
  if (
    candidates[0].diffMs <= UNGROUPED_MEDIA_MATCH_WINDOW_MS &&
    (candidates.length === 1 || candidates[0].diffMs <= candidates[1].diffMs / 2)
  ) {
    return candidates[0].step;
  }

  return null;
}

function prepareMediaForInference(photos: PhotoExifData[]) {
  const sorted = sortMediaByCapturedTime(photos);
  let remainingImages = 4;

  return sorted.map((photo) => {
    const includeImage = remainingImages > 0 && Boolean(photo.analysisImage);
    if (includeImage) remainingImages -= 1;

    return {
      captionId: photo.captionId,
      fileName: photo.file.name,
      takenAt: photo.takenAt?.toISOString() ?? null,
      analysisImage: includeImage ? photo.analysisImage ?? null : null,
    };
  });
}

async function inferLocationsWithVision(
  steps: ImportedMediaStep[],
  noGpsGroups: Array<{ key: string; photos: PhotoExifData[] }> = [],
): Promise<Map<string, HybridLocationResult>> {
  const preparedNoGpsGroups = noGpsGroups
    .map((group) => ({
      key: group.key,
      exifLocation: null,
      photos: prepareMediaForInference(group.photos),
    }))
    .filter((group) => group.photos.some((photo) => Boolean(photo.analysisImage)));

  const gpsGroups = steps
    .map((step) => ({
      key: step.key,
      exifLocation: {
        latitude: step.latitude,
        longitude: step.longitude,
        name: step.locationName,
        country: step.country,
      },
      photos: prepareMediaForInference(step.photos),
    }))
    .filter((group) => group.photos.length > 0);

  const allGroups = [...preparedNoGpsGroups, ...gpsGroups];
  if (allGroups.length === 0) return new Map();

  const batches = Array.from({ length: Math.ceil(allGroups.length / 12) }, (_, index) =>
    allGroups.slice(index * 12, index * 12 + 12),
  );

  const batchResults = await Promise.all(
    batches.map(async (batch) => {
      const { data, error } = await supabase.functions.invoke("photo-location-inference", { body: { groups: batch } });
      if (error) {
        console.error("Visual location inference batch error:", error);
        return [];
      }

      return Array.isArray(data?.results) ? data.results : [];
    }),
  );

  return new Map(
    batchResults
      .flat()
      .filter((result: any): result is HybridLocationResult => typeof result?.key === "string")
      .map((result) => [result.key, result]),
  );
}

export async function processImportedMediaFiles(files: File[]): Promise<ProcessedMediaImport> {
  const mediaFiles = files.filter((file) => file.type.startsWith("image/") || file.type.startsWith("video/"));
  if (mediaFiles.length === 0) {
    return {
      steps: [],
      noGpsPhotos: [],
      allDates: [],
      countries: [],
      totalMedia: 0,
      resolvedMediaCount: 0,
      unresolvedCount: 0,
    };
  }

  const exifResults = await extractExifFromFiles(mediaFiles);
  const allDates = exifResults.map((photo) => photo.takenAt).filter(Boolean) as Date[];
  const groups = groupPhotosByLocation(exifResults, LOCATION_GROUP_RADIUS_METERS, LOCATION_GROUP_MAX_GAP_HOURS);

  const baseSteps: ImportedMediaStep[] = await Promise.all(
    Array.from(groups.entries()).map(async ([key, photos]) => {
      const sortedPhotos = sortMediaByCapturedTime(photos);
      const { latitude, longitude } = getRepresentativeCoordinates(sortedPhotos);
      const geo = await reverseGeocode(latitude, longitude);
      const dates = sortedPhotos.map((p) => p.takenAt).filter(Boolean) as Date[];
      const earliestDate = dates.length > 0 ? new Date(Math.min(...dates.map((d) => d.getTime()))) : null;

      return {
        key,
        locationName: geo.name,
        country: geo.country,
        latitude,
        longitude,
        photos: applyMediaInsights(sortedPhotos, undefined, geo.name),
        earliestDate,
        selected: true,
        confidence: "low" as const,
        summary: buildLocationSummary(geo.name, geo.country),
        description: buildEventDescription(geo.name, geo.country),
      };
    }),
  );

  const noGpsPhotos = sortMediaByCapturedTime(
    exifResults.filter((photo) => photo.latitude === null || photo.longitude === null),
  );
  const unresolvedNoGpsMedia: PhotoExifData[] = [];

  for (const media of noGpsPhotos) {
    const matchedStep = findStepForUngroupedMedia(media, baseSteps);
    if (!matchedStep) {
      unresolvedNoGpsMedia.push(media);
      continue;
    }

    matchedStep.photos = applyMediaInsights([...matchedStep.photos, media], undefined, matchedStep.locationName);
    if (media.takenAt && (!matchedStep.earliestDate || media.takenAt.getTime() < matchedStep.earliestDate.getTime())) {
      matchedStep.earliestDate = media.takenAt;
    }
  }

  const noGpsGroups = Array.from(groupMediaByTime(unresolvedNoGpsMedia, LOCATION_GROUP_MAX_GAP_HOURS).values()).map(
    (photos, index) => ({
      key: `no-gps-${index}`,
      photos,
    }),
  );

  let inferredLocations = new Map<string, HybridLocationResult>();
  try {
    inferredLocations = await inferLocationsWithVision(baseSteps, noGpsGroups);
  } catch (error) {
    console.error("Visual location inference error:", error);
  }

  const steps = baseSteps.map((step) => {
    const inferred = inferredLocations.get(step.key);
    const locationName = isKnownLocationName(step.locationName) ? step.locationName : inferred?.locationName || step.locationName;
    const country = step.country && step.country !== "Unknown" ? step.country : inferred?.country || step.country;

    return {
      ...step,
      locationName,
      country,
      photos: applyMediaInsights(step.photos, inferred?.photoCaptions, locationName),
      confidence: inferred?.confidence ? pickHigherConfidence(step.confidence, inferred.confidence) : step.confidence,
      summary: inferred?.summary || buildLocationSummary(locationName, country),
      description: inferred?.eventDescription || buildEventDescription(locationName, country),
    };
  });

  const inferredNoGpsSteps = (
    await Promise.all(
      noGpsGroups.map(async (group): Promise<ImportedMediaStep | null> => {
        const inferred = inferredLocations.get(group.key);
        if (!inferred) return null;

        let latitude = inferred.latitude;
        let longitude = inferred.longitude;

        if ((latitude === null || longitude === null) && inferred.locationName) {
          const geocoded = await geocodeLocationName(inferred.locationName, inferred.country);
          latitude = geocoded?.latitude ?? null;
          longitude = geocoded?.longitude ?? null;
        }

        if (latitude === null || longitude === null) return null;

        const locationName = inferred.locationName || "Visually Identified Location";
        const country = inferred.country || "Unknown";
        const photos = applyMediaInsights(group.photos, inferred.photoCaptions, locationName);
        const dates = photos.map((photo) => photo.takenAt).filter(Boolean) as Date[];
        const earliestDate = dates.length > 0 ? new Date(Math.min(...dates.map((date) => date.getTime()))) : null;

        return {
          key: group.key,
          locationName,
          country,
          latitude,
          longitude,
          photos,
          earliestDate,
          selected: true,
          confidence: inferred.confidence,
          summary: inferred.summary || buildLocationSummary(locationName, country),
          description: inferred.eventDescription || buildEventDescription(locationName, country),
        };
      }),
    )
  ).filter((step): step is ImportedMediaStep => step !== null);

  const finalSteps = [...steps, ...inferredNoGpsSteps].sort(
    (a, b) => (a.earliestDate?.getTime() ?? Infinity) - (b.earliestDate?.getTime() ?? Infinity),
  );

  return {
    steps: finalSteps,
    noGpsPhotos,
    allDates,
    countries: Array.from(
      new Set(finalSteps.map((step) => step.country).filter((country) => country && country !== "Unknown")),
    ),
    totalMedia: mediaFiles.length,
    resolvedMediaCount: finalSteps.reduce((count, step) => count + step.photos.length, 0),
    unresolvedCount: mediaFiles.length - finalSteps.reduce((count, step) => count + step.photos.length, 0),
  };
}