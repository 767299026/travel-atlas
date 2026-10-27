import type { Location, MediaItem, AtlasPlace } from './index.js';
export interface PhotoCapture { takenOn: string | null; position: Location | null }
export interface PhotoPlace { label: string; cityName: string; cityCode?: string; position: Location | null; source: 'manual' | 'exif' | 'map' | 'diary' }
export interface PhotoInput { mediaId: string; baseVersion: number; takenOn: string | null; place: PhotoPlace | null; note: string }
export interface PhotoMemory extends PhotoInput { media: MediaItem; diaryId: string | null; suggestion: PhotoPlace | null; city: AtlasPlace | null }
export interface PhotoGroupNote { key: string; note: string; version: number }
export interface PhotoLibrary { items: PhotoMemory[]; groupNotes: PhotoGroupNote[]; uploadMaxBytes?: number }
export interface PhotoSave { items: PhotoInput[]; groupNote?: PhotoGroupNote; clientMutationId: string }
const clean = (text: string) => text.normalize('NFKC').trim().replace(/\s+/g, ' ').toLowerCase();
export const photoPlaceKey = (place: PhotoPlace | null) => place ? JSON.stringify([clean(place.cityName), clean(place.label)]) : 'unplaced';
export const photoGroupKey = (photo: Pick<PhotoInput, 'takenOn' | 'place'>) => JSON.stringify([photo.takenOn?.slice(0, 7) || 'undated', photoPlaceKey(photo.place)]);
