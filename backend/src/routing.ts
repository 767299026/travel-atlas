import { randomUUID, createHash } from 'node:crypto';
import { and, asc, desc, count, eq, gt, inArray, lt, sql } from 'drizzle-orm';
import type { AppConfig } from './config.js';
import type { Database, DbExecutor } from './db/client.js';
import { repository } from './repository.js';
import { geometryDto } from './geometry.js';
import { calculateBrouter } from './brouter.js';
import { DomainError, canonicalJson, distanceM, validPosition, geometryLimits, routingAttribution, routingLimits, type RoutingCapabilities, type RoutingInput, type RoutingJob, type RoutingCandidate, type RouteSnapshot } from '../../packages/contracts/src/index.js';

export function routingService(database: Database, config: AppConfig, upstreamFetch: typeof fetch = fetch) {
  const { db, schema: s } = database, storage = repository(database).storage;
  const controllers = new Map<string, AbortController>(); let inFlight: Promise<boolean> | null = null, interval: ReturnType<typeof setInterval> | undefined, closing = false;
  const capabilities = (): RoutingCapabilities => ({ enabled: !!config.routing, engineVersion: config.routing?.engineVersion ?? null, tiles: config.routing?.tiles ?? [], modes: ['hike'], profile: 'hiking-mountain', attribution: routingAttribution, limits: routingLimits });
  const fingerprint = (input: RoutingInput) => { const { expectedGeometryRef: _, ...geometryInput } = input; return createHash('sha256').update(canonicalJson(geometryInput)).digest('hex'); };
  const jobDto = (row: typeof s.routingJobs.$inferSelect): RoutingJob => ({ id: row.id, routeId: row.routeId, segmentId: row.segmentId, status: row.status, candidateId: row.candidateId, failure: row.failureCode ? { code: row.failureCode, message: row.failureMessage ?? '计算未完成。' } : null, createdAt: row.createdAt.toISOString(), startedAt: row.startedAt?.toISOString() ?? null, finishedAt: row.finishedAt?.toISOString() ?? null, expiresAt: row.expiresAt.toISOString() });
  async function job(ex: DbExecutor, ownerId: string, id: string) { const [row] = await ex.select().from(s.routingJobs).where(and(eq(s.routingJobs.id, id), eq(s.routingJobs.ownerId, ownerId))); if (!row) throw new DomainError('NOT_FOUND', '算路任务不存在。', 404); return row; }
  function inputFor(route: RouteSnapshot, segmentId: string): RoutingInput {
    const service = config.routing; if (!service) throw new DomainError('ROUTER_NOT_CONFIGURED', '本机区域路由尚未启用；可继续手工补绘或导入。', 503);
    const segment = route.segments.find(s => s.id === segmentId); if (!segment) throw new DomainError('NOT_FOUND', '路段不存在。', 404);
    if (segment.kind !== 'travel' || segment.mode !== 'hike') throw new DomainError('UNSUPPORTED_MODE', '当前本机路由仅支持明确的徒步连接，请先确认交通方式。');
    const stops = route.days.flatMap(d => d.stops), from = stops.find(p => p.id === segment.fromStopId)!.location, to = stops.find(p => p.id === segment.toStopId)!.location;
    if (!from || !to || from.crs !== 'WGS84' || to.crs !== 'WGS84') throw new DomainError('WGS84_REQUIRED', '请先用户外地图、设备坐标或参考文件核对 WGS84 起终点；不会反向转换高德坐标。');
    const start: RoutingInput['from'] = [from.longitude, from.latitude], end: RoutingInput['to'] = [to.longitude, to.latitude];
    if (!validPosition(start) || !validPosition(end)) throw new DomainError('INVALID_GEOMETRY', '起终点坐标无效。');
    return { fromStopId: segment.fromStopId, toStopId: segment.toStopId, from: start, to: end, mode: 'hike', profile: 'hiking-mountain', engineVersion: service.engineVersion, profileSha256: service.profileSha256, dataVersion: service.dataVersion, expectedGeometryRef: segment.geometryRef };
  }
  function current(route: RouteSnapshot, row: { segmentId: string; input: RoutingInput; fingerprint: string }) {
    try { const input = inputFor(route, row.segmentId); return fingerprint(input) === row.fingerprint && input.expectedGeometryRef === row.input.expectedGeometryRef && !route.segments.find(s => s.id === row.segmentId)!.geometryLocked; } catch { return false; }
  }
  async function lockRoute(ex: DbExecutor, ownerId: string, routeId: string) {
    await ex.select({ id: s.users.id }).from(s.users).where(eq(s.users.id, ownerId)).for('update');
    const [identity] = await ex.select({ journeyId: s.routes.journeyId }).from(s.routes).where(and(eq(s.routes.id, routeId), eq(s.routes.ownerId, ownerId)));
    if (!identity) throw new DomainError('NOT_FOUND', '路线不存在。', 404);
    await ex.select({ id: s.journeys.id }).from(s.journeys).where(eq(s.journeys.id, identity.journeyId)).for('update');
    await ex.select({ id: s.routes.id }).from(s.routes).where(eq(s.routes.id, routeId)).for('update');
    return storage.readRoute(ex, ownerId, routeId);
  }
  async function sweepInterrupted() {
    const now = new Date();
    await db.update(s.routingJobs).set({ status: 'failed', failureCode: 'WORKER_INTERRUPTED', failureMessage: '计算进程中断或等待超时，请核对后重新发起。', finishedAt: now, leaseToken: null, leaseExpiresAt: null }).where(and(eq(s.routingJobs.status, 'running'), lt(s.routingJobs.leaseExpiresAt, now)));
    await db.update(s.routingJobs).set({ status: 'failed', failureCode: 'JOB_EXPIRED', failureMessage: '等待任务已过期，请重新发起。', finishedAt: now }).where(and(eq(s.routingJobs.status, 'queued'), lt(s.routingJobs.expiresAt, now)));
  }
  async function execute(): Promise<boolean> {
    if (!config.routing || closing) return false;
    await sweepInterrupted();
    const claimed = await db.transaction(async ex => {
      const [next] = await ex.select().from(s.routingJobs).where(and(eq(s.routingJobs.status, 'queued'), gt(s.routingJobs.expiresAt, new Date()))).orderBy(asc(s.routingJobs.createdAt), asc(s.routingJobs.id)).limit(1).for('update', { skipLocked: true });
      if (!next) return null;
      const startedAt = new Date(), leaseToken = randomUUID(); await ex.update(s.routingJobs).set({ status: 'running', startedAt, leaseToken, leaseExpiresAt: new Date(Date.now() + routingLimits.timeoutMs + 15000) }).where(eq(s.routingJobs.id, next.id)); return { ...next, leaseToken };
    });
    if (!claimed) return false;
    const controller = new AbortController(); controllers.set(claimed.id, controller);
    let result: Awaited<ReturnType<typeof calculateBrouter>> | undefined, failure: { code: string; message: string } | undefined;
    const candidateId = randomUUID();
    try {
      const route = await storage.readRoute(db, claimed.ownerId, claimed.routeId); if (!current(route, claimed)) throw new DomainError('INPUT_CHANGED', '起终点、路段或已有路径已变化，请重新计算。', 409);
      const [user] = await db.select({ active: s.users.active }).from(s.users).where(eq(s.users.id, claimed.ownerId)); if (!user?.active) throw new DomainError('USER_DISABLED', '账号已停用，任务未继续。', 403);
      const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(routingLimits.timeoutMs)]);
      result = await calculateBrouter(config.routing.endpoint, claimed.input, candidateId, signal, upstreamFetch);
    } catch (error) {
      failure = error instanceof DomainError ? { code: error.code, message: error.message } : { code: closing ? 'WORKER_INTERRUPTED' : 'ROUTER_UNAVAILABLE', message: closing ? '计算进程中断，请重新发起。' : '路由超时或暂不可用，请稍后重试。' };
    } finally { controllers.delete(claimed.id); }
    await db.transaction(async ex => {
      const route = await lockRoute(ex, claimed.ownerId, claimed.routeId);
      const [latest] = await ex.select().from(s.routingJobs).where(eq(s.routingJobs.id, claimed.id)).for('update');
      if (!latest || latest.status !== 'running' || latest.leaseToken !== claimed.leaseToken) return;
      const now = new Date();
      if (!current(route, claimed) || failure?.code === 'INPUT_CHANGED') { await ex.update(s.routingJobs).set({ status: 'obsolete', failureCode: 'INPUT_CHANGED', failureMessage: '路线输入已变化，旧结果未绑定到当前路线。', finishedAt: now, leaseToken: null, leaseExpiresAt: null }).where(eq(s.routingJobs.id, claimed.id)); return; }
      if (failure || !result) { await ex.update(s.routingJobs).set({ status: 'failed', failureCode: failure?.code ?? 'ROUTER_UNAVAILABLE', failureMessage: failure?.message ?? '计算未完成。', finishedAt: now, leaseToken: null, leaseExpiresAt: null }).where(eq(s.routingJobs.id, claimed.id)); return; }
      const [user] = await ex.select({ active: s.users.active }).from(s.users).where(eq(s.users.id, claimed.ownerId)); if (!user?.active) { await ex.update(s.routingJobs).set({ status: 'cancelled', finishedAt: now, leaseToken: null, leaseExpiresAt: null }).where(eq(s.routingJobs.id, claimed.id)); return; }
      await ex.insert(s.routingCandidates).values({ id: candidateId, jobId: claimed.id, ownerId: claimed.ownerId, routeId: claimed.routeId, segmentId: claimed.segmentId, input: claimed.input, fingerprint: claimed.fingerprint, ...result, adoptedAssetId: null, createdAt: now, expiresAt: claimed.expiresAt });
      await ex.update(s.routingJobs).set({ status: 'succeeded', candidateId, finishedAt: now, leaseToken: null, leaseExpiresAt: null }).where(eq(s.routingJobs.id, claimed.id));
    });
    return true;
  }
  const service = {
    capabilities,
    async create(ownerId: string, routeId: string, segmentId: string, body: { baseVersion: number; clientMutationId: string }) {
      return db.transaction(async ex => {
        const route = await lockRoute(ex, ownerId, routeId), scope = `routing-create:${segmentId}`, cached = await storage.replay(ex, ownerId, scope, body.clientMutationId, body);
        if (cached.found) return jobDto(await job(ex, ownerId, (cached.response as { id: string }).id));
        if (route.version !== body.baseVersion) throw new DomainError('VERSION_CONFLICT', '路线已更新，请加载最新版本后再规划。', 409);
        const input = inputFor(route, segmentId), segment = route.segments.find(s => s.id === segmentId)!; if (segment.geometryLocked) throw new DomainError('GEOMETRY_LOCKED', '请先解除路径保护并保存，再计算替换候选。', 409);
        const distance = distanceM(input.from, input.to); if (distance < routingLimits.minimumDistanceM || distance > routingLimits.straightDistanceM) throw new DomainError('ROUTE_LIMIT', '当前仅支持起终点间距 10 米至 50 公里的区域徒步规划。');
        const tile = ([lon, lat]: number[]) => `E${Math.floor(lon! / 5) * 5}_N${Math.floor(lat! / 5) * 5}`;
        if (![input.from, input.to].every(p => config.routing!.tiles.includes(tile(p)))) throw new DomainError('ROUTING_DATA_MISSING', '起终点所在区域路网尚未安装；请查看当前区域范围。');
        if ((await ex.select({ id: s.routingJobs.id }).from(s.routingJobs).where(and(eq(s.routingJobs.ownerId, ownerId), inArray(s.routingJobs.status, ['queued', 'running']))).limit(1)).length) throw new DomainError('ROUTING_BUSY', '已有一个计算任务，请等待或取消后再试。', 409);
        const [total] = await ex.select({ n: count() }).from(s.routingJobs).where(eq(s.routingJobs.ownerId, ownerId)), [today] = await ex.select({ n: count() }).from(s.routingJobs).where(and(eq(s.routingJobs.ownerId, ownerId), gt(s.routingJobs.createdAt, new Date(Date.now() - 86400000))));
        if (Number(total?.n) >= routingLimits.retainedJobs || Number(today?.n) >= routingLimits.jobsPerDay) throw new DomainError('ROUTING_QUOTA', '已达到当前任务限额，请稍后或整理历史任务后再试。', 429);
        const now = new Date(), row = { id: randomUUID(), ownerId, routeId, segmentId, status: 'queued' as const, input, fingerprint: fingerprint(input), candidateId: null, failureCode: null, failureMessage: null, leaseToken: null, leaseExpiresAt: null, createdAt: now, startedAt: null, finishedAt: null, expiresAt: new Date(Date.now() + routingLimits.expiryHours * 3600000) };
        await ex.insert(s.routingJobs).values(row); await storage.remember(ex, ownerId, scope, body.clientMutationId, body, { id: row.id }); return jobDto(row);
      });
    },
    async get(ownerId: string, id: string) { return jobDto(await job(db, ownerId, id)); },
    async list(ownerId: string, routeId: string, segmentId: string) { await storage.readRoute(db, ownerId, routeId); return (await db.select().from(s.routingJobs).where(and(eq(s.routingJobs.ownerId, ownerId), eq(s.routingJobs.routeId, routeId), eq(s.routingJobs.segmentId, segmentId))).orderBy(desc(s.routingJobs.createdAt), desc(s.routingJobs.id)).limit(10)).map(jobDto); },
    async cancel(ownerId: string, id: string, body: { clientMutationId: string }) {
      const result = await db.transaction(async ex => {
        await ex.select({ id: s.users.id }).from(s.users).where(eq(s.users.id, ownerId)).for('update'); const scope = `routing-cancel:${id}`, cached = await storage.replay(ex, ownerId, scope, body.clientMutationId, body); if (cached.found) return jobDto(await job(ex, ownerId, id));
        const current = await job(ex, ownerId, id); if (!['queued', 'running', 'cancelled'].includes(current.status)) throw new DomainError('JOB_FINISHED', '任务已经结束，请查看结果或重新发起。', 409);
        await ex.update(s.routingJobs).set({ status: 'cancelled', finishedAt: new Date(), leaseToken: null, leaseExpiresAt: null }).where(eq(s.routingJobs.id, id)); await storage.remember(ex, ownerId, scope, body.clientMutationId, body, { id }); return jobDto(await job(ex, ownerId, id));
      }); controllers.get(id)?.abort(); return result;
    },
    async candidate(ownerId: string, id: string): Promise<RoutingCandidate> {
      const [row] = await db.select().from(s.routingCandidates).where(and(eq(s.routingCandidates.id, id), eq(s.routingCandidates.ownerId, ownerId))); if (!row) throw new DomainError('NOT_FOUND', '规划候选不存在。', 404);
      const route = await storage.readRoute(db, ownerId, row.routeId), obsolete = !current(route, row);
      const { ownerId: _, fingerprint: __, createdAt, expiresAt, ...data } = row; return { ...data, createdAt: createdAt.toISOString(), expiresAt: expiresAt.toISOString(), obsolete, adoptable: !obsolete && !row.adoptedAssetId && row.expiresAt > new Date() };
    },
    async adopt(ownerId: string, id: string, body: { baseVersion: number; clientMutationId: string; expectedGeometryRef: string | null; acknowledge: boolean }) {
      return db.transaction(async ex => {
        await ex.select({ id: s.users.id }).from(s.users).where(eq(s.users.id, ownerId)).for('update'); const scope = `routing-adopt:${id}`, cached = await storage.replay(ex, ownerId, scope, body.clientMutationId, body); if (cached.found) return cached.response;
        const [candidate] = await ex.select().from(s.routingCandidates).where(and(eq(s.routingCandidates.id, id), eq(s.routingCandidates.ownerId, ownerId))).for('update'); if (!candidate) throw new DomainError('NOT_FOUND', '规划候选不存在。', 404);
        const route = await lockRoute(ex, ownerId, candidate.routeId), segment = route.segments.find(s => s.id === candidate.segmentId);
        if (route.version !== body.baseVersion) throw new DomainError('VERSION_CONFLICT', '路线已变化，请加载最新版本后核对候选。', 409);
        if (candidate.expiresAt <= new Date()) throw new DomainError('CANDIDATE_EXPIRED', '候选已经过期，请重新计算。', 409);
        if (candidate.adoptedAssetId) throw new DomainError('CANDIDATE_ADOPTED', '此候选已经采纳，请查看当前路径。', 409);
        if (!segment || !current(route, candidate) || body.expectedGeometryRef !== segment.geometryRef) throw new DomainError('INPUT_CHANGED', '输入、已有路径或保护状态已变化，旧候选不能覆盖当前路径。', 409);
        if (!body.acknowledge) throw new DomainError('REVIEW_REQUIRED', '请查看来源、端点偏移和诊断，再确认采纳。');
        const [usage] = await ex.select({ points: sql<string>`COALESCE(SUM(${s.geometries.pointCount}), 0)`, n: count() }).from(s.geometries).where(eq(s.geometries.ownerId, ownerId));
        const pointCount = candidate.geometry.parts.reduce((n, p) => n + p.length, 0); if (Number(usage?.points) + pointCount > geometryLimits.ownerPoints || Number(usage?.n) >= geometryLimits.ownerAssets) throw new DomainError('GEOMETRY_QUOTA', '路径历史达到个人限额，本次没有采纳。', 413);
        const now = new Date(), sourceNote = `本机 BRouter ${candidate.info.engineVersion} / ${candidate.info.profile} 路网规划；profile ${candidate.info.profileSha256}；区域数据 ${candidate.info.dataVersion}。${candidate.info.attribution}`;
        const row = { id: randomUUID(), ownerId, routeId: route.id, sourceKind: 'routing' as const, sourceNote, geometry: candidate.geometry, samples: null, pointCount, lengthM: candidate.lengthM, exportPolicy: 'allowed' as const, filename: null, originalXml: null, checksum: createHash('sha256').update(canonicalJson(candidate.geometry)).digest('hex'), diagnostics: candidate.diagnostics, routingInfo: candidate.info, createdAt: now };
        await ex.insert(s.geometries).values(row); segment.geometryRef = row.id; segment.geometryStatus = 'ready'; segment.reviewStatus = 'needs_attention'; route.version++;
        await storage.persist(ex, route); await ex.update(s.routes).set({ version: route.version, updatedAt: now }).where(eq(s.routes.id, route.id)); await ex.update(s.journeys).set({ updatedAt: now }).where(eq(s.journeys.id, route.journeyId)); await storage.revision(ex, ownerId, route);
        await ex.update(s.routingCandidates).set({ adoptedAssetId: row.id }).where(eq(s.routingCandidates.id, id)); const result = { route, asset: geometryDto(row) }; await storage.remember(ex, ownerId, scope, body.clientMutationId, body, result); return result;
      });
    },
    async cleanup() {
      await sweepInterrupted(); const owners = await db.select({ id: s.users.id }).from(s.users); let removed = 0;
      for (const owner of owners) await db.transaction(async ex => { await ex.select({ id: s.users.id }).from(s.users).where(eq(s.users.id, owner.id)).for('update'); const rows = await ex.select({ id: s.routingJobs.id }).from(s.routingJobs).where(and(eq(s.routingJobs.ownerId, owner.id), inArray(s.routingJobs.status, ['succeeded', 'failed', 'cancelled', 'obsolete']), lt(s.routingJobs.createdAt, new Date(Date.now() - 7 * 86400000)))); if (rows.length) { await ex.delete(s.routingJobs).where(inArray(s.routingJobs.id, rows.map(r => r.id))); removed += rows.length; } });
      return { removed };
    },
    async runNext() { if (inFlight || closing) return false; inFlight = execute(); try { return await inFlight; } finally { inFlight = null; } },
    start() { if (!config.routing || interval) return; interval = setInterval(() => { void service.runNext().catch(() => {}); }, 1000); interval.unref(); },
    async stop() { closing = true; if (interval) clearInterval(interval); for (const c of controllers.values()) c.abort(); await inFlight?.catch(() => {}); },
  };
  return service;
}
