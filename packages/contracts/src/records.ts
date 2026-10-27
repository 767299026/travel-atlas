import type { AtlasPlace } from './atlas.js';
export interface ActualCopyInput { planVersion: number; actualVersion: number | null; dayIds: string[]; mode: 'append' | 'replace' }
export interface ActualCopyPreview { planVersion: number; actualVersion: number | null; addedDays: number; addedStops: number; replacedDays: number; preservedVisits: number; preservedDiaries: number }
export interface Visit { place?: AtlasPlace | null; version?: number; id: string; journeyId: string; routeId: string; stopId: string; label: string; region: string; visitedOn: string; note: string; createdAt: string; detached: boolean }
export interface DiaryAssociationInput { journeyId: string; routeId: string | null; dayId: string | null; stopId: string | null }
export interface DiaryAssociation extends DiaryAssociationInput { journeyTitle: string; dayTitle: string | null; stopLabel: string | null; detached?: boolean }
export interface MediaItem { id: string; filename: string; width: number; height: number; originalBytes: number; storedBytes: number; createdAt: string; previewUrl: string; thumbnailUrl: string; originalUrl: string; capture?: import('./photos.js').PhotoCapture | null }
export interface DiaryPhoto { mediaId: string; caption: string; media?: MediaItem }
export interface DiaryInput { title: string; occurredOn: string | null; body: string; status: 'draft' | 'written'; association: DiaryAssociationInput | null; photos: DiaryPhoto[] }
export interface Diary extends Omit<DiaryInput, 'association'> { id: string; association: DiaryAssociation | null; version: number; createdAt: string; updatedAt: string; visibility: 'private' }
export interface DiaryList { items: Diary[]; nextCursor: string | null }
export interface AccountSummary { journeys: number; diaries: number; visits: number; mediaBytes: number; mediaQuotaBytes: number }
export interface AdminUser { id: string; username: string; displayName: string; role: string; active: boolean; version: number; createdAt: string }
export interface AdminOverview { users: number; journeys: number; diaries: number; visits: number; mediaBytes: number }
