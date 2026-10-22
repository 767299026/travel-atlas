import type { Position, RouteGeometry } from './maps.js';
export const routingAttribution = '© OpenStreetMap contributors · ODbL 1.0 · https://www.openstreetmap.org/copyright · https://opendatacommons.org/licenses/odbl/1-0/';
export const routingLimits = { straightDistanceM: 50000, minimumDistanceM: 10, candidateLengthM: 200000, jobsPerDay: 20, retainedJobs: 200, expiryHours: 24, responseBytes: 2097152, timeoutMs: 35000 } as const;
export interface RoutingInput {
  fromStopId: string; toStopId: string; from: Position; to: Position; mode: 'hike'; profile: 'hiking-mountain';
  engineVersion: string; profileSha256: string; dataVersion: string; expectedGeometryRef: string | null;
}
export interface RoutingInfo {
  provider: 'brouter_local'; engineVersion: string; profile: string; profileSha256: string; dataVersion: string;
  attribution: string; fromOffsetM: number; toOffsetM: number;
  providerDistanceM: number | null; estimatedTimeS: number | null; candidateId: string;
}
export type RoutingStatus = 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled' | 'obsolete';
export interface RoutingJob {
  id: string; routeId: string; segmentId: string; status: RoutingStatus; createdAt: string; startedAt: string | null; finishedAt: string | null; expiresAt: string;
  candidateId: string | null; failure: { code: string; message: string } | null;
}
export interface RoutingCandidate {
  id: string; jobId: string; routeId: string; segmentId: string; geometry: RouteGeometry; input: RoutingInput;
  info: RoutingInfo; lengthM: number; diagnostics: string[]; createdAt: string; expiresAt: string; adoptedAssetId: string | null;
  obsolete: boolean; adoptable: boolean;
}
export interface RoutingCapabilities {
  enabled: boolean; engineVersion: string | null; tiles: string[]; modes: ['hike']; profile: 'hiking-mountain'; attribution: string; limits: typeof routingLimits;
}
