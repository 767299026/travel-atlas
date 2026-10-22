import { randomUUID, createHash } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { and, eq, inArray } from 'drizzle-orm';
import sharp from 'sharp';
import type { Database } from '../../backend/src/db/client.js';
import type { AppConfig } from '../../backend/src/config.js';
import { repository } from '../../backend/src/repository.js';
import { records } from '../../backend/src/records.js';
import { atlasService } from '../../backend/src/atlas.js';
import { geometryRepository } from '../../backend/src/geometry.js';
import { mediaService } from '../../backend/src/media.js';
import { canonicalJson, type RouteSnapshot, type RouteCommand, type Location } from '../../packages/contracts/src/index.js';

type Stop = { label: string; city: string | null; coordinate: [number, number] | null; crs?: Location['crs'] };
type Trip = { title: string; date: string; destinations: string[]; days: Stop[][]; body: string; color: string };
const trips: Trip[] = [
  { title: '江城两岸散步', date: '2025-05-01', destinations: ['武汉市'], color: '#5a8070', body: '上午在黄鹤楼附近看长江，午后走进昙华林，傍晚在江滩吹风。街巷之间留出了吃饭和休息的时间。\n\n这是用于界面审核的模拟日记；地点坐标及补绘路线是演示示意，不能用于导航。', days: [[{ label: '黄鹤楼', city: '420100', coordinate: [114.306, 30.543] }, { label: '昙华林', city: '420100', coordinate: [114.312, 30.554] }, { label: '武昌江滩', city: '420100', coordinate: [114.289, 30.558] }, { label: '街巷午餐（未定位）', city: '420100', coordinate: null }, { label: '待确认城市的旧照片', city: null, coordinate: null }]] },
  { title: '西湖与绍兴三日慢游', date: '2026-10-01', destinations: ['杭州市', '绍兴市'], color: '#8c9d6e', body: '第一天沿湖走，第二天给山间小路留半天，第三天坐车去绍兴。途中临时改了出发时间，实际记录与原计划分开。\n\n日记和插画均为演示数据，不代表本人真实出行；城际段保留缺口，不画成徒步直线。', days: [[{ label: '断桥残雪', city: '330100', coordinate: [120.151, 30.259] }, { label: '湖滨步道', city: '330100', coordinate: [120.158, 30.251] }], [{ label: '灵隐寺附近', city: '330100', coordinate: [120.101, 30.241] }, { label: '北高峰山脚', city: '330100', coordinate: [120.098, 30.246] }], [{ label: '鲁迅故里', city: '330600', coordinate: [120.581, 29.994] }, { label: '沈园', city: '330600', coordinate: [120.587, 29.991] }]] },
  { title: '黄山云谷山间一日', date: '2026-09-12', destinations: ['黄山市'], color: '#7e8b9a', body: '清晨从云谷方向上山，沿途停下来休息和看景，返回后整理照片。\n\n本条专门检查 WGS84 位置显示转换。示意点串由模拟坐标生成，并非实际 GPS 或已验证的徒步线路。', days: [[{ label: '云谷方向演示起点', city: '341000', coordinate: [118.189, 30.103], crs: 'WGS84' }, { label: '山间休息点', city: '341000', coordinate: [118.186, 30.112], crs: 'WGS84' }, { label: '白鹅岭方向演示终点', city: '341000', coordinate: [118.181, 30.122], crs: 'WGS84' }]] },
];
export type DemoManifest = { version: 1; id: string; ownerId: string; prefix: string; complete: boolean; steps: Record<string, any>; fingerprint?: string; cleaned?: boolean };
export async function seedDemo(database: Database, config: AppConfig, ownerId: string, manifestPath: string) {
  let manifest: DemoManifest;
  try { manifest = JSON.parse(await readFile(manifestPath, 'utf8')); } catch (e: any) { if (e.code !== 'ENOENT') throw e; manifest = { version: 1, id: randomUUID(), ownerId, prefix: config.prefix, complete: false, steps: {} }; }
  if (manifest.version !== 1 || manifest.ownerId !== ownerId || manifest.prefix !== config.prefix || manifest.cleaned) throw new Error('模拟清单与当前用户／数据库不一致。');
  const persist = async () => { await mkdir(join(manifestPath, '..'), { recursive: true, mode: 0o700 }); await writeFile(manifestPath + '.next', JSON.stringify(manifest), { mode: 0o600 }); await rename(manifestPath + '.next', manifestPath); };
  await persist();
  const step = async <T>(name: string, action: (key: string) => Promise<T>): Promise<T> => { if (name in manifest.steps) return manifest.steps[name]; const result = await action('demo-' + manifest.id + '-' + name); manifest.steps[name] = result; await persist(); return result; };
  const repo = repository(database), rec = records(database, config), geo = geometryRepository(database), atlas = atlasService(database), media = mediaService(database, config);
  if (!manifest.complete) {
    for (const [i, trip] of trips.entries()) {
      const created: any = await step('j' + i, key => repo.create(ownerId, { title: '【演示】' + trip.title, destinations: trip.destinations, origin: '', duration: trip.days.length, startDate: trip.date, clientMutationId: key }));
      const ops: RouteCommand[] = [{ type: 'set_route_note', note: '【演示数据】用于地图和图文审核，可按模拟数据清单清理。位置仅示意，不用于导航。' }];
      for (const [d, stops] of trip.days.entries()) for (const [n, stop] of stops.entries()) ops.push({ type: 'add_stop', dayId: created.route.days[d].id, clientRef: `draft:demo-${i}-${d}-${n}`, arrivalMode: n === 0 ? 'unknown' : 'walk', stop: { label: stop.label, region: trip.destinations.join('、'), time: n ? '14:00' : '09:00', note: '【演示】模拟停留点；坐标仅用于显示审核。', role: 'visit', location: stop.coordinate ? { longitude: stop.coordinate[0], latitude: stop.coordinate[1], crs: stop.crs ?? 'GCJ02', source: 'manual_coordinate' } : null } });
      const planned: any = await step('p' + i, key => repo.commands(ownerId, created.route.id, { baseVersion: created.route.version, clientMutationId: key, operations: ops }));
      const copied: any = await step('a' + i, key => rec.copyActual(ownerId, created.journey.id, { planVersion: planned.route.version, actualVersion: null, dayIds: planned.route.days.map((d: any) => d.id), mode: 'append', clientMutationId: key }));
      let route: RouteSnapshot = copied.route;
      // Only draw short same-day, same-city segments with two locations. Cross-city/day gaps remain gaps.
      for (const [n, segment] of route.segments.entries()) {
        const day = route.days.find(d => d.stops.some(p => p.id === segment.fromStopId) && d.stops.some(p => p.id === segment.toStopId)); if (!day) continue;
        const a = day.stops.find(p => p.id === segment.fromStopId)!, b = day.stops.find(p => p.id === segment.toStopId)!; if (!a.location || !b.location || a.location.crs !== b.location.crs || a.location.crs === 'BD09') continue;
        const result: any = await step('g' + i + '-' + n, key => geo.save(ownerId, route.id, segment.id, { baseVersion: route.version, clientMutationId: key, expectedGeometryRef: null, kind: 'manual', sourceNote: '【演示】模拟补绘点串，仅供界面测试，非 GPS 实录、非可导航线路。', geometry: { crs: a.location!.crs as 'GCJ02' | 'WGS84', parts: [[[a.location!.longitude, a.location!.latitude], [(a.location!.longitude + b.location!.longitude) / 2, (a.location!.latitude + b.location!.latitude) / 2 + .0007], [b.location!.longitude, b.location!.latitude]]] } })); route = result.route;
      }
      for (const [d, day] of route.days.entries()) for (const [n, stop] of day.stops.entries()) {
        const spec = trip.days[d]![n]!;
        await step('v' + i + '-' + d + '-' + n, key => rec.confirmVisit(ownerId, route.id, stop.id, { routeVersion: route.version, clientMutationId: key, visitedOn: planned.route.days[d].date, note: '【演示】模拟到访，不代表真实旅行。', ...(spec.city ? { place: { countryCode: 'CHN', areaCode: spec.city } } : {}) }));
      }
      const picture = await sharp(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="1000" height="640"><rect width="1000" height="640" fill="#f4efdd"/><circle cx="760" cy="165" r="68" fill="#d5ad79"/><path d="M0 430L230 190 420 420 660 160 1000 430V640H0Z" fill="${trip.color}"/><path d="M0 540Q280 360 560 530T1000 490V640H0Z" fill="#345d50"/><text x="54" y="80" fill="#234a43" font-size="36" font-family="sans-serif">TRAVEL ATLAS / DEMO ${i + 1}</text><text x="54" y="590" fill="#fffdf3" font-size="28" font-family="sans-serif">Illustration for preview / not a travel photograph</text></svg>`)).png().toBuffer();
      const image: any = await step('m' + i, key => media.upload(ownerId, key, '演示插画-' + i + '.png', async () => picture));
      await step('d' + i, key => rec.saveDiary(ownerId, null, { title: '【演示】' + trip.title + ' · 沿途手记', occurredOn: trip.date, body: trip.body, status: 'written', association: { journeyId: created.journey.id, routeId: route.id, dayId: route.days[0]!.id, stopId: route.days[0]!.stops[0]!.id }, photos: [{ mediaId: image.id, caption: '【演示插画】用于检查封面与图文排版，不是真实旅行照片。' }], clientMutationId: key }));
      await step('s' + i, key => repo.metadata(ownerId, created.journey.id, { baseVersion: 1, title: created.journey.title, destinations: trip.destinations, status: 'completed', clientMutationId: key }));
    }
    await step('manual', key => atlas.save(ownerId, null, { kind: 'visited', place: { countryCode: 'CHN', areaCode: '510100' }, visitedOn: '2024-04-05', note: '【演示】成都手动补记，无精确位置。', clientMutationId: key }));
    await step('unknown', key => atlas.save(ownerId, null, { kind: 'visited', place: { countryCode: 'CHN', areaCode: '320100' }, visitedOn: null, note: '【演示】南京旧旅行，日期待补充。', clientMutationId: key }));
    await step('wish', key => atlas.save(ownerId, null, { kind: 'wish', place: { countryCode: 'CHN', areaCode: '530100' }, visitedOn: null, note: '【演示】下一站想去昆明，不计入已到访。', clientMutationId: key }));
    manifest.complete = true;
    manifest.fingerprint = await demoFingerprint(database, manifest); await persist();
  }
  return manifest;
}
function identities(m: DemoManifest) { return { journeys: [0, 1, 2].flatMap(i => m.steps['j' + i]?.journey.id ?? []), diaries: [0, 1, 2].flatMap(i => m.steps['d' + i]?.data.id ?? []), media: [0, 1, 2].flatMap(i => m.steps['m' + i]?.id ?? []), places: ['manual', 'unknown', 'wish'].flatMap(k => m.steps[k]?.id ?? []) }; }
async function demoRows(database: Database, m: DemoManifest) {
  const { db, schema: s } = database, ids = identities(m);
  const own = (column: any, values: string[]) => and(eq(s.journeys.ownerId, m.ownerId), inArray(column, values));
  const journeys = ids.journeys.length ? await db.select().from(s.journeys).where(own(s.journeys.id, ids.journeys)) : [];
  const routes = ids.journeys.length ? await db.select().from(s.routes).where(and(eq(s.routes.ownerId, m.ownerId), inArray(s.routes.journeyId, ids.journeys))) : [], routeIds = routes.map(r => r.id);
  const visits = ids.journeys.length ? await db.select().from(s.visits).where(and(eq(s.visits.ownerId, m.ownerId), inArray(s.visits.journeyId, ids.journeys))) : [];
  const diaries = (await db.select().from(s.diaries).where(eq(s.diaries.ownerId, m.ownerId))).filter(d => ids.diaries.includes(d.id) || ids.journeys.includes(d.association?.journeyId ?? ''));
  const shares = ids.journeys.length ? await db.select().from(s.shares).where(and(eq(s.shares.ownerId, m.ownerId), inArray(s.shares.journeyId, ids.journeys))) : [];
  const places = ids.places.length ? await db.select().from(s.placeRecords).where(and(eq(s.placeRecords.ownerId, m.ownerId), inArray(s.placeRecords.id, ids.places))) : [];
  const media = ids.media.length ? await db.select().from(s.media).where(and(eq(s.media.ownerId, m.ownerId), inArray(s.media.id, ids.media))) : [];
  const photos = ids.media.length ? await db.select().from(s.diaryPhotos).where(inArray(s.diaryPhotos.mediaId, ids.media)) : [];
  const stops = routeIds.length ? await db.select().from(s.stops).where(inArray(s.stops.routeId, routeIds)) : [];
  return { journeys, routes, visits, diaries, shares, places, media, photos, stops };
}
export async function demoFingerprint(db: Database, m: DemoManifest) {
  const rows = await demoRows(db, m); const sorted = Object.fromEntries(Object.entries(rows).map(([k, values]) => [k, values.sort((a: any, b: any) => a.id.localeCompare(b.id))]));
  return createHash('sha256').update(canonicalJson(JSON.parse(JSON.stringify(sorted)))) .digest('hex');
}
export async function cleanDemo(database: Database, config: AppConfig, manifestPath: string) {
  const m: DemoManifest = JSON.parse(await readFile(manifestPath, 'utf8')); if (m.cleaned) return { alreadyCleaned: true };
  if (!m.complete || m.prefix !== config.prefix || await demoFingerprint(database, m) !== m.fingerprint) throw new Error('模拟内容有变化或清单未完成，已停止清理；请先人工核对清单。');
  const { db, schema: s } = database, ids = identities(m);
  await db.transaction(async tx => {
    await tx.select().from(s.users).where(eq(s.users.id, m.ownerId)).for('update');
    // The fingerprint is checked again with the owner write lock held.
    if (await demoFingerprint(database, m) !== m.fingerprint) throw new Error('模拟数据在清理前发生变化。');
    const routes = await tx.select().from(s.routes).where(and(eq(s.routes.ownerId, m.ownerId), inArray(s.routes.journeyId, ids.journeys))), routeIds = routes.map(r => r.id);
    if (ids.diaries.length) { await tx.delete(s.diaryPhotos).where(inArray(s.diaryPhotos.diaryId, ids.diaries)); await tx.delete(s.diaries).where(and(eq(s.diaries.ownerId, m.ownerId), inArray(s.diaries.id, ids.diaries))); }
    if (ids.journeys.length) { await tx.delete(s.shares).where(and(eq(s.shares.ownerId, m.ownerId), inArray(s.shares.journeyId, ids.journeys))); await tx.delete(s.visits).where(and(eq(s.visits.ownerId, m.ownerId), inArray(s.visits.journeyId, ids.journeys))); }
    if (routeIds.length) {
      for (const table of [s.routingCandidates, s.routingJobs, s.revisions, s.geometries, s.segments, s.stops, s.days]) await tx.delete(table).where(inArray(table.routeId, routeIds));
      await tx.delete(s.routes).where(and(eq(s.routes.ownerId, m.ownerId), inArray(s.routes.id, routeIds)));
    }
    if (ids.journeys.length) await tx.delete(s.journeys).where(and(eq(s.journeys.ownerId, m.ownerId), inArray(s.journeys.id, ids.journeys)));
    if (ids.places.length) await tx.delete(s.placeRecords).where(and(eq(s.placeRecords.ownerId, m.ownerId), inArray(s.placeRecords.id, ids.places)));
    if (ids.media.length) await tx.delete(s.media).where(and(eq(s.media.ownerId, m.ownerId), inArray(s.media.id, ids.media)));
    const mutations = await tx.select().from(s.mutations).where(eq(s.mutations.ownerId, m.ownerId)), keys = mutations.filter(r => r.key.startsWith('demo-' + m.id + '-')).map(r => r.id);
    if (keys.length) await tx.delete(s.mutations).where(inArray(s.mutations.id, keys));
  });
  const store = mediaService(database, config).files; for (const id of ids.media) await store.remove(id);
  m.cleaned = true; await writeFile(manifestPath + '.next', JSON.stringify(m), { mode: 0o600 }); await rename(manifestPath + '.next', manifestPath); return { removedJourneys: ids.journeys.length };
}
