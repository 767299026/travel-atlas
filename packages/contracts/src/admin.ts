export type AdminResource = 'journeys' | 'photos' | 'visits' | 'diaries' | 'shares';
export interface AdminEntry {
  id: string; title: string; subtitle: string; ownerId: string; ownerName: string;
  status: string; updatedAt: string; details: { label: string; value: string }[];
}
export interface AdminPage { items: AdminEntry[]; total: number; page: number; pageSize: number }
export interface AdminDashboard {
  journeys: number; photos: number; visits: number; places: number; diaries: number; users: number;
  activeUsers: number; activeShares: number; mediaBytes: number;
  attention: { unlocatedPhotos: number; unassignedVisits: number; failedJobs: number };
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
