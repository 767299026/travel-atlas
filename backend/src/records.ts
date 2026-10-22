import { randomUUID } from 'node:crypto';
import { and, asc, desc, eq, inArray, isNull, lt, or, sql, count } from 'drizzle-orm';
import type { Database, DbExecutor } from './db/client.js';
import type { AppConfig } from './config.js';
import { resolvePlace } from './atlas-catalog.js';
import type { PlaceInput } from '../../packages/contracts/src/index.js';
import { repository } from './repository.js';
import { DomainError, applyCommands, canonicalJson, clone, isDate, type ActualCopyInput, type ActualCopyPreview, type Diary, type DiaryAssociation, type DiaryAssociationInput, type DiaryInput, type MediaItem, type RouteSnapshot, type Visit } from '../../packages/contracts/src/index.js';

export function mediaItem(row: Database['schema']['media']['$inferSelect']): MediaItem {
  return { id: row.id, filename: row.filename, width: row.width, height: row.height, originalBytes: row.originalBytes, storedBytes: row.storedBytes, createdAt: row.createdAt.toISOString(), previewUrl: `/api/v1/media/${row.id}/content?variant=preview`, thumbnailUrl: `/api/v1/media/${row.id}/content?variant=thumb`, originalUrl: `/api/v1/media/${row.id}/content?variant=original` };
}
export function records(database: Database, config: AppConfig) {
  const { db, schema: s } = database; const storage = repository(database).storage;
  const lockUser = async (ex: DbExecutor, ownerId: string) => { await ex.select({ id: s.users.id }).from(s.users).where(eq(s.users.id, ownerId)).for('update'); };
  async function lockJourney(ex: DbExecutor, ownerId: string, id: string) {
    const [journey] = await ex.select().from(s.journeys).where(and(eq(s.journeys.id, id), eq(s.journeys.ownerId, ownerId))).for('update');
    if (!journey) throw new DomainError('NOT_FOUND', '未找到这次旅程。', 404); return journey;
  }
  async function copyState(ex: DbExecutor, ownerId: string, journeyId: string, body: ActualCopyInput) {
    await lockUser(ex, ownerId);
    await lockJourney(ex, ownerId, journeyId);
    const routes = await ex.select().from(s.routes).where(eq(s.routes.journeyId, journeyId)).orderBy(asc(s.routes.layer)).for('update');
    const planRow = routes.find(r => r.layer === 'plan')!, actualRow = routes.find(r => r.layer === 'actual');
    if (body.planVersion !== planRow.version || body.actualVersion !== (actualRow?.version ?? null)) throw new DomainError('VERSION_CONFLICT', '计划或实际记录已更新，请重新预览复制内容。', 409);
    const plan = await storage.readRoute(ex, ownerId, planRow.id); const selected = plan.days.filter(d => body.dayIds.includes(d.id));
    if (selected.length !== body.dayIds.length) throw new DomainError('NOT_FOUND', '所选日期不属于这次计划。', 422);
    const existing = actualRow ? await storage.readRoute(ex, ownerId, actualRow.id) : null;
    const [visits] = await ex.select({ n: count() }).from(s.visits).where(and(eq(s.visits.ownerId, ownerId), eq(s.visits.journeyId, journeyId)));
    const diaryRows = await ex.select({ association: s.diaries.association }).from(s.diaries).where(eq(s.diaries.ownerId, ownerId));
    const preview: ActualCopyPreview = { planVersion: plan.version, actualVersion: existing?.version ?? null, addedDays: selected.length, addedStops: selected.flatMap(d => d.stops).length, replacedDays: body.mode === 'replace' ? existing?.days.length ?? 0 : 0, preservedVisits: Number(visits?.n ?? 0), preservedDiaries: diaryRows.filter(d => d.association?.journeyId === journeyId).length };
    return { plan, selected, existing, preview };
  }
  const nowRoute = (journeyId: string): RouteSnapshot => ({ id: randomUUID(), journeyId, layer: 'actual', version: 1, note: '', copiedFrom: null, days: [], segments: [] });
  async function saveNewRoute(ex: DbExecutor, ownerId: string, route: RouteSnapshot) {
    const now = new Date(); await ex.insert(s.routes).values({ id: route.id, ownerId, journeyId: route.journeyId, layer: 'actual', note: route.note, copiedFrom: route.copiedFrom ?? null, createdAt: now, updatedAt: now });
  }
  async function association(ex: DbExecutor, ownerId: string, input: DiaryAssociationInput | null, old?: DiaryAssociation | null): Promise<DiaryAssociation | null> {
    if (!input) return null;
    if (old && canonicalJson(input) === canonicalJson({ journeyId: old.journeyId, routeId: old.routeId, dayId: old.dayId, stopId: old.stopId })) return { ...old, detached: undefined };
    const journey = await storage.summary(ex, ownerId, input.journeyId);
    if (!input.routeId && (input.dayId || input.stopId) || !input.dayId && input.stopId) throw new DomainError('INVALID_ASSOCIATION', '请选择日记关联的路线和日期。');
    const route = input.routeId ? await storage.readRoute(ex, ownerId, input.routeId) : null;
    if (route && route.journeyId !== input.journeyId) throw new DomainError('INVALID_ASSOCIATION', '路线不属于所选旅程。');
    const day = input.dayId ? route?.days.find(d => d.id === input.dayId) : null;
    const stop = input.stopId ? day?.stops.find(p => p.id === input.stopId) : null;
    if (input.dayId && !day || input.stopId && !stop) throw new DomainError('INVALID_ASSOCIATION', '关联的日期或地点不存在，请重新选择。');
    return { ...input, journeyTitle: journey.title, dayTitle: day?.title ?? null, stopLabel: stop?.label ?? null };
  }
  async function readDiary(ex: DbExecutor, ownerId: string, id: string): Promise<Diary> {
    const [row] = await ex.select().from(s.diaries).where(and(eq(s.diaries.id, id), eq(s.diaries.ownerId, ownerId)));
    if (!row) throw new DomainError('NOT_FOUND', '未找到这篇日记。', 404);
    const photos = await ex.select({ link: s.diaryPhotos, image: s.media }).from(s.diaryPhotos).innerJoin(s.media, eq(s.media.id, s.diaryPhotos.mediaId)).where(and(eq(s.diaryPhotos.diaryId, id), eq(s.media.state, 'ready'), eq(s.media.ownerId, ownerId))).orderBy(asc(s.diaryPhotos.sortOrder));
    let detached = false;
    if (row.association?.stopId) detached = !(await ex.select({ id: s.stops.id }).from(s.stops).where(eq(s.stops.id, row.association.stopId))).length;
    else if (row.association?.dayId) detached = !(await ex.select({ id: s.days.id }).from(s.days).where(eq(s.days.id, row.association.dayId))).length;
    const { ownerId: _, createdAt, updatedAt, ...fields } = row;
    return { ...fields, visibility: 'private', createdAt: createdAt.toISOString(), updatedAt: updatedAt.toISOString(), association: row.association ? { ...row.association, detached } : null, photos: photos.map(p => ({ mediaId: p.image.id, caption: p.link.caption, media: mediaItem(p.image) })) };
  }
  async function setPhotos(ex: DbExecutor, ownerId: string, diaryId: string, photos: DiaryInput['photos']) {
    if (new Set(photos.map(x => x.mediaId)).size !== photos.length) throw new DomainError('DUPLICATE_PHOTO', '同一张照片不能重复加入日记。');
    for (const photo of photos) {
      const [image] = await ex.select().from(s.media).where(and(eq(s.media.id, photo.mediaId), eq(s.media.ownerId, ownerId), eq(s.media.state, 'ready'))).for('update');
      if (!image) throw new DomainError('NOT_FOUND', '图片不存在或无权使用。', 404);
      const [link] = await ex.select().from(s.diaryPhotos).where(eq(s.diaryPhotos.mediaId, photo.mediaId));
      if (link && link.diaryId !== diaryId) throw new DomainError('PHOTO_IN_USE', '这张照片已关联其他日记，请重新上传。', 409);
    }
    const previous = await ex.select().from(s.diaryPhotos).where(eq(s.diaryPhotos.diaryId, diaryId));
    await ex.delete(s.diaryPhotos).where(eq(s.diaryPhotos.diaryId, diaryId));
    const removedIds = previous.filter(p => !photos.some(n => n.mediaId === p.mediaId)).map(p => p.mediaId);
    if (removedIds.length) await ex.update(s.media).set({ state: 'deleted' }).where(inArray(s.media.id, removedIds));
    for (const [sortOrder, photo] of photos.entries()) await ex.insert(s.diaryPhotos).values({ id: randomUUID(), diaryId, mediaId: photo.mediaId, caption: photo.caption, sortOrder });
    return removedIds;
  }
  return {
    async copyPreview(ownerId: string, journeyId: string, body: ActualCopyInput) { return db.transaction(async ex => (await copyState(ex, ownerId, journeyId, body)).preview); },
    async copyActual(ownerId: string, journeyId: string, body: ActualCopyInput & { clientMutationId: string }) {
      return db.transaction(async ex => {
        await lockUser(ex, ownerId);
        await lockJourney(ex, ownerId, journeyId); const scope = `actual-copy:${journeyId}`;
        const cached = await storage.replay(ex, ownerId, scope, body.clientMutationId, body); if (cached.found) return cached.response;
        const { plan, selected, existing, preview } = await copyState(ex, ownerId, journeyId, body);
        let route = existing ? clone(existing) : nowRoute(journeyId); const ids = new Map<string, string>();
        const copied = selected.map(d => ({ ...clone(d), id: randomUUID(), copiedFrom: { routeId: plan.id, version: plan.version, id: d.id }, stops: d.stops.map(p => { const id = randomUUID(); ids.set(p.id, id); return { ...clone(p), id, copiedFrom: { routeId: plan.id, version: plan.version, id: p.id } }; }) }));
        if (body.mode === 'replace' || !existing) { route.days = []; route.segments = []; route.note = plan.note; }
        route.days.push(...copied); route.copiedFrom = { routeId: plan.id, version: plan.version };
        route.segments.push(...plan.segments.filter(p => ids.has(p.fromStopId) && ids.has(p.toStopId)).map(p => ({ ...p, id: randomUUID(), fromStopId: ids.get(p.fromStopId)!, toStopId: ids.get(p.toStopId)!, geometryRef: null, geometryStatus: 'missing' as const, reviewStatus: 'unreviewed' as const, geometryLocked: false })));
        route = applyCommands(route, [{ type: 'set_route_note', note: route.note }], () => randomUUID()).route;
        if (existing) route.version++; else await saveNewRoute(ex, ownerId, route);
        await storage.persist(ex, route); await ex.update(s.routes).set({ version: route.version, note: route.note, copiedFrom: route.copiedFrom, updatedAt: new Date() }).where(eq(s.routes.id, route.id));
        await storage.revision(ex, ownerId, route); await ex.update(s.journeys).set({ updatedAt: new Date() }).where(eq(s.journeys.id, journeyId));
        const result = { route, preview }; await storage.remember(ex, ownerId, scope, body.clientMutationId, body, result); return result;
      });
    },
    async emptyActual(ownerId: string, journeyId: string, body: { clientMutationId: string }) {
      return db.transaction(async ex => {
        await lockUser(ex, ownerId);
        await lockJourney(ex, ownerId, journeyId); const scope = `actual-empty:${journeyId}`; const cached = await storage.replay(ex, ownerId, scope, body.clientMutationId, body); if (cached.found) return cached.response;
        if ((await ex.select().from(s.routes).where(and(eq(s.routes.journeyId, journeyId), eq(s.routes.layer, 'actual')))).length) throw new DomainError('ACTUAL_EXISTS', '已经有实际记录，请直接编辑。', 409);
        const route = nowRoute(journeyId); route.days.push({ id: randomUUID(), title: '第 1 天', area: '', date: null, stayName: '', stops: [] });
        await saveNewRoute(ex, ownerId, route); await storage.persist(ex, route); await storage.revision(ex, ownerId, route);
        await ex.update(s.journeys).set({ updatedAt: new Date() }).where(eq(s.journeys.id, journeyId));
        await storage.remember(ex, ownerId, scope, body.clientMutationId, body, route); return route;
      });
    },
    async listVisits(ownerId: string, journeyId?: string): Promise<Visit[]> {
      if (journeyId) await storage.summary(db, ownerId, journeyId);
      const rows = await db.select({ visit: s.visits, current: s.stops.id }).from(s.visits).leftJoin(s.stops, eq(s.stops.id, s.visits.stopId)).where(and(eq(s.visits.ownerId, ownerId), journeyId ? eq(s.visits.journeyId, journeyId) : undefined)).orderBy(desc(s.visits.createdAt)).limit(500);
      return rows.map(({ visit: { ownerId: _, createdAt, ...visit }, current }) => ({ ...visit, createdAt: createdAt.toISOString(), detached: !current }));
    },
    async confirmVisit(ownerId: string, routeId: string, stopId: string, body: { place?: PlaceInput; routeVersion: number; visitedOn: string; note: string; clientMutationId: string }) {
      if (!isDate(body.visitedOn)) throw new DomainError('INVALID_DATE', '请填写有效的到访日期。');
      const place = body.place ? await resolvePlace(body.place) : null;
      return db.transaction(async ex => {
        await lockUser(ex, ownerId); const scope = `visit:${stopId}`, cached = await storage.replay(ex, ownerId, scope, body.clientMutationId, body); if (cached.found) return cached.response;
        const route = await storage.readRoute(ex, ownerId, routeId); await lockJourney(ex, ownerId, route.journeyId);
        const latest = await storage.readRoute(ex, ownerId, routeId);
        if (latest.layer !== 'actual') throw new DomainError('ACTUAL_REQUIRED', '请在实际记录中主动确认到访。');
        if (latest.version !== body.routeVersion) throw new DomainError('VERSION_CONFLICT', '实际记录已更新，请加载最新版本后确认。', 409);
        const stop = latest.days.flatMap(d => d.stops).find(p => p.id === stopId); if (!stop) throw new DomainError('NOT_FOUND', '地点不存在。', 404);
        if ((await ex.select().from(s.visits).where(and(eq(s.visits.ownerId, ownerId), eq(s.visits.stopId, stopId)))).length) throw new DomainError('ALREADY_VISITED', '这个地点已经确认到访。', 409);
        const visit = { id: randomUUID(), place, location: stop.location, version: 1, ownerId, journeyId: latest.journeyId, routeId, stopId, label: stop.label, region: stop.region, visitedOn: body.visitedOn, note: body.note, createdAt: new Date() };
        await ex.insert(s.visits).values(visit); const { ownerId: _, ...fields } = visit; const result = { ...fields, createdAt: visit.createdAt.toISOString(), detached: false };
        await storage.remember(ex, ownerId, scope, body.clientMutationId, body, result); return result;
      });
    },
    async removeVisit(ownerId: string, id: string, body: { clientMutationId: string }) {
      return db.transaction(async ex => { await lockUser(ex, ownerId); const scope = `visit-delete:${id}`, cached = await storage.replay(ex, ownerId, scope, body.clientMutationId, body); if (cached.found) return cached.response;
        const [visit] = await ex.select().from(s.visits).where(and(eq(s.visits.id, id), eq(s.visits.ownerId, ownerId))); if (!visit) throw new DomainError('NOT_FOUND', '到访记录不存在。', 404);
        await ex.delete(s.visits).where(eq(s.visits.id, id)); const result = { removed: true }; await storage.remember(ex, ownerId, scope, body.clientMutationId, body, result); return result; });
    },
    readDiary: (ownerId: string, id: string) => readDiary(db, ownerId, id),
    async listDiaries(ownerId: string, query: { journeyId?: string; cursor?: string; year?: string; status?: string; q?: string }) {
      if (query.q && query.q.length > 100 || query.status && !['all', 'draft', 'written'].includes(query.status) || query.year && !/^(all|unknown|19[0-9]{2}|20[0-9]{2}|21[0-9]{2}|2200)$/.test(query.year)) throw new DomainError('VALIDATION_ERROR', '日记筛选条件无效。', 400);
      if (query.journeyId) await storage.summary(db, ownerId, query.journeyId);
      let before: { id: string; createdAt: Date } | undefined;
      if (query.cursor) { const [row] = await db.select({ id: s.diaries.id, createdAt: s.diaries.createdAt }).from(s.diaries).where(and(eq(s.diaries.id, query.cursor), eq(s.diaries.ownerId, ownerId))); if (!row) throw new DomainError('INVALID_CURSOR', '日记游标无效。', 400); before = row; }
      const rows = await db.select({ id: s.diaries.id }).from(s.diaries).where(and(eq(s.diaries.ownerId, ownerId), query.status && query.status !== 'all' ? eq(s.diaries.status, query.status as 'draft' | 'written') : undefined, query.year && query.year !== 'all' ? query.year === 'unknown' ? isNull(s.diaries.occurredOn) : sql`LEFT(${s.diaries.occurredOn}, 4) = ${query.year}` : undefined, query.q?.trim() ? sql`(LOCATE(${query.q.trim()}, ${s.diaries.title}) > 0 OR LOCATE(${query.q.trim()}, ${s.diaries.body}) > 0)` : undefined, query.journeyId ? sql`JSON_UNQUOTE(JSON_EXTRACT(${s.diaries.association}, '$.journeyId')) = ${query.journeyId}` : undefined, before ? or(lt(s.diaries.createdAt, before.createdAt), and(eq(s.diaries.createdAt, before.createdAt), lt(s.diaries.id, before.id))) : undefined)).orderBy(desc(s.diaries.createdAt), desc(s.diaries.id)).limit(21);
      return { items: await Promise.all(rows.slice(0, 20).map(r => readDiary(db, ownerId, r.id))), nextCursor: rows.length > 20 ? rows[19]!.id : null };
    },
    async saveDiary(ownerId: string, id: string | null, body: DiaryInput & { baseVersion?: number; clientMutationId: string }) {
      if (!body.title.trim() || !isDate(body.occurredOn)) throw new DomainError('VALIDATION_ERROR', '请检查日记标题和日期。');
      return db.transaction(async ex => {
        await lockUser(ex, ownerId); const scope = id ? `diary:${id}` : 'diary-create', cached = await storage.replay(ex, ownerId, scope, body.clientMutationId, body); if (cached.found) return { data: cached.response as Diary, removedIds: [] as string[] };
        const [old] = id ? await ex.select().from(s.diaries).where(and(eq(s.diaries.id, id), eq(s.diaries.ownerId, ownerId))).for('update') : [];
        if (id && !old) throw new DomainError('NOT_FOUND', '未找到这篇日记。', 404);
        if (old && old.version !== body.baseVersion) throw new DomainError('VERSION_CONFLICT', '日记已在其他页面更新，本机草稿已保留。', 409);
        const diaryId = id ?? randomUUID(), now = new Date(); const values = { title: body.title.trim(), occurredOn: body.occurredOn, body: body.body, status: body.status, association: await association(ex, ownerId, body.association, old?.association), version: (old?.version ?? 0) + 1, updatedAt: now };
        if (old) await ex.update(s.diaries).set(values).where(eq(s.diaries.id, diaryId)); else await ex.insert(s.diaries).values({ id: diaryId, ownerId, ...values, createdAt: now });
        const removedIds = await setPhotos(ex, ownerId, diaryId, body.photos); const result = await readDiary(ex, ownerId, diaryId);
        await storage.remember(ex, ownerId, scope, body.clientMutationId, body, result); return { data: result, removedIds };
      });
    },
    async removeDiary(ownerId: string, id: string, body: { baseVersion: number; clientMutationId: string }) {
      return db.transaction(async ex => { await lockUser(ex, ownerId); const scope = `diary-delete:${id}`, cached = await storage.replay(ex, ownerId, scope, body.clientMutationId, body); if (cached.found) return { removedIds: [] as string[] };
        const [old] = await ex.select().from(s.diaries).where(and(eq(s.diaries.id, id), eq(s.diaries.ownerId, ownerId))).for('update'); if (!old) throw new DomainError('NOT_FOUND', '日记不存在。', 404);
        if (old.version !== body.baseVersion) throw new DomainError('VERSION_CONFLICT', '日记已更新，请刷新后再删除。', 409);
        const removedIds = await setPhotos(ex, ownerId, id, []); await ex.delete(s.diaries).where(eq(s.diaries.id, id)); await storage.remember(ex, ownerId, scope, body.clientMutationId, body, { removed: true }); return { removedIds }; });
    },
    async accountSummary(ownerId: string) {
      const [journeys] = await db.select({ n: count() }).from(s.journeys).where(eq(s.journeys.ownerId, ownerId));
      const [diaries] = await db.select({ n: count() }).from(s.diaries).where(eq(s.diaries.ownerId, ownerId));
      const [visits] = await db.select({ n: count() }).from(s.visits).where(eq(s.visits.ownerId, ownerId));
      const [media] = await db.select({ n: sql<string>`COALESCE(SUM(${s.media.storedBytes}), 0)` }).from(s.media).where(and(eq(s.media.ownerId, ownerId), eq(s.media.state, 'ready')));
      return { journeys: Number(journeys?.n ?? 0), diaries: Number(diaries?.n ?? 0), visits: Number(visits?.n ?? 0), mediaBytes: Number(media?.n ?? 0), mediaQuotaBytes: config.mediaQuotaBytes };
    },
  };
}
