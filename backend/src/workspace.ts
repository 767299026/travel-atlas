import { randomUUID } from 'node:crypto';
import { and, eq, inArray, ne } from 'drizzle-orm';
import type { Database, DbExecutor } from './db/client.js';
import type { AppConfig } from './config.js';
import { repository } from './repository.js';
import { records } from './records.js';
import { resolvePlace } from './atlas-catalog.js';
import { DomainError, applyCommands, canonicalJson, clone, isDate, type WorkspaceData, type WorkspaceSave, type PlanningPreferences, type RouteSnapshot, type StopInput, type PlaceInput } from '../../packages/contracts/src/index.js';
export const emptyPreferences = (): PlanningPreferences => ({ places: {}, poiIds: {}, stayNotes: {}, defaultModes: {} });
export interface WorkspaceRecord { journeyVersion: number; routeVersion: number; visitedOn: string; selected: { sourceId?: string; stop: StopInput; place?: PlaceInput }[]; clientMutationId: string }
export function workspaceService(database: Database, config: AppConfig) {
  const { db, schema: s } = database, storage = repository(database).storage;
  async function lock(ex: DbExecutor, ownerId: string, id?: string) {
    await ex.select({ id: s.users.id }).from(s.users).where(eq(s.users.id, ownerId)).for('update');
    if (id) { const [j] = await ex.select().from(s.journeys).where(and(eq(s.journeys.id, id), eq(s.journeys.ownerId, ownerId))).for('update'); if (!j) throw new DomainError('NOT_FOUND', '旅程不存在或已删除。', 404); return j; }
  }
  async function read(ownerId: string, id: string): Promise<WorkspaceData> {
    const journey = await storage.summary(db, ownerId, id), route = await storage.readRoute(db, ownerId, journey.planRouteId);
    const [row] = await db.select({ preferences: s.journeys.planningPreferences }).from(s.journeys).where(eq(s.journeys.id, id));
    const visits = await records(database, config).listVisits(ownerId, id);
    const actual = journey.actualRouteId ? await storage.readRoute(db, ownerId, journey.actualRouteId) : null;
    const confirmedSourceIds = actual?.days.flatMap(d => d.stops).filter(p => visits.some(v => v.stopId === p.id)).flatMap(p => p.copiedFrom?.routeId === route.id && p.copiedFrom.id ? [p.copiedFrom.id] : []) || [];
    return { journey, route, preferences: row!.preferences || emptyPreferences(), visits, confirmedSourceIds };
  }
  return {
    read,
    async create(ownerId: string, body: { title: string; destination: string; clientMutationId: string }) {
      if (!body.title.trim()) throw new DomainError('INVALID_TITLE', '先写一个旅行名称或想去的地方。');
      return db.transaction(async ex => {
        await lock(ex, ownerId); const cached = await storage.replay(ex, ownerId, 'workspace-create', body.clientMutationId, body); if (cached.found) return cached.response;
        const now = new Date(), id = randomUUID(), routeId = randomUUID();
        await ex.insert(s.journeys).values({ id, ownerId, title: body.title.trim(), destinations: body.destination ? [body.destination] : [], planningPreferences: emptyPreferences(), createdAt: now, updatedAt: now });
        await ex.insert(s.routes).values({ id: routeId, journeyId: id, ownerId, layer: 'plan', note: '', createdAt: now, updatedAt: now });
        const route: RouteSnapshot = { id: routeId, journeyId: id, layer: 'plan', version: 1, note: '', days: [{ id: randomUUID(), title: '待安排', unscheduled: true, area: '', date: null, stayName: '', stops: [] }], segments: [] };
        await storage.persist(ex, route); await storage.revision(ex, ownerId, route); const result = { id };
        await storage.remember(ex, ownerId, 'workspace-create', body.clientMutationId, body, result); return result;
      });
    },
    async save(ownerId: string, id: string, body: WorkspaceSave) {
      if (!body.title.trim()) throw new DomainError('INVALID_TITLE', '旅程名称不能为空。');
      return db.transaction(async ex => {
        const j = (await lock(ex, ownerId, id))!;
        const scope = 'workspace-save:' + id, cached = await storage.replay(ex, ownerId, scope, body.clientMutationId, body); if (cached.found) return cached.response;
        const summary = await storage.summary(ex, ownerId, id), old = await storage.readRoute(ex, ownerId, summary.planRouteId);
        if (j.version !== body.journeyVersion || old.version !== body.routeVersion) throw new DomainError('VERSION_CONFLICT', '这次旅程已在其他页面修改，当前草稿已保留，请先核对最新版本。', 409);
        if (body.days.filter(d => d.unscheduled).length !== 1 || !body.days[0]?.unscheduled || body.days[0].date !== null) throw new DomainError('INVALID_GROUP', '请保留一个待安排分组。');
        const days = body.days.map(d => ({ ...clone(d), copiedFrom: old.days.find(x => x.id === d.id)?.copiedFrom ?? null, stops: d.stops.map(p => ({ ...clone(p), copiedFrom: old.days.flatMap(x => x.stops).find(x => x.id === p.id)?.copiedFrom ?? null })) }));
        const dayIds = days.map(d => d.id), stopIds = days.flatMap(d => d.stops.map(p => p.id));
        if (new Set(dayIds).size !== dayIds.length || new Set(stopIds).size !== stopIds.length) throw new DomainError('DUPLICATE_ID', '分组或地点不能重复。');
        if ((await ex.select({ id: s.days.id }).from(s.days).where(and(inArray(s.days.id, dayIds), ne(s.days.routeId, old.id)))).length || stopIds.length && (await ex.select({ id: s.stops.id }).from(s.stops).where(and(inArray(s.stops.id, stopIds), ne(s.stops.routeId, old.id)))).length) throw new DomainError('NOT_FOUND', '无法使用其他路线的地点或日期。', 404);
        const route = applyCommands({ ...old, days }, [{ type: 'set_route_note', note: old.note }], () => randomUUID()).route;
        for (const segment of route.segments) {
          const source = old.segments.find(p => p.id === segment.id), mode = body.arrivalModes[segment.toStopId] ?? segment.mode;
          const moved = [segment.fromStopId, segment.toStopId].some(pid => canonicalJson(old.days.flatMap(d => d.stops).find(p => p.id === pid)?.location) !== canonicalJson(days.flatMap(d => d.stops).find(p => p.id === pid)?.location));
          if (source?.geometryLocked && (moved || mode !== source.mode)) throw new DomainError('GEOMETRY_LOCKED', '相关路径已保护，请先在路线工具中解除保护。', 409);
          if (moved || mode !== segment.mode) { if (segment.geometryRef) segment.geometryStatus = 'stale'; segment.reviewStatus = 'unreviewed'; }
          segment.mode = mode; segment.kind = mode === 'unknown' ? 'gap' : 'travel';
        }
        if (old.segments.some(p => p.geometryLocked && !route.segments.some(n => n.id === p.id))) throw new DomainError('GEOMETRY_LOCKED', '调整会移除已保护的路径，请先在路线工具中解除保护。', 409);
        route.version++;
        const keys = new Set(stopIds), dayKeys = new Set(dayIds), preferences = emptyPreferences();
        for (const name of ['places', 'poiIds', 'stayNotes'] as const) for (const [key, value] of Object.entries(body.preferences[name])) if (keys.has(key)) (preferences[name] as Record<string, unknown>)[key] = value;
        for (const [key, value] of Object.entries(body.preferences.defaultModes)) if (dayKeys.has(key)) preferences.defaultModes[key] = value;
        await storage.persist(ex, route); await ex.update(s.routes).set({ version: route.version, updatedAt: new Date() }).where(eq(s.routes.id, route.id));
        await ex.update(s.journeys).set({ title: body.title.trim(), status: body.status, destinations: body.destinations, planningPreferences: preferences, version: j.version + 1, updatedAt: new Date() }).where(eq(s.journeys.id, id));
        await storage.revision(ex, ownerId, route); const result = { journeyVersion: j.version + 1, routeVersion: route.version };
        await storage.remember(ex, ownerId, scope, body.clientMutationId, body, result); return result;
      });
    },
    async record(ownerId: string, id: string, body: WorkspaceRecord) {
      if (!body.visitedOn || !isDate(body.visitedOn)) throw new DomainError('INVALID_DATE', '请选择实际到访日期。');
      const places = await Promise.all(body.selected.map(p => p.place ? resolvePlace(p.place) : null));
      return db.transaction(async ex => {
        const j = (await lock(ex, ownerId, id))!, scope = 'workspace-record:' + id, cached = await storage.replay(ex, ownerId, scope, body.clientMutationId, body); if (cached.found) return cached.response;
        const summary = await storage.summary(ex, ownerId, id), plan = await storage.readRoute(ex, ownerId, summary.planRouteId);
        if (j.version !== body.journeyVersion || plan.version !== body.routeVersion) throw new DomainError('VERSION_CONFLICT', '旅程已更新，请先重新读取再确认到访。', 409);
        const now = new Date(); let actual: RouteSnapshot;
        if (summary.actualRouteId) actual = await storage.readRoute(ex, ownerId, summary.actualRouteId);
        else { actual = { id: randomUUID(), journeyId: id, layer: 'actual', version: 0, note: '', days: [], segments: [] }; await ex.insert(s.routes).values({ id: actual.id, journeyId: id, ownerId, layer: 'actual', note: '', createdAt: now, updatedAt: now }); }
        let group = actual.days.find(d => d.title === '出行补记');
        if (!group) { group = { id: randomUUID(), title: '出行补记', area: '', date: null, stayName: '', stops: [] }; actual.days.push(group); }
        for (const [index, item] of body.selected.entries()) {
          const source = item.sourceId ? plan.days.flatMap(d => d.stops).find(p => p.id === item.sourceId) : null;
          if (item.sourceId && !source) throw new DomainError('NOT_FOUND', '所选地点不属于这次计划。', 404);
          let stop = source ? actual.days.flatMap(d => d.stops).find(p => p.copiedFrom?.routeId === plan.id && p.copiedFrom?.id === source.id) : undefined;
          if (!stop) { stop = { ...clone(source || item.stop), id: randomUUID(), copiedFrom: source ? { routeId: plan.id, version: plan.version, id: source.id } : null }; group.stops.push(stop); }
          if (!(await ex.select({ id: s.visits.id }).from(s.visits).where(and(eq(s.visits.ownerId, ownerId), eq(s.visits.stopId, stop.id)))).length) await ex.insert(s.visits).values({ id: randomUUID(), ownerId, journeyId: id, routeId: actual.id, stopId: stop.id, label: stop.label, region: stop.region, location: stop.location, place: places[index], visitedOn: body.visitedOn, note: '', createdAt: now });
        }
        actual = applyCommands(actual, [{ type: 'set_route_note', note: actual.note }], () => randomUUID()).route; actual.version++;
        await storage.persist(ex, actual); await ex.update(s.routes).set({ version: actual.version, updatedAt: now }).where(eq(s.routes.id, actual.id)); await storage.revision(ex, ownerId, actual);
        await ex.update(s.journeys).set({ status: 'completed', version: j.version + 1, updatedAt: now }).where(eq(s.journeys.id, id));
        const result = { confirmed: body.selected.length }; await storage.remember(ex, ownerId, scope, body.clientMutationId, body, result); return result;
      });
    },
    async remove(ownerId: string, id: string, body: { journeyVersion: number; routeVersions: Record<string, number>; acknowledge: boolean; clientMutationId: string }) {
      return db.transaction(async ex => {
        await lock(ex, ownerId); const scope = 'workspace-delete:' + id, cached = await storage.replay(ex, ownerId, scope, body.clientMutationId, body); if (cached.found) return cached.response;
        const j = (await lock(ex, ownerId, id))!; if (!body.acknowledge) throw new DomainError('ACK_REQUIRED', '请先确认删除范围。');
        const routes = await ex.select().from(s.routes).where(eq(s.routes.journeyId, id)).for('update');
        if (j.version !== body.journeyVersion || routes.some(r => body.routeVersions[r.id] !== r.version)) throw new DomainError('VERSION_CONFLICT', '旅程内容已更新，请重新查看删除范围。', 409);
        const routeIds = routes.map(r => r.id);
        await ex.delete(s.shares).where(eq(s.shares.journeyId, id)); await ex.delete(s.visits).where(eq(s.visits.journeyId, id));
        if (routeIds.length) {
          await ex.delete(s.routingCandidates).where(inArray(s.routingCandidates.routeId, routeIds)); await ex.delete(s.routingJobs).where(inArray(s.routingJobs.routeId, routeIds));
          await ex.delete(s.geometries).where(inArray(s.geometries.routeId, routeIds)); await ex.delete(s.routes).where(inArray(s.routes.id, routeIds));
        }
        await ex.delete(s.journeys).where(eq(s.journeys.id, id));
        await ex.insert(s.auditEvents).values({ id: randomUUID(), actorId: ownerId, action: 'journey_delete', targetId: id, createdAt: new Date() });
        const result = { removed: true, photosPreserved: true, diariesPreserved: true }; await storage.remember(ex, ownerId, scope, body.clientMutationId, body, result); return result;
      });
    },
  };
}
