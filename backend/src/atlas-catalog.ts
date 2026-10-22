import { readFile, mkdir, writeFile, rename } from 'node:fs/promises';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { projectRoot } from './config.js';
import { DomainError, type AtlasCatalog, type AtlasMap, type AtlasGeometry, type AtlasPlace, type PlaceInput } from '../../packages/contracts/src/index.js';
const folder = join(projectRoot, 'data/atlas'), inflight = new Map<string, Promise<unknown>>();
const worldPromise = readFile(join(projectRoot, 'backend/assets/world.json'), 'utf8').then(text => JSON.parse(text) as AtlasGeometry[]);
type Area = { adcode: number; name: string; level: string; parent: number | null; lng: number; lat: number };
const municipalities = new Set(['110000', '120000', '310000', '500000', '810000', '820000']);
async function source(name: string, url: string) {
  try { return JSON.parse(await readFile(join(folder, name), 'utf8')); } catch {}
  if (inflight.has(name)) return inflight.get(name);
  const request = (async () => {
    try {
      const result = await fetch(url, { signal: AbortSignal.timeout(12000), redirect: 'error' }); if (!result.ok || !result.body) throw new Error();
      const reader = result.body.getReader(), chunks: Uint8Array[] = []; let length = 0;
      try { while (true) { const r = await reader.read(); if (r.done) break; length += r.value.length; if (length > 5 * 1048576) { await reader.cancel(); throw new Error(); } chunks.push(r.value); } } finally { reader.releaseLock(); }
      const value = JSON.parse(Buffer.concat(chunks).toString('utf8')); await mkdir(folder, { recursive: true, mode: 0o700 });
      await writeFile(join(folder, name + '.next'), JSON.stringify(value), { mode: 0o600 }); await rename(join(folder, name + '.next'), join(folder, name)); return value;
    } catch { throw new DomainError('ATLAS_DATA_UNAVAILABLE', '地区底图或目录暂不可用，已保存记录仍保留，请稍后重试。', 503); }
  })(); inflight.set(name, request); try { return await request; } finally { inflight.delete(name); }
}
let areasPromise: Promise<Area[]> | undefined;
async function areas(): Promise<Area[]> {
  if (!areasPromise) areasPromise = source('catalog-source.json', 'https://geo.datav.aliyun.com/areas_v3/bound/all.json').then(value => {
    if (!Array.isArray(value) || value.length < 300 || value.length > 6000 || value.some(a => !Number.isSafeInteger(a.adcode) || typeof a.name !== 'string' || !['country', 'province', 'city', 'district'].includes(a.level) || !Number.isFinite(a.lng) || !Number.isFinite(a.lat))) throw new DomainError('ATLAS_DATA_UNAVAILABLE', '地区目录格式暂不可用。', 503); return value as Area[];
  }).catch(e => { areasPromise = undefined; throw e; }); return areasPromise;
}
export async function atlasCatalog(): Promise<AtlasCatalog> {
  const list = await areas(), world = await worldPromise;
  return { countries: [...new Map(world.map(f => [f.code, { code: f.code, name: f.name }])).values()].sort((a, b) => a.code === 'CHN' ? -1 : b.code === 'CHN' ? 1 : a.name.localeCompare(b.name, 'zh-CN')),
    provinces: list.filter(a => a.level === 'province').map(a => ({ code: String(a.adcode), name: a.name })),
    cities: list.filter(a => a.level === 'city' || municipalities.has(String(a.adcode))).map(a => ({ code: String(a.adcode), name: a.name, provinceCode: municipalities.has(String(a.adcode)) ? String(a.adcode) : String(a.parent) })) };
}
export async function resolvePlace(input: PlaceInput): Promise<AtlasPlace> {
  if (input.countryCode === 'CHN') {
    const list = await areas(), area = list.find(a => String(a.adcode) === input.areaCode && ['city', 'province'].includes(a.level));
    if (!area) throw new DomainError('INVALID_PLACE', '请选择目录中的省份或城市。');
    const province = area.level === 'province' ? area : list.find(a => a.adcode === area.parent && a.level === 'province'); if (!province) throw new DomainError('INVALID_PLACE', '城市所属省份暂不可用。');
    if (input.cityName !== undefined) {
      const name = input.cityName.normalize('NFKC').trim().replace(/\s+/g, ' ');
      if (area.level !== 'province' || municipalities.has(String(area.adcode)) || !name || name.length > 80) throw new DomainError('INVALID_PLACE', '手填城市需要有效省份和城市名称。');
      const key = 'CHN:' + area.adcode + ':' + createHash('sha256').update(name.toLowerCase()).digest('hex').slice(0, 16);
      return { key, countryCode: 'CHN', countryName: '中国', provinceCode: String(area.adcode), provinceName: area.name, cityCode: null, cityName: name, name, center: null };
    }
    const isCity = area.level === 'city' || municipalities.has(String(area.adcode));
    return { key: 'CHN:' + area.adcode, countryCode: 'CHN', countryName: '中国', provinceCode: String(province.adcode), provinceName: province.name, cityCode: isCity ? String(area.adcode) : null, cityName: isCity ? area.name : null, name: area.name, center: [area.lng, area.lat] };
  }
  const country = (await worldPromise).find(c => c.code === input.countryCode), cityName = input.cityName?.normalize('NFKC').trim().replace(/\s+/g, ' ');
  if (!country || !cityName || cityName.length > 80 || input.areaCode) throw new DomainError('INVALID_PLACE', '请选择国家／地区并填写城市名称。');
  const key = country.code + ':' + createHash('sha256').update(cityName.toLocaleLowerCase('en-US')).digest('hex').slice(0, 24);
  return { key, countryCode: country.code, countryName: country.name, provinceCode: null, provinceName: null, cityCode: key, cityName, name: cityName, center: null };
}
export async function atlasMap(code: string): Promise<AtlasMap> {
  if (code === 'world') return { features: await worldPromise, attribution: 'Made with Natural Earth · 公共领域参考底图', sourceUrl: 'https://www.naturalearthdata.com/about/terms-of-use/' };
  if (code !== '100000' && !(await areas()).some(a => String(a.adcode) === code && ['province', 'city'].includes(a.level))) throw new DomainError('NOT_FOUND', '地区底图不存在。', 404);
  const value = await source('map-' + code + '.json', `https://geo.datav.aliyun.com/areas_v3/bound/${code}_full.json`) as { type: string; features: { properties: { adcode?: number; name?: string; center?: [number, number] }; geometry: AtlasGeometry['geometry'] }[] };
  if (value.type !== 'FeatureCollection' || !Array.isArray(value.features) || value.features.length > 500) throw new DomainError('ATLAS_DATA_UNAVAILABLE', '地区底图格式暂不可用。', 503);
  return { features: value.features.filter(f => f.geometry && ['Polygon', 'MultiPolygon', 'LineString', 'MultiLineString'].includes(f.geometry.type)).map(f => ({ code: String(f.properties.adcode ?? ''), name: f.properties.name ?? '', center: f.properties.center ?? null, geometry: f.geometry })), attribution: 'DataV GeoAtlas · 地区参考底图', sourceUrl: 'https://datav.aliyun.com/portal/school/atlas/area_selector' };
}
