const VIDEO_EXTENSIONS = [".mov", ".mp4", ".m4v", ".3gp", ".3gpp", ".hevc"];
const IMAGE_EXTENSIONS = [".jpg", ".jpeg", ".png", ".webp", ".gif", ".heic", ".heif"];

export const MEDIA_FILE_ACCEPT = [
  "image/*",
  "video/*",
  "image/heic",
  "image/heif",
  "video/quicktime",
  "video/mp4",
  ".heic",
  ".heif",
  ".mov",
  ".mp4",
  ".m4v",
  ".3gp",
  ".3gpp",
].join(",");

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