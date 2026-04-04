import type { Json } from "@/integrations/supabase/types";
import type { PhotoExifData } from "@/lib/exif";

const MONTH_TAGS = [
  "january",
  "february",
  "march",
  "april",
  "may",
  "june",
  "july",
  "august",
  "september",
  "october",
  "november",
  "december",
] as const;

function normalizeTag(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[._/]+/g, " ")
    .replace(/\s+/g, " ");
}

function getFileExtension(fileName: string) {
  const match = fileName.toLowerCase().match(/\.([a-z0-9]+)$/i);
  return match ? match[1] : null;
}

function isImageDataUrl(value: unknown): value is string {
  return typeof value === "string" && value.startsWith("data:image/");
}

export function dedupeTags(values: Array<string | null | undefined>) {
  const tags = values
    .filter((value): value is string => typeof value === "string" && value.trim().length > 0)
    .map(normalizeTag)
    .filter((value) => value.length > 0);

  return Array.from(new Set(tags));
}

export function buildMediaBaseTags(
  photo: PhotoExifData,
  context: { locationName?: string | null; country?: string | null } = {},
) {
  const mediaType = photo.file.type.startsWith("video/") ? "video" : "image";
  const extension = getFileExtension(photo.file.name);

  return dedupeTags([
    mediaType,
    extension,
    photo.latitude !== null && photo.longitude !== null ? "gps" : "no gps",
    photo.cameraMake ?? null,
    photo.cameraModel ?? null,
    photo.takenAt ? String(photo.takenAt.getUTCFullYear()) : null,
    photo.takenAt ? MONTH_TAGS[photo.takenAt.getUTCMonth()] : null,
    context.country && context.country !== "Unknown" ? context.country : null,
    context.locationName && !["Unknown", "Unknown Location"].includes(context.locationName)
      ? context.locationName
      : null,
  ]);
}

export function buildStoredMediaMetadata(
  photo: PhotoExifData,
  context: { locationName?: string | null; country?: string | null } = {},
): Json {
  const mediaType = photo.file.type.startsWith("video/") ? "video" : "image";
  const extension = getFileExtension(photo.file.name);
  const baseTags = buildMediaBaseTags(photo, context);
  const aiTags = dedupeTags(photo.aiTags ?? []);

  return {
    version: 1,
    caption_id: photo.captionId,
    media_type: mediaType,
    base_tags: baseTags,
    ai_tags: aiTags,
    all_tags: dedupeTags([...baseTags, ...aiTags]),
    locked_metadata: {
      file_name: photo.file.name,
      mime_type: photo.file.type || null,
      file_extension: extension,
      taken_at: photo.takenAt?.toISOString() ?? null,
      latitude: photo.latitude,
      longitude: photo.longitude,
      camera_make: photo.cameraMake ?? null,
      camera_model: photo.cameraModel ?? null,
      duration_seconds: photo.duration ?? null,
      metadata_sources: photo.metadataSources ?? [],
      preview_source: photo.previewSource ?? null,
      preview_thumbnail_data_url: mediaType === "video" ? photo.thumbnail ?? null : null,
      derived_location_name: context.locationName ?? null,
      derived_country: context.country ?? null,
    },
    ai_enrichment: {
      caption: photo.caption ?? null,
      scene_description: photo.sceneDescription ?? null,
      essence: photo.essence ?? null,
      rich_tags: aiTags,
      model:
        photo.caption || photo.sceneDescription || photo.essence || aiTags.length > 0
          ? "google/gemini-2.5-flash"
          : null,
    },
    raw_exif: photo.exifRaw ?? null,
  } as Json;
}

export function getStoredPreviewThumbnail(exifData: unknown): string | null {
  if (!exifData || typeof exifData !== "object" || Array.isArray(exifData)) {
    return null;
  }

  const lockedMetadata = (exifData as Record<string, unknown>).locked_metadata;
  if (!lockedMetadata || typeof lockedMetadata !== "object" || Array.isArray(lockedMetadata)) {
    return null;
  }

  const previewThumbnail = (lockedMetadata as Record<string, unknown>).preview_thumbnail_data_url;
  return isImageDataUrl(previewThumbnail) ? previewThumbnail : null;
}

export function getStoredEssence(exifData: unknown): string | null {
  if (!exifData || typeof exifData !== "object" || Array.isArray(exifData)) {
    return null;
  }

  const aiEnrichment = (exifData as Record<string, unknown>).ai_enrichment;
  if (!aiEnrichment || typeof aiEnrichment !== "object" || Array.isArray(aiEnrichment)) {
    return null;
  }

  const essence = (aiEnrichment as Record<string, unknown>).essence;
  return typeof essence === "string" && essence.trim().length > 0 ? essence.trim() : null;
}