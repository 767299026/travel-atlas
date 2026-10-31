import { registerWorkspaceRoutes } from './workspace-routes.js';
import Fastify, { type FastifyRequest } from 'fastify';
import cookie from '@fastify/cookie';
import rateLimit from '@fastify/rate-limit';
import multipart from '@fastify/multipart';
import { timingSafeEqual } from 'node:crypto';
import { and, eq, gt, lt } from 'drizzle-orm';
import type { AppConfig } from './config.js';
import type { Database } from './db/client.js';
import { hashToken, randomToken, verifyPassword, dummyHash } from './security.js';
import { repository } from './repository.js';
import { commandsSchema, createSchema, loginSchema, metadataSchema } from './schemas.js';
import { DomainError, type CommandRequest, type JourneyCreate, type SessionData } from '../../packages/contracts/src/index.js';
import { registerPhotoRoutes } from './photo-routes.js';
import { registerRecordRoutes } from './record-routes.js';
import { registerAdminRoutes } from './admin.js';
import { registerMapRoutes } from './map-routes.js';
import { registerPersonalRoutes } from './personal-routes.js';
import { registerAtlasRoutes } from './atlas-routes.js';
import { registerShareRoutes } from './share-routes.js';
import { registerRoutingRoutes } from './routing-routes.js';

