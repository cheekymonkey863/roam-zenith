const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

interface VideoMetadata {
  latitude: number | null;
  longitude: number | null;
  altitude: number | null;
  creationDate: string | null;
  duration: number | null;
  cameraMake: string | null;
  cameraModel: string | null;
}

interface AtomHeader {
  size: number;
  type: string;
  headerSize: number;
}

// MP4 epoch: 1904-01-01 to Unix epoch: 1970-01-01 in seconds
const MP4_EPOCH_OFFSET = 2082844800;

const CONTAINER_ATOMS = new Set([
  "moov", "trak", "mdia", "minf", "stbl", "udta", "edts",
  "dinf", "sinf", "schi", "tref", "moof", "traf", "mvex",
  "mfra", "skip", "meta", "ilst",
]);

function readAtomHeader(view: DataView, offset: number): AtomHeader | null {
  if (offset + 8 > view.byteLength) return null;

  let size = view.getUint32(offset);
  const type = String.fromCharCode(
    view.getUint8(offset + 4),
    view.getUint8(offset + 5),
    view.getUint8(offset + 6),
    view.getUint8(offset + 7)
  );

  let headerSize = 8;

  if (size === 1) {
    // 64-bit extended size
    if (offset + 16 > view.byteLength) return null;
    const hi = view.getUint32(offset + 8);
    const lo = view.getUint32(offset + 12);
    size = hi * 0x100000000 + lo;
    headerSize = 16;
  } else if (size === 0) {
    // Atom extends to end of file
    size = view.byteLength - offset;
  }

  return { size, type, headerSize };
}

function readString(bytes: Uint8Array, start: number, length: number): string {
  const slice = bytes.slice(start, start + length);
  return new TextDecoder("utf-8", { fatal: false }).decode(slice);
}

