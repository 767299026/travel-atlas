import { DomainError, routingAttribution, routingLimits, validateGeometry, validPosition, geometryLength, distanceM, type RoutingInput, type RoutingInfo, type RouteGeometry, type Position } from '../../packages/contracts/src/index.js';
export function parseBrouterResponse(value: unknown, input: RoutingInput, candidateId: string) {
  const fail = () => new DomainError('UPSTREAM_INVALID_RESPONSE', '路由服务返回的路径或指标格式无效，未生成候选。', 502);
  const data = value as { type?: string; features?: { type?: string; properties?: Record<string, unknown>; geometry?: { type?: string; coordinates?: unknown[] } }[] };
  if (data?.type !== 'FeatureCollection' || !Array.isArray(data.features) || data.features.length !== 1 || data.features[0]?.type !== 'Feature') throw fail();
  const feature = data.features[0]!, raw = feature.geometry?.coordinates, properties = feature.properties;
  if (feature.geometry?.type !== 'LineString' || !Array.isArray(raw) || raw.length < 2 || raw.length > 10000 || !properties || properties.creator !== 'BRouter-' + input.engineVersion) throw fail();
  const coordinates = raw.map(p => { if (!Array.isArray(p) || ![2, 3].includes(p.length) || !p.every(Number.isFinite) || !validPosition(p.slice(0, 2))) throw fail(); return [p[0], p[1]] as Position; });
  const geometry: RouteGeometry = { crs: 'WGS84', parts: [coordinates] }; validateGeometry(geometry); const lengthM = geometryLength(geometry);
  if (lengthM > routingLimits.candidateLengthM || lengthM < 1) throw new DomainError('ROUTE_LIMIT', '候选长度超出当前规划范围，或没有有效路径。');
  const metric = (name: string, maximum: number) => {
    const value = properties[name]; if (value === undefined || value === null || value === '') return null;
    if (!['string', 'number'].includes(typeof value)) throw fail();
    const number = Number(value); if (!Number.isFinite(number) || number < 0 || number > maximum) throw fail(); return number;
  };
  const info: RoutingInfo = { provider: 'brouter_local', engineVersion: input.engineVersion, profile: input.profile, profileSha256: input.profileSha256, dataVersion: input.dataVersion, attribution: routingAttribution,
    fromOffsetM: distanceM(input.from, coordinates[0]!), toOffsetM: distanceM(input.to, coordinates.at(-1)!), providerDistanceM: metric('track-length', routingLimits.candidateLengthM), estimatedTimeS: metric('total-time', 2592000), candidateId };
  const diagnostics = ['路网规划候选，未确认实际走过；模型时间不是个人运动时间。'];
  for (const [name, offset] of [['起点', info.fromOffsetM], ['终点', info.toOffsetM]] as const) if (offset > 150) diagnostics.push(`${name}与所选地点偏移约 ${Math.round(offset)} 米，请核对，未补直线。`);
  if (info.providerDistanceM !== null && Math.abs(info.providerDistanceM - lengthM) > Math.max(100, lengthM * 0.1)) diagnostics.push('供应商里程与二维线长差异较大，请核对。');
  return { geometry, lengthM, info, diagnostics };
}
export async function calculateBrouter(endpoint: string, input: RoutingInput, candidateId: string, signal: AbortSignal, upstreamFetch: typeof fetch) {
  const url = new URL(endpoint); if (url.origin !== 'http://127.0.0.1:17777' || url.pathname !== '/brouter') throw new DomainError('ROUTER_CONFIG', '路由服务配置无效。', 503);
  url.searchParams.set('lonlats', input.from.join(',') + '|' + input.to.join(',')); url.searchParams.set('profile', input.profile); url.searchParams.set('alternativeidx', '0'); url.searchParams.set('format', 'geojson');
  const response = await upstreamFetch(url, { signal, redirect: 'error' }); if (!response.body) throw new DomainError('ROUTER_UNAVAILABLE', '本机路由暂不可用，请稍后重试。', 503);
  const reader = response.body.getReader(), chunks: Uint8Array[] = []; let size = 0;
  try { while (true) { const next = await reader.read(); if (next.done) break; size += next.value.length; if (size > routingLimits.responseBytes) { await reader.cancel(); throw new DomainError('ROUTE_LIMIT', '候选数据超过大小限制，请缩短规划范围。'); } chunks.push(next.value); } } finally { reader.releaseLock(); }
  const body = Buffer.concat(chunks).toString('utf8');
  if (!response.ok) {
    if (/rd5|datafile|segment.*not found|does not exist/i.test(body)) throw new DomainError('ROUTING_DATA_MISSING', '所需区域路网尚未安装；当前没有生成路线。');
    if (/not mapped|no route|cannot find|not found/i.test(body)) throw new DomainError('NO_ROUTE', '起终点没有匹配到可用路网，请核对入口或调整位置。');
    throw new DomainError('ROUTER_UNAVAILABLE', '本机路由暂不可用或未找到候选，请稍后重试。', 503);
  }
  let value: unknown; try { value = JSON.parse(body); } catch { throw new DomainError('UPSTREAM_INVALID_RESPONSE', '路由服务没有返回有效候选。', 502); }
  return parseBrouterResponse(value, input, candidateId);
}
