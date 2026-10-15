import sharp from 'sharp';
import { ScheduleError } from './schedule';

const MAX_BYTES = 4 * 1024 * 1024;
const MAX_PIXELS = 16_777_216;
const DATA_URL = /^data:(image\/(?:png|jpeg|jpg|webp)|application\/pdf);base64,([A-Za-z0-9+/]+={0,2})$/;

export async function normalizePaymentProof(value: string): Promise<string> {
  const invalid = () => new ScheduleError(400, 'El comprobante debe ser una imagen o PDF válido');
  if (value.length > Math.ceil(MAX_BYTES / 3) * 4 + 40) throw new ScheduleError(400, 'El comprobante no puede superar 4 MB');
  const match = DATA_URL.exec(value);
  if (!match || match[2].length % 4 !== 0) throw invalid();
  const bytes = Buffer.from(match[2], 'base64');
  if (!bytes.length || bytes.length > MAX_BYTES || bytes.toString('base64') !== match[2]) throw invalid();

  const type = match[1] === 'image/jpg' ? 'image/jpeg' : match[1];
  if (type === 'application/pdf') {
    // Check the PDF envelope. Embedded features still depend on the viewer's sandbox.
    if (!bytes.subarray(0, 5).equals(Buffer.from('%PDF-')) || !/%%EOF\s*$/.test(bytes.toString('latin1'))) throw invalid();
    return `data:${type};base64,${match[2]}`;
  }

  try {
    const format = type.slice('image/'.length) as 'png' | 'jpeg' | 'webp';
    const image = sharp(bytes, { failOn: 'warning', limitInputPixels: MAX_PIXELS });
    const metadata = await image.metadata();
    if (metadata.format !== format || (metadata.pages ?? 1) !== 1 || !metadata.width || !metadata.height) throw invalid();
    // A full decode and re-encode strips metadata and trailing non-image payload.
    const normalized = await image.rotate().toFormat(format).timeout({ seconds: 5 }).toBuffer();
    if (normalized.length > MAX_BYTES) throw invalid();
    return `data:${type};base64,${normalized.toString('base64')}`;
  } catch {
    throw invalid();
  }
}
