import type { TravelMode } from './index.js';
export const shareLimits = { diaries: 20, photos: 100, snapshotBytes: 1048576, active: 20, retained: 200, perDay: 20 } as const;
export interface ShareOptions { title: string; layer: 'plan' | 'actual'; includeDates: boolean; includeNotes: boolean; diaryIds: string[]; includePhotos: boolean; expiresInDays: 1 | 7 | 30 }
export interface SharePhoto { key: string; caption: string; width: number; height: number }
export interface ShareSnapshot {
  title: string; destinations: string[]; layer: 'plan' | 'actual'; note: string | null;
  days: { title: string; area: string; date: string | null; stayName: string | null; stops: { label: string; region: string; time: string | null; note: string | null; arrival: TravelMode | null }[] }[];
  diaries: { key: string; title: string; occurredOn: string | null; body: string; photos: SharePhoto[] }[];
}
export interface ShareBindings { diaryKey: string; diaryId: string; photos: { key: string; mediaId: string }[] }
export interface SharePreview { snapshot: ShareSnapshot; fingerprint: string; photoCount: number; photoPreviews: { key: string; url: string }[] }
export interface ShareLink { id: string; title: string; layer: 'plan' | 'actual'; state: 'active' | 'expired' | 'revoked'; createdAt: string; expiresAt: string; revokedAt: string | null; path: string | null; diaryCount: number; photoCount: number }
export interface ShareCreate extends ShareOptions { previewFingerprint: string; acknowledge: boolean; clientMutationId: string }
