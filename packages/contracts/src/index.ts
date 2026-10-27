export const travelModes = ['unknown', 'walk', 'hike', 'drive', 'transit', 'rail', 'flight', 'bike', 'boat', 'other'] as const;
export type TravelMode = typeof travelModes[number];
export const modeLabels: Record<TravelMode, string> = {
  unknown: '接驳待定', walk: '步行', hike: '徒步', drive: '自驾', transit: '公共交通',
  rail: '铁路', flight: '飞机', bike: '骑行', boat: '船舶', other: '其他',
};
export interface Location { longitude: number; latitude: number; crs: 'WGS84' | 'GCJ02' | 'BD09'; source?: 'manual_coordinate' | 'amap_pick' | 'gpx_endpoint' | 'outdoor_pick' }
export interface StopInput { label: string; region: string; time: string | null; note: string; role: 'departure' | 'visit' | 'waypoint' | 'transfer' | 'overnight'; location: Location | null }
export interface CopySource { routeId: string; version: number; id?: string }
export interface RouteStop extends StopInput { id: string; copiedFrom?: CopySource | null }
export interface RouteDay { id: string; title: string; area: string; date: string | null; stayName: string; stops: RouteStop[]; copiedFrom?: CopySource | null }
export interface RouteSegment {
  id: string; fromStopId: string; toStopId: string; kind: 'travel' | 'gap'; mode: TravelMode;
  geometryStatus: 'missing' | 'ready' | 'stale'; reviewStatus: 'unreviewed' | 'needs_attention' | 'confirmed';
  geometryRef: string | null; geometryLocked: boolean;
}
export interface RouteSnapshot { id: string; journeyId: string; layer: 'plan' | 'actual'; version: number; note: string; days: RouteDay[]; segments: RouteSegment[]; copiedFrom?: CopySource | null }
export interface JourneySummary {
  coverUrl?: string | null;
  id: string; title: string; destinations: string[]; status: 'planning' | 'completed' | 'archived';
  version: number; timezone: string; createdAt: string; updatedAt: string; planRouteId: string; actualRouteId: string | null; dayCount: number;
}
export interface SessionData { user: { id: string; username: string; displayName: string; role: string }; csrfToken: string }
export interface JourneyCreate { title: string; destinations: string[]; origin: string; startDate: string | null; duration: number; clientMutationId: string }
export type RouteCommand =
  | { type: 'add_day'; clientRef: string; title: string; area: string; date: string | null }
  | { type: 'update_day'; dayId: string; patch: Partial<Pick<RouteDay, 'title' | 'area' | 'date' | 'stayName'>> }
  | { type: 'remove_day'; dayId: string }
  | { type: 'add_stop'; clientRef: string; dayId: string; stop: StopInput; arrivalMode: TravelMode }
  | { type: 'update_stop'; stopId: string; patch: Partial<StopInput> }
  | { type: 'move_stop'; stopId: string; toDayId: string; index: number }
  | { type: 'remove_stop'; stopId: string }
  | { type: 'set_arrival'; stopId: string; mode: TravelMode }
  | { type: 'review_segment'; segmentId: string; geometryRef: string }
  | { type: 'clear_segment_geometry'; segmentId: string; geometryRef: string }
  | { type: 'set_segment_lock'; segmentId: string; locked: boolean }
  | { type: 'set_route_note'; note: string };
export interface CommandRequest { baseVersion: number; clientMutationId: string; operations: RouteCommand[] }
export interface CommandResult { route: RouteSnapshot; idMap: Record<string, string>; invalidatedSegmentIds: string[] }
export interface JourneyList { items: JourneySummary[]; nextCursor: string | null }
export * from './records.js';
export * from './maps.js';
export * from './routing.js';

