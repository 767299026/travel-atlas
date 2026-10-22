import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, createHmac, randomBytes, randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import { eq } from 'drizzle-orm';
import { config } from '../src/config.js';
import { openDatabase } from '../src/db/client.js';
import { migrate, removeTestTables } from '../src/db/migrate.js';
import { buildApp } from '../src/app.js';
import { hashPassword } from '../src/security.js';
import { shareService } from '../src/shares.js';
import { mediaService } from '../src/media.js';
import type { ShareOptions, ShareLink, SharePreview } from '../../packages/contracts/src/index.js';

test('M4.1 private share snapshots and revocable visitor access', async t => {
  const mediaRoot = await mkdtemp(join(tmpdir(), 'travel-shares-')), cfg = { ...config, prefix: 'tjt_' + randomBytes(4).toString('hex') + '_', mediaRoot, shareSecret: randomBytes(32).toString('hex'), loginRateMax: 100, rateLimitMax: 1000 };
  const database = openDatabase(cfg), password = randomBytes(24).toString('base64url'), ownerId = randomUUID(), otherId = randomUUID(), origin = cfg.origins[0]!;
  let app: Awaited<ReturnType<typeof buildApp>> | undefined;
  try {
    await migrate(database.pool, cfg.prefix); const passwordHash = await hashPassword(password);
    await database.db.insert(database.schema.users).values([{ id: ownerId, username: 'share-owner', displayName: 'PRIVATE_OWNER_NAME', passwordHash, createdAt: new Date() }, { id: otherId, username: 'share-other', displayName: 'Other', passwordHash, createdAt: new Date() }]);
    app = await buildApp(cfg, database, { routingWorker: false });
    const login = async (username: string) => { const result = await app!.inject({ method: 'POST', url: '/api/v1/auth/login', headers: { origin }, payload: { username, password } }); assert.equal(result.statusCode, 200); return { origin, cookie: 'atlas_session=' + result.cookies[0]!.value, 'x-csrf-token': result.json().data.csrfToken }; };
    const owner = await login('share-owner'), other = await login('share-other');
    const get = (url: string, headers: Record<string, string> = owner) => app!.inject({ url: '/api/v1' + url, headers });
    const post = (url: string, payload: unknown, headers = owner) => app!.inject({ method: 'POST', url: '/api/v1' + url, payload, headers });
    const created = await post('/journeys', { title: '黄山分享测试', destinations: ['黄山'], origin: '', duration: 1, startDate: '2026-10-20', clientMutationId: randomUUID() }); let route = created.json().data.route; const journeyId = created.json().data.journey.id;
    const command = async (operations: unknown[]) => { const result = await post('/routes/' + route.id + '/commands', { baseVersion: route.version, clientMutationId: randomUUID(), operations }); assert.equal(result.statusCode, 200); route = result.json().data.route; };
    await command([{ type: 'set_route_note', note: 'PRIVATE_ROUTE_NOTE' }, { type: 'update_day', dayId: route.days[0].id, patch: { stayName: 'PRIVATE_HOTEL' } }, { type: 'add_stop', dayId: route.days[0].id, clientRef: 'draft:share', stop: { label: '云谷寺', region: '黄山', time: '08:30', note: 'PRIVATE_STOP_NOTE', role: 'visit', location: { longitude: 118.1875481, latitude: 30.1222091, crs: 'WGS84' } }, arrivalMode: 'unknown' }]);
    const image = await sharp({ create: { width: 8, height: 8, channels: 3, background: '#668844' } }).withExif({ IFD0: { Copyright: 'PRIVATE_PHOTO_METADATA' } }).jpeg().toBuffer();
    const media = await mediaService(database, cfg).upload(ownerId, randomUUID(), 'PRIVATE_ORIGINAL_NAME.jpg', async () => image);
    const diaryInput = { title: '已写完的日记', occurredOn: '2026-10-20', body: '日记内容 <script>window.shareUnsafe = true</script>', status: 'written', association: { journeyId, routeId: route.id, dayId: null, stopId: null }, photos: [{ mediaId: media.id, caption: '山间照片' }] };
    const diaryResult = await post('/diaries', { ...diaryInput, clientMutationId: randomUUID() }); assert.equal(diaryResult.statusCode, 200); let diary = diaryResult.json().data;
    const draft = (await post('/diaries', { ...diaryInput, status: 'draft', title: 'PRIVATE_DRAFT', body: 'PRIVATE_DRAFT_BODY', photos: [], clientMutationId: randomUUID() })).json().data;
    const unselected = (await post('/diaries', { ...diaryInput, title: 'PRIVATE_UNSELECTED', body: 'PRIVATE_UNSELECTED_BODY', photos: [], clientMutationId: randomUUID() })).json().data;
    const options: ShareOptions = { title: '分享标题', layer: 'plan', includeDates: false, includeNotes: false, diaryIds: [], includePhotos: false, expiresInDays: 7 };
    const preview = async (values = options) => { const response = await post(`/journeys/${journeyId}/share-preview`, values); assert.equal(response.statusCode, 200); return response.json().data as SharePreview; };
    const createBody = (p: SharePreview, values = options) => ({ ...values, previewFingerprint: p.fingerprint, acknowledge: true, clientMutationId: randomUUID() });
    const publicRead = (link: ShareLink, supplied = link.path?.split('#')[1]) => get('/public/shares/' + link.id, supplied ? { authorization: 'Bearer ' + supplied } : {});
    const photoRead = (link: ShareLink, suffix = 'p1') => get(`/public/shares/${link.id}/photos/${suffix}`, { authorization: 'Bearer ' + link.path!.split('#')[1] });
    let link: ShareLink, body: ReturnType<typeof createBody>;
    await t.test('owner-only preview uses an explicit visitor DTO and creates nothing', async () => {
      assert.equal((await get(`/journeys/${journeyId}/share-options`, {})).statusCode, 401); assert.equal((await get(`/journeys/${journeyId}/share-options`, other)).statusCode, 404);
      const response = await post(`/journeys/${journeyId}/share-preview`, options, { ...owner, 'x-csrf-token': 'wrong' }); assert.equal(response.statusCode, 403);
      const p = await preview(), text = JSON.stringify(p.snapshot); for (const secret of ['PRIVATE_', '118.1875481', '2026-10-20', '08:30', ownerId, journeyId, route.id]) assert.ok(!text.includes(secret), secret + ' leaked'); assert.equal(p.snapshot.diaries.length, 0); assert.deepEqual(p.photoPreviews, []); assert.equal((await database.db.select().from(database.schema.shares)).length, 0);
      assert.equal((await post(`/journeys/${journeyId}/share-preview`, { ...options, includeCoordinates: true })).statusCode, 400);
    });
    await t.test('only selected written diaries in this journey can be included', async () => {
      const choices = (await get(`/journeys/${journeyId}/share-options`)).json().data; assert.ok(choices.diaries.some((d: any) => d.id === diary.id)); assert.ok(!choices.diaries.some((d: any) => d.id === draft.id));
      assert.equal((await post(`/journeys/${journeyId}/share-preview`, { ...options, diaryIds: [draft.id] })).statusCode, 409); assert.equal((await post(`/journeys/${journeyId}/share-preview`, { ...options, diaryIds: [randomUUID()] })).statusCode, 409);
      const p = await preview({ ...options, diaryIds: [diary.id], includePhotos: true }); assert.equal(p.photoCount, 1); assert.equal(p.snapshot.diaries.length, 1); assert.ok(!JSON.stringify(p.snapshot).includes(media.id)); assert.ok(!JSON.stringify(p.snapshot).includes(unselected.body)); assert.ok(p.photoPreviews[0]!.url.includes(media.id));
    });
    await t.test('changed source, range or missing acknowledgement requires another preview', async () => {
      const p = await preview(); await command([{ type: 'set_route_note', note: 'PRIVATE_CHANGED_NOTE' }]); assert.equal((await post(`/journeys/${journeyId}/shares`, createBody(p))).statusCode, 409);
      const fresh = await preview(); assert.equal((await post(`/journeys/${journeyId}/shares`, { ...createBody(fresh), acknowledge: false })).statusCode, 422); assert.equal((await post(`/journeys/${journeyId}/shares`, { ...createBody(fresh), includeNotes: true })).statusCode, 409);
    });
    await t.test('create retries return one recoverable link without persisting plaintext credentials', async () => {
      options.diaryIds = [diary.id]; options.includePhotos = true; const p = await preview(); body = createBody(p); const response = await post(`/journeys/${journeyId}/shares`, body); assert.equal(response.statusCode, 200); link = response.json().data;
      assert.deepEqual((await post(`/journeys/${journeyId}/shares`, body)).json().data, link); assert.equal((await database.db.select().from(database.schema.shares)).length, 1);
      const stored = JSON.stringify([await database.db.select().from(database.schema.shares), await database.db.select().from(database.schema.mutations)]); assert.ok(!stored.includes(link.path!.split('#')[1]!));
      assert.equal((await get(`/journeys/${journeyId}/shares`, other)).statusCode, 404); assert.equal((await post('/shares/' + link.id + '/revoke', { clientMutationId: randomUUID() }, other)).statusCode, 404);
      await app!.close(); app = await buildApp(cfg, database, { routingWorker: false }); assert.equal((await get(`/journeys/${journeyId}/shares`)).json().data[0].path, link.path);
    });
    await t.test('anonymous access needs the share credential and never exposes private object data', async () => {
      assert.equal((await publicRead(link, '')).statusCode, 404); assert.equal((await publicRead(link, 'A'.repeat(43))).statusCode, 404); assert.equal((await get('/public/shares/' + link.id + '?token=' + link.path!.split('#')[1], {})).statusCode, 404);
      assert.equal((await get('/public/shares/' + link.id, owner)).statusCode, 404); const response = await publicRead(link); assert.equal(response.statusCode, 200); assert.match(String(response.headers['cache-control']), /no-store/); assert.match(String(response.headers['x-robots-tag']), /noindex/); assert.equal(response.headers['referrer-policy'], 'no-referrer');
      const text = JSON.stringify(response.json().data); for (const secret of ['PRIVATE_', '118.1875481', '2026-10-20', ownerId, journeyId, route.id, diary.id, media.id, '/media/', 'originalUrl', 'sourceNote']) assert.ok(!text.includes(secret), secret + ' leaked'); assert.equal(response.json().data.diaries.length, 1);
      assert.equal((await get('/diaries/' + diary.id, {})).statusCode, 401); assert.equal((await get('/media/' + media.id + '/content', {})).statusCode, 401);
    });
    await t.test('share-scoped photos provide metadata-free previews, never original variants', async () => {
      const response = await photoRead(link); assert.equal(response.statusCode, 200); assert.equal(response.headers['content-type'], 'image/webp'); const metadata = await sharp(response.rawPayload).metadata(); assert.equal(metadata.exif, undefined); assert.ok(!response.rawPayload.includes(Buffer.from('PRIVATE_PHOTO_METADATA')));
      assert.equal((await photoRead(link, 'p2')).statusCode, 404); assert.equal((await photoRead(link, 'p1?variant=original')).statusCode, 400);
    });
    await t.test('edits do not expand a snapshot; draft state and removed photos stop access', async () => {
      const saveDiary = async (changes: object) => { const result = await app!.inject({ method: 'PUT', url: '/api/v1/diaries/' + diary.id, headers: owner, payload: { ...diaryInput, ...changes, baseVersion: diary.version, clientMutationId: randomUUID() } }); assert.equal(result.statusCode, 200); diary = result.json().data; };
      await saveDiary({ body: 'PRIVATE_NEW_BODY' }); assert.equal((await publicRead(link)).json().data.diaries[0].body, diaryInput.body);
      await saveDiary({ status: 'draft' }); assert.equal((await publicRead(link)).json().data.diaries.length, 0); assert.equal((await photoRead(link)).statusCode, 404);
      await saveDiary({ photos: [] }); assert.equal((await publicRead(link)).json().data.diaries[0].photos.length, 0); assert.equal((await photoRead(link)).statusCode, 404);
    });
    await t.test('expiry, inactive owner and rotated keys reject the same visitor routes', async () => {
      const shareRow = database.schema.shares; await database.db.update(shareRow).set({ expiresAt: new Date(Date.now() - 1000) }).where(eq(shareRow.id, link.id)); assert.equal((await publicRead(link)).statusCode, 404);
      await database.db.update(shareRow).set({ expiresAt: new Date(Date.now() + 86400000) }).where(eq(shareRow.id, link.id)); await database.db.update(database.schema.users).set({ active: false }).where(eq(database.schema.users.id, ownerId)); assert.equal((await publicRead(link)).statusCode, 404); await database.db.update(database.schema.users).set({ active: true }).where(eq(database.schema.users.id, ownerId));
      await assert.rejects(shareService(database, { ...cfg, shareSecret: randomBytes(32).toString('hex') }).read(link.id, link.path!.split('#')[1]));
    });
    await t.test('revoke is idempotent, blocks fresh reads and cannot be undone by create replay', async () => {
      const mutation = { clientMutationId: randomUUID() }; const revoked = await post('/shares/' + link.id + '/revoke', mutation); assert.equal(revoked.json().data.state, 'revoked'); assert.equal(revoked.json().data.path, null); assert.equal((await post('/shares/' + link.id + '/revoke', mutation)).statusCode, 200); assert.equal((await publicRead(link)).statusCode, 404); assert.equal((await photoRead(link)).statusCode, 404); assert.equal((await post(`/journeys/${journeyId}/shares`, body)).json().data.state, 'revoked');
    });
    await t.test('limits and terminal-history cleanup retain current links and business data', async () => {
      options.diaryIds = []; options.includePhotos = false; const p = await preview(), created = await post(`/journeys/${journeyId}/shares`, createBody(p)); assert.equal(created.statusCode, 200);
      const [row] = await database.db.select().from(database.schema.shares).where(eq(database.schema.shares.id, created.json().data.id));
      await database.db.insert(database.schema.shares).values(Array.from({ length: 18 }, () => { const id = randomUUID(), token = createHmac('sha256', cfg.shareSecret).update('travel-atlas-share-v1:' + id).digest('base64url'); return { ...row!, id, tokenHash: createHash('sha256').update(token).digest('hex'), createdAt: new Date(Date.now() - 2 * 86400000) }; }));
      const concurrent = await Promise.all([post(`/journeys/${journeyId}/shares`, createBody(p)), post(`/journeys/${journeyId}/shares`, createBody(p))]); assert.deepEqual(concurrent.map(r => r.statusCode).sort(), [200, 429]);
      await database.db.update(database.schema.shares).set({ revokedAt: new Date(Date.now() - 31 * 86400000) }).where(eq(database.schema.shares.id, link.id)); assert.equal((await shareService(database, cfg).cleanup()).removed, 1); assert.equal((await publicRead(created.json().data)).statusCode, 200); assert.equal((await get('/journeys/' + journeyId)).statusCode, 200);
    });
  } finally { if (app) await app.close(); await removeTestTables(database.pool, cfg.prefix); await database.pool.end(); await rm(mediaRoot, { recursive: true, force: true }); }
});
