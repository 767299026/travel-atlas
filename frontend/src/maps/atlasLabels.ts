import polylabel from 'polylabel';
import type { Map as LeafletMap } from 'leaflet';
import type { AtlasGeometry } from '../../../packages/contracts/src/index.js';

const anchors = new WeakMap<AtlasGeometry, [number, number] | null>();
type Ring = number[][];
/** A reference label's interior point, independent of camera zoom; never a recorded visit. */
export function atlasLabelPoint(feature: AtlasGeometry, map: LeafletMap): [number, number] | null {
  if (anchors.has(feature)) return anchors.get(feature)!;
  const geometry = feature.geometry;
  const polygons = geometry.type === 'Polygon' ? [geometry.coordinates as Ring[]] : geometry.type === 'MultiPolygon' ? geometry.coordinates as Ring[][] : [];
  let largest: [number, number][][] | undefined, largestArea = 0;
  for (const rings of polygons) {
    const projected = rings.map(ring => ring.map(([lng, lat]) => { const p = map.project([lat!, lng!], 8); return [p.x, p.y] as [number, number]; }));
    const outer = projected[0]; if (!outer || outer.length < 3) continue;
    let area = 0;
    for (let i = 0, j = outer.length - 1; i < outer.length; j = i++) area += outer[j]![0]! * outer[i]![1]! - outer[i]![0]! * outer[j]![1]!;
    // Prefer the mainland component over a disconnected island. Holes remain in the polygon.
    if (Math.abs(area) > largestArea) { largestArea = Math.abs(area); largest = projected; }
  }
  let anchor: [number, number] | null = null;
  if (largest) {
    const p = polylabel(largest, .5), location = map.unproject([p[0]!, p[1]!], 8);
    if (p.distance > 0 && Number.isFinite(location.lng) && Number.isFinite(location.lat)) anchor = [location.lng, location.lat];
  }
  anchors.set(feature, anchor); return anchor;
}
