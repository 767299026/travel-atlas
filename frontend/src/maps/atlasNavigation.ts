import type { AtlasGeometry } from '../../../packages/contracts/src/index.js';

/** EPSG:3857 camera values belong to the reference atlas only; never use them as recorded GPS positions. */
export interface AtlasCamera { scope: string; center: [number, number]; zoom: number }

// Keep navigation thresholds in one place; zoom levels are specific to the projection.
export const atlasZoomLevels = {
  enterChina: 4.25, enterProvince: 6, enterCity: 8,
  leaveChina: 2.25, leaveProvince: 5,
  returnChina: 5.25, returnProvince: 6.5,
} as const;

export const atlasPalette = {
  water: '#DEE8E5', land: '#E8E5DA', visited: '#A7BBA7', border: '#FAF8F1',
  label: '#506158', surface: '#F7F6F2',
};

type Ring = number[][];
function insideRing(point: [number, number], ring: Ring): boolean {
  const [x, y] = point; let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i]!, b = ring[j]!;
    if ((a[1]! > y) !== (b[1]! > y) && x < (b[0]! - a[0]!) * (y - a[1]!) / (b[1]! - a[1]!) + a[0]!) inside = !inside;
  }
  return inside;
}
export function containsAtlasPoint(feature: AtlasGeometry, point: [number, number]): boolean {
  const geometry = feature.geometry;
  const polygons = geometry.type === 'Polygon' ? [geometry.coordinates as Ring[]] : geometry.type === 'MultiPolygon' ? geometry.coordinates as Ring[][] : [];
  return polygons.some(rings => rings[0] && insideRing(point, rings[0]) && !rings.slice(1).some(hole => insideRing(point, hole)));
}
