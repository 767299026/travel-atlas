import { randomUUID, createHash } from 'node:crypto';
import { and, count, eq, inArray, sql } from 'drizzle-orm';
import type { Database, DbExecutor } from './db/client.js';
import { repository } from './repository.js';
import { parseGpx, writeGpx } from './gpx.js';
import { DomainError, geometryLimits, validateGeometry, geometryLength, endpointDiagnostics, type GeometryAsset, type GeometrySaveInput, type GeometrySummary, type ExportReport, type RouteSnapshot } from '../../packages/contracts/src/index.js';
export function geometryRepository(database: Database) {
  const { db, schema: s } = database, storage = repository(database).storage;
  const dto = (row: typeof s.geometries.$inferSelect): GeometryAsset => {
    const { ownerId: _, originalXml: __, checksum: ___, createdAt, ...asset } = row; return { ...asset, createdAt: createdAt.toISOString() };
  };
  async function read(ex: DbExecutor, ownerId: string, id: string) {
    const [row] = await ex.select().from(s.geometries).where(and(eq(s.geometries.id, id), eq(s.geometries.ownerId, ownerId)));
    if (!row) throw new DomainError('NOT_FOUND', '路径资产不存在。', 404); return row;
  }
  async function exportState(ex: DbExecutor, ownerId: string, routeId: string) {
    const route = await storage.readRoute(ex, ownerId, routeId), assets: GeometryAsset[] = [], report: ExportReport = { routeVersion: route.version, total: route.segments.length, included: 0, missing: 0, gaps: 0, blockers: [], partial: false };
    for (const segment of route.segments) {
      if (segment.kind === 'gap') { report.gaps++; continue; }
      if (!segment.geometryRef) { report.missing++; continue; }
      const asset = dto(await read(ex, ownerId, segment.geometryRef));
      if (asset.routeId !== routeId) throw new DomainError('NOT_FOUND', '路径资产不属于当前路线。', 404);
      if (segment.geometryStatus !== 'ready') report.blockers.push('有已过期的路径，请按当前地点重新保存或移除绑定。');
      if (segment.reviewStatus !== 'confirmed') report.blockers.push('有尚未核对的路径，请先查看来源和端点诊断并确认。');
      if (asset.geometry.crs !== 'WGS84' || asset.exportPolicy !== 'allowed') report.blockers.push('有 GCJ-02 或使用范围未核实的路径，不能导出为 WGS84 GPX。');
      assets.push(asset);
    }
    report.included = assets.length; report.partial = report.missing + report.gaps > 0; report.blockers = [...new Set(report.blockers)];
    if (!assets.length) report.blockers.push('没有可导出的路径。地点标记不能代替连续轨迹。');
    return { route, assets, report };
  }
  return {
    async get(ownerId: string, id: string) { return dto(await read(db, ownerId, id)); },
    async original(ownerId: string, id: string) { const row = await read(db, ownerId, id); if (!row.originalXml) throw new DomainError('NOT_FOUND', '这条路径没有原始 GPX 文件。', 404); return row.originalXml; },
    async list(ownerId: string, routeId: string): Promise<GeometrySummary[]> {
      const route = await storage.readRoute(db, ownerId, routeId), ids = route.segments.flatMap(x => x.geometryRef ? [x.geometryRef] : []);
      if (!ids.length) return [];
      const g = s.geometries;
      const rows = await db.select({ id: g.id, routeId: g.routeId, sourceKind: g.sourceKind, sourceNote: g.sourceNote, pointCount: g.pointCount, lengthM: g.lengthM, exportPolicy: g.exportPolicy, filename: g.filename, createdAt: g.createdAt, diagnostics: g.diagnostics, crs: sql<'WGS84' | 'GCJ02'>`JSON_UNQUOTE(JSON_EXTRACT(${g.geometry}, '$.crs'))`, partCount: sql<number>`JSON_LENGTH(JSON_EXTRACT(${g.geometry}, '$.parts'))` }).from(g).where(and(eq(g.ownerId, ownerId), eq(g.routeId, routeId), inArray(g.id, ids)));
      return rows.map(r => ({ ...r, createdAt: r.createdAt.toISOString() }));
    },
    async save(ownerId: string, routeId: string, segmentId: string, body: GeometrySaveInput) {
      // Decode/validate before acquiring MySQL locks. No external request occurs inside a transaction.
      if (body.kind === 'gpx' && !body.rightsConfirmed) throw new DomainError('SOURCE_PERMISSION_REQUIRED', '请确认有权保存和导出该文件，并填写来源。');
      if (!body.sourceNote.trim()) throw new DomainError('SOURCE_REQUIRED', '请注明路径来源与使用说明。');
      const parsed = body.kind === 'gpx' ? parseGpx(body.xml) : null, geometry = parsed?.geometry ?? (body.kind === 'manual' ? body.geometry : null)!;
      const pointCount = validateGeometry(geometry), lengthM = geometryLength(geometry);
      const exportPolicy = geometry.crs === 'WGS84' ? 'allowed' as const : 'unverified' as const;
      return db.transaction(async ex => {
        await ex.select({ id: s.users.id }).from(s.users).where(eq(s.users.id, ownerId)).for('update');
        const [identity] = await ex.select({ journeyId: s.routes.journeyId }).from(s.routes).where(and(eq(s.routes.id, routeId), eq(s.routes.ownerId, ownerId)));
        if (!identity) throw new DomainError('NOT_FOUND', '路线不存在。', 404);
        await ex.select({ id: s.journeys.id }).from(s.journeys).where(eq(s.journeys.id, identity.journeyId)).for('update');
        await ex.select({ id: s.routes.id }).from(s.routes).where(eq(s.routes.id, routeId)).for('update');
        const scope = `geometry:${segmentId}`, replay = await storage.replay(ex, ownerId, scope, body.clientMutationId, body);
        if (replay.found) return replay.response as { route: RouteSnapshot; asset: GeometryAsset };
        const route = await storage.readRoute(ex, ownerId, routeId), segment = route.segments.find(x => x.id === segmentId);
        if (route.version !== body.baseVersion) throw new DomainError('VERSION_CONFLICT', '路线已更新，保留本页路径草稿，请先核对最新版本。', 409);
        if (!segment) throw new DomainError('NOT_FOUND', '路段不存在。', 404);
        if (segment.geometryRef !== body.expectedGeometryRef) throw new DomainError('VERSION_CONFLICT', '路径绑定已变化，请重新核对。', 409);
        if (segment.geometryLocked) throw new DomainError('GEOMETRY_LOCKED', '这段路径受到保护，请先解除保护再替换。', 409);
        if (segment.kind !== 'travel' || segment.mode === 'unknown') throw new DomainError('TRAVEL_MODE_REQUIRED', '请先为这段连接明确交通方式，缺口不能直接绑定轨迹。');
        const [usage] = await ex.select({ points: sql<string>`COALESCE(SUM(${s.geometries.pointCount}), 0)`, bytes: sql<string>`COALESCE(SUM(OCTET_LENGTH(${s.geometries.originalXml})), 0)`, count: count() }).from(s.geometries).where(eq(s.geometries.ownerId, ownerId));
        if (Number(usage?.points) + pointCount > geometryLimits.ownerPoints || Number(usage?.count) >= geometryLimits.ownerAssets || Number(usage?.bytes) + (body.kind === 'gpx' ? Buffer.byteLength(body.xml) : 0) > geometryLimits.ownerSourceBytes) throw new DomainError('GEOMETRY_QUOTA', '路径历史达到当前个人限额，请先联系管理员整理旧资产；本次没有保存。', 413);
        const stops = route.days.flatMap(d => d.stops), from = stops.find(p => p.id === segment.fromStopId)!, to = stops.find(p => p.id === segment.toStopId)!;
        const diagnostics = endpointDiagnostics(geometry, from.location, to.location), now = new Date();
        const row = { id: randomUUID(), ownerId, routeId, sourceKind: body.kind === 'gpx' ? 'imported_reference' as const : 'manual' as const, sourceNote: body.sourceNote.trim(), geometry, samples: parsed?.samples ?? null, pointCount, lengthM, exportPolicy, filename: body.kind === 'gpx' ? body.filename.replace(/[\x00-\x1f\x7f/\\]/g, '_').slice(0, 200) : null, originalXml: body.kind === 'gpx' ? body.xml : null, checksum: createHash('sha256').update(body.kind === 'gpx' ? body.xml : JSON.stringify(geometry)).digest('hex'), diagnostics, createdAt: now };
        await ex.insert(s.geometries).values(row);
        segment.geometryRef = row.id; segment.geometryStatus = 'ready'; segment.reviewStatus = diagnostics.length ? 'needs_attention' : 'unreviewed'; route.version++;
        await storage.persist(ex, route); await ex.update(s.routes).set({ version: route.version, updatedAt: now }).where(eq(s.routes.id, routeId)); await ex.update(s.journeys).set({ updatedAt: now }).where(eq(s.journeys.id, route.journeyId)); await storage.revision(ex, ownerId, route);
        const result = { route, asset: dto(row) }; await storage.remember(ex, ownerId, scope, body.clientMutationId, body, result); return result;
      });
    },
    async previewExport(ownerId: string, routeId: string) { return db.transaction(async ex => (await exportState(ex, ownerId, routeId)).report); },
    async export(ownerId: string, routeId: string, version: number, allowPartial: boolean) {
      return db.transaction(async ex => {
        const { route, assets, report } = await exportState(ex, ownerId, routeId);
        if (route.version !== version) throw new DomainError('VERSION_CONFLICT', '路线已变化，请重新预览导出范围。', 409);
        if (report.blockers.length) throw new DomainError('EXPORT_BLOCKED', report.blockers.join(' '));
        if (report.partial && !allowPartial) throw new DomainError('PARTIAL_EXPORT', '存在缺失路径或接驳缺口，请确认只导出已有路径。');
        const journey = await storage.summary(ex, ownerId, route.journeyId);
        return { filename: `travel-atlas-${route.layer}-${routeId}.gpx`, xml: writeGpx(journey.title, assets, report.partial), report };
      });
    },
  };
}
