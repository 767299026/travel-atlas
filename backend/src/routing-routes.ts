import type { FastifyInstance } from 'fastify';
import { Type as T } from '@sinclair/typebox';
import type { AppConfig } from './config.js';
import type { Database } from './db/client.js';
import type { RouteContext } from './record-routes.js';
import { routingService } from './routing.js';
const object = (fields: Parameters<typeof T.Object>[0]) => T.Object(fields, { additionalProperties: false });
const id = T.String({ minLength: 1, maxLength: 80 }), mutation = T.String({ minLength: 8, maxLength: 80 }), baseVersion = T.Integer({ minimum: 1 });
declare module 'fastify' { interface FastifyInstance { routingWorker: ReturnType<typeof routingService> } }
export function registerRoutingRoutes(app: FastifyInstance, database: Database, config: AppConfig, context: RouteContext, dependencies: { routingFetch?: typeof fetch; routingWorker?: boolean }) {
  const service = routingService(database, config, dependencies.routingFetch), { authenticate, respond } = context, auth = { preHandler: authenticate };
  app.decorate('routingWorker', service); if (dependencies.routingWorker !== false) service.start(); app.addHook('onClose', async () => service.stop());
  app.get('/api/v1/routing/capabilities', auth, async request => respond(request, service.capabilities()));
  app.post<{ Params: { id: string; segmentId: string }; Body: { baseVersion: number; clientMutationId: string } }>('/api/v1/routes/:id/segments/:segmentId/routing-jobs', { ...auth, schema: { body: object({ baseVersion, clientMutationId: mutation }) }, config: { rateLimit: { max: config.rateLimitMax ?? 10, timeWindow: '1 minute' } } }, async request => respond(request, await service.create(request.auth!.user.id, request.params.id, request.params.segmentId, request.body)));
  app.get<{ Params: { id: string }; Querystring: { segmentId: string } }>('/api/v1/routes/:id/routing-jobs', { ...auth, schema: { querystring: object({ segmentId: id }) } }, async request => respond(request, await service.list(request.auth!.user.id, request.params.id, request.query.segmentId)));
  app.get<{ Params: { id: string } }>('/api/v1/routing-jobs/:id', auth, async request => respond(request, await service.get(request.auth!.user.id, request.params.id)));
  app.post<{ Params: { id: string }; Body: { clientMutationId: string } }>('/api/v1/routing-jobs/:id/cancel', { ...auth, schema: { body: object({ clientMutationId: mutation }) } }, async request => respond(request, await service.cancel(request.auth!.user.id, request.params.id, request.body)));
  app.get<{ Params: { id: string } }>('/api/v1/routing-candidates/:id', auth, async request => respond(request, await service.candidate(request.auth!.user.id, request.params.id)));
  app.post<{ Params: { id: string }; Body: { baseVersion: number; clientMutationId: string; expectedGeometryRef: string | null; acknowledge: boolean } }>('/api/v1/routing-candidates/:id/adopt', { ...auth, schema: { body: object({ baseVersion, clientMutationId: mutation, expectedGeometryRef: T.Union([id, T.Null()]), acknowledge: T.Boolean() }) } }, async request => respond(request, await service.adopt(request.auth!.user.id, request.params.id, request.body)));
}
