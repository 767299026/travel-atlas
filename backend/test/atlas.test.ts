import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { config } from '../src/config.js';
import { openDatabase } from '../src/db/client.js';
import { migrate, removeTestTables } from '../src/db/migrate.js';
import { hashPassword } from '../src/security.js';
import { buildApp } from '../src/app.js';
test('prototype pages: atlas, wishes, records, filters and personal settings', async t => {
  const cfg = { ...config, prefix: 'tjt_' + randomBytes(4).toString('hex') + '_', loginRateMax: 100, rateLimitMax: 1000 };
  const database = openDatabase(cfg), ownerId = randomUUID(), otherId = randomUUID(), password = randomBytes(24).toString('base64url'), origin = cfg.origins[0]!;
  let app: Awaited<ReturnType<typeof buildApp>> | undefined;
  try {
    await migrate(database.pool, cfg.prefix); const passwordHash = await hashPassword(password);
    await database.db.insert(database.schema.users).values([{ id: ownerId, username: 'atlas-owner', displayName: 'Owner', passwordHash, createdAt: new Date() }, { id: otherId, username: 'atlas-other', displayName: 'Other', passwordHash, createdAt: new Date() }]);
    app = await buildApp(cfg, database, { routingWorker: false });
    const login = async (username: string, supplied = password) => { const r = await app!.inject({ method: 'POST', url: '/api/v1/auth/login', headers: { origin }, payload: { username, password: supplied } }); assert.equal(r.statusCode, 200); return { origin, cookie: 'atlas_session=' + r.cookies[0]!.value, 'x-csrf-token': r.json().data.csrfToken }; };
    const owner = await login('atlas-owner'), other = await login('atlas-other');
    const get = (path: string, headers = owner) => app!.inject({ url: '/api/v1' + path, headers });
    const call = (path: string, payload: unknown, method: 'POST' | 'PUT' | 'PATCH' | 'DELETE' = 'POST', headers = owner) => app!.inject({ url: '/api/v1' + path, method, headers, payload });
    const wuhan = { countryCode: 'CHN', areaCode: '420100' }, hangzhou = { countryCode: 'CHN', areaCode: '330100' };
    const input = { kind: 'visited', place: wuhan, visitedOn: '2025-05-01', note: '<script>not executable</script>', clientMutationId: randomUUID() };
    let manual: any, wish: any, visit: any, route: any, journey: any;
    await t.test('catalog and maps require login and only allow known map identifiers', async () => {
      assert.equal((await get('/atlas', {} as any)).statusCode, 401); const c = (await get('/atlas/catalog')).json().data; assert.equal(c.provinces.length, 34); assert.ok(c.cities.some((x: any) => x.code === '420100')); assert.ok(c.countries.some((x: any) => x.code === 'JPN'));
      assert.equal((await get('/atlas/maps/world')).statusCode, 200); assert.equal((await get('/atlas/maps/100000')).statusCode, 200); assert.equal((await get('/atlas/maps/999999')).statusCode, 404); assert.equal((await get('/atlas?year=2026%20OR%201=1')).statusCode, 400);
    });
    await t.test('manual visits are explicit, idempotent and independently owner-scoped', async () => {
      const first = await call('/atlas/records', input); assert.equal(first.statusCode, 200); manual = first.json().data; assert.equal((await call('/atlas/records', input)).json().data.id, manual.id);
      assert.equal((await call('/atlas/records/' + manual.id, { ...input, baseVersion: 1 }, 'PUT', other)).statusCode, 404);
      let overview = (await get('/atlas')).json().data; assert.equal(overview.countries, 1); assert.equal(overview.provinces, 1); assert.equal(overview.cities, 1); assert.equal(overview.records, 1); assert.equal((await get('/atlas', other)).json().data.records, 0);
      assert.equal((await call('/atlas/records', { ...input, place: { ...wuhan, areaCode: '999999' }, clientMutationId: randomUUID() })).statusCode, 422);
      assert.equal((await call('/atlas/records', { ...input, visitedOn: '2025-02-30', clientMutationId: randomUUID() })).statusCode, 422);
      assert.equal((await call('/atlas/records', { ...input, location: { longitude: 1 }, clientMutationId: randomUUID() })).statusCode, 400);
    });
    await t.test('wishlist is unique per city and never lights visited statistics', async () => {
      const body = { kind: 'wish', place: hangzhou, visitedOn: null, note: '秋天去走走', clientMutationId: randomUUID() };
      const results = await Promise.all([call('/atlas/records', body), call('/atlas/records', { ...body, clientMutationId: randomUUID() })]); assert.deepEqual(results.map(r => r.statusCode).sort(), [200, 409]); wish = results.find(r => r.statusCode === 200)!.json().data;
      const o = (await get('/atlas')).json().data; assert.equal(o.cities, 1); assert.equal(o.wishes, 1); assert.equal(o.places.find((p: any) => p.place.key === 'CHN:330100').records, 0);
      assert.equal((await call('/atlas/records', { ...body, visitedOn: '2026-01-01', clientMutationId: randomUUID() })).statusCode, 422);
    });
    await t.test('unknown years and province-only records are not invented city visits', async () => {
      assert.equal((await call('/atlas/records', { ...input, place: { countryCode: 'CHN', areaCode: '530000' }, visitedOn: null, clientMutationId: randomUUID() })).statusCode, 200);
      const o = (await get('/atlas?year=unknown')).json().data; assert.equal(o.records, 1); assert.equal(o.provinces, 1); assert.equal(o.cities, 0); assert.equal(o.wishes, 1); assert.ok(o.years.includes('unknown')); assert.equal((await get('/atlas?year=2024')).json().data.records, 0);
    });
    await t.test('world cities use explicit names without fake coordinates or duplicate case variants', async () => {
      const body = { kind: 'visited', place: { countryCode: 'JPN', cityName: 'Tokyo' }, visitedOn: '2026-01-01', note: '', clientMutationId: randomUUID() };
      const r = await call('/atlas/records', body); assert.equal(r.statusCode, 200); assert.equal(r.json().data.place.center, null);
      await call('/atlas/records', { ...body, place: { countryCode: 'JPN', cityName: ' TOKYO ' }, clientMutationId: randomUUID() }); assert.equal((await get('/atlas?year=2026')).json().data.cities, 1); assert.equal((await get('/atlas')).json().data.countries, 2);
    });
    await t.test('unlisted domestic cities retain province and explicit names without guessed centers', async () => {
      const response = await call('/atlas/records', { ...input, place: { countryCode: 'CHN', areaCode: '710000', cityName: '台北市' }, visitedOn: '2023-04-01', clientMutationId: randomUUID() }); assert.equal(response.statusCode, 200); const place = response.json().data.place;
      assert.equal(place.center, null); assert.equal(place.provinceCode, '710000'); assert.equal(place.cityName, '台北市'); assert.equal((await get('/atlas/places/' + encodeURIComponent(place.key))).json().data.records.length, 1);
    });
    await t.test('new plans and actual copies never create footprints', async () => {
      const c = await call('/journeys', { title: '武汉之行', destinations: ['武汉市'], origin: '', duration: 1, startDate: '2026-10-20', clientMutationId: randomUUID() }); journey = c.json().data.journey; route = c.json().data.route;
      route = (await call('/routes/' + route.id + '/commands', { baseVersion: route.version, clientMutationId: randomUUID(), operations: [{ type: 'add_stop', dayId: route.days[0].id, clientRef: 'draft:atlas', stop: { label: '黄鹤楼', region: '武汉市', note: '', role: 'visit', time: null, location: { longitude: 114.3, latitude: 30.5, crs: 'WGS84' } }, arrivalMode: 'unknown' }] })).json().data.route;
      const before = (await get('/atlas')).json().data.records; route = (await call('/journeys/' + journey.id + '/actual-copy', { planVersion: route.version, actualVersion: null, dayIds: [route.days[0].id], mode: 'append', clientMutationId: randomUUID() })).json().data.route; assert.equal((await get('/atlas')).json().data.records, before);
      const r = await call('/routes/' + route.id + '/stops/' + route.days[0].stops[0].id + '/visit', { routeVersion: route.version, visitedOn: '2026-10-20', note: '我确认去过', clientMutationId: randomUUID() }); assert.equal(r.statusCode, 200); visit = r.json().data;
      assert.equal((await get('/atlas')).json().data.unassigned, 1);
    });
    await t.test('legacy visits can be assigned with version protection and remain after stop removal', async () => {
      const body = { place: wuhan, baseVersion: visit.version, clientMutationId: randomUUID() }; assert.equal((await call('/visits/' + visit.id + '/place', body, 'PUT')).statusCode, 200); assert.equal((await call('/visits/' + visit.id + '/place', body, 'PUT')).statusCode, 200);
      assert.equal((await call('/visits/' + visit.id + '/place', { ...body, clientMutationId: randomUUID() }, 'PUT')).statusCode, 409); assert.equal((await get('/atlas')).json().data.unassigned, 0);
      const d = (await get('/atlas/places/CHN%3A420100?year=2026')).json().data; assert.equal(d.journeys[0].id, journey.id); assert.ok(d.plans.some((p: any) => p.id === journey.id));
      await call('/routes/' + route.id + '/commands', { baseVersion: route.version, clientMutationId: randomUUID(), operations: [{ type: 'remove_stop', stopId: route.days[0].stops[0].id }] });
      assert.equal((await get('/atlas/places/CHN%3A420100?year=2026')).json().data.records[0].detached, true); const [stored] = await database.db.select().from(database.schema.visits).where(eq(database.schema.visits.id, visit.id)); assert.equal(stored!.location!.longitude, 114.3);
    });
    await t.test('city drawer links only owner diaries; collection filters apply on the server', async () => {
      const diary = { title: '黄鹤楼记忆', occurredOn: '2026-10-20', body: '江畔散步', status: 'written', association: { journeyId: journey.id, routeId: null, dayId: null, stopId: null }, photos: [], clientMutationId: randomUUID() };
      assert.equal((await call('/diaries', diary)).statusCode, 200); await call('/diaries', { ...diary, title: '草稿', status: 'draft', occurredOn: null, clientMutationId: randomUUID() });
      assert.equal((await get('/diaries?status=written&year=2026&q=江畔')).json().data.items.length, 1); assert.equal((await get('/diaries?status=draft&year=unknown')).json().data.items.length, 1);
      assert.equal((await get('/atlas/places/CHN%3A420100')).json().data.diaries.length, 2); assert.equal((await get('/atlas/places/CHN%3A420100', other)).json().data.diaries.length, 0);
      assert.equal((await get('/journeys?status=planning&q=武汉')).json().data.items.length, 1); assert.equal((await get('/journeys?status=completed')).json().data.items.length, 0); assert.equal((await get('/journeys?status=unknown')).statusCode, 400);
    });
    await t.test('record editing and deletion require current versions and keep business data', async () => {
      assert.equal((await call('/atlas/records/' + manual.id, { ...input, baseVersion: 99 }, 'PUT')).statusCode, 409);
      const changed = await call('/atlas/records/' + manual.id, { ...input, note: '更新备注', baseVersion: 1, clientMutationId: randomUUID() }, 'PUT'); assert.equal(changed.json().data.version, 2);
      assert.equal((await call('/atlas/records/' + manual.id, { baseVersion: 1, clientMutationId: randomUUID() }, 'DELETE')).statusCode, 409);
      assert.equal((await call('/atlas/records/' + manual.id, { baseVersion: 2, clientMutationId: randomUUID() }, 'DELETE')).statusCode, 200); assert.equal((await get('/journeys/' + journey.id)).statusCode, 200);
      assert.equal((await call('/atlas/records/' + wish.id, { baseVersion: 1, clientMutationId: randomUUID() }, 'DELETE', other)).statusCode, 404);
    });
    await t.test('personal name saves are versioned and cannot edit roles', async () => {
      const p = (await get('/me/profile')).json().data, body = { displayName: '旅行的人', baseVersion: p.version, clientMutationId: randomUUID() };
      const saved = await call('/me/profile', body, 'PATCH'); assert.equal(saved.statusCode, 200); assert.equal((await call('/me/profile', body, 'PATCH')).json().data.version, saved.json().data.version);
      assert.equal((await call('/me/profile', { ...body, clientMutationId: randomUUID() }, 'PATCH')).statusCode, 409); assert.equal((await call('/me/profile', { ...body, role: 'owner' }, 'PATCH')).statusCode, 400); assert.equal((await get('/me/profile', other)).json().data.displayName, 'Other');
    });
    await t.test('self password change validates old password and revokes all own sessions', async () => {
      const p = (await get('/me/profile')).json().data, newPassword = randomBytes(24).toString('base64url'), another = await login('atlas-owner');
      assert.equal((await call('/me/password', { baseVersion: p.version, currentPassword: 'wrong-password', newPassword })).statusCode, 403);
      assert.equal((await call('/me/password', { baseVersion: p.version, currentPassword: password, newPassword })).statusCode, 200);
      assert.equal((await get('/me/profile')).statusCode, 401); assert.equal((await get('/me/profile', another)).statusCode, 401); assert.equal((await get('/me/profile', other)).statusCode, 200); await login('atlas-owner', newPassword);
    });
  } finally { if (app) await app.close(); await removeTestTables(database.pool, cfg.prefix); await database.pool.end(); }
});
