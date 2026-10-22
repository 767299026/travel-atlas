import { createHash, createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { and, asc, count, desc, eq, gt, inArray, isNull, lt, or } from 'drizzle-orm';
import type { AppConfig } from './config.js';
import type { Database, DbExecutor } from './db/client.js';
import { repository } from './repository.js';
import { hashToken } from './security.js';
import { DomainError, canonicalJson, clone, shareLimits, type ShareOptions, type ShareBindings, type ShareSnapshot, type SharePreview, type ShareCreate, type ShareLink } from '../../packages/contracts/src/index.js';

export function shareService(database: Database, config: AppConfig) {
  const { db, schema: s } = database, storage = repository(database).storage;
  type Row = typeof s.shares.$inferSelect;
  const unavailable = () => new DomainError('SHARE_UNAVAILABLE', '分享链接不存在或已失效，请向分享者获取新链接。', 404);
  const token = (id: string) => createHmac('sha256', config.shareSecret!).update('travel-atlas-share-v1:' + id).digest('base64url');
  const equalHash = (a: string, b: string) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));
  const keyMatches = (row: Pick<Row, 'id' | 'tokenHash'>) => !!config.shareSecret && equalHash(row.tokenHash, hashToken(token(row.id)));
  function dto(row: Row): ShareLink {
    const state = row.revokedAt || !keyMatches(row) ? 'revoked' : row.expiresAt <= new Date() ? 'expired' : 'active';
    return { id: row.id, title: row.snapshot.title, layer: row.snapshot.layer, state, createdAt: row.createdAt.toISOString(), expiresAt: row.expiresAt.toISOString(), revokedAt: row.revokedAt?.toISOString() ?? null, path: state === 'active' ? `/s/${row.id}#${token(row.id)}` : null, diaryCount: row.snapshot.diaries.length, photoCount: row.snapshot.diaries.reduce((n, d) => n + d.photos.length, 0) };
  }
  async function lockOwner(ex: DbExecutor, ownerId: string) { await ex.select({ id: s.users.id }).from(s.users).where(eq(s.users.id, ownerId)).for('update'); }
  async function own(ex: DbExecutor, ownerId: string, id: string) { const [row] = await ex.select().from(s.shares).where(and(eq(s.shares.id, id), eq(s.shares.ownerId, ownerId))); if (!row) throw unavailable(); return row; }
  async function prepare(ex: DbExecutor, ownerId: string, journeyId: string, options: ShareOptions) {
    const journey = await storage.summary(ex, ownerId, journeyId), routeId = options.layer === 'actual' ? journey.actualRouteId : journey.planRouteId;
    if (!routeId) throw new DomainError('NO_ACTUAL_ROUTE', '还没有实际记录，请先选择计划安排。');
    if (!options.title.trim()) throw new DomainError('INVALID_TITLE', '请填写分享标题。');
    if (new Set(options.diaryIds).size !== options.diaryIds.length) throw new DomainError('DUPLICATE_DIARY', '同一篇日记不能重复选择。');
    const route = await storage.readRoute(ex, ownerId, routeId);
    const snapshot: ShareSnapshot = { title: options.title.trim(), destinations: [...journey.destinations], layer: route.layer, note: options.includeNotes ? route.note : null,
      days: route.days.map(day => ({ title: day.title, area: day.area, date: options.includeDates ? day.date : null, stayName: options.includeNotes ? day.stayName : null,
        stops: day.stops.map(stop => ({ label: stop.label, region: stop.region, time: options.includeDates ? stop.time : null, note: options.includeNotes ? stop.note : null, arrival: route.segments.find(segment => segment.toStopId === stop.id)?.mode ?? null })) })), diaries: [] };
    const diaryRows = options.diaryIds.length ? await ex.select().from(s.diaries).where(and(eq(s.diaries.ownerId, ownerId), inArray(s.diaries.id, options.diaryIds))) : [];
    const bindings: ShareBindings[] = [], versions: { id: string; version: number }[] = []; let photoCount = 0;
    for (const [index, id] of options.diaryIds.entries()) {
      const diary = diaryRows.find(d => d.id === id);
      if (!diary || diary.status !== 'written' || diary.association?.journeyId !== journeyId) throw new DomainError('DIARY_NOT_SHAREABLE', '所选日记不存在、尚为草稿或不属于这次行程，请重新选择。', 409);
      const key = 'd' + (index + 1), binding: ShareBindings = { diaryKey: key, diaryId: id, photos: [] };
      const entry: ShareSnapshot['diaries'][number] = { key, title: diary.title, occurredOn: options.includeDates ? diary.occurredOn : null, body: diary.body, photos: [] };
      if (options.includePhotos) {
        const photos = await ex.select({ link: s.diaryPhotos, image: s.media }).from(s.diaryPhotos).innerJoin(s.media, eq(s.media.id, s.diaryPhotos.mediaId)).where(and(eq(s.diaryPhotos.diaryId, id), eq(s.media.ownerId, ownerId), eq(s.media.state, 'ready'))).orderBy(asc(s.diaryPhotos.sortOrder));
        for (const photo of photos) { const key = 'p' + (++photoCount); entry.photos.push({ key, caption: photo.link.caption, width: photo.image.width, height: photo.image.height }); binding.photos.push({ key, mediaId: photo.image.id }); }
      }
      snapshot.diaries.push(entry); bindings.push(binding); versions.push({ id, version: diary.version });
    }
    if (photoCount > shareLimits.photos) throw new DomainError('SHARE_LIMIT', '一次分享最多 100 张照片，请减少所选日记或关闭照片。', 413);
    if (Buffer.byteLength(JSON.stringify(snapshot)) > shareLimits.snapshotBytes) throw new DomainError('SHARE_LIMIT', '分享文字超过 1MiB，请减少所选内容。', 413);
    const fingerprint = createHash('sha256').update(canonicalJson({ options, snapshot, bindings, versions, journeyVersion: journey.version, routeVersion: route.version })).digest('hex');
    return { snapshot, bindings, fingerprint, photoCount };
  }
  async function authorize(id: string, supplied: string | undefined) {
    if (!config.shareSecret || !supplied || !/^[a-zA-Z0-9_-]{43}$/.test(supplied) || !/^[a-f0-9-]{36}$/.test(id)) throw unavailable();
    const [row] = await db.select({ share: s.shares, active: s.users.active }).from(s.shares).innerJoin(s.users, eq(s.users.id, s.shares.ownerId)).where(eq(s.shares.id, id));
    if (!row || !row.active || row.share.revokedAt || row.share.expiresAt <= new Date() || !equalHash(row.share.tokenHash, hashToken(supplied)) || !keyMatches(row.share)) throw unavailable(); return row.share;
  }
  async function visible(row: Row) {
    const ids = row.bindings.map(d => d.diaryId);
    const diaries = ids.length ? await db.select().from(s.diaries).where(and(eq(s.diaries.ownerId, row.ownerId), eq(s.diaries.status, 'written'), inArray(s.diaries.id, ids))) : [];
    const allowed = row.bindings.filter(b => diaries.some(d => d.id === b.diaryId && d.association?.journeyId === row.journeyId));
    const links = allowed.length ? await db.select({ diaryId: s.diaryPhotos.diaryId, mediaId: s.media.id }).from(s.diaryPhotos).innerJoin(s.media, eq(s.media.id, s.diaryPhotos.mediaId)).where(and(inArray(s.diaryPhotos.diaryId, allowed.map(b => b.diaryId)), eq(s.media.ownerId, row.ownerId), eq(s.media.state, 'ready'))) : [];
    return allowed.map(b => ({ ...b, photos: b.photos.filter(p => links.some(link => link.diaryId === b.diaryId && link.mediaId === p.mediaId)) }));
  }
  return {
    async choices(ownerId: string, journeyId: string) {
      await storage.summary(db, ownerId, journeyId);
      const diaries = await db.select({ id: s.diaries.id, title: s.diaries.title, association: s.diaries.association }).from(s.diaries).where(and(eq(s.diaries.ownerId, ownerId), eq(s.diaries.status, 'written'))).orderBy(desc(s.diaries.updatedAt));
      return { enabled: !!config.shareSecret, diaries: diaries.filter(d => d.association?.journeyId === journeyId).map(({ id, title }) => ({ id, title })), limits: shareLimits };
    },
    async preview(ownerId: string, journeyId: string, options: ShareOptions): Promise<SharePreview> {
      return db.transaction(async ex => { await lockOwner(ex, ownerId); const { bindings, ...result } = await prepare(ex, ownerId, journeyId, options); return { ...result, photoPreviews: bindings.flatMap(d => d.photos.map(p => ({ key: p.key, url: `/api/v1/media/${p.mediaId}/content?variant=preview` }))) }; });
    },
    async create(ownerId: string, journeyId: string, body: ShareCreate) {
      if (!config.shareSecret) throw new DomainError('SHARING_NOT_CONFIGURED', '分享服务尚未配置。', 503);
      return db.transaction(async ex => {
        await lockOwner(ex, ownerId); await storage.summary(ex, ownerId, journeyId); const scope = `share-create:${journeyId}`, cached = await storage.replay(ex, ownerId, scope, body.clientMutationId, body);
        if (cached.found) return dto(await own(ex, ownerId, (cached.response as { id: string }).id));
        const { previewFingerprint, acknowledge, clientMutationId: _, ...options } = body, prepared = await prepare(ex, ownerId, journeyId, options);
        if (!acknowledge) throw new DomainError('SHARE_REVIEW_REQUIRED', '请先预览并确认分享范围。');
        if (previewFingerprint !== prepared.fingerprint) throw new DomainError('SHARE_PREVIEW_CHANGED', '行程、日记或所选范围已变化，请重新预览后创建链接。', 409);
        const now = new Date(); const [total] = await ex.select({ n: count() }).from(s.shares).where(eq(s.shares.ownerId, ownerId));
        const active = await ex.select({ id: s.shares.id, tokenHash: s.shares.tokenHash }).from(s.shares).where(and(eq(s.shares.ownerId, ownerId), isNull(s.shares.revokedAt), gt(s.shares.expiresAt, now)));
        const [today] = await ex.select({ n: count() }).from(s.shares).where(and(eq(s.shares.ownerId, ownerId), gt(s.shares.createdAt, new Date(Date.now() - 86400000))));
        if (Number(total?.n) >= shareLimits.retained || active.filter(keyMatches).length >= shareLimits.active || Number(today?.n) >= shareLimits.perDay) throw new DomainError('SHARE_QUOTA', '已达到当前分享数量限额，请撤销旧链接或稍后再试。', 429);
        const id = randomUUID(), row = { id, ownerId, journeyId, tokenHash: hashToken(token(id)), snapshot: prepared.snapshot, bindings: prepared.bindings, createdAt: now, expiresAt: new Date(now.getTime() + options.expiresInDays * 86400000), revokedAt: null };
        await ex.insert(s.shares).values(row); await storage.remember(ex, ownerId, scope, body.clientMutationId, body, { id }); return dto(row);
      });
    },
    async list(ownerId: string, journeyId: string) { await storage.summary(db, ownerId, journeyId); return (await db.select().from(s.shares).where(and(eq(s.shares.ownerId, ownerId), eq(s.shares.journeyId, journeyId))).orderBy(desc(s.shares.createdAt), desc(s.shares.id))).map(dto); },
    async revoke(ownerId: string, id: string, body: { clientMutationId: string }) {
      return db.transaction(async ex => { await lockOwner(ex, ownerId); const row = await own(ex, ownerId, id), scope = `share-revoke:${id}`, cached = await storage.replay(ex, ownerId, scope, body.clientMutationId, body); if (cached.found) return dto(row);
        if (!row.revokedAt) await ex.update(s.shares).set({ revokedAt: new Date() }).where(eq(s.shares.id, id)); await storage.remember(ex, ownerId, scope, body.clientMutationId, body, { id }); return dto(await own(ex, ownerId, id)); });
    },
    async read(id: string, supplied: string | undefined): Promise<ShareSnapshot> { const row = await authorize(id, supplied), allowed = await visible(row), snapshot = clone(row.snapshot); snapshot.diaries = snapshot.diaries.filter(d => allowed.some(b => b.diaryKey === d.key)).map(d => ({ ...d, photos: d.photos.filter(p => allowed.some(b => b.diaryKey === d.key && b.photos.some(photo => photo.key === p.key))) })); return snapshot; },
    async photo(id: string, key: string, supplied: string | undefined) {
      const row = await authorize(id, supplied), allowed = await visible(row), photo = allowed.flatMap(b => b.photos).find(p => p.key === key); if (!photo) throw unavailable(); return photo.mediaId;
    },
    async cleanup() {
      const cutoff = new Date(Date.now() - 30 * 86400000); let removed = 0;
      for (const owner of await db.select({ id: s.users.id }).from(s.users)) await db.transaction(async ex => { await lockOwner(ex, owner.id); const rows = await ex.select({ id: s.shares.id }).from(s.shares).where(and(eq(s.shares.ownerId, owner.id), or(lt(s.shares.revokedAt, cutoff), lt(s.shares.expiresAt, cutoff)))); if (rows.length) { await ex.delete(s.shares).where(inArray(s.shares.id, rows.map(r => r.id))); removed += rows.length; } }); return { removed };
    },
  };
}