interface Auth extends SessionData { tokenHash: string }
declare module 'fastify' { interface FastifyRequest { auth: Auth | null } }
export async function buildApp(config: AppConfig, database: Database, dependencies: { mapFetch?: typeof fetch; routingFetch?: typeof fetch; routingWorker?: boolean } = {}) {
  const app = Fastify({ logger: false, bodyLimit: 131072, ajv: { customOptions: { removeAdditional: false, coerceTypes: false } } });
  const { db, schema: s } = database; const store = repository(database); const cookieName = 'atlas_session'; let hashing = 0;
  await app.register(cookie); await app.register(rateLimit, { max: config.rateLimitMax ?? 180, timeWindow: '1 minute' });
  await app.register(multipart, { limits: { fileSize: config.uploadMaxBytes, files: 1, fields: 0, parts: 1 } });
  app.decorateRequest('auth', null);
  app.addHook('onRequest', async (_request, reply) => { reply.header('X-Content-Type-Options', 'nosniff'); reply.header('Cache-Control', 'no-store'); });
  const response = (request: FastifyRequest, data: unknown) => ({ data, meta: { requestId: request.id } });
  const checkOrigin = (request: FastifyRequest) => {
    if (!request.headers.origin || !config.origins.includes(request.headers.origin)) throw new DomainError('ORIGIN_REJECTED', '请求来源不受信任。', 403);
  };
  const authenticate = async (request: FastifyRequest) => {
    const token = request.cookies[cookieName];
    if (!token || token.length > 100) throw new DomainError('UNAUTHENTICATED', '请先登录。', 401);
    const [record] = await db.select({ tokenHash: s.sessions.tokenHash, csrfToken: s.sessions.csrfToken, id: s.users.id, username: s.users.username, displayName: s.users.displayName, role: s.users.role })
      .from(s.sessions).innerJoin(s.users, eq(s.users.id, s.sessions.userId)).where(and(eq(s.sessions.tokenHash, hashToken(token)), gt(s.sessions.expiresAt, new Date()), eq(s.users.active, true)));
    if (!record) throw new DomainError('UNAUTHENTICATED', '登录已过期，请重新登录。', 401);
    const { tokenHash, csrfToken, ...user } = record; request.auth = { tokenHash, csrfToken, user };
    if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method)) {
      checkOrigin(request); const supplied = request.headers['x-csrf-token'];
      if (typeof supplied !== 'string' || Buffer.byteLength(supplied) !== Buffer.byteLength(csrfToken) || !timingSafeEqual(Buffer.from(supplied), Buffer.from(csrfToken))) throw new DomainError('CSRF_REJECTED', '安全校验失效，请刷新页面后重试。', 403);
    }
  };
  app.setErrorHandler((error, request, reply) => {
    if (error instanceof DomainError) return reply.code(error.statusCode).send({ error: { code: error.code, message: error.message }, meta: { requestId: request.id } });
    const safeError = error as { validation?: unknown; statusCode?: number };
    const status = safeError.validation ? 400 : (typeof safeError.statusCode === 'number' && safeError.statusCode >= 400 && safeError.statusCode < 500 ? safeError.statusCode : 503);
    return reply.code(status).send({ error: { code: safeError.validation ? 'VALIDATION_ERROR' : status === 429 ? 'RATE_LIMITED' : 'SERVICE_UNAVAILABLE', message: safeError.validation ? '请求内容格式不正确，请检查填写内容。' : status === 429 ? '请求过于频繁，请稍后重试。' : '服务暂时不可用，请稍后重试。' }, meta: { requestId: request.id } });
  });
  app.setNotFoundHandler((request, reply) => reply.code(404).send({ error: { code: 'NOT_FOUND', message: '未找到接口。' }, meta: { requestId: request.id } }));
  app.get('/health', async request => { await database.pool.query('SELECT 1'); return response(request, { status: 'ok' }); });
  app.post<{ Body: { username: string; password: string } }>('/api/v1/auth/login', { schema: { body: loginSchema }, config: { rateLimit: { max: config.loginRateMax, timeWindow: '1 minute' } } }, async (request, reply) => {
    checkOrigin(request);
    if (hashing >= 2) throw new DomainError('BUSY', '登录繁忙，请稍后再试。', 429);
    hashing++;
    try {
      const [user] = await db.select().from(s.users).where(eq(s.users.username, request.body.username));
      const valid = await verifyPassword(request.body.password, user?.passwordHash ?? await dummyHash());
      if (!user || !user.active || !valid) throw new DomainError('INVALID_CREDENTIALS', '账号或密码不正确。', 401);
      const token = randomToken(), csrfToken = randomToken(), now = new Date();
      await db.delete(s.sessions).where(lt(s.sessions.expiresAt, now));
      await db.insert(s.sessions).values({ tokenHash: hashToken(token), csrfToken, userId: user.id, createdAt: now, expiresAt: new Date(now.getTime() + 14 * 86400000) });
      const previous = request.cookies[cookieName]; if (previous) await db.delete(s.sessions).where(eq(s.sessions.tokenHash, hashToken(previous)));
      reply.setCookie(cookieName, token, { path: '/', httpOnly: true, secure: config.cookieSecure, sameSite: 'lax', maxAge: 14 * 86400 });
      return response(request, { user: { id: user.id, username: user.username, displayName: user.displayName, role: user.role }, csrfToken });
    } finally { hashing--; }
  });
  app.get('/api/v1/auth/session', { preHandler: authenticate }, async request => response(request, { user: request.auth!.user, csrfToken: request.auth!.csrfToken }));
  app.post('/api/v1/auth/logout', { preHandler: authenticate }, async (request, reply) => {
    await db.delete(s.sessions).where(eq(s.sessions.tokenHash, request.auth!.tokenHash)); reply.clearCookie(cookieName, { path: '/' }); return response(request, { loggedOut: true });
  });
  app.get<{ Querystring: { cursor?: string; status?: 'planning' | 'completed' | 'archived'; q?: string } }>('/api/v1/journeys', { preHandler: authenticate }, async request => response(request, await store.list(request.auth!.user.id, request.query.cursor, request.query)));
  app.post<{ Body: JourneyCreate }>('/api/v1/journeys', { preHandler: authenticate, schema: { body: createSchema } }, async (request, reply) => reply.code(201).send(response(request, await store.create(request.auth!.user.id, request.body))));
  app.get<{ Params: { id: string } }>('/api/v1/journeys/:id', { preHandler: authenticate }, async request => response(request, await store.summary(request.auth!.user.id, request.params.id)));
  type Metadata = Parameters<typeof store.metadata>[2];
  app.patch<{ Params: { id: string }; Body: Metadata }>('/api/v1/journeys/:id', { preHandler: authenticate, schema: { body: metadataSchema } }, async request => response(request, await store.metadata(request.auth!.user.id, request.params.id, request.body)));
  app.get<{ Params: { id: string } }>('/api/v1/routes/:id', { preHandler: authenticate }, async request => response(request, await store.readRoute(request.auth!.user.id, request.params.id)));
  app.post<{ Params: { id: string }; Body: CommandRequest }>('/api/v1/routes/:id/commands', { preHandler: authenticate, schema: { body: commandsSchema } }, async request => response(request, await store.commands(request.auth!.user.id, request.params.id, request.body)));
  registerRecordRoutes(app, database, config, { authenticate, respond: response });
  registerPhotoRoutes(app, database, config, { authenticate, respond: response });
  registerWorkspaceRoutes(app, database, config, { authenticate, respond: response });
  registerAdminRoutes(app, database, { authenticate, respond: response }, config);
  registerMapRoutes(app, database, config, { authenticate, respond: response }, dependencies.mapFetch);
  registerRoutingRoutes(app, database, config, { authenticate, respond: response }, dependencies);
  registerPersonalRoutes(app, database, { authenticate, respond: response });
  registerAtlasRoutes(app, database, { authenticate, respond: response });
  registerShareRoutes(app, database, config, { authenticate, respond: response });
  return app;
}
