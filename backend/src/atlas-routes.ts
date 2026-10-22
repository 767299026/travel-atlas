import { Type as T } from '@sinclair/typebox';
import type { FastifyInstance } from 'fastify';
import type { Database } from './db/client.js';
import type { RouteContext } from './record-routes.js';
import { atlasService } from './atlas.js';
import { atlasCatalog, atlasMap } from './atlas-catalog.js';
import type { PlaceRecordInput, PlaceInput } from '../../packages/contracts/src/index.js';
export const atlasObject = (fields: Parameters<typeof T.Object>[0]) => T.Object(fields, { additionalProperties: false });
export const placeInputSchema = atlasObject({ countryCode: T.String({ pattern: '^[A-Z]{3}$' }), areaCode: T.Optional(T.String({ pattern: '^\\d{6}$' })), cityName: T.Optional(T.String({ minLength: 1, maxLength: 80 })) });
const mutation = T.String({ minLength: 8, maxLength: 80 }), version = T.Integer({ minimum: 1 }), year = T.Optional(T.String({ pattern: '^(all|unknown|19[0-9]{2}|20[0-9]{2}|21[0-9]{2}|2200)$' }));
const fields = { kind: T.Union([T.Literal('visited'), T.Literal('wish')]), place: placeInputSchema, visitedOn: T.Union([T.String({ pattern: '^\\d{4}-\\d{2}-\\d{2}$' }), T.Null()]), note: T.String({ maxLength: 4000 }), clientMutationId: mutation };
export function registerAtlasRoutes(app: FastifyInstance, database: Database, { authenticate, respond }: RouteContext) {
  const service = atlasService(database), auth = { preHandler: authenticate };
  app.get('/api/v1/atlas/catalog', auth, async request => respond(request, await atlasCatalog()));
  app.get<{ Params: { code: string } }>('/api/v1/atlas/maps/:code', { ...auth, config: { rateLimit: { max: 60, timeWindow: '1 minute' } } }, async request => respond(request, await atlasMap(request.params.code)));
  app.get<{ Querystring: { year?: string } }>('/api/v1/atlas', { ...auth, schema: { querystring: atlasObject({ year }) } }, async request => respond(request, await service.overview(request.auth!.user.id, request.query.year)));
  app.get<{ Querystring: { year?: string } }>('/api/v1/atlas/unassigned', { ...auth, schema: { querystring: atlasObject({ year }) } }, async request => respond(request, await service.unassigned(request.auth!.user.id, request.query.year)));
  app.get<{ Params: { code: string }; Querystring: { year?: string } }>('/api/v1/atlas/cities/:code', { ...auth, schema: { params: atlasObject({ code: T.String({ pattern: '^\\d{6}$' }) }), querystring: atlasObject({ year }) } }, async request => respond(request, await service.cityLayer(request.auth!.user.id, await service.resolveKey(request.auth!.user.id, 'CHN:' + request.params.code), request.query.year)));
  app.get('/api/v1/atlas/wishes', auth, async request => respond(request, await service.wishes(request.auth!.user.id)));
  app.get<{ Params: { key: string }; Querystring: { year?: string; cursor?: number } }>('/api/v1/atlas/places/:key', { ...auth, schema: { querystring: atlasObject({ year, cursor: T.Optional(T.Integer({ minimum: 0, maximum: 100000 })) }) } }, async request => respond(request, await service.detail(request.auth!.user.id, await service.resolveKey(request.auth!.user.id, request.params.key), request.query.year, request.query.cursor)));
  app.post<{ Body: PlaceRecordInput & { clientMutationId: string } }>('/api/v1/atlas/records', { ...auth, schema: { body: atlasObject(fields) } }, async request => respond(request, await service.save(request.auth!.user.id, null, request.body)));
  app.put<{ Params: { id: string }; Body: PlaceRecordInput & { baseVersion: number; clientMutationId: string } }>('/api/v1/atlas/records/:id', { ...auth, schema: { body: atlasObject({ ...fields, baseVersion: version }) } }, async request => respond(request, await service.save(request.auth!.user.id, request.params.id, request.body)));
  app.delete<{ Params: { id: string }; Body: { baseVersion: number; clientMutationId: string } }>('/api/v1/atlas/records/:id', { ...auth, schema: { body: atlasObject({ baseVersion: version, clientMutationId: mutation }) } }, async request => respond(request, await service.remove(request.auth!.user.id, request.params.id, request.body)));
  app.put<{ Params: { id: string }; Body: { place: PlaceInput; baseVersion: number; clientMutationId: string } }>('/api/v1/visits/:id/place', { ...auth, schema: { body: atlasObject({ place: placeInputSchema, baseVersion: version, clientMutationId: mutation }) } }, async request => respond(request, await service.assign(request.auth!.user.id, request.params.id, request.body)));
}
