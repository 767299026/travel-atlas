import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import { config } from '../src/config.js';
import { openDatabase } from '../src/db/client.js';
import { migrate, removeTestTables } from '../src/db/migrate.js';
import { hashPassword } from '../src/security.js';
import { buildApp } from '../src/app.js';
import { mediaService } from '../src/media.js';
import type { Diary, RouteSnapshot, ActualCopyInput, MediaItem } from '../../packages/contracts/src/index.js';

test('M2 real MySQL records, media and admin integration', async t => {
  const mediaRoot = await mkdtemp(join(tmpdir(), 'travel-atlas-m2-'));
  const cfg = { ...config, mediaRoot, prefix: 'tjt_' + randomBytes(4).toString('hex') + '_', loginRateMax: 100 };
  const database = openDatabase(cfg); let app: Awaited<ReturnType<typeof buildApp>> | undefined;
  const password = randomBytes(24).toString('base64url'), origin = cfg.origins[0]!;
  try {
    await migrate(database.pool, cfg.prefix); await migrate(database.pool, cfg.prefix);
    const passwordHash = await hashPassword(password), ownerId = randomUUID();
    await database.db.insert(database.schema.users).values([{ id: ownerId, username: 'owner-fixture', displayName: 'Owner', passwordHash, createdAt: new Date() }, { id: randomUUID(), username: 'editor-fixture', displayName: 'Editor', passwordHash, role: 'editor', createdAt: new Date() }]);
    app = await buildApp(cfg, database);
    const login = async (username = 'owner-fixture', loginPassword = password) => { const res = await app!.inject({ method: 'POST', url: '/api/v1/auth/login', headers: { origin }, payload: { username, password: loginPassword } }); assert.equal(res.statusCode, 200); return { cookie: 'atlas_session=' + res.cookies[0]!.value, origin, 'x-csrf-token': res.json().data.csrfToken }; };
    const owner = await login(), editor = await login('editor-fixture');
    const get = (url: string, headers = owner) => app!.inject({ method: 'GET', url, headers });
    const call = (url: string, body: unknown, method: 'POST' | 'PUT' | 'PATCH' | 'DELETE' = 'POST', headers = owner) => app!.inject({ method, url, payload: body, headers });
    const create = await call('/api/v1/journeys', { title: 'M2 verification', destinations: ['黄山'], origin: '杭州东站', startDate: '2026-10-20', duration: 2, clientMutationId: randomUUID() }); assert.equal(create.statusCode, 201);
    const journeyId: string = create.json().data.journey.id; let plan: RouteSnapshot = create.json().data.route;
    const add = await call(`/api/v1/routes/${plan.id}/commands`, { baseVersion: plan.version, clientMutationId: randomUUID(), operations: [{ type: 'add_stop', clientRef: 'draft:site', dayId: plan.days[0]!.id, stop: { label: '云谷寺', region: '黄山', role: 'visit', time: '08:30', note: '真实备注', location: null }, arrivalMode: 'drive' }] }); assert.equal(add.statusCode, 200); plan = add.json().data.route;
    let actual: RouteSnapshot, diary: Diary, photo: MediaItem;
    const copyInput = (): ActualCopyInput => ({ planVersion: plan.version, actualVersion: actual?.version ?? null, dayIds: plan.days.map(d => d.id), mode: 'replace' });
    await t.test('copy preview is read-only; independent actual identifiers and exact retry', async () => {
      const body = copyInput(), preview = await call(`/api/v1/journeys/${journeyId}/actual-copy-previews`, body); assert.equal(preview.statusCode, 200); assert.equal(preview.json().data.addedStops, 2);
      assert.equal((await get('/api/v1/journeys/' + journeyId)).json().data.actualRouteId, null);
      const request = { ...body, clientMutationId: randomUUID() }, result = await call(`/api/v1/journeys/${journeyId}/actual-copy`, request); assert.equal(result.statusCode, 200); actual = result.json().data.route;
      assert.equal(actual.layer, 'actual'); assert.notEqual(actual.days[0]!.id, plan.days[0]!.id); assert.notEqual(actual.days[0]!.stops[0]!.id, plan.days[0]!.stops[0]!.id); assert.equal(actual.days[0]!.stops[1]!.copiedFrom!.id, plan.days[0]!.stops[1]!.id);
      assert.deepEqual((await call(`/api/v1/journeys/${journeyId}/actual-copy`, request)).json().data, result.json().data);
      assert.equal((await get('/api/v1/visits?journeyId=' + journeyId)).json().data.length, 0); assert.equal((await get('/api/v1/diaries')).json().data.items.length, 0);
    });
    await t.test('actual edit leaves plan unchanged and stale copy is rejected', async () => {
      const result = await call(`/api/v1/routes/${actual.id}/commands`, { baseVersion: actual.version, clientMutationId: randomUUID(), operations: [{ type: 'update_stop', stopId: actual.days[0]!.stops[1]!.id, patch: { label: '云谷寺实际补记' } }] }); assert.equal(result.statusCode, 200); actual = result.json().data.route;
      assert.equal((await get(`/api/v1/routes/${plan.id}`)).json().data.days[0].stops[1].label, '云谷寺');
      assert.equal((await call(`/api/v1/journeys/${journeyId}/actual-copy`, { ...copyInput(), actualVersion: 1, clientMutationId: randomUUID() })).statusCode, 409);
      assert.equal((await call(`/api/v1/journeys/${journeyId}/actual-copy-previews`, { ...copyInput(), dayIds: [randomUUID()] })).statusCode, 422);
    });
    const diaryBody = () => ({ title: '黄山回忆', occurredOn: '2026-10-20', body: '保留完整日记正文\n\n<script>alert(1)</script>', status: 'written', association: { journeyId, routeId: actual.id, dayId: actual.days[0]!.id, stopId: actual.days[0]!.stops[1]!.id }, photos: [], clientMutationId: randomUUID() });
    await t.test('manual visit, diary ownership and retry', async () => {
      const stopId = actual.days[0]!.stops[1]!.id, body = { routeVersion: actual.version, visitedOn: '2026-10-20', note: '手动确认', clientMutationId: randomUUID() };
      assert.equal((await call(`/api/v1/routes/${plan.id}/stops/${plan.days[0]!.stops[1]!.id}/visit`, { ...body, routeVersion: plan.version })).statusCode, 422);
      const visit = await call(`/api/v1/routes/${actual.id}/stops/${stopId}/visit`, body); assert.equal(visit.statusCode, 200); assert.deepEqual((await call(`/api/v1/routes/${actual.id}/stops/${stopId}/visit`, body)).json().data, visit.json().data);
      const input = diaryBody(), result = await call('/api/v1/diaries', input); assert.equal(result.statusCode, 200); diary = result.json().data;
      assert.deepEqual((await call('/api/v1/diaries', input)).json().data, diary); assert.equal((await get('/api/v1/diaries/' + diary.id, editor)).statusCode, 404);
      assert.equal((await call('/api/v1/diaries', { ...diaryBody(), association: { journeyId, routeId: plan.id, dayId: plan.days[0]!.id, stopId: actual.days[0]!.stops[0]!.id } })).statusCode, 422);
      assert.equal((await call('/api/v1/diaries/' + diary.id, { ...input, baseVersion: 1 }, 'PUT', editor)).statusCode, 404);
    });
    await t.test('replacement preserves visit and diary snapshots without rebinding', async () => {
      const preview = await call(`/api/v1/journeys/${journeyId}/actual-copy-previews`, copyInput()); assert.equal(preview.json().data.preservedVisits, 1); assert.equal(preview.json().data.preservedDiaries, 1);
      const result = await call(`/api/v1/journeys/${journeyId}/actual-copy`, { ...copyInput(), clientMutationId: randomUUID() }); assert.equal(result.statusCode, 200); actual = result.json().data.route;
      const visits = (await get('/api/v1/visits?journeyId=' + journeyId)).json().data; assert.equal(visits[0].detached, true); assert.equal(visits[0].label, '云谷寺实际补记');
      const restored = (await get('/api/v1/diaries/' + diary.id)).json().data; assert.equal(restored.association.detached, true); assert.equal(restored.association.stopLabel, '云谷寺实际补记'); assert.equal(restored.body, diary.body);
      const input = { ...diaryBody(), association: { journeyId: diary.association!.journeyId, routeId: diary.association!.routeId, dayId: diary.association!.dayId, stopId: diary.association!.stopId }, baseVersion: diary.version, title: '替换后仍可编辑', clientMutationId: randomUUID() };
      const saved = await call('/api/v1/diaries/' + diary.id, input, 'PUT'); assert.equal(saved.statusCode, 200); diary = saved.json().data;
    });
    const upload = async (buffer: Buffer, filename: string, key = randomUUID(), headers = owner) => {
      const boundary = 'fixture-' + randomUUID(), body = Buffer.concat([Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: image/jpeg\r\n\r\n`), buffer, Buffer.from(`\r\n--${boundary}--\r\n`)]);
      return app!.inject({ method: 'POST', url: '/api/v1/media', headers: { ...headers, 'content-type': 'multipart/form-data; boundary=' + boundary, 'x-upload-id': key }, payload: body });
    };
    const image = await sharp({ create: { width: 128, height: 96, channels: 3, background: '#234a43' } }).withExif({ IFD0: { Artist: 'private-test-marker' } }).jpeg().toBuffer();
    await t.test('image decode, metadata stripping, ownership, private original and retry', async () => {
      const key = randomUUID(), result = await upload(image, '../../private-photo.jpg', key); assert.equal(result.statusCode, 200); photo = result.json().data;
      assert.equal(photo.width, 128); assert.ok(!photo.filename.includes('/')); assert.equal((await upload(image, '../../private-photo.jpg', key)).json().data.id, photo.id);
      const preview = await get(photo.previewUrl), original = await get(photo.originalUrl); assert.equal(preview.statusCode, 200); assert.equal(original.statusCode, 200); assert.match(original.headers['content-disposition']!, /attachment/);
      const metadata = await sharp(preview.rawPayload).metadata(); assert.equal(metadata.exif, undefined); assert.equal(metadata.xmp, undefined); assert.equal(metadata.icc, undefined);
      assert.ok((await sharp(original.rawPayload).metadata()).exif); assert.equal((await get(photo.previewUrl, editor)).statusCode, 404); assert.equal((await app!.inject(photo.previewUrl)).statusCode, 401);
      assert.equal((await upload(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>'), 'pretend.jpg')).statusCode, 415);
      assert.equal((await upload(image, 'other-name.jpg', key)).statusCode, 409); assert.equal((await call('/api/v1/media/' + photo.id, undefined, 'DELETE', editor)).statusCode, 404);
    });
    await t.test('diary photo save, version conflict, rejection rolls back and deletion removes files', async () => {
      const { id, version, createdAt, updatedAt, visibility, ...input } = diary;
      const body = { ...input, association: { journeyId: diary.association!.journeyId, routeId: diary.association!.routeId, dayId: diary.association!.dayId, stopId: diary.association!.stopId }, baseVersion: version, clientMutationId: randomUUID(), photos: [{ mediaId: photo.id, caption: '沿途照片' }] };
      const saved = await call('/api/v1/diaries/' + id, body, 'PUT'); assert.equal(saved.statusCode, 200); diary = saved.json().data; assert.equal(diary.photos[0]!.caption, '沿途照片');
      assert.equal((await call('/api/v1/media/' + photo.id, undefined, 'DELETE')).statusCode, 409);
      assert.equal((await call('/api/v1/diaries/' + id, { ...body, clientMutationId: randomUUID() }, 'PUT')).statusCode, 409);
      assert.equal((await call('/api/v1/diaries/' + id, { ...body, baseVersion: diary.version, clientMutationId: randomUUID(), photos: [{ mediaId: randomUUID(), caption: 'bad' }] }, 'PUT')).statusCode, 404);
      assert.equal((await get('/api/v1/diaries/' + id)).json().data.version, diary.version);
      const removed = await call('/api/v1/diaries/' + id, { ...body, baseVersion: diary.version, photos: [], clientMutationId: randomUUID() }, 'PUT'); assert.equal(removed.statusCode, 200); diary = removed.json().data;
      assert.equal((await get(photo.previewUrl)).statusCode, 404); assert.ok(!(await readdir(mediaRoot)).includes(photo.id));
    });
    await t.test('admin boundary, last owner, versioned users and revoked sessions', async () => {
      assert.equal((await get('/api/v1/admin/users', editor)).statusCode, 403); const users = await get('/api/v1/admin/users'); assert.equal(users.statusCode, 200); assert.ok(!users.body.includes('passwordHash')); assert.ok(!users.body.includes(password));
      const created = await call('/api/v1/admin/users', { username: 'new-editor', displayName: '新账号', password, role: 'editor' }); assert.equal(created.statusCode, 200); const user = created.json().data, auth = await login('new-editor');
      const changed = await call('/api/v1/admin/users/' + user.id, { baseVersion: 1, displayName: '新账号', role: 'editor', active: false }, 'PATCH'); assert.equal(changed.statusCode, 200); assert.equal((await get('/api/v1/auth/session', auth)).statusCode, 401);
      const own = users.json().data.items.find((u: { id: string }) => u.id === ownerId); const last = await call('/api/v1/admin/users/' + ownerId, { baseVersion: own.version, displayName: own.displayName, role: 'editor', active: false }, 'PATCH'); assert.equal(last.statusCode, 409); assert.equal(last.json().error.code, 'LAST_OWNER');
      const editorRow = users.json().data.items.find((u: { username: string }) => u.username === 'editor-fixture'); const reset = await call('/api/v1/admin/users/' + editorRow.id + '/password', { baseVersion: editorRow.version, password: randomBytes(24).toString('base64url') }); assert.equal(reset.statusCode, 200); assert.equal((await get('/api/v1/auth/session', editor)).statusCode, 401);
      const audit = await get('/api/v1/admin/audit'); assert.equal(audit.statusCode, 200); assert.ok(audit.json().data.length >= 3); assert.ok(!audit.body.includes(password));
    });
    await t.test('independent diary and visit cancel do not change the route', async () => {
      const result = await call('/api/v1/diaries', { ...diaryBody(), association: null, status: 'draft' }); assert.equal(result.statusCode, 200); assert.equal(result.json().data.association, null);
      const visits = (await get('/api/v1/visits')).json().data; const removed = await call('/api/v1/visits/' + visits[0].id, { clientMutationId: randomUUID() }, 'DELETE'); assert.equal(removed.statusCode, 200);
      assert.equal((await get('/api/v1/routes/' + actual.id)).json().data.version, actual.version);
      const summary = (await get('/api/v1/me/summary')).json().data; assert.equal(summary.visits, 0); assert.equal(summary.diaries, 2); assert.equal(summary.mediaBytes, 0);
      assert.equal((await call('/api/v1/diaries/' + diary.id, { baseVersion: diary.version, clientMutationId: randomUUID() }, 'DELETE')).statusCode, 200); assert.equal((await get('/api/v1/diaries/' + diary.id)).statusCode, 404);
    });
    await t.test('empty actual retry and append preserve existing identities with a gap boundary', async () => {
      const created = (await call('/api/v1/journeys', { title: 'Append verification', destinations: ['黄山'], origin: '杭州', startDate: null, duration: 1, clientMutationId: randomUUID() })).json().data;
      const url = `/api/v1/journeys/${created.journey.id}`, request = { clientMutationId: randomUUID() };
      const empty = await call(url + '/actual', request); assert.equal(empty.statusCode, 200);
      assert.deepEqual((await call(url + '/actual', request)).json().data, empty.json().data);
      assert.equal((await call(url + '/actual', { clientMutationId: randomUUID() })).statusCode, 409);
      const edited = await call(`/api/v1/routes/${empty.json().data.id}/commands`, { baseVersion: 1, clientMutationId: randomUUID(), operations: [{ type: 'add_stop', clientRef: 'draft:kept', dayId: empty.json().data.days[0].id, stop: { label: '已记录地点', region: '', role: 'visit', time: null, note: '', location: null }, arrivalMode: 'walk' }] }); assert.equal(edited.statusCode, 200);
      const existing = edited.json().data.route;
      const result = await call(url + '/actual-copy', { planVersion: created.route.version, actualVersion: existing.version, mode: 'append', dayIds: [created.route.days[0].id], clientMutationId: randomUUID() }); assert.equal(result.statusCode, 200);
      const appended = result.json().data.route; assert.equal(appended.days[0].id, existing.days[0].id); assert.equal(appended.days[0].stops[0].id, existing.days[0].stops[0].id); assert.equal(appended.days.length, 2);
      assert.equal(appended.segments.length, 1); assert.equal(appended.segments[0].kind, 'gap'); assert.equal(appended.segments[0].geometryRef, null);
    });
    await t.test('quota rejection cleans files and EXIF orientation is applied to reading images', async () => {
      const before = (await readdir(mediaRoot)).sort();
      const service = mediaService(database, { ...cfg, mediaQuotaBytes: 1 });
      await assert.rejects(service.upload(ownerId, randomUUID(), 'quota.jpg', async () => image), (e: unknown) => (e as { code: string }).code === 'MEDIA_QUOTA');
      assert.deepEqual((await readdir(mediaRoot)).sort(), before);
      const rotated = await sharp({ create: { width: 128, height: 96, channels: 3, background: '#234a43' } }).withMetadata({ orientation: 6 }).jpeg().toBuffer();
      const uploaded = await upload(rotated, 'rotated.jpg'); assert.equal(uploaded.statusCode, 200); const item = uploaded.json().data;
      assert.equal(item.width, 96); assert.equal(item.height, 128); assert.equal((await sharp((await get(item.previewUrl)).rawPayload).metadata()).orientation, undefined);
      assert.equal((await call('/api/v1/media/' + item.id, undefined, 'DELETE')).statusCode, 200);
    });
  } finally { if (app) await app.close(); await removeTestTables(database.pool, cfg.prefix); await database.pool.end(); await rm(mediaRoot, { recursive: true, force: true }); }
});
