import type { FastifyInstance } from 'fastify';
import type { AppConfig } from './config.js';
import type { Database } from './db/client.js';
import type { RouteContext } from './record-routes.js';
import { geometryRepository } from './geometry.js';
import { parseGpx } from './gpx.js';
import { geometrySaveSchema, gpxPreviewSchema, exportSchema } from './map-schemas.js';
import { DomainError, geometryLimits, type GeometrySaveInput } from '../../packages/contracts/src/index.js';
export function registerMapRoutes(app: FastifyInstance, database: Database, config: AppConfig, context: RouteContext, upstreamFetch: typeof fetch = fetch) {
  const store = geometryRepository(database), { authenticate, respond } = context, auth = { preHandler: authenticate };
  app.get('/api/v1/maps/capabilities', auth, async request => respond(request, { amap: config.amap ? { jsKey: config.amap.jsKey, serviceHost: '/api/v1/maps/_AMapService' } : null, limits: geometryLimits }));
  // Only the official JS API service paths needed by this interface. Not an arbitrary URL proxy.
  const paths = new Set(['v3/log/init', 'v3/assistant/coordinate/convert', 'v3/place/text', 'v3/place/around', 'v3/config/district', 'v4/map/styles']);
  let active = 0;
  app.get<{ Params: { '*': string } }>('/api/v1/maps/_AMapService/*', { ...auth, config: { rateLimit: { max: 120, timeWindow: '1 minute' } } }, async (request, reply) => {
    if (!config.amap) throw new DomainError('MAP_NOT_CONFIGURED', '在线地图尚未配置；可以继续使用坐标和 GPX。', 503);
    const path = request.params['*']; if (!paths.has(path)) throw new DomainError('NOT_FOUND', '不支持此地图服务路径。', 404);
    const incoming = new URL(request.raw.url!, 'http://localhost');
    if (incoming.search.length > 8192 || [...incoming.searchParams].length > 60 || incoming.searchParams.has('jscode')) throw new DomainError('VALIDATION_ERROR', '地图请求参数无效。', 400);
    for (const [name, value] of incoming.searchParams) if (/callback/i.test(name) && !/^[a-zA-Z_$][\w.$]{0,160}$/.test(value)) throw new DomainError('VALIDATION_ERROR', '地图回调格式无效。', 400);
    const url = new URL('/' + path, path === 'v4/map/styles' ? 'https://webapi.amap.com' : 'https://restapi.amap.com');
    url.search = incoming.search; url.searchParams.set('key', config.amap.jsKey); url.searchParams.set('jscode', config.amap.securityCode);
    if (active >= 4) throw new DomainError('MAP_BUSY', '地图服务繁忙，请稍后重试。', 429);
    active++;
    try {
      const upstream = await upstreamFetch(url, { signal: AbortSignal.timeout(12000), redirect: 'error' });
      if (!upstream.ok || !upstream.body) throw new Error('Map request failed');
      const reader = upstream.body.getReader(), chunks: Uint8Array[] = []; let size = 0;
      try { while (true) { const { done, value } = await reader.read(); if (done) break; size += value.length; if (size > 4194304) { await reader.cancel(); throw new Error('Map response too large'); } chunks.push(value); } } finally { reader.releaseLock(); }
      const body = Buffer.concat(chunks); if (body.includes(Buffer.from(config.amap.securityCode))) throw new Error('Unsafe upstream response');
      const contentType = upstream.headers.get('content-type') ?? 'application/json', jsonp = [...incoming.searchParams.keys()].some(name => /callback/i.test(name));
      reply.type(jsonp || /javascript/i.test(contentType) ? 'application/javascript' : /json/i.test(contentType) ? 'application/json' : 'application/octet-stream'); return reply.send(body);
    } catch { throw new DomainError('MAP_UNAVAILABLE', '在线地图服务暂不可用，请稍后重试；已有行程与文件不受影响。', 502); }
    finally { active--; }
  });
  app.post<{ Body: { xml: string } }>('/api/v1/geometries/gpx-preview', { ...auth, bodyLimit: 2228224, schema: { body: gpxPreviewSchema }, config: { rateLimit: { max: 15, timeWindow: '1 minute' } } }, async request => respond(request, parseGpx(request.body.xml)));
  app.get<{ Params: { id: string } }>('/api/v1/routes/:id/geometries', auth, async request => respond(request, await store.list(request.auth!.user.id, request.params.id)));
  app.get<{ Params: { id: string } }>('/api/v1/geometries/:id', auth, async request => respond(request, await store.get(request.auth!.user.id, request.params.id)));
  app.get<{ Params: { id: string } }>('/api/v1/geometries/:id/original', auth, async (request, reply) => {
    const xml = await store.original(request.auth!.user.id, request.params.id); return reply.type('application/gpx+xml').header('Content-Disposition', `attachment; filename="original-${request.params.id.replace(/[^a-zA-Z0-9-]/g, '')}.gpx"`).send(xml);
  });
  app.put<{ Params: { id: string; segmentId: string }; Body: GeometrySaveInput }>('/api/v1/routes/:id/segments/:segmentId/geometry', { ...auth, bodyLimit: 2228224, schema: { body: geometrySaveSchema } }, async request => respond(request, await store.save(request.auth!.user.id, request.params.id, request.params.segmentId, request.body)));
  app.get<{ Params: { id: string } }>('/api/v1/routes/:id/gpx-export-preview', auth, async request => respond(request, await store.previewExport(request.auth!.user.id, request.params.id)));
  app.post<{ Params: { id: string }; Body: { baseVersion: number; allowPartial: boolean } }>('/api/v1/routes/:id/gpx-export', { ...auth, schema: { body: exportSchema } }, async request => respond(request, await store.export(request.auth!.user.id, request.params.id, request.body.baseVersion, request.body.allowPartial)));
}
