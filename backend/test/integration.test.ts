import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID, randomBytes } from 'node:crypto';
import { config } from '../src/config.js';
import { openDatabase } from '../src/db/client.js';
import { migrate, removeTestTables } from '../src/db/migrate.js';
import { buildApp } from '../src/app.js';
import { hashPassword } from '../src/security.js';
import type { JourneySummary, RouteSnapshot, CommandResult, RouteCommand } from '../../packages/contracts/src/index.js';

test('M1 real MySQL integration (isolated table prefix)', async t => {
  const cfg = { ...config, prefix: 'tjt_' + randomBytes(4).toString('hex') + '_', loginRateMax: 100 };
  const database = openDatabase(cfg); let app: Awaited<ReturnType<typeof buildApp>> | undefined;
  const password = randomBytes(24).toString('base64url'); const origin = cfg.origins[0]!;
  try {
    try { await migrate(database.pool, cfg.prefix); await migrate(database.pool, cfg.prefix); }
    catch { throw new Error('Isolated MySQL migration failed; credentials and SQL omitted'); }
    const passwordHash = await hashPassword(password);
    for (const username of ['fixture-owner', 'fixture-other']) await database.db.insert(database.schema.users).values({ id: randomUUID(), username, displayName: username, passwordHash, createdAt: new Date() });
    app = await buildApp(cfg, database);
    const login = async (username = 'fixture-owner') => {
      const res = await app!.inject({ method: 'POST', url: '/api/v1/auth/login', headers: { origin }, payload: { username, password } }); assert.equal(res.statusCode, 200);
      return { cookie: res.cookies[0]!.name + '=' + res.cookies[0]!.value, origin, 'x-csrf-token': res.json().data.csrfToken as string };
    };
    const auth = await login(), other = await login('fixture-other');
    const get = (url: string, headers = auth) => app!.inject({ method: 'GET', url, headers });
    const post = (url: string, payload: unknown, headers = auth) => app!.inject({ method: 'POST', url, headers, payload });
    let journey: JourneySummary, route: RouteSnapshot;
    await t.test('authentication, origin, CSRF and strict validation', async () => {
      assert.equal((await app!.inject('/api/v1/journeys')).statusCode, 401);
      assert.equal((await app!.inject({ method: 'POST', url: '/api/v1/auth/login', headers: { origin }, payload: { username: 'fixture-owner', password: 'wrong' } })).statusCode, 401);
      assert.equal((await post('/api/v1/auth/logout', undefined, { ...auth, origin: 'https://untrusted.invalid' })).statusCode, 403);
      assert.equal((await post('/api/v1/auth/logout', undefined, { ...auth, 'x-csrf-token': 'invalid' })).statusCode, 403);
      assert.equal((await post('/api/v1/auth/logout', undefined, { ...auth, 'x-csrf-token': 'é'.repeat(auth['x-csrf-token'].length) })).statusCode, 403);
      const response = await post('/api/v1/journeys', { title: 'x', duration: '2', unexpected: true }); assert.equal(response.statusCode, 400);
      assert.ok(!response.body.includes(password));
    });
    await t.test('create, idempotent retry and multiple destinations', async () => {
      const body = { title: '集成验证旅程', destinations: ['黄山', '宏村'], origin: '杭州东站', startDate: null, duration: 2, clientMutationId: randomUUID() };
      const first = await post('/api/v1/journeys', body); assert.equal(first.statusCode, 201); ({ journey, route } = first.json().data);
      assert.equal(route.days.length, 2); assert.equal(route.days[0]!.date, null); assert.equal(route.days[0]!.stops[0]!.location, null);
      assert.deepEqual(journey.destinations, body.destinations);
      assert.deepEqual((await post('/api/v1/journeys', body)).json().data, first.json().data);
      assert.equal((await post('/api/v1/journeys', { ...body, title: '变更内容' })).statusCode, 409);
      assert.equal((await get('/api/v1/journeys')).json().data.items.length, 1);
    });
    await t.test('owner boundaries on read and mutation', async () => {
      assert.equal((await get('/api/v1/journeys/' + journey.id, other)).statusCode, 404);
      assert.equal((await get('/api/v1/routes/' + route.id, other)).statusCode, 404);
      assert.equal((await post('/api/v1/routes/' + route.id + '/commands', { baseVersion: 1, clientMutationId: randomUUID(), operations: [{ type: 'set_route_note', note: 'intrusion' }] }, other)).statusCode, 404);
      assert.equal((await get('/api/v1/journeys', other)).json().data.items.length, 0);
    });
    const commands = async (operations: RouteCommand[], extra?: { baseVersion?: number; clientMutationId?: string }) => {
      const body = { baseVersion: route.version, clientMutationId: randomUUID(), operations, ...extra };
      const res = await post(`/api/v1/routes/${route.id}/commands`, body); return { res, body };
    };
    let firstStop = '', secondStop = '';
    await t.test('duplicate names keep independent IDs; exact retry preserves all fields', async () => {
      const stop = { label: '同名酒店', region: '黄山', role: 'overnight' as const, time: '18:30', note: '到店前电话确认', location: null };
      const { res, body } = await commands([
        { type: 'add_stop', clientRef: 'draft:first', dayId: route.days[0]!.id, stop, arrivalMode: 'rail' },
        { type: 'add_stop', clientRef: 'draft:second', dayId: route.days[0]!.id, stop: { ...stop, note: '另一天住宿' }, arrivalMode: 'walk' },
        { type: 'set_route_note', note: '备用计划' },
      ]); assert.equal(res.statusCode, 200); const result: CommandResult = res.json().data; route = result.route;
      firstStop = result.idMap['draft:first']!; secondStop = result.idMap['draft:second']!; assert.notEqual(firstStop, secondStop);
      assert.equal(route.days[0]!.stops.length, 3); assert.equal(route.segments.length, 2);
      assert.deepEqual((await post(`/api/v1/routes/${route.id}/commands`, body)).json().data, result);
      assert.equal((await post(`/api/v1/routes/${route.id}/commands`, { ...body, operations: [{ type: 'set_route_note', note: 'different' }] })).statusCode, 409);
    });
    await t.test('sorting and cross-day move preserve fields and invalidate changed connections', async () => {
      const original = route.days[0]!.stops.find(x => x.id === firstStop)!;
      const { res } = await commands([{ type: 'move_stop', stopId: firstStop, toDayId: route.days[1]!.id, index: 0 }]); assert.equal(res.statusCode, 200); route = res.json().data.route;
      assert.deepEqual(route.days[1]!.stops[0], original); assert.equal(route.note, '备用计划');
      assert.equal(route.segments.find(x => x.toStopId === firstStop)!.kind, 'gap');
      const moved = await commands([{ type: 'move_stop', stopId: secondStop, toDayId: route.days[0]!.id, index: 0 }]); assert.equal(moved.res.statusCode, 200); route = moved.res.json().data.route;
      assert.equal(route.days[0]!.stops[0]!.id, secondStop);
    });
    await t.test('invalid reference and invalid date roll back the full batch', async () => {
      const before = (await get('/api/v1/routes/' + route.id)).json().data;
      const { res } = await commands([{ type: 'set_route_note', note: 'should roll back' }, { type: 'remove_stop', stopId: randomUUID() }]); assert.equal(res.statusCode, 422);
      assert.deepEqual((await get('/api/v1/routes/' + route.id)).json().data, before);
      assert.equal((await commands([{ type: 'update_day', dayId: route.days[0]!.id, patch: { date: '2026-02-30' } }])).res.statusCode, 422);
      assert.deepEqual((await get('/api/v1/routes/' + route.id)).json().data, before);
    });
    await t.test('concurrent saves have exactly one winner, metadata has an independent version', async () => {
      const baseVersion = route.version;
      const responses = await Promise.all(['A', 'B'].map(note => post(`/api/v1/routes/${route.id}/commands`, { baseVersion, clientMutationId: randomUUID(), operations: [{ type: 'set_route_note', note }] })));
      assert.deepEqual(responses.map(x => x.statusCode).sort(), [200, 409]); route = responses.find(x => x.statusCode === 200)!.json().data.route;
      const metadata = await app!.inject({ method: 'PATCH', url: '/api/v1/journeys/' + journey.id, headers: auth, payload: { baseVersion: journey.version, title: '旅行新标题', destinations: journey.destinations, status: 'completed', clientMutationId: randomUUID() } }); assert.equal(metadata.statusCode, 200);
      assert.equal(metadata.json().data.version, 2); assert.equal((await get('/api/v1/routes/' + route.id)).json().data.version, route.version);
    });
    await t.test('application recreation restores persisted session and route; logout revokes session', async () => {
      await app!.close(); app = await buildApp(cfg, database);
      assert.equal((await get('/api/v1/auth/session')).statusCode, 200);
      const restored: RouteSnapshot = (await get('/api/v1/routes/' + route.id)).json().data;
      assert.equal(restored.version, route.version); assert.equal(restored.days[1]!.stops[0]!.id, firstStop);
      assert.equal((await post('/api/v1/auth/logout', undefined)).statusCode, 200);
      assert.equal((await get('/api/v1/journeys')).statusCode, 401);
    });
    await t.test('closed test pool returns a safe service error', async () => {
      const isolated = openDatabase(cfg), failingApp = await buildApp(cfg, isolated); await isolated.pool.end();
      try { const response = await failingApp.inject('/health'); assert.equal(response.statusCode, 503); assert.equal(response.json().error.code, 'SERVICE_UNAVAILABLE'); assert.ok(!response.body.includes(cfg.mysql.password)); }
      finally { await failingApp.close(); }
    });
  } finally { if (app) await app.close(); await removeTestTables(database.pool, cfg.prefix); await database.pool.end(); }
});
