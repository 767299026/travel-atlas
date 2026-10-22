import { randomUUID } from 'node:crypto';
import { and, asc, count, desc, eq, inArray, sql } from 'drizzle-orm';
import type { Database } from './db/client.js';
import { repository } from './repository.js';
import { resolvePlace } from './atlas-catalog.js';
import { DomainError, isDate, canonicalJson, type AtlasCityLayer, type AtlasDetail, type AtlasOverview, type AtlasRecord, type AtlasPlace, type PlaceInput, type PlaceRecordInput } from '../../packages/contracts/src/index.js';
const matchesYear = (date: string | null, year: string) => year === 'all' || (year === 'unknown' ? !date : date?.startsWith(year + '-'));
export function atlasService(database: Database) {
  const { db, schema: s } = database, storage = repository(database).storage;
  async function rows(ownerId: string): Promise<AtlasRecord[]> {
    const visits = await db.select({ visit: s.visits, current: s.stops.id }).from(s.visits).leftJoin(s.stops, eq(s.stops.id, s.visits.stopId)).where(eq(s.visits.ownerId, ownerId));
    const records = await db.select().from(s.placeRecords).where(eq(s.placeRecords.ownerId, ownerId));
    return [...visits.map(({ visit: v, current }) => ({ id: v.id, source: 'journey' as const, version: v.version, label: v.label, place: v.place, visitedOn: v.visitedOn, note: v.note, journeyId: v.journeyId, routeId: v.routeId, detached: !current })),
      ...records.map(r => ({ id: r.id, source: r.kind === 'wish' ? 'wish' as const : 'manual' as const, version: r.version, label: r.place.name, place: r.place, visitedOn: r.visitedOn, note: r.note, journeyId: null, routeId: null, detached: false }))];
  }
  const sorted = (list: AtlasRecord[]) => list.sort((a, b) => (b.visitedOn ?? '').localeCompare(a.visitedOn ?? '') || b.id.localeCompare(a.id));
  return {
    async overview(ownerId: string, year = 'all'): Promise<AtlasOverview> {
      const all = await rows(ownerId), visits = all.filter(r => r.source !== 'wish'), current = visits.filter(r => matchesYear(r.visitedOn, year)), wishes = all.filter(r => r.source === 'wish');
      const groups = new Map<string, { place: AtlasPlace; records: AtlasRecord[]; wished: boolean }>();
      for (const r of [...current, ...wishes]) if (r.place) { const group = groups.get(r.place.key) ?? { place: r.place, records: [], wished: false }; if (r.source === 'wish') group.wished = true; else group.records.push(r); groups.set(r.place.key, group); }
      const places = [...groups.values()].map(g => ({ place: g.place, records: g.records.length, journeys: new Set(g.records.map(r => r.journeyId).filter(Boolean)).size, lastVisitedOn: sorted([...g.records])[0]?.visitedOn ?? null, wished: g.wished })).sort((a, b) => b.records - a.records || a.place.name.localeCompare(b.place.name, 'zh-CN'));
      const lit = current.filter(r => r.place).map(r => r.place!);
      return { year, years: [...new Set(visits.map(r => r.visitedOn?.slice(0, 4) ?? 'unknown'))].sort().reverse(), countries: new Set(lit.map(p => p.countryCode)).size, provinces: new Set(lit.map(p => p.provinceCode).filter(Boolean)).size, cities: new Set(lit.filter(p => p.cityName).map(p => p.key)).size, records: current.length, unassigned: current.filter(r => !r.place).length, wishes: wishes.length, places };
    },
    async unassigned(ownerId: string, year = 'all') { return sorted((await rows(ownerId)).filter(r => r.source !== 'wish' && !r.place && matchesYear(r.visitedOn, year))); },
    async wishes(ownerId: string) { return (await rows(ownerId)).filter(r => r.source === 'wish').sort((a, b) => a.place!.name.localeCompare(b.place!.name, 'zh-CN')); },
    async detail(ownerId: string, place: AtlasPlace, year = 'all', cursor = 0): Promise<AtlasDetail> {
      const all = (await rows(ownerId)).filter(r => r.place?.key === place.key), records = sorted(all.filter(r => r.source === 'wish' || matchesYear(r.visitedOn, year)));
      const journeyIds = [...new Set(records.map(r => r.journeyId).filter((v): v is string => !!v))];
      const journeys = journeyIds.length ? await db.select({ id: s.journeys.id, title: s.journeys.title }).from(s.journeys).where(and(eq(s.journeys.ownerId, ownerId), inArray(s.journeys.id, journeyIds))).limit(30) : [];
      const diaryRows = journeyIds.length ? await db.select({ id: s.diaries.id, title: s.diaries.title, occurredOn: s.diaries.occurredOn, status: s.diaries.status }).from(s.diaries).where(and(eq(s.diaries.ownerId, ownerId), sql`JSON_UNQUOTE(JSON_EXTRACT(${s.diaries.association}, '$.journeyId')) IN (${sql.join(journeyIds.map(id => sql`${id}`), sql`, `)})`)).orderBy(desc(s.diaries.updatedAt)).limit(20) : [];
      const diaries = await Promise.all(diaryRows.map(async d => { const [cover] = await db.select({ id: s.media.id }).from(s.diaryPhotos).innerJoin(s.media, eq(s.media.id, s.diaryPhotos.mediaId)).where(and(eq(s.diaryPhotos.diaryId, d.id), eq(s.media.ownerId, ownerId), eq(s.media.state, 'ready'))).orderBy(asc(s.diaryPhotos.sortOrder)).limit(1); return { ...d, coverUrl: cover ? `/api/v1/media/${cover.id}/content?variant=thumb` : null }; }));
      const alias = place.name.replace(/市$/, '') || place.name, plans = await db.select({ id: s.journeys.id, title: s.journeys.title }).from(s.journeys).where(and(eq(s.journeys.ownerId, ownerId), eq(s.journeys.status, 'planning'), sql`LOCATE(${alias}, CAST(${s.journeys.destinations} AS CHAR)) > 0`)).orderBy(desc(s.journeys.updatedAt)).limit(20);
      return { place, records: records.slice(cursor, cursor + 30), nextCursor: records.length > cursor + 30 ? cursor + 30 : null, journeys, plans, diaries };
    },
    async cityLayer(ownerId: string, place: AtlasPlace, year = 'all'): Promise<AtlasCityLayer> {
      if (place.countryCode !== 'CHN' || !place.cityCode || !/^\d{6}$/.test(place.cityCode)) throw new DomainError('INVALID_PLACE', '请选择目录中的国内城市。');
      const visits = (await db.select().from(s.visits).where(and(eq(s.visits.ownerId, ownerId), sql`JSON_UNQUOTE(JSON_EXTRACT(${s.visits.place}, '$.cityCode')) = ${place.cityCode}`)).orderBy(desc(s.visits.visitedOn), asc(s.visits.id))).filter(v => matchesYear(v.visitedOn, year));
      const located = visits.filter(v => v.location), points = located.slice(0, 500).map(v => ({ id: v.id, label: v.label, visitedOn: v.visitedOn, location: v.location!, journeyId: v.journeyId, routeId: v.routeId }));
      const activeVisits = new Map(located.map(v => [v.stopId, v]));
      const routeIds = [...new Set(located.map(v => v.routeId))];
      const candidates = routeIds.length ? await db.select({ segment: s.segments, asset: s.geometries, journey: s.journeys, from: s.stops }).from(s.segments)
        .innerJoin(s.geometries, and(eq(s.geometries.id, s.segments.geometryRef), eq(s.geometries.ownerId, ownerId), eq(s.geometries.routeId, s.segments.routeId)))
        .innerJoin(s.routes, and(eq(s.routes.id, s.segments.routeId), eq(s.routes.ownerId, ownerId), eq(s.routes.layer, 'actual')))
        .innerJoin(s.journeys, and(eq(s.journeys.id, s.routes.journeyId), eq(s.journeys.ownerId, ownerId)))
        .innerJoin(s.stops, eq(s.stops.id, s.segments.fromStopId))
        .where(and(inArray(s.segments.routeId, routeIds), eq(s.segments.geometryStatus, 'ready'), eq(s.segments.kind, 'travel'))).orderBy(desc(s.geometries.createdAt)).limit(61) : [];
      const destinations = candidates.length ? await db.select().from(s.stops).where(inArray(s.stops.id, candidates.map(c => c.segment.toStopId))) : [];
      const paths: AtlasCityLayer['paths'] = [];
      for (const c of candidates.slice(0, 60)) {
        const a = activeVisits.get(c.segment.fromStopId), b = activeVisits.get(c.segment.toStopId), to = destinations.find(p => p.id === c.segment.toStopId);
        if (!a || !b || !to || canonicalJson(a.location) !== canonicalJson(c.from.location) || canonicalJson(b.location) !== canonicalJson(to.location)) continue;
        paths.push({ id: c.asset.id, journeyId: c.journey.id, title: c.journey.title, sourceKind: c.asset.sourceKind, geometry: c.asset.geometry, reviewStatus: c.segment.reviewStatus });
      }
      const manual = (await rows(ownerId)).filter(r => r.source === 'manual' && r.place?.cityCode === place.cityCode && matchesYear(r.visitedOn, year)).length;
      let sampled = false;
      const displayPaths = paths.slice(0, 20).map(path => {
        const total = path.geometry.parts.reduce((n, p) => n + p.length, 0); if (total <= 300) return path; sampled = true;
        const budget = Math.max(0, 300 - path.geometry.parts.length * 2);
        return { ...path, geometry: { crs: path.geometry.crs, parts: path.geometry.parts.map(part => { const n = Math.min(part.length, 2 + Math.floor(budget * part.length / total)); return Array.from({ length: n }, (_, i) => part[Math.round(i * (part.length - 1) / (n - 1))]!); }) } };
      });
      return { place, points, paths: displayPaths, withoutLocation: visits.length - located.length + manual, truncated: located.length > 500 || candidates.length > 60 || paths.length > 20, sampled };
    },
    async resolveKey(ownerId: string, key: string) {
      const saved = (await rows(ownerId)).find(r => r.place?.key === key)?.place; if (saved) return saved;
      if (/^CHN:\d{6}$/.test(key)) return resolvePlace({ countryCode: 'CHN', areaCode: key.slice(4) });
      throw new DomainError('NOT_FOUND', '这座城市还没有记录。', 404);
    },
    async save(ownerId: string, id: string | null, body: PlaceRecordInput & { baseVersion?: number; clientMutationId: string }) {
      if (!isDate(body.visitedOn) || body.kind === 'wish' && body.visitedOn) throw new DomainError('INVALID_DATE', '请检查到访日期；心愿不填写到访日期。');
      const place = await resolvePlace(body.place);
      return db.transaction(async ex => {
        await ex.select({ id: s.users.id }).from(s.users).where(eq(s.users.id, ownerId)).for('update'); const scope = id ? `place-record:${id}` : 'place-record:create', cached = await storage.replay(ex, ownerId, scope, body.clientMutationId, body); if (cached.found) return cached.response;
        const [old] = id ? await ex.select().from(s.placeRecords).where(and(eq(s.placeRecords.id, id), eq(s.placeRecords.ownerId, ownerId))).for('update') : [];
        if (id && !old) throw new DomainError('NOT_FOUND', '城市记录不存在。', 404);
        if (old && old.version !== body.baseVersion) throw new DomainError('VERSION_CONFLICT', '城市记录已更新，请刷新后核对。', 409);
        if (old && old.kind !== body.kind) throw new DomainError('INVALID_RECORD', '请单独新增到访或心愿，不能修改记录类型。');
        if (body.kind === 'wish') { const existing = await ex.select({ id: s.placeRecords.id }).from(s.placeRecords).where(and(eq(s.placeRecords.ownerId, ownerId), eq(s.placeRecords.kind, 'wish'), eq(s.placeRecords.placeKey, place.key))); if (existing.some(r => r.id !== id)) throw new DomainError('WISH_EXISTS', '这座城市已经在心愿清单中。', 409); }
        const [usage] = await ex.select({ n: count() }).from(s.placeRecords).where(eq(s.placeRecords.ownerId, ownerId)); if (!old && Number(usage?.n) >= 5000) throw new DomainError('PLACE_QUOTA', '城市记录达到当前个人限额，请先整理旧记录。', 413);
        const row = { id: old?.id ?? randomUUID(), ownerId, kind: body.kind, placeKey: place.key, place, visitedOn: body.visitedOn, note: body.note, version: (old?.version ?? 0) + 1, createdAt: old?.createdAt ?? new Date() };
        if (old) await ex.update(s.placeRecords).set(row).where(eq(s.placeRecords.id, row.id)); else await ex.insert(s.placeRecords).values(row);
        const { ownerId: _, createdAt, ...result } = row; const response = { ...result, createdAt: createdAt.toISOString() }; await storage.remember(ex, ownerId, scope, body.clientMutationId, body, response); return response;
      });
    },
    async remove(ownerId: string, id: string, body: { baseVersion: number; clientMutationId: string }) {
      return db.transaction(async ex => { await ex.select({ id: s.users.id }).from(s.users).where(eq(s.users.id, ownerId)).for('update'); const scope = `place-remove:${id}`, cached = await storage.replay(ex, ownerId, scope, body.clientMutationId, body); if (cached.found) return cached.response;
        const [row] = await ex.select().from(s.placeRecords).where(and(eq(s.placeRecords.id, id), eq(s.placeRecords.ownerId, ownerId))); if (!row) throw new DomainError('NOT_FOUND', '城市记录不存在。', 404); if (row.version !== body.baseVersion) throw new DomainError('VERSION_CONFLICT', '记录已更新，请刷新后重试。', 409);
        await ex.delete(s.placeRecords).where(eq(s.placeRecords.id, id)); const response = { removed: true }; await storage.remember(ex, ownerId, scope, body.clientMutationId, body, response); return response;
      });
    },
    async assign(ownerId: string, id: string, body: { place: PlaceInput; baseVersion: number; clientMutationId: string }) {
      const place = await resolvePlace(body.place);
      return db.transaction(async ex => { await ex.select({ id: s.users.id }).from(s.users).where(eq(s.users.id, ownerId)).for('update'); const scope = `visit-place:${id}`, cached = await storage.replay(ex, ownerId, scope, body.clientMutationId, body); if (cached.found) return cached.response;
        const [row] = await ex.select().from(s.visits).where(and(eq(s.visits.id, id), eq(s.visits.ownerId, ownerId))); if (!row) throw new DomainError('NOT_FOUND', '到访记录不存在。', 404); if (row.version !== body.baseVersion) throw new DomainError('VERSION_CONFLICT', '到访归属已更新，请重新读取。', 409);
        await ex.update(s.visits).set({ place, version: row.version + 1 }).where(eq(s.visits.id, id)); const response = { place, version: row.version + 1 }; await storage.remember(ex, ownerId, scope, body.clientMutationId, body, response); return response;
      });
    },
  };
}
