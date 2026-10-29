import { loadAMap } from './amap';
import type { Location, PlaceInput, AtlasCatalog } from '../../../packages/contracts/src/index.js';
export interface PlaceResult { id: string; name: string; city: string; address: string; location: Location | null; place?: PlaceInput }
export async function searchPlaces(keyword: string, city: string, catalog: AtlasCatalog): Promise<PlaceResult[]> {
  const sdk = await loadAMap();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(Error('地点搜索超时，请重试，也可以先记下名字。')), 15000);
    sdk.plugin('AMap.PlaceSearch', () => new sdk.PlaceSearch({ city: city || '全国', pageSize: 15, extensions: 'base' }).search(keyword, (status: string, data: any) => {
      clearTimeout(timer); if (status === 'no_data') { resolve([]); return; }
      if (status !== 'complete') { reject(Error('地点搜索暂不可用，请重试或先保存名称。')); return; }
      resolve((data.poiList?.pois || []).map((p: any) => {
        const cityName = typeof p.cityname === 'string' ? p.cityname : city, code = String(p.adcode || '').slice(0, 4) + '00';
        const area = catalog.cities.find(c => c.code === code || c.name.replace(/市$/, '') === cityName.replace(/市$/, ''));
        const longitude = p.location?.getLng?.(), latitude = p.location?.getLat?.();
        return { id: String(p.id || p.name + ':' + p.address), name: String(p.name), city: cityName, address: [p.adname, typeof p.address === 'string' ? p.address : ''].filter(Boolean).join(' · '), location: Number.isFinite(longitude) && Number.isFinite(latitude) ? { longitude, latitude, crs: 'GCJ02' as const, source: 'amap_pick' as const } : null, ...(area ? { place: { countryCode: 'CHN', areaCode: area.code } } : {}) };
      }));
    }));
  });
}
