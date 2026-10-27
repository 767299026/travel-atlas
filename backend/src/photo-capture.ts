import exifr from 'exifr';
import { isDate, validPosition, type PhotoCapture } from '../../packages/contracts/src/index.js';
/** Metadata is a suggestion, never an automatic confirmed visit or camera location. */
export async function readPhotoCapture(buffer: Buffer): Promise<PhotoCapture> {
  const result: PhotoCapture = { takenOn: null, position: null };
  const [date, gps] = await Promise.allSettled([
    exifr.parse(buffer, { pick: ['DateTimeOriginal'], reviveValues: false }), exifr.gps(buffer),
  ]);
  if (date.status === 'fulfilled') {
    const raw = date.value?.DateTimeOriginal;
    if (typeof raw === 'string' && /^\d{4}:\d{2}:\d{2}/.test(raw)) { const value = raw.slice(0, 10).replaceAll(':', '-'); if (isDate(value)) result.takenOn = value; }
  }
  if (gps.status === 'fulfilled' && gps.value && validPosition([gps.value.longitude, gps.value.latitude])) result.position = { longitude: gps.value.longitude, latitude: gps.value.latitude, crs: 'WGS84' };
  return result;
}
