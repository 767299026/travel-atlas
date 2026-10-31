export type AdminResource = 'journeys' | 'photos' | 'visits' | 'diaries' | 'shares';
export interface AdminEntry {
  id: string; title: string; subtitle: string; ownerId: string; ownerName: string;
  resource?: AdminResource; editPath?: string;
  photo?: { thumbUrl: string; baseVersion: number; takenOn: string | null };
  status: string; updatedAt: string; details: { label: string; value: string }[];
}
export interface AdminPage { items: AdminEntry[]; total: number; page: number; pageSize: number }
export interface AdminDashboard {
  journeys: number; photos: number; visits: number; places: number; diaries: number; users: number;
  activeUsers: number; activeShares: number; mediaBytes: number;
  attention: { unlocatedPhotos: number; undatedPhotos: number; unassignedVisits: number; failedJobs: number };
  recent: AdminEntry[]; checkedAt: string;
}
export interface AdminService {
  id: string; name: string; state: 'ready' | 'configured' | 'unconfigured' | 'planned';
  label: string; description: string;
}
export interface AdminAuditPage {
  items: { id: string; action: string; actorName: string; targetName: string; targetId: string; createdAt: string }[];
  total: number; page: number; pageSize: number;
}
export const adminFilters: Record<AdminResource, { value: string; label: string }[]> = {
  journeys: [{ value: 'planning', label: '计划中' }, { value: 'completed', label: '已完成' }, { value: 'archived', label: '已归档' }],
  photos: [{ value: 'needs_location', label: '待补精确位置' }, { value: 'needs_date', label: '待补日期' }, { value: 'located', label: '已定位' }, { value: 'place_only', label: '只有地点名称' }, { value: 'unfiled', label: '待收录上传' }, { value: 'hidden', label: '已隐藏' }],
  visits: [{ value: 'unassigned', label: '待补城市' }, { value: 'assigned', label: '已归属' }],
  diaries: [{ value: 'draft', label: '草稿' }, { value: 'written', label: '已记录' }], shares: [],
};
export interface AdminPhotoDetail {
  mediaId: string; ownerId: string; ownerName: string; filename: string; baseVersion: number;
  takenOn: string | null; place: import('./photos.js').PhotoPlace | null; note: string; hidden: boolean;
  capture: import('./photos.js').PhotoCapture | null; width: number; height: number; previewUrl: string;
  source: 'photo' | 'diary' | 'upload';
  diary: { id: string; title: string; journeyId: string | null; stopLabel: string | null } | null;
}
