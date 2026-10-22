import { Type as T } from '@sinclair/typebox';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { AppConfig } from './config.js';
import type { Database } from './db/client.js';
import type { RouteContext } from './record-routes.js';
import { shareService } from './shares.js';
import { PrivateImageStore } from './media.js';
import type { ShareCreate, ShareOptions } from '../../packages/contracts/src/index.js';
const object = (fields: Parameters<typeof T.Object>[0]) => T.Object(fields, { additionalProperties: false });
const fields = { title: T.String({ minLength: 1, maxLength: 80 }), layer: T.Union([T.Literal('plan'), T.Literal('actual')]), includeDates: T.Boolean(), includeNotes: T.Boolean(), diaryIds: T.Array(T.String({ minLength: 1, maxLength: 36 }), { maxItems: 20, uniqueItems: true }), includePhotos: T.Boolean(), expiresInDays: T.Union([T.Literal(1), T.Literal(7), T.Literal(30)]) };
const mutation = T.String({ minLength: 8, maxLength: 80 });
export function registerShareRoutes(app: FastifyInstance, database: Database, config: AppConfig, { authenticate, respond }: RouteContext) {
  const service = shareService(database, config), files = new PrivateImageStore(config.mediaRoot), auth = { preHandler: authenticate };
  app.get<{ Params: { id: string } }>('/api/v1/journeys/:id/share-options', auth, async request => respond(request, await service.choices(request.auth!.user.id, request.params.id)));
  app.post<{ Params: { id: string }; Body: ShareOptions }>('/api/v1/journeys/:id/share-preview', { ...auth, schema: { body: object(fields) } }, async request => respond(request, await service.preview(request.auth!.user.id, request.params.id, request.body)));
  app.post<{ Params: { id: string }; Body: ShareCreate }>('/api/v1/journeys/:id/shares', { ...auth, schema: { body: object({ ...fields, previewFingerprint: T.String({ pattern: '^[a-f0-9]{64}$' }), acknowledge: T.Boolean(), clientMutationId: mutation }) }, config: { rateLimit: { max: config.rateLimitMax ?? 10, timeWindow: '1 minute' } } }, async request => respond(request, await service.create(request.auth!.user.id, request.params.id, request.body)));
  app.get<{ Params: { id: string } }>('/api/v1/journeys/:id/shares', auth, async request => respond(request, await service.list(request.auth!.user.id, request.params.id)));
  app.post<{ Params: { id: string }; Body: { clientMutationId: string } }>('/api/v1/shares/:id/revoke', { ...auth, schema: { body: object({ clientMutationId: mutation }) } }, async request => respond(request, await service.revoke(request.auth!.user.id, request.params.id, request.body)));
  const credential = (request: FastifyRequest) => typeof request.headers.authorization === 'string' ? /^Bearer ([A-Za-z0-9_-]{43})$/.exec(request.headers.authorization)?.[1] : undefined;
  app.addHook('onRequest', async (request, reply) => { if (request.url.startsWith('/api/v1/public/shares/')) reply.header('Cache-Control', 'private, no-store, max-age=0').header('X-Robots-Tag', 'noindex, nofollow, nosnippet').header('Referrer-Policy', 'no-referrer'); });
  const publicLimit = { rateLimit: { max: config.rateLimitMax ?? 120, timeWindow: '1 minute' } };
  app.get<{ Params: { id: string } }>('/api/v1/public/shares/:id', { config: publicLimit }, async request => respond(request, await service.read(request.params.id, credential(request))));
  app.get<{ Params: { id: string; key: string } }>('/api/v1/public/shares/:id/photos/:key', { config: publicLimit, schema: { querystring: object({}) } }, async (request, reply) => {
    const mediaId = await service.photo(request.params.id, request.params.key, credential(request)); reply.type('image/webp'); return reply.send(await files.stream(mediaId, 'preview', 'webp'));
  });
}
