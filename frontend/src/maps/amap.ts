import { api } from '../api';
import { validPosition, type Position } from '../../../packages/contracts/src/index.js';
let pending: Promise<any> | null = null;
export function loadAMap(): Promise<any> {
  if ((window as any).AMap) return Promise.resolve((window as any).AMap);
  if (pending) return pending;
  pending = (async () => {
    const capabilities = await api<{ amap: { jsKey: string; serviceHost: string } | null }>('/maps/capabilities');
    if (!capabilities.amap) throw new Error('在线地图尚未配置，足迹记录仍可从列表查看。');
    const config = capabilities.amap;
    await new Promise<void>((resolve, reject) => {
      (window as any)._AMapSecurityConfig = { serviceHost: location.origin + config.serviceHost };
      const script = document.createElement('script'); let timer: ReturnType<typeof setTimeout>;
      const finish = (failed: boolean) => { clearTimeout(timer); script.onload = null; script.onerror = null; if (failed) { script.remove(); reject(new Error('在线地图加载失败，请检查网络或稍后重试。')); } else resolve(); };
      script.src = 'https://webapi.amap.com/maps?v=2.0&key=' + encodeURIComponent(config.jsKey); script.async = true;
      script.onload = () => finish(!(window as any).AMap); script.onerror = () => finish(true); timer = setTimeout(() => finish(true), 18000); document.head.append(script);
    });
    return (window as any).AMap;
  })().catch(e => { pending = null; throw e; });
  return pending;
}
// Coordinate conversion shares the supplier's QPS budget across map instances.
let conversionQueue: Promise<unknown> = Promise.resolve(), lastConversionStarted = 0;
function convertBatch(sdk: any, batch: Position[], type: string): Promise<Position[]> {
  const run = async () => {
    for (let attempt = 0; attempt < 5; attempt++) {
      const wait = Math.max(0, 700 - (performance.now() - lastConversionStarted));
      if (wait) await new Promise(resolve => setTimeout(resolve, wait));
      lastConversionStarted = performance.now();
      const response = await new Promise<{ status: string; result: any }>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('显示坐标转换超时，请重试；原始位置未改变。')), 12000);
        sdk.convertFrom(batch.map(p => [...p]), type, (status: string, result: any) => { clearTimeout(timer); resolve({ status, result }); });
      });
      const { status, result } = response;
      const rateLimited = /10021|10014|CUQPS|QPS_HAS_EXCEEDED/.test(String(result?.infocode ?? '') + ' ' + String(result?.info ?? result));
      if (status !== 'complete' && rateLimited && attempt < 4) { await new Promise(resolve => setTimeout(resolve, 1000 * 2 ** attempt)); continue; }
      const output = result?.locations?.map((p: any) => [p.getLng(), p.getLat()]);
      if (status !== 'complete' || output?.length !== batch.length || !output.every(validPosition)) throw new Error('显示坐标转换失败，未混用不同坐标系。');
      return output as Position[];
    }
    throw new Error('显示坐标转换繁忙，请稍后重试；原始位置未改变。');
  };
  const task = conversionQueue.then(run, run); conversionQueue = task.catch(() => {}); return task;
}
export function displayConverter(sdk: any) {
  const cache = new Map<string, Position>();
  return async (points: Position[], crs: string): Promise<Position[]> => {
    if (crs === 'GCJ02') return points.map(p => [...p] as Position);
    const type = crs === 'BD09' ? 'baidu' : 'gps'; if (cache.size > 16000) cache.clear();
    const missing = [...new Map(points.filter(p => !cache.has(type + ':' + p.join(','))).map(p => [p.join(','), p])).values()];
    for (let i = 0; i < missing.length; i += 40) {
      const batch = missing.slice(i, i + 40);
      const converted = await convertBatch(sdk, batch, type);
      converted.forEach((p, j) => cache.set(type + ':' + batch[j]!.join(','), p));
    }
    return points.map(p => cache.get(type + ':' + p.join(','))!);
  };
}
