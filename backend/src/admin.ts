import { registerAdminConsole } from './admin-console.js';
import type { AppConfig } from './config.js';
import { randomUUID } from 'node:crypto';
import { and, asc, count, eq, gt, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import type { Database } from './db/client.js';
import type { RouteContext } from './record-routes.js';
import { passwordSchema, userCreateSchema, userUpdateSchema } from './record-schemas.js';
import { hashPassword } from './security.js';
import { DomainError, type AdminUser } from '../../packages/contracts/src/index.js';

export function registerAdminRoutes(app: FastifyInstance, database: Database, context: RouteContext, config: AppConfig) {
  registerAdminConsole(app, database, config, context);
  const { db, schema: s } = database; const { respond } = context; let hashing = 0;
  const authenticate = async (request: Parameters<RouteContext['authenticate']>[0]) => { await context.authenticate(request); if (request.auth!.user.role !== 'owner') throw new DomainError('FORBIDDEN', '仅管理员可以访问管理端。', 403); };
  const auth = { preHandler: authenticate };
  const summary = (row: typeof s.users.$inferSelect): AdminUser => { const { passwordHash: _, createdAt, ...user } = row; return { ...user, createdAt: createdAt.toISOString() }; };
  const password = async (value: string) => { if (hashing >= 1) throw new DomainError('BUSY', '正在处理账号密码，请稍后再试。', 429); hashing++; try { return await hashPassword(value); } finally { hashing--; } };
  app.get('/api/v1/admin/overview', auth, async request => {
    const [users] = await db.select({ n: count() }).from(s.users), [journeys] = await db.select({ n: count() }).from(s.journeys), [diaries] = await db.select({ n: count() }).from(s.diaries), [visits] = await db.select({ n: count() }).from(s.visits);
    const [media] = await db.select({ n: sql<string>`COALESCE(SUM(${s.media.storedBytes}), 0)` }).from(s.media).where(eq(s.media.state, 'ready'));
    return respond(request, { users: Number(users?.n ?? 0), journeys: Number(journeys?.n ?? 0), diaries: Number(diaries?.n ?? 0), visits: Number(visits?.n ?? 0), mediaBytes: Number(media?.n ?? 0) });
  });
  app.get<{ Querystring: { cursor?: string } }>('/api/v1/admin/users', auth, async request => {
    const rows = await db.select().from(s.users).where(request.query.cursor ? gt(s.users.username, request.query.cursor) : undefined).orderBy(asc(s.users.username)).limit(51);
    return respond(request, { items: rows.slice(0, 50).map(summary), nextCursor: rows.length > 50 ? rows[49]!.username : null });
  });
  type Create = { username: string; displayName: string; password: string; role: 'owner' | 'editor' };
  app.post<{ Body: Create }>('/api/v1/admin/users', { ...auth, schema: { body: userCreateSchema } }, async request => {
    const body = request.body; if (!body.displayName.trim()) throw new DomainError('VALIDATION_ERROR', '显示名称不能为空。');
    const passwordHash = await password(body.password);
    const result = await db.transaction(async ex => {
      await ex.select({ id: s.users.id }).from(s.users).for('update');
      if ((await ex.select({ id: s.users.id }).from(s.users).where(eq(s.users.username, body.username))).length) throw new DomainError('USER_EXISTS', '账号已存在，请刷新列表核对。', 409);
      const user = { id: randomUUID(), username: body.username, displayName: body.displayName.trim(), passwordHash, role: body.role, active: true, version: 1, createdAt: new Date() };
      await ex.insert(s.users).values(user); await ex.insert(s.auditEvents).values({ id: randomUUID(), actorId: request.auth!.user.id, action: 'user.create', targetId: user.id, createdAt: new Date() }); return summary(user);
    }); return respond(request, result);
  });
  type Update = { baseVersion: number; displayName: string; role: 'owner' | 'editor'; active: boolean };
  app.patch<{ Params: { id: string }; Body: Update }>('/api/v1/admin/users/:id', { ...auth, schema: { body: userUpdateSchema } }, async request => {
    const body = request.body; if (!body.displayName.trim()) throw new DomainError('VALIDATION_ERROR', '显示名称不能为空。');
    return respond(request, await db.transaction(async ex => {
      const users = await ex.select().from(s.users).for('update'), target = users.find(u => u.id === request.params.id);
      if (!target) throw new DomainError('NOT_FOUND', '账号不存在。', 404);
      if (target.version !== body.baseVersion) throw new DomainError('VERSION_CONFLICT', '账号信息已更新，请刷新列表。', 409);
      if (target.role === 'owner' && target.active && (!body.active || body.role !== 'owner') && users.filter(u => u.role === 'owner' && u.active).length <= 1) throw new DomainError('LAST_OWNER', '至少保留一个启用的管理员。', 409);
      if (target.id === request.auth!.user.id && (!body.active || body.role !== 'owner')) throw new DomainError('SELF_LOCKOUT', '不能在当前会话停用或降权自己，请使用其他管理员账号。', 409);
      const fields = { displayName: body.displayName.trim(), role: body.role, active: body.active, version: target.version + 1 };
      await ex.update(s.users).set(fields).where(eq(s.users.id, target.id));
      if (target.role !== body.role || target.active !== body.active) await ex.delete(s.sessions).where(eq(s.sessions.userId, target.id));
      await ex.insert(s.auditEvents).values({ id: randomUUID(), actorId: request.auth!.user.id, action: 'user.update', targetId: target.id, createdAt: new Date() }); return summary({ ...target, ...fields });
    }));
  });
  app.post<{ Params: { id: string }; Body: { baseVersion: number; password: string } }>('/api/v1/admin/users/:id/password', { ...auth, schema: { body: passwordSchema } }, async request => {
    const passwordHash = await password(request.body.password);
    return respond(request, await db.transaction(async ex => {
      const target = (await ex.select().from(s.users).for('update')).find(user => user.id === request.params.id); if (!target) throw new DomainError('NOT_FOUND', '账号不存在。', 404);
      if (target.version !== request.body.baseVersion) throw new DomainError('VERSION_CONFLICT', '账号已更新，请刷新后核对。', 409);
      await ex.update(s.users).set({ passwordHash, version: target.version + 1 }).where(eq(s.users.id, target.id)); await ex.delete(s.sessions).where(eq(s.sessions.userId, target.id));
      await ex.insert(s.auditEvents).values({ id: randomUUID(), actorId: request.auth!.user.id, action: 'user.password', targetId: target.id, createdAt: new Date() }); return { version: target.version + 1, sessionsRevoked: true };
    }));
  });
  app.get('/api/v1/admin/audit', auth, async request => respond(request, await db.select({ id: s.auditEvents.id, action: s.auditEvents.action, actorId: s.auditEvents.actorId, targetId: s.auditEvents.targetId, createdAt: s.auditEvents.createdAt }).from(s.auditEvents).orderBy(sql`${s.auditEvents.createdAt} DESC`).limit(50)));
}
