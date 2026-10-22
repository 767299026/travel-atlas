import { DomainError, type Location } from './index.js';
import type { RoutingInfo } from './routing.js';
export type Position = [number, number];
export const geometrySourceLabels = { manual: '手工补绘', imported_reference: '导入参考', routing: '路网规划' } as const;
export interface RouteGeometry { crs: 'WGS84' | 'GCJ02'; parts: Position[][] }
export interface PointSample { elevation: number | null; time: string | null }
export interface GeometryAsset {
  id: string; routeId: string; sourceKind: 'manual' | 'imported_reference' | 'routing'; sourceNote: string;
  geometry: RouteGeometry; samples: PointSample[][] | null; pointCount: number; lengthM: number;
  exportPolicy: 'allowed' | 'unverified'; filename: string | null; createdAt: string;
  diagnostics: string[];
  routingInfo?: RoutingInfo | null;
}
export type GeometrySummary = Omit<GeometryAsset, 'geometry' | 'samples'> & { crs: RouteGeometry['crs']; partCount: number };
export interface GpxPreview { geometry: RouteGeometry; samples: PointSample[][]; pointCount: number; lengthM: number; warnings: string[] }
export type GeometrySaveInput = { baseVersion: number; clientMutationId: string; expectedGeometryRef: string | null; sourceNote: string } & (
  { kind: 'manual'; geometry: RouteGeometry } |
  { kind: 'gpx'; xml: string; filename: string; rightsConfirmed: boolean }
);
export interface ExportReport { routeVersion: number; total: number; included: number; missing: number; gaps: number; blockers: string[]; partial: boolean }
export const geometryLimits = { points: 10000, parts: 100, gpxBytes: 1048576, ownerPoints: 200000, ownerAssets: 500, ownerSourceBytes: 20971520 } as const;
export function validPosition(p: unknown): p is Position { return Array.isArray(p) && p.length === 2 && p.every(Number.isFinite) && Math.abs(p[0]!) <= 180 && Math.abs(p[1]!) <= 90; }
export function validateGeometry(g: RouteGeometry) {
  if (!g || !['WGS84', 'GCJ02'].includes(g.crs) || !Array.isArray(g.parts) || !g.parts.length || g.parts.length > geometryLimits.parts) throw new DomainError('INVALID_GEOMETRY', '请保留 1–100 个独立路径分段，并注明坐标系。');
  let count = 0;
  for (const part of g.parts) { if (!Array.isArray(part) || part.length < 2 || !part.every(validPosition)) throw new DomainError('INVALID_GEOMETRY', '每段至少需要两个有效经纬度点，不能合并缺口。'); count += part.length; }
  if (count > geometryLimits.points) throw new DomainError('LIMIT_EXCEEDED', '单条几何最多 10000 个点，请先分割或简化文件。');
  return count;
}
export function distanceM(a: Position, b: Position) {
  const rad = Math.PI / 180, dlat = (b[1] - a[1]) * rad, dlon = (b[0] - a[0]) * rad;
  const n = Math.sin(dlat / 2) ** 2 + Math.cos(a[1] * rad) * Math.cos(b[1] * rad) * Math.sin(dlon / 2) ** 2;
  return 6371008.8 * 2 * Math.atan2(Math.sqrt(Math.min(1, n)), Math.sqrt(Math.max(0, 1 - n)));
}
export function geometryLength(g: RouteGeometry) { return g.parts.reduce((total, p) => total + p.slice(1).reduce((n, point, i) => n + distanceM(p[i]!, point), 0), 0); }
export function endpointDiagnostics(g: RouteGeometry, from: Location | null, to: Location | null) {
  const warnings: string[] = [];
  if (g.parts.length > 1) warnings.push(`包含 ${g.parts.length} 个独立分段，缺口未连线、未计程。`);
  for (const [label, location, actual] of [['起点', from, g.parts[0]![0]!], ['终点', to, g.parts.at(-1)!.at(-1)!]] as const) {
    if (!location) warnings.push(`${label}地点尚未定位，未核对贴合。`);
    else if (location.crs !== g.crs) warnings.push(`${label}坐标系不同，未进行跨坐标端点比较。`);
    else { const distance = distanceM([location.longitude, location.latitude], actual); if (distance > 150) warnings.push(`${label}与地点相距约 ${Math.round(distance)} 米，请核对。`); }
  }
  return warnings;
}
