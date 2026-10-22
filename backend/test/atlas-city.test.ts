import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { config } from '../src/config.js';
import { openDatabase } from '../src/db/client.js';
import { migrate, removeTestTables } from '../src/db/migrate.js';
import { hashPassword } from '../src/security.js';
import { buildApp } from '../src/app.js';

test('city footprint layers retain location provenance and owner boundaries', async t => {
  const cfg = { ...config, prefix: 'tjt_' + randomBytes(4).toString('hex') + '_', loginRateMax: 100, rateLimitMax: 1000 }, db = openDatabase(cfg), password = randomBytes(24).toString('base64url'), origin = cfg.origins[0]!;
  let app: Awaited<ReturnType<typeof buildApp>> | undefined;
  try {
    await migrate(db.pool, cfg.prefix); const passwordHash = await hashPassword(password);
    await db.db.insert(db.schema.users).values(['city-owner', 'city-other'].map(username => ({ id: randomUUID(), username, displayName: username, passwordHash, createdAt: new Date() })));
    app = await buildApp(cfg, db, { routingWorker: false });
    const login = async (username: string) => { const r = await app!.inject({ method: 'POST', url: '/api/v1/auth/login', headers: { origin }, payload: { username, password } }); assert.equal(r.statusCode, 200); return { origin, cookie: 'atlas_session=' + r.cookies[0]!.value, 'x-csrf-token': r.json().data.csrfToken }; };
    const owner = await login('city-owner'), other = await login('city-other');
    const get = (path: string, headers = owner) => app!.inject({ url: '/api/v1' + path, headers });
    const post = async (path: string, payload: unknown, method: 'POST' | 'PUT' = 'POST') => { const r = await app!.inject({ url: '/api/v1' + path, method, headers: owner, payload }); assert.ok(r.statusCode >= 200 && r.statusCode < 300, r.body); return r.json().data; };
    const commands = (r: any, operations: unknown[]) => post('/routes/' + r.id + '/commands', { baseVersion: r.version, clientMutationId: randomUUID(), operations });
    const created = await post('/journeys', { title: '城市图层测试', destinations: ['武汉市'], origin: '', duration: 1, startDate: '2026-10-01', clientMutationId: randomUUID() });
    let route: any = await post('/journeys/' + created.journey.id + '/actual', { clientMutationId: randomUUID() });
    route = (await commands(route, [0, 1].map(i => ({ type: 'add_stop', dayId: route.days[0].id, clientRef: 'draft:p' + i, arrivalMode: 'walk', stop: { label: '位置' + i, region: '武汉', note: '', time: null, role: 'visit', location: { longitude: 114.3 + i * .01, latitude: 30.5, crs: i === 0 ? 'WGS84' : 'GCJ02' } } })))).route;
    const stops = route.days[0].stops;
    const geo = await post('/routes/' + route.id + '/segments/' + route.segments[0].id + '/geometry', { baseVersion: route.version, clientMutationId: randomUUID(), expectedGeometryRef: null, kind: 'manual', sourceNote: '测试示意', geometry: { crs: 'GCJ02', parts: [[[114.3, 30.5], [114.31, 30.5]]] } }, 'PUT'); route = geo.route;
    await t.test('authentication and city parameters are enforced', async () => {
      assert.equal((await get('/atlas/cities/420100', {} as any)).statusCode, 401); assert.equal((await get('/atlas/cities/999999')).statusCode, 422); assert.equal((await get('/atlas/cities/420000')).statusCode, 422); assert.equal((await get('/atlas/cities/420100?year=oops')).statusCode, 400);
      assert.equal((await get('/atlas/cities/420100')).json().data.points.length, 0);
    });
    for (const stop of stops) await post('/routes/' + route.id + '/stops/' + stop.id + '/visit', { routeVersion: route.version, visitedOn: '2026-10-01', note: '', place: { countryCode: 'CHN', areaCode: '420100' }, clientMutationId: randomUUID() });
    await t.test('confirmed snapshot coordinates retain their CRS and no plan points leak', async () => {
      const data = (await get('/atlas/cities/420100')).json().data; assert.equal(data.points.length, 2); assert.deepEqual(data.points.map((p: any) => p.location.crs).sort(), ['GCJ02', 'WGS84']); assert.equal(data.paths.length, 1); assert.equal(data.paths[0].sourceKind, 'manual');
      assert.equal((await get('/atlas/cities/420100', other)).json().data.points.length, 0); assert.equal((await get('/atlas/cities/420100', other)).json().data.paths.length, 0);
      assert.equal((await get('/atlas/cities/420100?year=2025')).json().data.points.length, 0); assert.equal((await get('/atlas/cities/420100?year=2025')).json().data.paths.length, 0);
    });
    await t.test('manual city records count as unlocated instead of fake city-center pins', async () => {
      await post('/atlas/records', { kind: 'visited', place: { countryCode: 'CHN', areaCode: '420100' }, visitedOn: '2026-10-01', note: '', clientMutationId: randomUUID() });
      const data = (await get('/atlas/cities/420100')).json().data; assert.equal(data.points.length, 2); assert.equal(data.withoutLocation, 1);
    });
    await t.test('dense paths are sampled for display while preserving independent parts and original assets', async () => {
      const parts = [0, 1].map(j => Array.from({ length: 500 }, (_, i) => [114.3 + i * .00001, 30.5 + j * .01]));
      const saved = await post('/routes/' + route.id + '/segments/' + route.segments[0].id + '/geometry', { baseVersion: route.version, expectedGeometryRef: route.segments[0].geometryRef, clientMutationId: randomUUID(), kind: 'manual', sourceNote: '多段显示抽样测试', geometry: { crs: 'GCJ02', parts } }, 'PUT'); route = saved.route;
      const data = (await get('/atlas/cities/420100')).json().data; assert.equal(data.sampled, true); assert.equal(data.paths[0].geometry.parts.length, 2); assert.ok(data.paths[0].geometry.parts.flat().length <= 300);
      assert.deepEqual(data.paths[0].geometry.parts[0][0], parts[0]![0]); assert.deepEqual(data.paths[0].geometry.parts[1].at(-1), parts[1]!.at(-1));
      const asset = (await get('/geometries/' + saved.asset.id)).json().data; assert.equal(asset.pointCount, 1000); assert.equal(asset.geometry.parts.flat().length, 1000);
    });
    await t.test('changed stop coordinates do not rewrite snapshots or retain invalid paths', async () => {
      route = (await commands(route, [{ type: 'update_stop', stopId: stops[0].id, patch: { location: { longitude: 115, latitude: 30, crs: 'WGS84' } } }])).route;
      const data = (await get('/atlas/cities/420100')).json().data; assert.equal(data.points.find((p: any) => p.label === '位置0').location.longitude, 114.3); assert.equal(data.paths.length, 0);
    });
    await t.test('removing current stop retains the historical city footprint', async () => {
      await commands(route, [{ type: 'remove_stop', stopId: stops[0].id }]); const data = (await get('/atlas/cities/420100')).json().data; assert.equal(data.points.length, 2); assert.equal(data.paths.length, 0);
    });
  } finally { if (app) await app.close(); await removeTestTables(db.pool, cfg.prefix); await db.pool.end(); }
});