export class DomainError extends Error {
  constructor(public code: string, message: string, public statusCode = 422) { super(message); }
}
export const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
export const parseDestinations = (text: string): string[] => [...new Set(text.split(/[、,，\n]/).map(s => s.trim()).filter(Boolean))];
// Adapted from the prototype's nextDate(): UTC calendar arithmetic avoids a browser timezone shift.
export function nextDate(date: string | null, offset: number): string | null {
  if (!date) return null;
  const d = new Date(`${date}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + offset);
  return Number.isFinite(d.getTime()) ? d.toISOString().slice(0, 10) : null;
}
export function isDate(value: string | null): boolean {
  if (value === null) return true;
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && Number(value.slice(0, 4)) >= 1900 && Number(value.slice(0, 4)) <= 2200
    && nextDate(value, 0) === value;
}
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map(k => `${JSON.stringify(k)}:${canonicalJson((value as Record<string, unknown>)[k])}`).join(',')}}`;
  return JSON.stringify(value) ?? 'null';
}
export function applyCommands(input: RouteSnapshot, operations: RouteCommand[], allocate: (ref?: string) => string): CommandResult {
  const route = clone(input); const idMap: Record<string, string> = {}; const invalidated = new Set<string>();
  const resolve = (id: string) => idMap[id] ?? id;
  const day = (id: string) => {
    const found = route.days.find(d => d.id === resolve(id));
    if (!found) throw new DomainError('NOT_FOUND', '这一天不属于当前路线。'); return found;
  };
  const point = (id: string) => {
    for (const d of route.days) { const p = d.stops.find(s => s.id === resolve(id)); if (p) return { day: d, stop: p }; }
    throw new DomainError('NOT_FOUND', '该地点不属于当前路线。');
  };
  const addId = (ref: string) => {
    if (!/^draft:[a-zA-Z0-9-]{1,70}$/.test(ref) || idMap[ref]) throw new DomainError('VALIDATION_ERROR', '新增对象标识重复或无效。');
    return idMap[ref] = allocate(ref);
  };
  const reconcile = () => {
    const old = new Map(route.segments.map(s => [`${s.fromStopId}|${s.toStopId}`, s]));
    const all = route.days.flatMap(d => d.stops); const next: RouteSegment[] = [];
    for (let i = 1; i < all.length; i++) {
      const from = all[i - 1]!, to = all[i]!; const key = `${from.id}|${to.id}`;
      next.push(old.get(key) ?? { id: allocate(), fromStopId: from.id, toStopId: to.id, kind: 'gap', mode: 'unknown', geometryStatus: 'missing', reviewStatus: 'unreviewed', geometryRef: null, geometryLocked: false });
      old.delete(key);
    }
    for (const s of old.values()) invalidated.add(s.id);
    route.segments = next;
  };
  const invalidate = (id: string) => {
    for (const s of route.segments.filter(s => s.fromStopId === id || s.toStopId === id)) {
      if (s.geometryRef) s.geometryStatus = 'stale';
      s.reviewStatus = 'unreviewed'; invalidated.add(s.id);
    }
  };
  const arrival = (id: string, mode: TravelMode) => {
    const p = point(id).stop; const s = route.segments.find(s => s.toStopId === p.id);
    if (!s) return;
    if (s.mode !== mode) { if (s.geometryRef) s.geometryStatus = 'stale'; s.reviewStatus = 'unreviewed'; invalidated.add(s.id); }
    s.mode = mode; s.kind = mode === 'unknown' ? 'gap' : 'travel';
  };
  for (const op of operations) {
    switch (op.type) {
      case 'add_day': route.days.push({ id: addId(op.clientRef), title: op.title.trim(), area: op.area.trim(), date: op.date, stayName: '', stops: [], copiedFrom: null }); break;
      case 'update_day': Object.assign(day(op.dayId), op.patch); break;
      case 'remove_day': {
        const d = day(op.dayId);
        if (route.days.length <= 1 || d.stops.length) throw new DomainError('DAY_NOT_EMPTY', '至少保留一天；删除日期前请先移动或移除地点。');
        route.days = route.days.filter(x => x.id !== d.id); break;
      }
      case 'add_stop': day(op.dayId).stops.push({ ...clone(op.stop), label: op.stop.label.trim(), id: addId(op.clientRef), copiedFrom: null }); reconcile(); arrival(op.clientRef, op.arrivalMode); break;
      case 'update_stop': {
        const p = point(op.stopId).stop;
        if ('location' in op.patch && canonicalJson(p.location) !== canonicalJson(op.patch.location)) invalidate(p.id);
        Object.assign(p, op.patch); p.label = p.label.trim(); break;
      }
      case 'move_stop': {
        const p = point(op.stopId), destination = day(op.toDayId);
        p.day.stops = p.day.stops.filter(s => s.id !== p.stop.id);
        if (op.index < 0 || op.index > destination.stops.length) throw new DomainError('VALIDATION_ERROR', '移动位置无效。');
        destination.stops.splice(op.index, 0, p.stop); break;
      }
      case 'remove_stop': { const p = point(op.stopId); p.day.stops = p.day.stops.filter(s => s.id !== p.stop.id); break; }
      case 'set_arrival': arrival(op.stopId, op.mode); break;
      case 'review_segment': case 'clear_segment_geometry': case 'set_segment_lock': {
        const segment = route.segments.find(s => s.id === op.segmentId);
        if (!segment) throw new DomainError('NOT_FOUND', '路段不属于当前路线。');
        if (op.type === 'set_segment_lock') segment.geometryLocked = op.locked;
        else {
          if (segment.geometryRef !== op.geometryRef) throw new DomainError('VERSION_CONFLICT', '路径引用已变动，请重新核对。', 409);
          if (op.type === 'review_segment') {
            if (segment.geometryStatus !== 'ready' || segment.kind !== 'travel') throw new DomainError('GEOMETRY_STALE', '请先保存与当前地点和交通安排一致的路径。');
            segment.reviewStatus = 'confirmed';
          } else {
            if (segment.geometryLocked) throw new DomainError('GEOMETRY_LOCKED', '请先解除路径保护，再移除绑定。', 409);
            segment.geometryRef = null; segment.geometryStatus = 'missing'; segment.reviewStatus = 'unreviewed';
          }
        }
        break;
      }
      case 'set_route_note': route.note = op.note; break;
    }
    reconcile();
  }
  if (route.days.length > 30 || route.days.flatMap(d => d.stops).length > 200) throw new DomainError('LIMIT_EXCEEDED', '每条路线最多安排 30 天、200 个地点。');
  for (const d of route.days) {
    if (!isDate(d.date)) throw new DomainError('INVALID_DATE', '请填写有效的出行日期。');
    for (const p of d.stops) if (!p.label.trim()) throw new DomainError('VALIDATION_ERROR', '地点名称不能为空。');
  }
  return { route, idMap, invalidatedSegmentIds: [...invalidated] };
}
export * from './shares.js';
export * from './atlas.js';

export * from './photos.js';
