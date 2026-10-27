import { Type as T } from '@sinclair/typebox';
import type { FastifyInstance } from 'fastify';
import type { Database } from './db/client.js';
import type { RouteContext } from './record-routes.js';
import type { PhotoSave } from '../../packages/contracts/src/index.js';
import { photoService } from './photos.js';
import type { AppConfig } from './config.js';
import { mediaService } from './media.js';
const obj = (fields: Parameters<typeof T.Object>[0]) => T.Object(fields, { additionalProperties: false });
const text = (max: number, min = 0) => T.String({ maxLength: max, minLength: min });
const position = obj({ longitude: T.Number({ minimum: -180, maximum: 180 }), latitude: T.Number({ minimum: -90, maximum: 90 }), crs: T.Union(['WGS84', 'GCJ02', 'BD09'].map(v => T.Literal(v))), source: T.Optional(T.Union(['manual_coordinate', 'amap_pick', 'gpx_endpoint', 'outdoor_pick'].map(v => T.Literal(v)))) });
const place = obj({ label: text(100, 1), cityName: text(80), cityCode: T.Optional(T.String({ pattern: '^\\d{6}$' })), position: T.Union([position, T.Null()]), source: T.Union(['manual', 'exif', 'map', 'diary'].map(v => T.Literal(v))) });
const item = obj({ mediaId: T.String({ format: 'uuid' }), baseVersion: T.Integer({ minimum: 0 }), takenOn: T.Union([T.String({ pattern: '^\\d{4}-\\d{2}-\\d{2}$' }), T.Null()]), place: T.Union([place, T.Null()]), note: text(1000) });
export function registerPhotoRoutes(app: FastifyInstance, database: Database, config: AppConfig, { authenticate, respond }: RouteContext) {
  const service = photoService(database), auth = { preHandler: authenticate };
  app.get('/api/v1/photos', auth, async request => respond(request, { ...await service.library(request.auth!.user.id), uploadMaxBytes: config.uploadMaxBytes }));
  app.post<{ Body: PhotoSave }>('/api/v1/photos', { ...auth, schema: { body: obj({ items: T.Array(item, { minItems: 1, maxItems: 24 }), groupNote: T.Optional(obj({ key: text(500, 1), note: text(1000), version: T.Integer({ minimum: 0 }) })), clientMutationId: text(80, 8) }) } }, async request => respond(request, await service.save(request.auth!.user.id, request.body)));
  app.delete<{ Params: { id: string }; Body: { baseVersion: number; clientMutationId: string } }>('/api/v1/photos/:id', { ...auth, schema: { body: obj({ baseVersion: T.Integer({ minimum: 0 }), clientMutationId: text(80, 8) }) } }, async request => {
    const result = await service.remove(request.auth!.user.id, request.params.id, request.body); await mediaService(database, config).cleanRemoved(result.removedIds); return respond(request, { removed: true });
  });
}
