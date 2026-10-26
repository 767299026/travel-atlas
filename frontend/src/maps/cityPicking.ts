export interface ScreenPoint { id: string; x: number; y: number }
export interface ScreenCluster<T extends ScreenPoint> { anchor: T; members: T[] }

/** Fixed representative anchors prevent transitive chains and marker drift while panning. */
export function clusterScreenPoints<T extends ScreenPoint>(points: T[], radius = 52): ScreenCluster<T>[] {
  if (!Number.isFinite(radius) || radius <= 0) throw new Error('Invalid cluster radius');
  const groups: ScreenCluster<T>[] = [], cells = new Map<string, number[]>();
  for (const point of [...points].sort((a, b) => a.id.localeCompare(b.id))) {
    if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) continue;
    const cx = Math.floor(point.x / radius), cy = Math.floor(point.y / radius);
    let best = -1, distance = radius;
    for (let x = cx - 1; x <= cx + 1; x++) for (let y = cy - 1; y <= cy + 1; y++) for (const index of cells.get(x + ':' + y) ?? []) {
      const anchor = groups[index]!.anchor, next = Math.hypot(point.x - anchor.x, point.y - anchor.y);
      if (next < distance || next === distance && (best < 0 || anchor.id.localeCompare(groups[best]!.anchor.id) < 0)) { distance = next; best = index; }
    }
    if (best >= 0) groups[best]!.members.push(point);
    else {
      const key = cx + ':' + cy, indices = cells.get(key) ?? [];
      indices.push(groups.length); cells.set(key, indices); groups.push({ anchor: point, members: [point] });
    }
  }
  return groups;
}

export function projectWorld(position: readonly number[], zoom: number): [number, number] {
  const scale = 256 * 2 ** zoom, lat = Math.max(-85, Math.min(85, position[1]!)) * Math.PI / 180;
  return [(position[0]! + 180) / 360 * scale, (.5 - Math.log(Math.tan(Math.PI / 4 + lat / 2)) / (2 * Math.PI)) * scale];
}

export interface ScreenRoute { journeyId: string; parts: [number, number][][] }
/** Only existing adjacent vertices form a segment. Never bridge a missing part. */
export function hitJourneys(routes: ScreenRoute[], point: [number, number], tolerance = 14): string[] {
  const hits = new Map<string, number>();
  for (const route of routes) for (const part of route.parts) for (let i = 1; i < part.length; i++) {
    const a = part[i - 1]!, b = part[i]!, [x, y] = point;
    if (x < Math.min(a[0], b[0]) - tolerance || x > Math.max(a[0], b[0]) + tolerance || y < Math.min(a[1], b[1]) - tolerance || y > Math.max(a[1], b[1]) + tolerance) continue;
    const dx = b[0] - a[0], dy = b[1] - a[1], t = Math.max(0, Math.min(1, ((x - a[0]) * dx + (y - a[1]) * dy) / (dx * dx + dy * dy || 1)));
    const distance = Math.hypot(x - a[0] - t * dx, y - a[1] - t * dy);
    if (distance <= tolerance) hits.set(route.journeyId, Math.min(hits.get(route.journeyId) ?? Infinity, distance));
  }
  return [...hits].sort((a, b) => a[1] - b[1] || a[0].localeCompare(b[0])).map(([id]) => id);
}
