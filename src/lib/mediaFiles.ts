const VIDEO_EXTENSIONS = [".mov", ".mp4", ".m4v", ".3gp", ".3gpp", ".hevc"];
const IMAGE_EXTENSIONS = [".jpg", ".jpeg", ".png", ".webp", ".gif", ".heic", ".heif"];

// IMPORTANT iOS Safari quirk: any `accept` value that combines image AND video
// types (even the wildcards `image/*,video/*`) makes iOS open a restricted
// picker capped at ~5 items. Leaving accept OFF entirely lets iOS open the
// full Photo Library picker with unlimited multi-select. We filter unsupported
// files in JS via `isSupportedMediaFile` after the user picks them.
export const MEDIA_FILE_ACCEPT = undefined as unknown as string;

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
