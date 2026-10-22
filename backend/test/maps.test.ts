import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { config } from '../src/config.js';
import { openDatabase } from '../src/db/client.js';
import { migrate, removeTestTables } from '../src/db/migrate.js';
import { hashPassword } from '../src/security.js';
import { buildApp } from '../src/app.js';
import { parseGpx } from '../src/gpx.js';
import { type RouteSnapshot, type GeometryAsset, type RouteGeometry, type GeometrySaveInput } from '../../packages/contracts/src/index.js';
const xml = `<?xml version="1.0" encoding="UTF-8"?><gpx xmlns="http://www.topografix.com/GPX/1/1" version="1.1" creator="fixture"><trk><name>两段参考</name><trkseg><trkpt lat="30.100" lon="118.100"><ele>100</ele><time>2026-10-20T08:30:00+08:00</time></trkpt><trkpt lat="30.101" lon="118.101"/></trkseg><trkseg><trkpt lat="30.110" lon="118.110"/><trkpt lat="30.111" lon="118.111"><ele>120</ele></trkpt></trkseg></trk></gpx>`;
test('M3 geometry, GPX and authenticated map services', async t => {
  const cfg = { ...config, prefix: 'tjt_' + randomBytes(4).toString('hex') + '_', loginRateMax: 100, rateLimitMax: 600, amap: { jsKey: 'fixture-public-key', securityCode: 'fixture-private-code' } };
  const database = openDatabase(cfg); let app: Awaited<ReturnType<typeof buildApp>> | undefined;
  const password = randomBytes(24).toString('base64url'), ownerId = randomUUID(), origin = cfg.origins[0]!;
  let upstreamCalls = 0, lastUpstream: URL | undefined, upstreamBody = '{"info":"OK"}';
  try {
    await migrate(database.pool, cfg.prefix); await migrate(database.pool, cfg.prefix);
    const passwordHash = await hashPassword(password); await database.db.insert(database.schema.users).values([{ id: ownerId, username: 'maps-owner', displayName: 'Owner', passwordHash, createdAt: new Date() }, { id: randomUUID(), username: 'maps-other', displayName: 'Other', passwordHash, createdAt: new Date() }]);
    app = await buildApp(cfg, database, { mapFetch: (async (url: string | URL | Request) => { upstreamCalls++; lastUpstream = new URL(String(url)); return new Response(upstreamBody, { headers: { 'content-type': 'application/json' } }); }) as typeof fetch });
    const login = async (username: string) => { const result = await app!.inject({ method: 'POST', url: '/api/v1/auth/login', headers: { origin }, payload: { username, password } }); assert.equal(result.statusCode, 200); return { origin, cookie: 'atlas_session=' + result.cookies[0]!.value, 'x-csrf-token': result.json().data.csrfToken }; };
    const owner = await login('maps-owner'), other = await login('maps-other');
    const get = (url: string, headers = owner) => app!.inject({ method: 'GET', url, headers });
    const call = (url: string, payload: unknown, method: 'POST' | 'PUT' = 'POST', headers = owner) => app!.inject({ method, url, payload, headers });
    let route: RouteSnapshot, asset: GeometryAsset, journeyId = '';
    const g: RouteGeometry = { crs: 'WGS84', parts: [[[118.1, 30.1], [118.101, 30.101], [118.111, 30.111]]] };
    const update = async (operations: unknown[]) => { const result = await call(`/api/v1/routes/${route.id}/commands`, { baseVersion: route.version, clientMutationId: randomUUID(), operations }); assert.equal(result.statusCode, 200); route = result.json().data.route; };
    const input = (): GeometrySaveInput => ({ kind: 'manual', geometry: g, baseVersion: route.version, expectedGeometryRef: route.segments[0]!.geometryRef, sourceNote: '本人根据自有坐标补绘', clientMutationId: randomUUID() });
    const saveUrl = () => `/api/v1/routes/${route.id}/segments/${route.segments[0]!.id}/geometry`;
    await t.test('strict GPX XML, namespaces, coordinates and disjoint length', () => {
      const parsed = parseGpx(xml); assert.equal(parsed.pointCount, 4); assert.equal(parsed.geometry.parts.length, 2); assert.ok(parsed.lengthM < 400); assert.equal(parsed.samples[0]![0]!.elevation, 100); assert.equal(parsed.samples[0]![1]!.time, null);
      for (const bad of [xml.replace('118.100', '999'), xml.replace('http://www.topografix.com/GPX/1/1', 'https://wrong.test'), xml.replace('</trk>', ''), '<!DOCTYPE gpx [<!ENTITY secret SYSTEM "file:///etc/passwd">]>' + xml, xml.replace('30.100', 'NaN'), xml.replace('2026-10-20T08:30:00+08:00', 'not-time')]) assert.throws(() => parseGpx(bad));
      assert.equal(parseGpx(xml.replaceAll('GPX/1/1', 'GPX/1/0').replace('version="1.1"', 'version="1.0"')).pointCount, 4);
      assert.throws(() => parseGpx(xml.replace('</gpx>', '<rte><rtept lat="30.1" lon="118.1"/><rtept lat="30.2" lon="118.2"/></rte></gpx>')), (e: unknown) => (e as { code: string }).code === 'AMBIGUOUS_GPX');
      assert.throws(() => parseGpx(xml.repeat(10000)), (e: unknown) => (e as { code: string }).code === 'FILE_TOO_LARGE');
    });
    await t.test('map capabilities and fixed upstream proxy protect private keys', async () => {
      assert.equal((await app!.inject('/api/v1/maps/capabilities')).statusCode, 401); const result = await get('/api/v1/maps/capabilities'); assert.equal(result.statusCode, 200); assert.ok(!result.body.includes(cfg.amap.securityCode));
      const proxy = await get('/api/v1/maps/_AMapService/v3/log/init?callback=fixtureCallback'); assert.equal(proxy.statusCode, 200); assert.match(proxy.headers['content-type']!, /application\/javascript/); assert.equal(lastUpstream!.origin, 'https://restapi.amap.com'); assert.equal(lastUpstream!.searchParams.get('jscode'), cfg.amap.securityCode);
      const before = upstreamCalls; assert.equal((await get('/api/v1/maps/_AMapService/http://127.0.0.1')).statusCode, 404); assert.equal((await get('/api/v1/maps/_AMapService/v3/log/init?callback=alert(1)')).statusCode, 400); assert.equal(upstreamCalls, before);
      upstreamBody = cfg.amap.securityCode; const blocked = await get('/api/v1/maps/_AMapService/v3/log/init'); assert.equal(blocked.statusCode, 502); assert.ok(!blocked.body.includes(cfg.amap.securityCode)); upstreamBody = '{"info":"OK"}';
    });
    await t.test('create located trip; GPX preview has no stored asset', async () => {
      const created = await call('/api/v1/journeys', { title: 'M3 <私密>路线', destinations: ['黄山'], origin: '', duration: 1, startDate: null, clientMutationId: randomUUID() }); assert.equal(created.statusCode, 201); route = created.json().data.route; journeyId = created.json().data.journey.id;
      await update([{ type: 'add_stop', clientRef: 'draft:a', dayId: route.days[0]!.id, stop: { label: '起点', region: '', role: 'visit', time: null, note: '', location: { longitude: 118.1, latitude: 30.1, crs: 'WGS84', source: 'manual_coordinate' } }, arrivalMode: 'unknown' }, { type: 'add_stop', clientRef: 'draft:b', dayId: route.days[0]!.id, stop: { label: '终点', region: '', role: 'visit', time: null, note: '', location: { longitude: 118.111, latitude: 30.111, crs: 'WGS84' } }, arrivalMode: 'hike' }, { type: 'add_stop', clientRef: 'draft:c', dayId: route.days[0]!.id, stop: { label: '缺口之后', region: '', role: 'visit', time: null, note: '', location: null }, arrivalMode: 'unknown' }]);
      const preview = await call('/api/v1/geometries/gpx-preview', { xml }); assert.equal(preview.statusCode, 200); assert.equal(preview.json().data.geometry.parts.length, 2); assert.deepEqual((await get('/api/v1/routes/' + route.id + '/geometries')).json().data, []);
      const loaded = (await get('/api/v1/routes/' + route.id)).json().data; assert.deepEqual(loaded.segments.map((s: { toStopId: string }) => s.toStopId), loaded.days.flatMap((d: { stops: { id: string }[] }) => d.stops).slice(1).map((s: { id: string }) => s.id));
    });
    await t.test('geometry saves have one version winner and exact retry', async () => {
      const body = input(), another = { ...body, clientMutationId: randomUUID(), sourceNote: '另一个页面' };
      const responses = await Promise.all([call(saveUrl(), body, 'PUT'), call(saveUrl(), another, 'PUT')]); assert.deepEqual(responses.map(r => r.statusCode).sort(), [200, 409]); const winner = responses.findIndex(r => r.statusCode === 200), result = responses[winner]!.json().data; asset = result.asset; route = result.route;
      const replay = await call(saveUrl(), winner === 0 ? body : another, 'PUT'); assert.equal(replay.statusCode, 200); assert.deepEqual(replay.json().data, result);
      const rows = (await get('/api/v1/routes/' + route.id + '/geometries')).json().data; assert.equal(rows.length, 1); assert.ok(!('geometry' in rows[0])); assert.equal((await get('/api/v1/geometries/' + asset.id, other)).statusCode, 404);
      assert.equal((await call(saveUrl(), input(), 'PUT', other)).statusCode, 404);
    });
    await t.test('review is explicit; partial export preserves XML escaping and requires confirmation', async () => {
      assert.equal((await call(`/api/v1/routes/${route.id}/gpx-export`, { baseVersion: route.version, allowPartial: true })).statusCode, 422);
      await update([{ type: 'review_segment', segmentId: route.segments[0]!.id, geometryRef: asset.id }, { type: 'set_route_note', note: '备注不会过期路径' }]); assert.equal(route.segments[0]!.geometryStatus, 'ready'); assert.equal(route.segments[0]!.reviewStatus, 'confirmed');
      const report = (await get(`/api/v1/routes/${route.id}/gpx-export-preview`)).json().data; assert.equal(report.included, 1); assert.equal(report.gaps, 1); assert.equal(report.partial, true);
      assert.equal((await call(`/api/v1/routes/${route.id}/gpx-export`, { baseVersion: route.version, allowPartial: false })).statusCode, 422);
      const result = await call(`/api/v1/routes/${route.id}/gpx-export`, { baseVersion: route.version, allowPartial: true }); assert.equal(result.statusCode, 200); assert.match(result.json().data.xml, /&lt;私密&gt;/); assert.equal(parseGpx(result.json().data.xml).pointCount, 3);
    });
    await t.test('GPX permission, source original and sample-preserving round trip', async () => {
      const body: GeometrySaveInput = { kind: 'gpx', xml, filename: '../reference.gpx', rightsConfirmed: false, sourceNote: '本人提供的有权使用参考文件', baseVersion: route.version, expectedGeometryRef: asset.id, clientMutationId: randomUUID() };
      assert.equal((await call(saveUrl(), body, 'PUT')).statusCode, 422); body.rightsConfirmed = true; const result = await call(saveUrl(), body, 'PUT'); assert.equal(result.statusCode, 200); route = result.json().data.route; asset = result.json().data.asset;
      assert.equal(asset.sourceKind, 'imported_reference'); assert.equal(asset.geometry.parts.length, 2); assert.equal(asset.exportPolicy, 'allowed');
      const original = await get('/api/v1/geometries/' + asset.id + '/original'); assert.equal(original.body, xml); assert.match(original.headers['content-disposition']!, /attachment/); assert.equal((await get('/api/v1/geometries/' + asset.id + '/original', other)).statusCode, 404);
      await update([{ type: 'review_segment', segmentId: route.segments[0]!.id, geometryRef: asset.id }]);
      const exported = (await call(`/api/v1/routes/${route.id}/gpx-export`, { baseVersion: route.version, allowPartial: true })).json().data;
      const parsed = parseGpx(exported.xml); assert.deepEqual(parsed.geometry, asset.geometry); assert.deepEqual(parsed.samples, asset.samples); assert.ok(parsed.lengthM < 400);
    });
    await t.test('protected geometry cannot be replaced or cleared', async () => {
      await update([{ type: 'set_segment_lock', segmentId: route.segments[0]!.id, locked: true }]); assert.equal((await call(saveUrl(), input(), 'PUT')).statusCode, 409);
      assert.equal((await call(`/api/v1/routes/${route.id}/commands`, { baseVersion: route.version, clientMutationId: randomUUID(), operations: [{ type: 'clear_segment_geometry', segmentId: route.segments[0]!.id, geometryRef: asset.id }] })).statusCode, 409);
      await update([{ type: 'set_segment_lock', segmentId: route.segments[0]!.id, locked: false }]);
    });
    await t.test('location changes stale the reference and prevent review or export', async () => {
      await update([{ type: 'update_stop', stopId: route.days[0]!.stops[0]!.id, patch: { location: { longitude: 118.2, latitude: 30.2, crs: 'GCJ02', source: 'amap_pick' } } }]); assert.equal(route.segments[0]!.geometryStatus, 'stale'); assert.equal(route.segments[0]!.geometryRef, asset.id);
      const result = await call(`/api/v1/routes/${route.id}/commands`, { baseVersion: route.version, clientMutationId: randomUUID(), operations: [{ type: 'review_segment', segmentId: route.segments[0]!.id, geometryRef: asset.id }] }); assert.equal(result.statusCode, 422);
      assert.equal((await call(`/api/v1/routes/${route.id}/gpx-export`, { baseVersion: route.version, allowPartial: true })).statusCode, 422);
    });
    await t.test('GCJ02 manual geometry never obtains GPX export permission from the client', async () => {
      const body = { ...input(), geometry: { ...g, crs: 'GCJ02' } }; assert.equal((await call(saveUrl(), { ...body, exportPolicy: 'allowed' }, 'PUT')).statusCode, 400);
      const saved = await call(saveUrl(), body, 'PUT'); assert.equal(saved.statusCode, 200); route = saved.json().data.route; asset = saved.json().data.asset; assert.equal(asset.exportPolicy, 'unverified');
      await update([{ type: 'review_segment', segmentId: route.segments[0]!.id, geometryRef: asset.id }]); assert.equal((await call(`/api/v1/routes/${route.id}/gpx-export`, { baseVersion: route.version, allowPartial: true })).statusCode, 422);
    });
    await t.test('clear binding keeps historical asset; actual copy does not invent a trace or visit', async () => {
      await update([{ type: 'clear_segment_geometry', segmentId: route.segments[0]!.id, geometryRef: asset.id }]); assert.equal(route.segments[0]!.geometryRef, null); assert.equal((await get('/api/v1/geometries/' + asset.id)).statusCode, 200);
      const copied = await call(`/api/v1/journeys/${journeyId}/actual-copy`, { planVersion: route.version, actualVersion: null, dayIds: route.days.map(d => d.id), mode: 'replace', clientMutationId: randomUUID() }); assert.equal(copied.statusCode, 200); assert.ok(copied.json().data.route.segments.every((s: { geometryRef: string | null }) => !s.geometryRef));
      assert.deepEqual((await get('/api/v1/visits')).json().data, []);
    });
  } finally { if (app) await app.close(); await removeTestTables(database.pool, cfg.prefix); await database.pool.end(); }
});