function parseISO6709(text: string): { latitude: number; longitude: number; altitude?: number } | null {
  // Format: +DD.DDDD-DDD.DDDD+ALT/ or +DD.DDDD-DDD.DDDD/
  const match = text.match(/([+-]\d+\.?\d*)([+-]\d+\.?\d*)(?:([+-]\d+\.?\d*))?/);
  if (!match) return null;

  const lat = parseFloat(match[1]);
  const lng = parseFloat(match[2]);
  const alt = match[3] ? parseFloat(match[3]) : undefined;

  if (Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
  if (lat === 0 && lng === 0) return null;

  return { latitude: lat, longitude: lng, altitude: alt };
}

function parseMvhd(view: DataView, offset: number, size: number): { creationDate: string | null; duration: number | null } {
  const result: { creationDate: string | null; duration: number | null } = { creationDate: null, duration: null };
  if (size < 12) return result;

  const version = view.getUint8(offset);
  let creationTime: number;
  let timescale: number;
  let durationRaw: number;

  if (version === 0) {
    if (offset + 20 > view.byteLength) return result;
    creationTime = view.getUint32(offset + 4);
    timescale = view.getUint32(offset + 12);
    durationRaw = view.getUint32(offset + 16);
  } else {
    if (offset + 32 > view.byteLength) return result;
    const hi = view.getUint32(offset + 4);
    const lo = view.getUint32(offset + 8);
    creationTime = hi * 0x100000000 + lo;
    timescale = view.getUint32(offset + 20);
    const durHi = view.getUint32(offset + 24);
    const durLo = view.getUint32(offset + 28);
    durationRaw = durHi * 0x100000000 + durLo;
  }

  if (creationTime > 0) {
    const unixTimestamp = creationTime - MP4_EPOCH_OFFSET;
    const date = new Date(unixTimestamp * 1000);
    if (date.getFullYear() >= 2000 && date.getFullYear() <= 2100) {
      result.creationDate = date.toISOString();
    }
  }

  if (timescale > 0 && durationRaw > 0) {
    result.duration = durationRaw / timescale;
  }

  return result;
}

function parseXyzAtom(bytes: Uint8Array, offset: number, size: number): { latitude: number; longitude: number; altitude?: number } | null {
  // The ©xyz atom may have different structures:
  // 1. Direct: 4 bytes (size) + 4 bytes (type ©xyz) + GPS string
  // 2. With data header: ... + 2 bytes text size + 2 bytes language code + GPS string
  
  if (size < 4) return null;
  
  // Try multiple offset strategies
  const strategies = [0, 4, 8];
  
  for (const skip of strategies) {
    if (skip + 4 > size) continue;
    const text = readString(bytes, offset + skip, size - skip);
    const result = parseISO6709(text);
    if (result) return result;
  }

  return null;
}

/** Walk the MP4 atom tree looking for metadata atoms. */
function walkAtoms(
  view: DataView,
  bytes: Uint8Array,
  start: number,
  end: number,
  path: string,
  metadata: VideoMetadata
): void {
  let offset = start;

  while (offset < end - 8) {
    const atom = readAtomHeader(view, offset);
    if (!atom || atom.size < 8) break;

    const atomEnd = Math.min(offset + atom.size, end);
    const dataOffset = offset + atom.headerSize;
    const dataSize = atomEnd - dataOffset;
    const currentPath = path ? `${path}.${atom.type}` : atom.type;

    // mvhd: movie header with creation date + duration
    if (atom.type === "mvhd" && dataSize > 0) {
      const mvhd = parseMvhd(view, dataOffset, dataSize);
      if (mvhd.creationDate && !metadata.creationDate) metadata.creationDate = mvhd.creationDate;
      if (mvhd.duration !== null && metadata.duration === null) metadata.duration = mvhd.duration;
    }

    // ©xyz: GPS location in ISO 6709 format (Apple/QuickTime)
    if (atom.type === "\xA9xyz" || atom.type === "©xyz") {
      const gps = parseXyzAtom(bytes, dataOffset, dataSize);
      if (gps) {
        metadata.latitude = gps.latitude;
        metadata.longitude = gps.longitude;
        if (gps.altitude !== undefined) metadata.altitude = gps.altitude;
      }
    }

    // ©mak: camera make (Apple)
    if (atom.type === "\xA9mak" || atom.type === "©mak") {
      if (dataSize > 4) {
        const text = readString(bytes, dataOffset + 4, dataSize - 4).replace(/\0/g, "").trim();
        if (text.length > 0 && !metadata.cameraMake) metadata.cameraMake = text;
      }
    }

    // ©mod: camera model (Apple)
    if (atom.type === "\xA9mod" || atom.type === "©mod") {
      if (dataSize > 4) {
        const text = readString(bytes, dataOffset + 4, dataSize - 4).replace(/\0/g, "").trim();
        if (text.length > 0 && !metadata.cameraModel) metadata.cameraModel = text;
      }
    }

    // ©day: creation date (Apple) — ISO 8601 string
    if (atom.type === "\xA9day" || atom.type === "©day") {
      if (dataSize > 4) {
        const text = readString(bytes, dataOffset + 4, dataSize - 4).replace(/\0/g, "").trim();
        if (text.length > 0 && !metadata.creationDate) {
          const date = new Date(text);
          if (!isNaN(date.getTime()) && date.getFullYear() >= 2000) {
            metadata.creationDate = date.toISOString();
          }
        }
      }
    }

    // meta atom sometimes has a 4-byte version/flags before children
    if (atom.type === "meta") {
      // Try with 4-byte version prefix (full box) first
      const innerStart = dataOffset + 4;
      if (innerStart < atomEnd) {
        walkAtoms(view, bytes, innerStart, atomEnd, currentPath, metadata);
      }
    } else if (CONTAINER_ATOMS.has(atom.type)) {
      walkAtoms(view, bytes, dataOffset, atomEnd, currentPath, metadata);
    }

    // Also handle Apple-style keys/ilst metadata
    if (atom.type === "keys") {
      // keys atom parsing would be complex; we rely on ©xyz etc. above
    }

    offset = atomEnd;
  }
}

/** Scan for GPS in 'loci' atom (3GPP location, used by some Android devices) */
function scanForLociAtom(bytes: Uint8Array, view: DataView): { latitude: number; longitude: number } | null {
  for (let i = 0; i < bytes.length - 20; i++) {
    // 'loci' = 0x6C 0x6F 0x63 0x69
    if (bytes[i] === 0x6C && bytes[i + 1] === 0x6F && bytes[i + 2] === 0x63 && bytes[i + 3] === 0x69) {
      // loci atom: version(1) + flags(3) + language(2) + name(null-term) + role(1) + fixed-point coords
      const baseOffset = i + 4; // after 'loci'
      // Skip version + flags
      let pos = baseOffset + 4; // skip version(1) + flags(3)
      // Skip language (2 bytes)
      pos += 2;
      // Skip null-terminated name string
      while (pos < bytes.length && bytes[pos] !== 0) pos++;
      pos++; // skip null terminator
      // Skip role (1 byte)
      pos++;
      // Now read fixed-point 16.16 latitude and longitude
      if (pos + 8 > view.byteLength) continue;
      const latFixed = view.getInt32(pos);
      const lngFixed = view.getInt32(pos + 4);
      const lat = latFixed / 65536.0;
      const lng = lngFixed / 65536.0;
      if (Math.abs(lat) <= 90 && Math.abs(lng) <= 180 && !(lat === 0 && lng === 0)) {
        return { latitude: lat, longitude: lng };
      }
    }
  }
  return null;
}

/** Scan for GPS in XMP metadata embedded as text */
function scanForXMPGPS(bytes: Uint8Array): { latitude: number; longitude: number } | null {
  // Look for XMP GPS tags in raw text
  const chunkSize = Math.min(bytes.length, 512 * 1024);
  const text = new TextDecoder("utf-8", { fatal: false }).decode(bytes.slice(0, chunkSize));

  // Match exif:GPSLatitude="DD,MM.MMMN" patterns
  const latMatch = text.match(/GPSLatitude[>"=]+(\d+),(\d+\.?\d*)[NSEW]?/i);
  const lngMatch = text.match(/GPSLongitude[>"=]+(\d+),(\d+\.?\d*)[NSEW]?/i);

  if (latMatch && lngMatch) {
    let lat = parseInt(latMatch[1]) + parseFloat(latMatch[2]) / 60;
    let lng = parseInt(lngMatch[1]) + parseFloat(lngMatch[2]) / 60;

    // Check for S/W indicators
    if (/[Ss]/.test(text.substring(text.indexOf(latMatch[0]), text.indexOf(latMatch[0]) + latMatch[0].length + 5))) {
      lat = -lat;
    }
    if (/[Ww]/.test(text.substring(text.indexOf(lngMatch[0]), text.indexOf(lngMatch[0]) + lngMatch[0].length + 5))) {
      lng = -lng;
    }

    if (Math.abs(lat) <= 90 && Math.abs(lng) <= 180 && !(lat === 0 && lng === 0)) {
      return { latitude: lat, longitude: lng };
    }
  }

  return null;
}

function extractMetadataFromBuffer(buffer: ArrayBuffer): VideoMetadata {
  const bytes = new Uint8Array(buffer);
  const view = new DataView(buffer);

  const metadata: VideoMetadata = {
    latitude: null,
    longitude: null,
    altitude: null,
    creationDate: null,
    duration: null,
    cameraMake: null,
    cameraModel: null,
  };

  // Walk the MP4 atom tree
  walkAtoms(view, bytes, 0, bytes.byteLength, "", metadata);

  // If no GPS found via atom tree, try fallback strategies
  if (metadata.latitude === null || metadata.longitude === null) {
    const loci = scanForLociAtom(bytes, view);
    if (loci) {
      metadata.latitude = loci.latitude;
      metadata.longitude = loci.longitude;
    }
  }

  if (metadata.latitude === null || metadata.longitude === null) {
    const xmpGps = scanForXMPGPS(bytes);
    if (xmpGps) {
      metadata.latitude = xmpGps.latitude;
      metadata.longitude = xmpGps.longitude;
    }
  }

  return metadata;
}

/**
 * For tail chunks that don't start at atom boundaries, scan for known
 * atom signatures and try to parse metadata starting from each match.
 */
function extractMetadataFromTailChunk(buffer: ArrayBuffer): VideoMetadata {
  const bytes = new Uint8Array(buffer);
  const view = new DataView(buffer);

  const metadata: VideoMetadata = {
    latitude: null,
    longitude: null,
    altitude: null,
    creationDate: null,
    duration: null,
    cameraMake: null,
    cameraModel: null,
  };

  // First try normal atom walk (works if chunk happens to start at atom boundary)
  walkAtoms(view, bytes, 0, bytes.byteLength, "", metadata);

  // Scan for 'moov' atom signature anywhere in the buffer
  const MOOV = [0x6D, 0x6F, 0x6F, 0x76]; // moov
  for (let i = 4; i < bytes.length - 8; i++) {
    if (bytes[i] === MOOV[0] && bytes[i+1] === MOOV[1] && bytes[i+2] === MOOV[2] && bytes[i+3] === MOOV[3]) {
      // Atom header starts 4 bytes before the type
      const atomStart = i - 4;
      if (atomStart < 0) continue;
      const atom = readAtomHeader(view, atomStart);
      if (!atom || atom.size < 16) continue;
      const atomEnd = Math.min(atomStart + atom.size, bytes.byteLength);
      // Walk children of moov
      walkAtoms(view, bytes, atomStart + atom.headerSize, atomEnd, "moov", metadata);
      break;
    }
  }

  // Scan for mvhd if we still need date/duration
  if (metadata.creationDate === null || metadata.duration === null) {
    const MVHD = [0x6D, 0x76, 0x68, 0x64]; // mvhd
    for (let i = 4; i < bytes.length - 20; i++) {
      if (bytes[i] === MVHD[0] && bytes[i+1] === MVHD[1] && bytes[i+2] === MVHD[2] && bytes[i+3] === MVHD[3]) {
        const atomStart = i - 4;
        if (atomStart < 0) continue;
        const atom = readAtomHeader(view, atomStart);
        if (!atom || atom.size < 12) continue;
        const dataOffset = atomStart + atom.headerSize;
        const dataSize = Math.min(atomStart + atom.size, bytes.byteLength) - dataOffset;
        const mvhd = parseMvhd(view, dataOffset, dataSize);
        if (mvhd.creationDate && !metadata.creationDate) metadata.creationDate = mvhd.creationDate;
        if (mvhd.duration !== null && metadata.duration === null) metadata.duration = mvhd.duration;
        break;
      }
    }
  }

  // Scan for ©xyz GPS
  if (metadata.latitude === null || metadata.longitude === null) {
    for (let i = 0; i < bytes.length - 16; i++) {
      if (bytes[i] === 0xA9 && bytes[i+1] === 0x78 && bytes[i+2] === 0x79 && bytes[i+3] === 0x7A) {
        // Read atom size from 4 bytes before if possible
        const atomStart = i - 4;
        if (atomStart >= 0) {
          const atomSize = view.getUint32(atomStart);
          const dataSize = Math.min(atomSize - 8, bytes.byteLength - i - 4);
          if (dataSize > 0 && dataSize < 256) {
            const gps = parseXyzAtom(bytes, i + 4, dataSize);
            if (gps) {
              metadata.latitude = gps.latitude;
              metadata.longitude = gps.longitude;
              if (gps.altitude !== undefined) metadata.altitude = gps.altitude;
              break;
            }
          }
        }
        // Also try just reading text after the signature
        const text = readString(bytes, i + 4, Math.min(64, bytes.byteLength - i - 4));
        const gps = parseISO6709(text);
        if (gps) {
          metadata.latitude = gps.latitude;
          metadata.longitude = gps.longitude;
          if (gps.altitude !== undefined) metadata.altitude = gps.altitude;
          break;
        }
      }
    }
  }

  // Also try loci and XMP fallbacks
  if (metadata.latitude === null || metadata.longitude === null) {
    const loci = scanForLociAtom(bytes, view);
    if (loci) {
      metadata.latitude = loci.latitude;
      metadata.longitude = loci.longitude;
    }
  }

  if (metadata.latitude === null || metadata.longitude === null) {
    const xmpGps = scanForXMPGPS(bytes);
    if (xmpGps) {
      metadata.latitude = xmpGps.latitude;
      metadata.longitude = xmpGps.longitude;
    }
  }

  return metadata;
}

function createEmptyMetadata(): VideoMetadata {
  return {
    latitude: null,
    longitude: null,
    altitude: null,
    creationDate: null,
    duration: null,
    cameraMake: null,
    cameraModel: null,
  };
}

function mergeMetadata(target: VideoMetadata, source: VideoMetadata): VideoMetadata {
  if (target.latitude === null && source.latitude !== null) target.latitude = source.latitude;
  if (target.longitude === null && source.longitude !== null) target.longitude = source.longitude;
  if (target.altitude === null && source.altitude !== null) target.altitude = source.altitude;
  if (target.creationDate === null && source.creationDate !== null) target.creationDate = source.creationDate;
  if (target.duration === null && source.duration !== null) target.duration = source.duration;
  if (target.cameraMake === null && source.cameraMake !== null) target.cameraMake = source.cameraMake;
  if (target.cameraModel === null && source.cameraModel !== null) target.cameraModel = source.cameraModel;
  return target;
}

function decodeBase64Chunk(raw: string): ArrayBuffer {
  const binaryString = atob(raw.includes(",") ? raw.split(",")[1] : raw);
  const bytes = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes.buffer;
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  try {
    const contentType = req.headers.get("content-type") || "";

    // Accept either JSON with base64 data or raw binary
    let buffers: ArrayBuffer[];

    if (contentType.includes("application/json")) {
      const body = await req.json();

      if (Array.isArray(body?.videoPartsBase64) && body.videoPartsBase64.length > 0) {
        buffers = body.videoPartsBase64
          .filter((part: unknown): part is string => typeof part === "string" && part.length > 0)
          .slice(0, 4)
          .map(decodeBase64Chunk);
      } else if (typeof body?.videoBase64 === "string") {
        buffers = [decodeBase64Chunk(body.videoBase64)];
      } else {
        return jsonResponse({ error: "Missing videoBase64 or videoPartsBase64 field" }, 400);
      }
    } else {
      // Raw binary body
      buffers = [await req.arrayBuffer()];
    }

    const validBuffers = buffers.filter((buffer) => buffer.byteLength >= 8);
    if (validBuffers.length === 0) {
      return jsonResponse({ error: "File too small to be a valid video" }, 400);
    }

    const metadata = createEmptyMetadata();
    for (let i = 0; i < validBuffers.length; i++) {
      // First buffer is the head chunk (starts at atom boundary)
      // Subsequent buffers are tail chunks (may not start at atom boundary)
      const extracted = i === 0
        ? extractMetadataFromBuffer(validBuffers[i])
        : extractMetadataFromTailChunk(validBuffers[i]);
      mergeMetadata(metadata, extracted);
    }

    return jsonResponse(metadata);
  } catch (error) {
    console.error("extract-video-metadata error:", error);
    return jsonResponse({ error: error instanceof Error ? error.message : "Unknown error" }, 500);
  }
});
