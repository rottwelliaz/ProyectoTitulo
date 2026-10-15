import sharp from 'sharp';

export const MAX_PHOTO_BYTES = 4 * 1024 * 1024;
const MAX_PIXELS = 16_777_216;
let processing = 0;
const crcTable = Uint32Array.from({ length: 256 }, (_, byte) => {
  for (let bit = 0; bit < 8; bit++) byte = (byte & 1) ? 0xedb88320 ^ (byte >>> 1) : byte >>> 1;
  return byte >>> 0;
});
const pngCrc = (bytes: Buffer, start: number, end: number) => {
  let crc = 0xffffffff;
  for (let index = start; index < end; index++) crc = crcTable[(crc ^ bytes[index]) & 255] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
};

export class ProfilePhotoError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

export async function normalizeProfilePhoto(value: unknown): Promise<string> {
  const invalid = () => new ProfilePhotoError(400, 'La fotografía debe contener una imagen PNG, JPEG o WebP estática válida');
  if (typeof value !== 'string') throw invalid();
  if (value.length > Math.ceil(MAX_PHOTO_BYTES / 3) * 4 + 32) throw new ProfilePhotoError(413, 'La fotografía no puede superar 4 MB');
  const match = /^data:image\/(png|jpeg|jpg|webp);base64,([A-Za-z0-9+/]+={0,2})$/.exec(value);
  if (!match || match[2].length % 4 !== 0) throw invalid();
  const bytes = Buffer.from(match[2], 'base64');
  if (!bytes.length || bytes.toString('base64') !== match[2]) throw invalid();
  if (bytes.length > MAX_PHOTO_BYTES) throw new ProfilePhotoError(413, 'La fotografía no puede superar 4 MB');
  const format = match[1] === 'jpg' ? 'jpeg' : match[1];
  // Restrict decoders before parsing metadata; a MIME label alone is not evidence.
  const signatureMatches = format === 'png'
    ? bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) && bytes.subarray(-12).equals(Buffer.from('0000000049454e44ae426082', 'hex'))
    : format === 'jpeg'
      ? bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255 && bytes.subarray(-2).equals(Buffer.from([255, 217]))
      : bytes.length >= 12 && bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP' && bytes.readUInt32LE(4) + 8 === bytes.length;
  if (!signatureMatches) throw invalid();
  if (format === 'png') {
    for (let offset = 8; offset < bytes.length;) {
      if (offset + 12 > bytes.length) throw invalid();
      const size = bytes.readUInt32BE(offset);
      if (offset + 12 + size > bytes.length || bytes.toString('ascii', offset + 4, offset + 8) === 'acTL') throw invalid();
      // Some decoders ignore CRC errors in ancillary chunks; reject them too.
      if (pngCrc(bytes, offset + 4, offset + 8 + size) !== bytes.readUInt32BE(offset + 8 + size)) throw invalid();
      offset += 12 + size;
    }
  }
  if (processing >= 2) throw new ProfilePhotoError(503, 'Hay otras fotografías en proceso. Inténtalo nuevamente.');
  processing++;
  try {
    const image = sharp(bytes, { failOn: 'warning', limitInputPixels: MAX_PIXELS });
    const metadata = await image.metadata();
    if (metadata.format !== format || (metadata.pages ?? 1) !== 1) throw invalid();
    if (!metadata.width || !metadata.height || metadata.width > 8192 || metadata.height > 8192) {
      throw new ProfilePhotoError(413, 'Las dimensiones de la fotografía son demasiado grandes');
    }
    // A full decode + re-encode removes metadata and non-image payloads. Existing
    // database images are not rewritten; only a successful new upload is replaced.
    const output = await image.rotate().toFormat(format as 'png' | 'jpeg' | 'webp').timeout({ seconds: 5 }).toBuffer();
    if (output.length > MAX_PHOTO_BYTES) throw new ProfilePhotoError(413, 'La fotografía procesada supera 4 MB');
    return `data:image/${format};base64,${output.toString('base64')}`;
  } catch (error) {
    if (error instanceof ProfilePhotoError) throw error;
    throw invalid();
  } finally { processing--; }
}
