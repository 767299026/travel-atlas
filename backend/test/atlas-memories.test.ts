import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { config } from '../src/config.js';
import { openDatabase } from '../src/db/client.js';
import { migrate, removeTestTables } from '../src/db/migrate.js';
import { hashPassword } from '../src/security.js';
import { buildApp } from '../src/app.js';
import { resolvePlace } from '../src/atlas-catalog.js';

test('atlas memory cards aggregate owned records and retain explicit journey order', async t => {
  const cfg = { ...config, prefix: 'tjt_' + randomBytes(4).toString('hex') + '_', loginRateMax: 100, rateLimitMax: 1000 }, database = openDatabase(cfg), s = database.schema, db = database.db;
  const owner = randomUUID(), other = randomUUID(), password = randomBytes(24).toString('hex'), now = new Date(), origin = cfg.origins[0]!; let app: Awaited<ReturnType<typeof buildApp>> | undefined;
  try {
    await migrate(database.pool, cfg.prefix); const passwordHash = await hashPassword(password);
    await db.insert(s.users).values([{ id: owner, username: 'memory-owner', displayName: 'Owner', passwordHash, createdAt: now }, { id: other, username: 'memory-other', displayName: 'Other', passwordHash, createdAt: now }]);
    app = await buildApp(cfg, database, { routingWorker: false });
    const login = async (username: string) => { const r = await app!.inject({ method: 'POST', url: '/api/v1/auth/login', headers: { origin }, payload: { username, password } }); assert.equal(r.statusCode, 200); return { cookie: 'atlas_session=' + r.cookies[0]!.value }; };
    const headers = await login('memory-owner'), otherHeaders = await login('memory-other');
    const get = async (path = '', auth = headers) => { const r = await app!.inject({ url: '/api/v1/atlas' + path, headers: auth }); assert.equal(r.statusCode, 200); return r.json().data; };
    const places = await Promise.all(['420100', '430100', '450300'].map(areaCode => resolvePlace({ countryCode: 'CHN', areaCode })));
    const journeyId = randomUUID(), routeId = randomUUID(), dayId = randomUUID(), stopIds = places.map(() => randomUUID());
    await db.insert(s.journeys).values({ id: journeyId, ownerId: owner, title: '跨城记忆验证', destinations: places.map(p => p.name), status: 'completed', timezone: 'Asia/Shanghai', version: 1, createdAt: now, updatedAt: now });
    await db.insert(s.routes).values({ id: routeId, journeyId, ownerId: owner, layer: 'actual', version: 1, note: '', createdAt: now, updatedAt: now });
    await db.insert(s.days).values({ id: dayId, routeId, sortOrder: 0, title: '一天', area: '', date: '2026-10-01', stayName: '' });
    await db.insert(s.stops).values(stopIds.map((id, i) => ({ id, routeId, dayId, sortOrder: i * 2, label: places[i]!.name, region: '', time: null, note: '', role: 'visit' as const, location: null })));
    await db.insert(s.visits).values(stopIds.map((stopId, i) => ({ id: randomUUID(), ownerId: owner, journeyId, routeId, stopId, place: places[i]!, location: null, version: 1, label: places[i]!.name, region: '', visitedOn: i === 0 ? '2025-12-31' : '2026-01-01', note: '', createdAt: now })));
    const diaryId = randomUUID(), older = randomUUID(), foreign = randomUUID(), mediaIds = Array.from({ length: 4 }, () => randomUUID());
    await db.insert(s.diaries).values([{ id: diaryId, ownerId: owner, title: '跨城图文', occurredOn: '2026-01-01', body: '', status: 'written' as const, association: { journeyId, routeId: null, dayId: null, stopId: null, journeyTitle: '跨城记忆验证', dayTitle: null, stopLabel: null }, version: 1, createdAt: now, updatedAt: now }, { id: older, ownerId: owner, title: '去年的图文', occurredOn: '2025-12-31', body: '', status: 'written' as const, association: { journeyId, routeId: null, dayId: null, stopId: null, journeyTitle: '跨城记忆验证', dayTitle: null, stopLabel: null }, version: 1, createdAt: now, updatedAt: now }, { id: foreign, ownerId: other, title: '他人的图文', occurredOn: '2026-01-01', body: '', status: 'written' as const, association: { journeyId, routeId: null, dayId: null, stopId: null, journeyTitle: '', dayTitle: null, stopLabel: null }, version: 1, createdAt: now, updatedAt: now }]);
    await db.insert(s.media).values(mediaIds.map((id, i) => ({ id, ownerId: i === 2 ? other : owner, filename: 'fixture.jpg', extension: 'jpg', width: 10, height: 10, originalBytes: 10, storedBytes: 10, checksum: id, state: i === 3 ? 'deleted' as const : 'ready' as const, createdAt: now })));
    await db.insert(s.diaryPhotos).values(mediaIds.map((mediaId, i) => ({ id: randomUUID(), diaryId, mediaId, sortOrder: i, caption: '' })));
    await t.test('year-specific cards count full owned memories and label a related journey cover', async () => {
      const result = await get('?year=2026'); assert.equal(result.places.length, 2);
      for (const city of result.places) { assert.equal(city.diaries, 1); assert.equal(city.photos, 2); assert.equal(city.cover.kind, 'journey'); assert.equal(city.cover.diaryId, diaryId); assert.equal(city.firstRecordedOn, '2026-01-01'); }
      assert.equal(result.connections.length, 1); assert.equal(result.connections[0].from.key, places[1]!.key); assert.equal(result.connections[0].to.key, places[2]!.key);
    });
    await t.test('covers and counts retain owner and year boundaries', async () => {
      const result = await get('?year=2025'); assert.equal(result.places[0].diaries, 1); assert.equal(result.places[0].photos, 0); assert.equal(result.places[0].cover, null);
      const theirs = await get('', otherHeaders); assert.equal(theirs.places.length, 0); assert.deepEqual(theirs.connections, []);
    });
    await t.test('first record and counts are independent of record pagination and wishes', async () => {
      await db.insert(s.placeRecords).values(Array.from({ length: 40 }, (_, i) => ({ id: randomUUID(), ownerId: owner, kind: 'visited' as const, placeKey: places[0]!.key, place: places[0]!, visitedOn: i === 0 ? '2001-01-01' : '2026-01-02', note: '', version: 1, createdAt: now })));
      const city = (await get()).places.find((p: any) => p.place.key === places[0]!.key); assert.equal(city.records, 41); assert.equal(city.firstRecordedOn, '2001-01-01'); assert.equal(city.lastVisitedOn, '2026-01-02'); assert.equal((await get('/places/' + encodeURIComponent(places[0]!.key))).records.length, 30);
    });
    await t.test('unconfirmed intermediate stops break the introduction connection', async () => {
      await db.insert(s.stops).values({ id: randomUUID(), routeId, dayId, sortOrder: 3, label: '尚未确认的中间点', region: '', time: null, note: '', role: 'waypoint', location: null });
      assert.equal((await get('?year=2026')).connections.length, 0);
    });
    await t.test('removed geometry does not create a made-up route card', async () => {
      const layer = await get('/cities/430100'); assert.equal(layer.paths.length, 0);
      await db.delete(s.stops).where(eq(s.stops.id, stopIds[1]!)); assert.equal((await get('?year=2026')).connections.length, 0);
    });
  } finally { await app?.close(); await removeTestTables(database.pool, cfg.prefix); await database.pool.end(); }
});
