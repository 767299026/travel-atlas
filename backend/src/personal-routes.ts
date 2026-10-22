import { Type as T } from '@sinclair/typebox';
import type { FastifyInstance } from 'fastify';
import { eq } from 'drizzle-orm';
import type { Database } from './db/client.js';
import type { RouteContext } from './record-routes.js';
import { hashPassword, verifyPassword } from './security.js';
import { repository } from './repository.js';
import { DomainError } from '../../packages/contracts/src/index.js';
const object = (fields: Parameters<typeof T.Object>[0]) => T.Object(fields, { additionalProperties: false });
export function registerPersonalRoutes(app: FastifyInstance, database: Database, { authenticate, respond }: RouteContext) {
  const { db, schema: s } = database, auth = { preHandler: authenticate }, storage = repository(database).storage;
  app.get('/api/v1/me/profile', auth, async request => { const [row] = await db.select({ username: s.users.username, displayName: s.users.displayName, version: s.users.version }).from(s.users).where(eq(s.users.id, request.auth!.user.id)); return respond(request, row); });
  app.patch<{ Body: { displayName: string; baseVersion: number; clientMutationId: string } }>('/api/v1/me/profile', { ...auth, schema: { body: object({ displayName: T.String({ minLength: 1, maxLength: 80 }), baseVersion: T.Integer({ minimum: 1 }), clientMutationId: T.String({ minLength: 8, maxLength: 80 }) }) } }, async request => {
    if (!request.body.displayName.trim()) throw new DomainError('INVALID_NAME', '请填写显示名称。'); const id = request.auth!.user.id;
    const result = await db.transaction(async ex => { const [row] = await ex.select().from(s.users).where(eq(s.users.id, id)).for('update'); const cached = await storage.replay(ex, id, 'me:profile', request.body.clientMutationId, request.body); if (cached.found) return cached.response;
      if (row!.version !== request.body.baseVersion) throw new DomainError('VERSION_CONFLICT', '个人资料已更新，请重新读取后修改。', 409);
      const response = { username: row!.username, displayName: request.body.displayName.trim(), version: row!.version + 1 }; await ex.update(s.users).set({ displayName: response.displayName, version: response.version }).where(eq(s.users.id, id)); await storage.remember(ex, id, 'me:profile', request.body.clientMutationId, request.body, response); return response; }); return respond(request, result);
  });
  app.post<{ Body: { currentPassword: string; newPassword: string; baseVersion: number } }>('/api/v1/me/password', { ...auth, config: { rateLimit: { max: 5, timeWindow: '1 minute' } }, schema: { body: object({ currentPassword: T.String({ minLength: 1, maxLength: 128 }), newPassword: T.String({ minLength: 12, maxLength: 128 }), baseVersion: T.Integer({ minimum: 1 }) }) } }, async (request, reply) => {
    const id = request.auth!.user.id; const [before] = await db.select().from(s.users).where(eq(s.users.id, id)); if (!before || !await verifyPassword(request.body.currentPassword, before.passwordHash)) throw new DomainError('WRONG_PASSWORD', '当前密码不正确。', 403);
    if (request.body.currentPassword === request.body.newPassword) throw new DomainError('SAME_PASSWORD', '新密码需要与当前密码不同。'); const passwordHash = await hashPassword(request.body.newPassword);
    await db.transaction(async ex => { const [row] = await ex.select().from(s.users).where(eq(s.users.id, id)).for('update'); if (!row || row.version !== request.body.baseVersion || row.passwordHash !== before.passwordHash) throw new DomainError('VERSION_CONFLICT', '账号已更新，请重新登录后修改。', 409);
      await ex.update(s.users).set({ passwordHash, version: row.version + 1 }).where(eq(s.users.id, id)); await ex.delete(s.sessions).where(eq(s.sessions.userId, id)); await ex.insert(s.auditEvents).values({ id: crypto.randomUUID(), actorId: id, targetId: id, action: 'self_password', createdAt: new Date() });
    }); reply.clearCookie('atlas_session', { path: '/' }); return respond(request, { loggedOut: true });
  });
}
