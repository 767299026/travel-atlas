import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { eq } from 'drizzle-orm';
import { config, projectRoot } from '../src/config.js';
import { openDatabase } from '../src/db/client.js';
import { migrate, removeTestTables } from '../src/db/migrate.js';
import { hashPassword } from '../src/security.js';
import { buildApp } from '../src/app.js';
import { parseBrouterResponse } from '../src/brouter.js';
import type { RouteSnapshot, RoutingInput, RoutingJob, RoutingCandidate } from '../../packages/contracts/src/index.js';

test('M3.2 durable routing jobs, candidates and adoption', async t => {
  const cfg = { ...config, prefix: 'tjt_' + randomBytes(4).toString('hex') + '_', loginRateMax: 100, rateLimitMax: 600, routing: { endpoint: 'http://127.0.0.1:17777/brouter', engineVersion: '1.7.10', profileSha256: '1'.repeat(64), dataVersion: '2'.repeat(64), tiles: ['E115_N30'] } };
  const database = openDatabase(cfg), ownerId = randomUUID(), password = randomBytes(24).toString('base64url'), origin = cfg.origins[0]!;
  let app: Awaited<ReturnType<typeof buildApp>> | undefined, fetchMode: 'ok' | 'hold' | 'bad' = 'ok', calls = 0, release: (() => void) | undefined, entered: (() => void) | undefined;
  const fixture = JSON.parse(await readFile(projectRoot + '/docs/evidence/huangshan-brouter-2026-10-21/response.geojson', 'utf8')); fixture.features[0].properties.creator = 'BRouter-1.7.10';
  const routingFetch = (async (_url: string | URL | Request, options?: RequestInit) => { calls++; if (fetchMode === 'hold') await new Promise<void>((resolve, reject) => { release = resolve; entered?.(); options?.signal?.addEventListener('abort', () => reject(new Error('aborted')), { once: true }); }); if (fetchMode === 'bad') return new Response('private diagnostic /root/should-not-leak', { status: 500 }); return new Response(JSON.stringify(fixture)); }) as typeof fetch;
  try {
    await migrate(database.pool, cfg.prefix); const hash = await hashPassword(password);
    await database.db.insert(database.schema.users).values([{ id: ownerId, username: 'routing-owner', displayName: 'Owner', passwordHash: hash, createdAt: new Date() }, { id: randomUUID(), username: 'routing-other', displayName: 'Other', passwordHash: hash, createdAt: new Date() }]);
    app = await buildApp(cfg, database, { routingFetch, routingWorker: false });
    const login = async (username: string) => { const result = await app!.inject({ method: 'POST', url: '/api/v1/auth/login', headers: { origin }, payload: { username, password } }); assert.equal(result.statusCode, 200); return { origin, cookie: 'atlas_session=' + result.cookies[0]!.value, 'x-csrf-token': result.json().data.csrfToken }; };
    const owner = await login('routing-owner'), other = await login('routing-other');
    const get = (url: string, headers = owner) => app!.inject({ method: 'GET', url, headers });
    const call = (url: string, payload: unknown, headers = owner) => app!.inject({ method: 'POST', url, headers, payload });
    const created = await call('/api/v1/journeys', { title: 'Routing verification', destinations: ['黄山'], origin: '', duration: 1, startDate: null, clientMutationId: randomUUID() }); assert.equal(created.statusCode, 201); let route: RouteSnapshot = created.json().data.route;
    const update = async (operations: unknown[]) => { const response = await call(`/api/v1/routes/${route.id}/commands`, { baseVersion: route.version, clientMutationId: randomUUID(), operations }); assert.equal(response.statusCode, 200); route = response.json().data.route; };
    await update([{ type: 'add_stop', clientRef: 'draft:a', dayId: route.days[0]!.id, stop: { label: '云谷寺', region: '', time: null, note: '', role: 'visit', location: { longitude: 118.1875481, latitude: 30.1222091, crs: 'WGS84', source: 'outdoor_pick' } }, arrivalMode: 'unknown' }, { type: 'add_stop', clientRef: 'draft:b', dayId: route.days[0]!.id, stop: { label: '白鹅岭', region: '', time: null, note: '', role: 'visit', location: { longitude: 118.1676191, latitude: 30.1395092, crs: 'WGS84' } }, arrivalMode: 'hike' }]);
    const create = async (key = randomUUID()) => call(`/api/v1/routes/${route.id}/segments/${route.segments[0]!.id}/routing-jobs`, { baseVersion: route.version, clientMutationId: key });
    const run = async () => { assert.equal(await app!.routingWorker.runNext(), true); };
    const makeCandidate = async () => { fetchMode = 'ok'; const response = await create(); assert.equal(response.statusCode, 200); await run(); const job = (await get('/api/v1/routing-jobs/' + response.json().data.id)).json().data as RoutingJob; assert.equal(job.status, 'succeeded'); return (await get('/api/v1/routing-candidates/' + job.candidateId)).json().data as RoutingCandidate; };
    const adoption = (candidate: RoutingCandidate, extras = {}) => ({ baseVersion: route.version, clientMutationId: randomUUID(), expectedGeometryRef: route.segments[0]!.geometryRef, acknowledge: true, ...extras });
    let job: RoutingJob, candidate: RoutingCandidate;
    await t.test('capabilities and eligibility require explicit WGS84 hiking inputs', async () => {
      assert.equal((await app!.inject('/api/v1/routing/capabilities')).statusCode, 401); assert.equal((await get('/api/v1/routing/capabilities')).json().data.enabled, true);
      await update([{ type: 'set_arrival', stopId: route.days[0]!.stops[1]!.id, mode: 'walk' }]); assert.equal((await create()).statusCode, 422);
      await update([{ type: 'set_arrival', stopId: route.days[0]!.stops[1]!.id, mode: 'hike' }, { type: 'update_stop', stopId: route.days[0]!.stops[0]!.id, patch: { location: { longitude: 118.1875481, latitude: 30.1222091, crs: 'GCJ02' } } }]); assert.equal((await create()).json().error.code, 'WGS84_REQUIRED');
      await update([{ type: 'update_stop', stopId: route.days[0]!.stops[0]!.id, patch: { location: { longitude: 118.1875481, latitude: 30.1222091, crs: 'WGS84' } } }]);
    });
    await t.test('idempotent task creation, one active job, ownership and no immediate route write', async () => {
      const key = randomUUID(), first = await create(key); assert.equal(first.statusCode, 200); job = first.json().data; assert.equal(job.status, 'queued'); assert.equal((await create(key)).json().data.id, job.id); assert.equal((await create()).statusCode, 409); assert.equal((await get('/api/v1/routing-jobs/' + job.id, other)).statusCode, 404); assert.equal(calls, 0);
      assert.equal((await get('/api/v1/routes/' + route.id)).json().data.segments[0].geometryRef, null);
    });
    await t.test('worker creates bounded candidate without binding or fake GPS samples', async () => {
      await run(); job = (await get('/api/v1/routing-jobs/' + job.id)).json().data; assert.equal(job.status, 'succeeded'); candidate = (await get('/api/v1/routing-candidates/' + job.candidateId)).json().data;
      assert.equal(candidate.geometry.parts[0]![0]!.length, 2); assert.equal(candidate.info.providerDistanceM, 3123); assert.equal(candidate.info.estimatedTimeS, 5714); assert.equal(candidate.adoptable, true); assert.equal((await get('/api/v1/routing-candidates/' + candidate.id, other)).statusCode, 404);
      assert.equal((await get('/api/v1/routes/' + route.id)).json().data.version, route.version); assert.equal((await get('/api/v1/routes/' + route.id + '/geometries')).json().data.length, 0);
    });
    await t.test('metadata-only edits keep candidate valid; explicit adoption is versioned and idempotent', async () => {
      await update([{ type: 'set_route_note', note: '备注可以变化' }]); assert.equal((await get('/api/v1/routing-candidates/' + candidate.id)).json().data.adoptable, true);
      assert.equal((await call('/api/v1/routing-candidates/' + candidate.id + '/adopt', adoption(candidate, { acknowledge: false }))).statusCode, 422);
      const body = adoption(candidate), saved = await call('/api/v1/routing-candidates/' + candidate.id + '/adopt', body); assert.equal(saved.statusCode, 200); route = saved.json().data.route;
      assert.equal(saved.json().data.asset.sourceKind, 'routing'); assert.equal(saved.json().data.asset.samples, null); assert.equal(route.segments[0]!.reviewStatus, 'needs_attention'); assert.deepEqual((await call('/api/v1/routing-candidates/' + candidate.id + '/adopt', body)).json().data, saved.json().data);
      await update([{ type: 'review_segment', segmentId: route.segments[0]!.id, geometryRef: route.segments[0]!.geometryRef! }]);
      const exported = (await call(`/api/v1/routes/${route.id}/gpx-export`, { baseVersion: route.version, allowPartial: false })).json().data.xml; assert.match(exported, /OpenStreetMap/); assert.match(exported, /ODbL/); assert.ok(!exported.includes('<ele>')); assert.ok(!exported.includes('<time>')); assert.deepEqual((await get('/api/v1/visits')).json().data, []);
    });
    await t.test('malformed provider responses and model metrics are rejected', () => {
      const input = candidate.input as RoutingInput; const bad = structuredClone(fixture); bad.features[0].properties['total-time'] = -1; assert.throws(() => parseBrouterResponse(bad, input, randomUUID()));
      const broken = structuredClone(fixture); broken.features[0].geometry.coordinates[0][0] = 999; assert.throws(() => parseBrouterResponse(broken, input, randomUUID()));
      assert.throws(() => parseBrouterResponse({ type: 'FeatureCollection', features: [] }, input, randomUUID()));
    });
    await t.test('failed task returns a safe failure and preserves the existing route', async () => {
      fetchMode = 'bad'; const response = await create(); assert.equal(response.statusCode, 200); await run(); const failed = await get('/api/v1/routing-jobs/' + response.json().data.id); assert.equal(failed.statusCode, 200); assert.equal(failed.json().data.status, 'failed'); assert.ok(!failed.body.includes('/root/')); assert.equal((await get('/api/v1/routes/' + route.id)).json().data.version, route.version);
    });
    await t.test('coordinate changes during calculation obsolete late results', async () => {
      fetchMode = 'hold'; const response = await create(); assert.equal(response.statusCode, 200); const waiting = new Promise<void>(resolve => { entered = resolve; }), work = app!.routingWorker.runNext(); await waiting;
      await update([{ type: 'update_stop', stopId: route.days[0]!.stops[0]!.id, patch: { location: { longitude: 118.188, latitude: 30.123, crs: 'WGS84' } } }]); release!(); await work; const result = (await get('/api/v1/routing-jobs/' + response.json().data.id)).json().data; assert.equal(result.status, 'obsolete'); assert.equal(result.candidateId, null);
    });
    await t.test('queued and in-flight cancellation never produce adoptable geometry', async () => {
      fetchMode = 'ok'; const queued = await create(); const cancel = { clientMutationId: randomUUID() }; assert.equal((await call('/api/v1/routing-jobs/' + queued.json().data.id + '/cancel', cancel)).json().data.status, 'cancelled'); assert.equal((await call('/api/v1/routing-jobs/' + queued.json().data.id + '/cancel', cancel)).statusCode, 200);
      fetchMode = 'hold'; const response = await create(), waiting = new Promise<void>(resolve => { entered = resolve; }), work = app!.routingWorker.runNext(); await waiting; assert.equal((await call('/api/v1/routing-jobs/' + response.json().data.id + '/cancel', { clientMutationId: randomUUID() })).statusCode, 200); await work; assert.equal((await get('/api/v1/routing-jobs/' + response.json().data.id)).json().data.candidateId, null);
    });
    await t.test('jobs survive application recreation and interrupted leases are reported', async () => {
      fetchMode = 'ok'; const queued = await create(); await app!.close(); app = await buildApp(cfg, database, { routingFetch, routingWorker: false }); assert.equal((await get('/api/v1/routing-jobs/' + queued.json().data.id)).json().data.status, 'queued'); await run();
      const response = await create(); await database.db.update(database.schema.routingJobs).set({ status: 'running', leaseToken: randomUUID(), leaseExpiresAt: new Date(Date.now() - 1000) }).where(eq(database.schema.routingJobs.id, response.json().data.id)); await app.routingWorker.runNext(); assert.equal((await get('/api/v1/routing-jobs/' + response.json().data.id)).json().data.failure.code, 'WORKER_INTERRUPTED');
    });
    await t.test('candidate expiry, version conflict, path protection and changed bindings block adoption', async () => {
      const current = await makeCandidate(); await database.db.update(database.schema.routingCandidates).set({ expiresAt: new Date(Date.now() - 1000) }).where(eq(database.schema.routingCandidates.id, current.id)); assert.equal((await call('/api/v1/routing-candidates/' + current.id + '/adopt', adoption(current))).json().error.code, 'CANDIDATE_EXPIRED');
      const valid = await makeCandidate(), oldVersion = route.version; await update([{ type: 'set_route_note', note: '更新版本' }]); assert.equal((await call('/api/v1/routing-candidates/' + valid.id + '/adopt', adoption(valid, { baseVersion: oldVersion }))).statusCode, 409);
      await update([{ type: 'set_segment_lock', segmentId: route.segments[0]!.id, locked: true }]); assert.equal((await create()).json().error.code, 'GEOMETRY_LOCKED'); assert.equal((await call('/api/v1/routing-candidates/' + valid.id + '/adopt', adoption(valid))).statusCode, 409);
      await update([{ type: 'set_segment_lock', segmentId: route.segments[0]!.id, locked: false }, { type: 'clear_segment_geometry', segmentId: route.segments[0]!.id, geometryRef: route.segments[0]!.geometryRef! }]); assert.equal((await call('/api/v1/routing-candidates/' + valid.id + '/adopt', adoption(valid))).json().error.code, 'INPUT_CHANGED');
    });
    await t.test('cleanup removes old task history but retains adopted geometry provenance', async () => {
      await database.db.update(database.schema.routingJobs).set({ createdAt: new Date(Date.now() - 8 * 86400000) }).where(eq(database.schema.routingJobs.id, job.id)); const result = await app!.routingWorker.cleanup(); assert.ok(result.removed >= 1); assert.equal((await get('/api/v1/routing-jobs/' + job.id)).statusCode, 404);
      const rows = await database.db.select().from(database.schema.geometries); assert.ok(rows.some(row => row.routingInfo?.candidateId === candidate.id));
    });
  } finally { if (app) await app.close(); await removeTestTables(database.pool, cfg.prefix); await database.pool.end(); }
});
