import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { Database } from './db/client.js';
import type { AppConfig } from './config.js';
import { records } from './records.js';
import { mediaService } from './media.js';
import { copyApplySchema, copyPreviewSchema, diaryCreateSchema, diarySaveSchema, mutationSchema, versionMutationSchema, visitSchema } from './record-schemas.js';
import { DomainError, type ActualCopyInput, type DiaryInput } from '../../packages/contracts/src/index.js';

export interface RouteContext { authenticate: (request: FastifyRequest) => Promise<void>; respond: (request: FastifyRequest, data: unknown) => unknown }
export function registerRecordRoutes(app: FastifyInstance, database: Database, config: AppConfig, context: RouteContext) {
  const store = records(database, config), media = mediaService(database, config), { authenticate, respond } = context;
  const auth = { preHandler: authenticate }; type Id = { id: string }; type Mutation = { clientMutationId: string };
  app.post<{ Params: Id; Body: ActualCopyInput }>('/api/v1/journeys/:id/actual-copy-previews', { ...auth, schema: { body: copyPreviewSchema } }, async request => respond(request, await store.copyPreview(request.auth!.user.id, request.params.id, request.body)));
  app.post<{ Params: Id; Body: ActualCopyInput & Mutation }>('/api/v1/journeys/:id/actual-copy', { ...auth, schema: { body: copyApplySchema } }, async request => respond(request, await store.copyActual(request.auth!.user.id, request.params.id, request.body)));
  app.post<{ Params: Id; Body: Mutation }>('/api/v1/journeys/:id/actual', { ...auth, schema: { body: mutationSchema } }, async request => respond(request, await store.emptyActual(request.auth!.user.id, request.params.id, request.body)));
  app.get<{ Querystring: { journeyId?: string } }>('/api/v1/visits', auth, async request => respond(request, await store.listVisits(request.auth!.user.id, request.query.journeyId)));
  app.post<{ Params: { id: string; stopId: string }; Body: { routeVersion: number; visitedOn: string; note: string } & Mutation }>('/api/v1/routes/:id/stops/:stopId/visit', { ...auth, schema: { body: visitSchema } }, async request => respond(request, await store.confirmVisit(request.auth!.user.id, request.params.id, request.params.stopId, request.body)));
  app.delete<{ Params: Id; Body: Mutation }>('/api/v1/visits/:id', { ...auth, schema: { body: mutationSchema } }, async request => respond(request, await store.removeVisit(request.auth!.user.id, request.params.id, request.body)));
  app.get('/api/v1/me/summary', auth, async request => respond(request, await store.accountSummary(request.auth!.user.id)));
  app.get<{ Querystring: { journeyId?: string; cursor?: string } }>('/api/v1/diaries', auth, async request => respond(request, await store.listDiaries(request.auth!.user.id, request.query)));
  app.get<{ Params: Id }>('/api/v1/diaries/:id', auth, async request => respond(request, await store.readDiary(request.auth!.user.id, request.params.id)));
  app.post<{ Body: DiaryInput & Mutation }>('/api/v1/diaries', { ...auth, schema: { body: diaryCreateSchema } }, async request => {
    const result = await store.saveDiary(request.auth!.user.id, null, request.body); await media.cleanRemoved(result.removedIds); return respond(request, result.data);
  });
  app.put<{ Params: Id; Body: DiaryInput & Mutation & { baseVersion: number } }>('/api/v1/diaries/:id', { ...auth, schema: { body: diarySaveSchema } }, async request => {
    const result = await store.saveDiary(request.auth!.user.id, request.params.id, request.body); await media.cleanRemoved(result.removedIds); return respond(request, result.data);
  });
  app.delete<{ Params: Id; Body: Mutation & { baseVersion: number } }>('/api/v1/diaries/:id', { ...auth, schema: { body: versionMutationSchema } }, async request => {
    const result = await store.removeDiary(request.auth!.user.id, request.params.id, request.body); await media.cleanRemoved(result.removedIds); return respond(request, { removed: true });
  });
  app.get('/api/v1/media/capabilities', auth, async request => respond(request, { formats: ['image/jpeg', 'image/png', 'image/webp'], uploadMaxBytes: config.uploadMaxBytes, maxPixels: 50_000_000, photosPerDiary: 24, quotaBytes: config.mediaQuotaBytes }));
  app.post('/api/v1/media', { ...auth, bodyLimit: config.uploadMaxBytes + 65536, config: { rateLimit: { max: 40, timeWindow: '1 minute' } } }, async request => {
    const key = request.headers['x-upload-id']; if (typeof key !== 'string') throw new DomainError('VALIDATION_ERROR', '上传标识缺失。', 400);
    try {
      const parts = request.parts({ limits: { fileSize: config.uploadMaxBytes, files: 1, fields: 0, parts: 1, fieldSize: 0 } }); const first = await parts.next();
      if (first.done || first.value.type !== 'file') throw new DomainError('INVALID_IMAGE', '请选择一张图片。', 400);
      const part = first.value;
      const result = await media.upload(request.auth!.user.id, key, part.filename, async () => { const buffer = await part.toBuffer(); if (!(await parts.next()).done) throw new DomainError('INVALID_IMAGE', '每次只能上传一张照片。', 400); return buffer; });
      return respond(request, result);
    } catch (error) {
      if (error instanceof DomainError) throw error;
      if ((error as { statusCode?: number }).statusCode === 413) throw new DomainError('FILE_TOO_LARGE', '照片或上传数量超过限制。', 413);
      throw new DomainError('UPLOAD_FAILED', '照片上传失败，请检查文件并重试。', 400);
    }
  });
  app.get<{ Params: Id; Querystring: { variant?: string } }>('/api/v1/media/:id/content', auth, async (request, reply) => {
    const row = await media.lookup(request.auth!.user.id, request.params.id), variant = request.query.variant ?? 'preview';
    if (!['original', 'preview', 'thumb'].includes(variant)) throw new DomainError('VALIDATION_ERROR', '图片版本无效。', 400);
    reply.type(variant === 'original' ? { jpg: 'image/jpeg', png: 'image/png', webp: 'image/webp' }[row.extension]! : 'image/webp');
    if (variant === 'original') reply.header('Content-Disposition', `attachment; filename="photo-${row.id}.${row.extension}"`);
    return reply.send(await media.files.stream(row.id, variant, row.extension));
  });
  app.delete<{ Params: Id }>('/api/v1/media/:id', auth, async request => respond(request, await media.remove(request.auth!.user.id, request.params.id)));
}
