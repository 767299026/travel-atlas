import { randomUUID } from 'node:crypto';
import { and, eq, isNotNull, or } from 'drizzle-orm';
import type { Database } from './db/client.js';
import { repository } from './repository.js';
import { mediaItem } from './records.js';
import { atlasCatalog, resolvePlace } from './atlas-catalog.js';
import { DomainError, isDate, photoGroupKey, type AtlasPlace, type PhotoLibrary, type PhotoMemory, type PhotoSave, type PhotoPlace } from '../../packages/contracts/src/index.js';

export function photoService(database: Database) {
  const { db, schema: s } = database, storage = repository(database).storage;
  async function library(ownerId: string): Promise<PhotoLibrary> {
    const rows = await db.select({ image: s.media, album: s.photoMemories, link: s.diaryPhotos, diary: s.diaries }).from(s.media)
      .leftJoin(s.photoMemories, eq(s.photoMemories.mediaId, s.media.id)).leftJoin(s.diaryPhotos, eq(s.diaryPhotos.mediaId, s.media.id)).leftJoin(s.diaries, and(eq(s.diaries.id, s.diaryPhotos.diaryId), eq(s.diaries.ownerId, ownerId)))
      .where(and(eq(s.media.ownerId, ownerId), eq(s.media.state, 'ready'), or(isNotNull(s.photoMemories.mediaId), isNotNull(s.diaries.id))));
    const journeys = await db.select({ id: s.journeys.id, destinations: s.journeys.destinations }).from(s.journeys).where(eq(s.journeys.ownerId, ownerId));
    const stops = await db.select({ id: s.stops.id, location: s.stops.location }).from(s.stops).innerJoin(s.routes, eq(s.routes.id, s.stops.routeId)).where(eq(s.routes.ownerId, ownerId));
    const catalog = await atlasCatalog().catch(() => null), cityCache = new Map<string, AtlasPlace | null>();
    const cityFor = async (p: PhotoPlace | null) => {
      if (!p) return null;
      const name = p.cityName.replace(/市$/, ''), code = p.cityCode || catalog?.cities.find(c => c.name.replace(/市$/, '') === name)?.code;
      if (!code) return null;
      if (!cityCache.has(code)) cityCache.set(code, await resolvePlace({ countryCode: 'CHN', areaCode: code }).catch(() => null));
      return cityCache.get(code)!;
    };
    const items: PhotoMemory[] = [];
    for (const row of rows) {
      if (row.album?.hidden) continue;
      const association = row.diary?.association, cityName = journeys.find(j => j.id === association?.journeyId)?.destinations[0] || '';
      const related: PhotoPlace | null = association?.stopLabel ? { label: association.stopLabel, cityName, position: null, source: 'diary' } : null;
      const position = stops.find(p => p.id === association?.stopId)?.location;
      const place = row.album ? row.album.place : related;
      items.push({ mediaId: row.image.id, baseVersion: row.album?.version ?? 0, takenOn: row.album ? row.album.takenOn : row.diary?.occurredOn ?? null, place, note: row.album?.note ?? row.link?.caption ?? '',
        media: mediaItem(row.image), diaryId: row.diary?.id ?? null, city: await cityFor(place), suggestion: related && position ? { ...related, position } : null });
    }
    items.sort((a, b) => (b.takenOn || '').localeCompare(a.takenOn || '') || a.mediaId.localeCompare(b.mediaId));
    const notes = await db.select().from(s.photoNotes).where(eq(s.photoNotes.ownerId, ownerId));
    return { items, groupNotes: notes.map(n => ({ key: n.groupKey, note: n.note, version: n.version })) };
  }
  return {
    library,
    async save(ownerId: string, body: PhotoSave, auditActorId?: string) {
      return db.transaction(async ex => {
        await ex.select({ id: s.users.id }).from(s.users).where(eq(s.users.id, ownerId)).for('update');
        const scope = auditActorId ? 'admin-photo-save:' + auditActorId : 'photo-save';
        const cached = await storage.replay(ex, ownerId, scope, body.clientMutationId, body); if (cached.found) return cached.response;
        if (new Set(body.items.map(i => i.mediaId)).size !== body.items.length) throw new DomainError('DUPLICATE_PHOTO', '同一张照片不能重复保存。');
        for (const item of body.items) {
          if (!isDate(item.takenOn)) throw new DomainError('INVALID_DATE', '请填写有效的拍摄日期。');
          if (item.place && (!item.place.label.trim() || item.place.label.trim().length > 100)) throw new DomainError('INVALID_PLACE', '请填写拍摄地点名称。');
          const [media] = await ex.select().from(s.media).where(and(eq(s.media.id, item.mediaId), eq(s.media.ownerId, ownerId), eq(s.media.state, 'ready')));
          if (!media) throw new DomainError('NOT_FOUND', '照片不存在或无权使用。', 404);
          const [old] = await ex.select().from(s.photoMemories).where(eq(s.photoMemories.mediaId, item.mediaId));
          if (auditActorId && old?.hidden) throw new DomainError('PHOTO_HIDDEN', '这张照片已隐藏，请先在回忆中核对。', 409);
          if ((old?.version ?? 0) !== item.baseVersion) throw new DomainError('VERSION_CONFLICT', '照片信息已在其他页面更新，请重新打开后修改。', 409);
          const fields = { takenOn: item.takenOn, place: item.place ? { ...item.place, label: item.place.label.trim(), cityName: item.place.cityName.trim() } : null, note: item.note, hidden: false, updatedAt: new Date() };
          if (old) await ex.update(s.photoMemories).set({ ...fields, version: old.version + 1 }).where(eq(s.photoMemories.mediaId, item.mediaId));
          else await ex.insert(s.photoMemories).values({ ...fields, mediaId: item.mediaId, ownerId, createdAt: new Date() });
          if (auditActorId) await ex.insert(s.auditEvents).values({ id: randomUUID(), actorId: auditActorId, action: 'photo.update', targetId: item.mediaId, createdAt: new Date() });
        }
        if (body.groupNote) {
          const n = body.groupNote;
          if (!body.items.some(p => photoGroupKey(p) === n.key)) throw new DomainError('INVALID_GROUP', '整组备注与当前照片的日期或地点不一致。');
          const [old] = await ex.select().from(s.photoNotes).where(and(eq(s.photoNotes.ownerId, ownerId), eq(s.photoNotes.groupKey, n.key)));
          if ((old?.version ?? 0) !== n.version) throw new DomainError('VERSION_CONFLICT', '这一组备注已更新，请重新打开后修改。', 409);
          if (old) await ex.update(s.photoNotes).set({ note: n.note, version: old.version + 1 }).where(eq(s.photoNotes.id, old.id));
          else await ex.insert(s.photoNotes).values({ id: randomUUID(), ownerId, groupKey: n.key, note: n.note });
        }
        const result = { saved: body.items.map(p => p.mediaId) }; await storage.remember(ex, ownerId, scope, body.clientMutationId, body, result); return result;
      });
    },
    async remove(ownerId: string, mediaId: string, body: { baseVersion: number; clientMutationId: string }) {
      return db.transaction(async ex => {
        await ex.select({ id: s.users.id }).from(s.users).where(eq(s.users.id, ownerId)).for('update');
        const scope = 'photo-remove:' + mediaId, cached = await storage.replay(ex, ownerId, scope, body.clientMutationId, body); if (cached.found) return cached.response as { removedIds: string[] };
        const [image] = await ex.select().from(s.media).where(and(eq(s.media.id, mediaId), eq(s.media.ownerId, ownerId), eq(s.media.state, 'ready')));
        if (!image) throw new DomainError('NOT_FOUND', '照片不存在或无权操作。', 404);
        const [old] = await ex.select().from(s.photoMemories).where(eq(s.photoMemories.mediaId, mediaId));
        if ((old?.version ?? 0) !== body.baseVersion) throw new DomainError('VERSION_CONFLICT', '照片已更新，请重新打开后操作。', 409);
        const now = new Date();
        if (old) await ex.update(s.photoMemories).set({ hidden: true, version: old.version + 1, updatedAt: now }).where(eq(s.photoMemories.mediaId, mediaId));
        else await ex.insert(s.photoMemories).values({ mediaId, ownerId, note: '', place: null, takenOn: null, hidden: true, createdAt: now, updatedAt: now });
        const diaryLinks = await ex.select().from(s.diaryPhotos).where(eq(s.diaryPhotos.mediaId, mediaId));
        const removedIds = diaryLinks.length ? [] : [mediaId];
        if (removedIds.length) await ex.update(s.media).set({ state: 'deleted' }).where(eq(s.media.id, mediaId));
        const result = { removedIds }; await storage.remember(ex, ownerId, scope, body.clientMutationId, body, result); return result;
      });
    },
  };
}
