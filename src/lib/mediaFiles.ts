const VIDEO_EXTENSIONS = [".mov", ".mp4", ".m4v", ".3gp", ".3gpp", ".hevc"];
const IMAGE_EXTENSIONS = [".jpg", ".jpeg", ".png", ".webp", ".gif", ".heic", ".heif"];

// Keep this minimal — iOS Safari falls back to the Files picker (which limits
// multi-select to ~5 items) when explicit extensions are listed alongside the
// wildcard types. `image/*,video/*` triggers the full Photo Library picker.
export const MEDIA_FILE_ACCEPT = "image/*,video/*";

function hasExtension(file: File, extensions: string[]) {
  const name = file.name.toLowerCase();
  return extensions.some((ext) => name.endsWith(ext));
}

export function isKnownVideoFile(file: File) {
  return file.type.startsWith("video/") || file.type === "video/quicktime" || hasExtension(file, VIDEO_EXTENSIONS);
}

export function isKnownImageFile(file: File) {
  return file.type.startsWith("image/") || hasExtension(file, IMAGE_EXTENSIONS);
}

export function isSupportedMediaFile(file: File) {
  return isKnownImageFile(file) || isKnownVideoFile(file);
}