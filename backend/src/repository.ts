import { randomUUID } from 'node:crypto';
import { and, asc, desc, eq, lt, inArray } from 'drizzle-orm';
import type { Database, DbExecutor } from './db/client.js';
import { DomainError, applyCommands, canonicalJson, isDate, nextDate, type JourneyCreate, type JourneySummary, type RouteSnapshot, type CommandRequest } from '../../packages/contracts/src/index.js';
import { hashToken } from './security.js';

export function repository(database: Database) {
  const { db, schema: s } = database;
  async function readRoute(executor: DbExecutor, ownerId: string, id: string): Promise<RouteSnapshot> {
    const [route] = await executor.select().from(s.routes).where(and(eq(s.routes.id, id), eq(s.routes.ownerId, ownerId)));
    if (!route) throw new DomainError('NOT_FOUND', '未找到这条路线。', 404);
    const days = await executor.select().from(s.days).where(eq(s.days.routeId, id)).orderBy(asc(s.days.sortOrder));
    const stops = await executor.select().from(s.stops).where(eq(s.stops.routeId, id)).orderBy(asc(s.stops.sortOrder));
    const segments = await executor.select().from(s.segments).where(eq(s.segments.routeId, id));
    return { id, journeyId: route.journeyId, layer: route.layer, version: route.version, note: route.note,
      days: days.map(d => ({ id: d.id, title: d.title, area: d.area, date: d.date, stayName: d.stayName, stops: stops.filter(p => p.dayId === d.id).map(p => ({ id: p.id, label: p.label, region: p.region, time: p.time, note: p.note, role: p.role, location: p.location })) })),
      segments: segments.map(({ routeId: _, ...segment }) => segment) };
  }
  async function summary(executor: DbExecutor, ownerId: string, id: string): Promise<JourneySummary> {
    const [journey] = await executor.select().from(s.journeys).where(and(eq(s.journeys.id, id), eq(s.journeys.ownerId, ownerId)));
    if (!journey) throw new DomainError('NOT_FOUND', '未找到这次旅程。', 404);
    const routes = await executor.select().from(s.routes).where(eq(s.routes.journeyId, id));
    const plan = routes.find(r => r.layer === 'plan');
    if (!plan) throw new Error('Missing plan route');
    const days = await executor.select({ id: s.days.id }).from(s.days).where(eq(s.days.routeId, plan.id));
    const { ownerId: _, createdAt, updatedAt, ...fields } = journey;
    return { ...fields, createdAt: createdAt.toISOString(), updatedAt: updatedAt.toISOString(), planRouteId: plan.id, actualRouteId: routes.find(r => r.layer === 'actual')?.id ?? null, dayCount: days.length };
  }
  async function replay(executor: DbExecutor, ownerId: string, scope: string, key: string, body: unknown) {
    const [record] = await executor.select().from(s.mutations).where(and(eq(s.mutations.ownerId, ownerId), eq(s.mutations.scope, scope), eq(s.mutations.key, key)));
    if (!record || record.expiresAt <= new Date()) return { found: false as const };
    if (record.requestHash !== hashToken(canonicalJson(body))) throw new DomainError('IDEMPOTENCY_CONFLICT', '同一次保存的内容发生变化，请重新提交。', 409);
    return { found: true as const, response: record.response };
  }
  async function remember(executor: DbExecutor, ownerId: string, scope: string, key: string, body: unknown, response: unknown) {
    await executor.delete(s.mutations).where(and(eq(s.mutations.ownerId, ownerId), lt(s.mutations.expiresAt, new Date())));
    await executor.insert(s.mutations).values({ id: randomUUID(), ownerId, scope, key, requestHash: hashToken(canonicalJson(body)), response, createdAt: new Date(), expiresAt: new Date(Date.now() + 7 * 86400000) });
  }
  async function revision(executor: DbExecutor, ownerId: string, route: RouteSnapshot) {
    await executor.insert(s.revisions).values({ id: randomUUID(), routeId: route.id, version: route.version, actorId: ownerId, snapshot: route, createdAt: new Date() });
    await executor.delete(s.revisions).where(and(eq(s.revisions.routeId, route.id), lt(s.revisions.version, route.version - 49)));
  }
  async function persist(executor: DbExecutor, route: RouteSnapshot) {
    // Remove obsolete edges before their endpoints. Existing place IDs remain stable across moves.
    const currentSegments = await executor.select().from(s.segments).where(eq(s.segments.routeId, route.id));
    const removedEdges = currentSegments.filter(x => !route.segments.some(n => n.id === x.id)).map(x => x.id);
    if (removedEdges.length) await executor.delete(s.segments).where(inArray(s.segments.id, removedEdges));
    const currentDays = await executor.select().from(s.days).where(eq(s.days.routeId, route.id));
    const currentStops = await executor.select().from(s.stops).where(eq(s.stops.routeId, route.id));
    for (const [sortOrder, day] of route.days.entries()) {
      const values = { routeId: route.id, sortOrder, title: day.title, area: day.area, date: day.date, stayName: day.stayName };
      await executor.insert(s.days).values({ id: day.id, ...values }).onDuplicateKeyUpdate({ set: values });
    }
    for (const day of route.days) for (const [sortOrder, stop] of day.stops.entries()) {
      const { id, ...fields } = stop; const values = { ...fields, routeId: route.id, dayId: day.id, sortOrder };
      await executor.insert(s.stops).values({ id, ...values }).onDuplicateKeyUpdate({ set: values });
    }
    const allStops = route.days.flatMap(d => d.stops);
    const removedStops = currentStops.filter(x => !allStops.some(n => n.id === x.id)).map(x => x.id);
    if (removedStops.length) await executor.delete(s.stops).where(inArray(s.stops.id, removedStops));
    const removedDays = currentDays.filter(x => !route.days.some(n => n.id === x.id)).map(x => x.id);
    if (removedDays.length) await executor.delete(s.days).where(inArray(s.days.id, removedDays));
    for (const segment of route.segments) {
      const { id, ...fields } = segment; const values = { ...fields, routeId: route.id };
      await executor.insert(s.segments).values({ id, ...values }).onDuplicateKeyUpdate({ set: values });
    }
  }
  return {
    readRoute: (ownerId: string, id: string) => readRoute(db, ownerId, id),
    summary: (ownerId: string, id: string) => summary(db, ownerId, id),
    async list(ownerId: string, cursor?: string) {
      let boundary: Date | undefined; let boundaryId = '';
      if (cursor) {
        try { const decoded: unknown = JSON.parse(Buffer.from(cursor, 'base64url').toString());
          if (!Array.isArray(decoded) || decoded.length !== 2 || typeof decoded[0] !== 'string' || typeof decoded[1] !== 'string' || !Number.isFinite(Date.parse(decoded[0]))) throw new Error();
          boundary = new Date(decoded[0]); boundaryId = decoded[1];
        } catch { throw new DomainError('INVALID_CURSOR', '列表游标无效。', 400); }
      }
      // Timestamp + UUID cursor: use SQL expression only with bound values.
      const { or } = await import('drizzle-orm');
      const rows = await db.select({ id: s.journeys.id, createdAt: s.journeys.createdAt }).from(s.journeys)
        .where(and(eq(s.journeys.ownerId, ownerId), boundary ? or(lt(s.journeys.createdAt, boundary), and(eq(s.journeys.createdAt, boundary), lt(s.journeys.id, boundaryId))) : undefined))
        .orderBy(desc(s.journeys.createdAt), desc(s.journeys.id)).limit(21);
      const page = rows.slice(0, 20); const last = page.at(-1);
      return { items: await Promise.all(page.map(x => summary(db, ownerId, x.id))), nextCursor: rows.length > 20 && last ? Buffer.from(JSON.stringify([last.createdAt.toISOString(), last.id])).toString('base64url') : null };
    },
    async create(ownerId: string, body: JourneyCreate) {
      if (!body.title.trim() || !isDate(body.startDate) || !isDate(nextDate(body.startDate, body.duration - 1)) || body.destinations.some(x => !x.trim())) throw new DomainError('VALIDATION_ERROR', '请检查旅程名称、目的地和日期。');
      return db.transaction(async tx => {
        await tx.select({ id: s.users.id }).from(s.users).where(eq(s.users.id, ownerId)).for('update');
        const cached = await replay(tx, ownerId, 'journeys:create', body.clientMutationId, body); if (cached.found) return cached.response;
        const id = randomUUID(), routeId = randomUUID(), now = new Date();
        await tx.insert(s.journeys).values({ id, ownerId, title: body.title.trim(), destinations: [...new Set(body.destinations.map(x => x.trim()))], createdAt: now, updatedAt: now });
        await tx.insert(s.routes).values({ id: routeId, journeyId: id, ownerId, layer: 'plan', note: '', createdAt: now, updatedAt: now });
        let route: RouteSnapshot = { id: routeId, journeyId: id, layer: 'plan', version: 1, note: '', segments: [], days: Array.from({ length: body.duration }, (_, i) => ({ id: randomUUID(), title: `第 ${i + 1} 天`, area: '', date: nextDate(body.startDate, i), stayName: '', stops: [] })) };
        if (body.origin.trim()) route.days[0]!.stops.push({ id: randomUUID(), label: body.origin.trim(), region: '', time: null, note: '', role: 'departure', location: null });
        await persist(tx, route); await revision(tx, ownerId, route);
        const response = { journey: await summary(tx, ownerId, id), route };
        await remember(tx, ownerId, 'journeys:create', body.clientMutationId, body, response); return response;
      });
    },
    async commands(ownerId: string, id: string, body: CommandRequest) {
      return db.transaction(async tx => {
        const [locked] = await tx.select().from(s.routes).where(and(eq(s.routes.id, id), eq(s.routes.ownerId, ownerId))).for('update');
        if (!locked) throw new DomainError('NOT_FOUND', '未找到这条路线。', 404);
        const scope = `routes:${id}`; const cached = await replay(tx, ownerId, scope, body.clientMutationId, body); if (cached.found) return cached.response;
        if (locked.version !== body.baseVersion) throw new DomainError('VERSION_CONFLICT', '路线已在其他页面更新。本地草稿已保留，请加载最新版本后核对。', 409);
        const result = applyCommands(await readRoute(tx, ownerId, id), body.operations, () => randomUUID()); result.route.version++;
        await persist(tx, result.route); await tx.update(s.routes).set({ version: result.route.version, note: result.route.note, updatedAt: new Date() }).where(eq(s.routes.id, id));
        await tx.update(s.journeys).set({ updatedAt: new Date() }).where(eq(s.journeys.id, locked.journeyId));
        await revision(tx, ownerId, result.route); await remember(tx, ownerId, scope, body.clientMutationId, body, result); return result;
      });
    },
    async metadata(ownerId: string, id: string, body: { baseVersion: number; title: string; destinations: string[]; status: 'planning' | 'completed' | 'archived'; clientMutationId: string }) {
      if (!body.title.trim() || body.destinations.some(x => !x.trim())) throw new DomainError('VALIDATION_ERROR', '旅程名称或目的地不能为空。');
      return db.transaction(async tx => {
        const [journey] = await tx.select().from(s.journeys).where(and(eq(s.journeys.id, id), eq(s.journeys.ownerId, ownerId))).for('update');
        if (!journey) throw new DomainError('NOT_FOUND', '未找到这次旅程。', 404);
        const scope = `journeys:${id}`; const cached = await replay(tx, ownerId, scope, body.clientMutationId, body); if (cached.found) return cached.response;
        if (journey.version !== body.baseVersion) throw new DomainError('VERSION_CONFLICT', '旅程信息已更新，请刷新后核对。', 409);
        await tx.update(s.journeys).set({ title: body.title.trim(), destinations: [...new Set(body.destinations.map(x => x.trim()))], status: body.status, version: journey.version + 1, updatedAt: new Date() }).where(eq(s.journeys.id, id));
        const response = await summary(tx, ownerId, id); await remember(tx, ownerId, scope, body.clientMutationId, body, response); return response;
      });
    },
  };
}
