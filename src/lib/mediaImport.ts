import { supabase } from "@/integrations/supabase/client";
import { dedupeTags } from "@/lib/mediaMetadata";
import {
  extractExifFromFile,
  geocodeLocationName,
  groupMediaByTime,
  groupPhotosByLocation,
  reverseGeocode,
  type PhotoExifData,
} from "@/lib/exif";
import {
  buildImportedEventDescription,
  buildImportedLocationSummary,
  buildImportedStepDetails,
} from "@/lib/placeClassification";

export type StepConfidence = "high" | "medium" | "low";

export interface MediaInsightResult {
  captionId: string;
  caption: string;
  sceneDescription?: string;
  essence?: string;
  richTags?: string[];
  suggestedVenueName?: string;
  suggestedCityName?: string;
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
  eventType: string;
  confidence: StepConfidence;
  placeTypes?: string[];
  nearbyPlaces?: string[];
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

export type ImportProgressCallback = (phase: string, current: number, total: number) => void;

const LOCATION_GROUP_RADIUS_METERS = 60;
const LOCATION_GROUP_MAX_GAP_HOURS = 1.5;
const UNGROUPED_MEDIA_MATCH_WINDOW_MS = LOCATION_GROUP_MAX_GAP_HOURS * 60 * 60 * 1000;
const NO_GPS_CONTEXT_MATCH_WINDOW_MS = 90 * 60 * 1000;
const REVERSE_GEOCODE_CONCURRENCY = 2;

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

function buildDisplayLocationName(name: string, locality: string) {
  const safeName = isKnownLocationName(name) ? name.trim() : "";
  const safeLocality = locality.trim().length > 0 && locality.trim().toLowerCase() !== "unknown"
    ? locality.trim()
    : "";

  if (safeName && safeLocality && safeName.toLowerCase() !== safeLocality.toLowerCase()) {
    return `${safeName}, ${safeLocality}`;
  }

  return safeName || safeLocality || "Unknown";
}

function buildLocationSummary(locationName: string, country: string, eventType = "activity") {
  return buildImportedLocationSummary(locationName, country, eventType);
}

function buildEventDescription(locationName: string, country: string, eventType = "activity") {
  return buildImportedEventDescription(locationName, country, eventType);
}

function buildMediaCaption(photo: PhotoExifData, locationName: string, eventType = "activity") {
  const isVideo = photo.file.type.startsWith("video/");
  if (!isKnownLocationName(locationName)) {
    return isVideo ? "Video from this travel stop" : "Photo from this travel stop";
  }

  if (isVideo) {
    const videoPrefix = {
      concert: "Performance video",
      live_show: "Performance video",
      theatre: "Show video",
      sport: "Match video",
      sightseeing: "Sightseeing video",
      dining: "Dining video",
      flight: "Flight video",
      train: "Train video",
      ferry: "Ferry video",
      hotel: "Stay video",
    }[eventType];

    return videoPrefix ? `${videoPrefix} at ${locationName}` : `Video at ${locationName}`;
  }

  return `Photo at ${locationName}`;
}

function applyMediaInsights(
  photos: PhotoExifData[],
  photoCaptions: MediaInsightResult[] | undefined,
  videoInsights: Map<string, MediaInsightResult> | undefined,
  locationName: string,
  eventType = "activity",
): PhotoExifData[] {
  const captionMap = new Map(
    (photoCaptions ?? [])
      .filter((item) => item.captionId.trim().length > 0)
      .map((item) => [item.captionId, item]),
  );

  return sortMediaByCapturedTime(photos).map((photo) => {
    const isVideo = photo.file.type.startsWith("video/");
    const videoInsight = isVideo ? videoInsights?.get(photo.captionId) : undefined;
    const photoInsight = captionMap.get(photo.captionId);
    const fallbackCaption = buildMediaCaption(photo, locationName, eventType);

    // Video insights from native Gemini analysis take priority
    if (isVideo && videoInsight) {
      return {
        ...photo,
        caption: videoInsight.caption?.trim() || photo.caption || fallbackCaption,
        sceneDescription: videoInsight.sceneDescription?.trim() || photo.sceneDescription,
        essence: videoInsight.essence?.trim() || photo.essence,
        aiTags: dedupeTags([...(photo.aiTags ?? []), ...((videoInsight.richTags ?? []).map((tag) => tag.trim()))]),
      };
    }

    return {
      ...photo,
      caption: isVideo ? photo.caption || fallbackCaption : photoInsight?.caption?.trim() || photo.caption || fallbackCaption,
      sceneDescription: isVideo ? undefined : photoInsight?.sceneDescription?.trim() || photo.sceneDescription,
      aiTags: dedupeTags([...(photo.aiTags ?? []), ...((photoInsight?.richTags ?? []).map((tag) => tag.trim()))]),
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

function findStepByCapturedTime(targetDate: Date | null, steps: ImportedMediaStep[], maxWindowMs = UNGROUPED_MEDIA_MATCH_WINDOW_MS) {
  if (!targetDate) return null;

  const candidates = steps
    .filter((step) => step.photos.some((photo) => photo.takenAt && isSameCalendarDay(photo.takenAt, targetDate)))
    .map((step) => ({ step, diffMs: getClosestTimeDistanceMs(step, targetDate) }))
    .sort((a, b) => a.diffMs - b.diffMs);

  if (candidates.length === 0) return null;
  if (candidates[0].diffMs <= maxWindowMs && (candidates.length === 1 || candidates[0].diffMs <= candidates[1].diffMs / 2)) {
    return candidates[0].step;
  }

  return null;
}

function findStepForUngroupedMedia(media: PhotoExifData, steps: ImportedMediaStep[]) {
  if (!media.takenAt) return null;
  if (media.file.type.startsWith("video/")) return null;

  return findStepByCapturedTime(media.takenAt, steps);
}

function findContextStepForNoGpsGroup(photos: PhotoExifData[], steps: ImportedMediaStep[]) {
  const groupDate = sortMediaByCapturedTime(photos).find((photo) => photo.takenAt)?.takenAt ?? null;
  return findStepByCapturedTime(groupDate, steps, NO_GPS_CONTEXT_MATCH_WINDOW_MS);
}

async function mapWithConcurrency<T, U>(
  items: T[],
  concurrency: number,
  mapper: (item: T, index: number) => Promise<U>,
): Promise<U[]> {
  if (items.length === 0) return [];

  const results = new Array<U>(items.length);
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
      analysisImage: includeImage ? photo.analysisImage ?? photo.thumbnail ?? null : null,
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
    .filter((group) => group.photos.some((photo) => Boolean(photo.analysisImage)));

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

export interface ExistingTripStep {
  location_name: string | null;
  country: string | null;
  latitude: number;
  longitude: number;
  recorded_at: string;
  event_type: string;
  description: string | null;
}

export async function processImportedMediaFiles(
  files: File[],
  onProgress?: ImportProgressCallback,
  existingTripSteps?: ExistingTripStep[],
): Promise<ProcessedMediaImport> {
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

  onProgress?.("Reading metadata", 0, mediaFiles.length);
  let exifDone = 0;
  const exifResults = await Promise.all(
    mediaFiles.map(async (file) => {
      const result = await extractExifFromFile(file);
      exifDone++;
      onProgress?.("Reading metadata", exifDone, mediaFiles.length);
      return result;
    }),
  );

  onProgress?.("Grouping locations", 0, 1);
  const allDates = exifResults.map((photo) => photo.takenAt).filter(Boolean) as Date[];
  const groups = groupPhotosByLocation(exifResults, LOCATION_GROUP_RADIUS_METERS, LOCATION_GROUP_MAX_GAP_HOURS);

  const groupEntries = Array.from(groups.entries());
  onProgress?.("Resolving locations", 0, groupEntries.length);
  let geoResolved = 0;
  const baseSteps: ImportedMediaStep[] = await mapWithConcurrency(
    groupEntries,
    REVERSE_GEOCODE_CONCURRENCY,
    async ([key, photos]) => {
      const sortedPhotos = sortMediaByCapturedTime(photos);
      const { latitude, longitude } = getRepresentativeCoordinates(sortedPhotos);
      const geo = await reverseGeocode(latitude, longitude);
      geoResolved++;
      onProgress?.("Resolving locations", geoResolved, groupEntries.length);
      const displayName = buildDisplayLocationName(geo.name, geo.locality);
      const stepDetails = buildImportedStepDetails({
        locationName: displayName,
        country: geo.country,
        placeTypes: geo.placeTypes,
      });
      const dates = sortedPhotos.map((p) => p.takenAt).filter(Boolean) as Date[];
      const earliestDate = dates.length > 0 ? new Date(Math.min(...dates.map((d) => d.getTime()))) : null;

      return {
        key,
        locationName: displayName,
        country: geo.country,
        latitude,
        longitude,
        photos: applyMediaInsights(sortedPhotos, undefined, undefined, displayName, stepDetails.eventType),
        earliestDate,
        selected: true,
        eventType: stepDetails.eventType,
        confidence: "low" as const,
        placeTypes: geo.placeTypes,
        nearbyPlaces: geo.nearbyPlaces,
        summary: buildLocationSummary(displayName, geo.country, stepDetails.eventType),
        description: buildEventDescription(displayName, geo.country, stepDetails.eventType),
      };
    },
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

    matchedStep.photos = applyMediaInsights(
      [...matchedStep.photos, media],
      undefined,
      undefined,
      matchedStep.locationName,
      matchedStep.eventType,
    );
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

  onProgress?.("Visual recognition", 0, 1);
  let inferredLocations = new Map<string, HybridLocationResult>();
  try {
    inferredLocations = await inferLocationsWithVision(baseSteps, noGpsGroups);
  } catch (error) {
    console.error("Visual location inference error:", error);
  }
  onProgress?.("Visual recognition", 1, 1);

  // Video analysis is now fully async — videos will be analyzed in the background
  // after the user completes the import. No blocking here.
  const videoInsights = new Map<string, MediaInsightResult>();

  const steps = baseSteps.map((step) => {
    const inferred = inferredLocations.get(step.key);

    // Extract AI venue/city from video insights if available
    const aiVenue = step.photos
      .map(p => videoInsights.get(p.captionId)?.suggestedVenueName)
      .find(name => name && name.trim().length > 0);
    const aiCity = step.photos
      .map(p => videoInsights.get(p.captionId)?.suggestedCityName)
      .find(name => name && name.trim().length > 0);

    // Strict "Venue, City" format if AI provided both; otherwise fall back
    let locationName: string;
    if (aiVenue && aiCity) {
      locationName = `${aiVenue}, ${aiCity}`;
    } else if (aiVenue) {
      locationName = aiVenue;
    } else {
      locationName = isKnownLocationName(step.locationName) ? step.locationName : inferred?.locationName || step.locationName;
    }

    const country = step.country && step.country !== "Unknown" ? step.country : inferred?.country || step.country;

    const stepDetails = buildImportedStepDetails({
      locationName,
      country,
      placeTypes: step.placeTypes,
      fallbackEventType: step.eventType,
    });

    return {
      ...step,
      locationName,
      country,
      photos: applyMediaInsights(step.photos, inferred?.photoCaptions, videoInsights, locationName, stepDetails.eventType),
      eventType: stepDetails.eventType,
      confidence: inferred?.confidence ? pickHigherConfidence(step.confidence, inferred.confidence) : step.confidence,
      summary: buildLocationSummary(locationName, country, stepDetails.eventType),
      description: buildEventDescription(locationName, country, stepDetails.eventType),
    };
  });

  const inferredNoGpsSteps = (
    await Promise.all(
      noGpsGroups.map(async (group): Promise<ImportedMediaStep | null> => {
        const inferred = inferredLocations.get(group.key);
        const contextualStep = findContextStepForNoGpsGroup(group.photos, baseSteps);
        if (!inferred && !contextualStep) return null;

        let latitude = contextualStep?.latitude ?? inferred?.latitude ?? null;
        let longitude = contextualStep?.longitude ?? inferred?.longitude ?? null;

        if ((latitude === null || longitude === null) && inferred?.locationName) {
          const geocoded = await geocodeLocationName(inferred.locationName, inferred.country);
          latitude = geocoded?.latitude ?? null;
          longitude = geocoded?.longitude ?? null;
        }

        if (latitude === null || longitude === null) return null;

        const locationName =
          contextualStep && isKnownLocationName(contextualStep.locationName)
            ? contextualStep.locationName
            : inferred?.locationName || "Visually Identified Location";
        const country =
          contextualStep?.country && contextualStep.country !== "Unknown"
            ? contextualStep.country
            : inferred?.country || "Unknown";
        const stepDetails = buildImportedStepDetails({
          locationName,
          country,
          placeTypes: contextualStep?.placeTypes,
          fallbackEventType: contextualStep?.eventType,
        });
        const photos = applyMediaInsights(group.photos, inferred?.photoCaptions, videoInsights, locationName, stepDetails.eventType);
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
          eventType: stepDetails.eventType,
          confidence: contextualStep ? pickHigherConfidence(inferred?.confidence ?? "low", contextualStep.confidence) : inferred?.confidence ?? "low",
          summary: buildLocationSummary(locationName, country, stepDetails.eventType),
          description: buildEventDescription(locationName, country, stepDetails.eventType),
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