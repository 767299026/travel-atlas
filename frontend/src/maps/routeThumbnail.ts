import type { RouteGeometry } from '../../../packages/contracts/src/index.js';
/** Local schematic only: preserve gaps and never request a thumbnail tile. */
export function routeThumbnail(geometry: RouteGeometry): string[] {
  const parts = geometry.parts.map(part => part.map(([lng, lat]) => [lng * Math.PI / 180, Math.log(Math.tan(Math.PI / 4 + Math.max(-85, Math.min(85, lat)) * Math.PI / 360))] as const));
  const points = parts.flat(); if (!points.length) return [];
  const xs = points.map(p => p[0]), ys = points.map(p => p[1]), minX = Math.min(...xs), minY = Math.min(...ys), width = Math.max(...xs) - minX, height = Math.max(...ys) - minY;
  const scale = Math.min(200 / (width || 1e-8), 64 / (height || 1e-8));
  const ox = (240 - width * scale) / 2, oy = (100 - height * scale) / 2;
  return parts.filter(p => p.length >= 2).map(part => part.map((p, i) => (i ? 'L' : 'M') + ' ' + (ox + (p[0] - minX) * scale).toFixed(2) + ' ' + (100 - oy - (p[1] - minY) * scale).toFixed(2)).join(' '));
}
