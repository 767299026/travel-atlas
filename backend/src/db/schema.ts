import { mysqlTableCreator, varchar, text, int, boolean, datetime, json, mysqlEnum, uniqueIndex, index, foreignKey } from 'drizzle-orm/mysql-core';
import type { Location, RouteSnapshot, TravelMode } from '../../../packages/contracts/src/index.js';

export function buildSchema(prefix = '') {
  const table = mysqlTableCreator(name => prefix + name);
  const id = () => varchar('id', { length: 36 }).primaryKey();
  const created = () => datetime('created_at', { mode: 'date', fsp: 3 }).notNull();
  const users = table('users', {
    id: id(), username: varchar('username', { length: 64 }).notNull(), displayName: varchar('display_name', { length: 80 }).notNull(),
    passwordHash: varchar('password_hash', { length: 256 }).notNull(), role: varchar('role', { length: 20 }).notNull().default('owner'),
    active: boolean('active').notNull().default(true), createdAt: created(),
  }, t => [uniqueIndex(prefix + 'users_username_uq').on(t.username)]);
  const sessions = table('sessions', {
    tokenHash: varchar('token_hash', { length: 64 }).primaryKey(), userId: varchar('user_id', { length: 36 }).notNull().references(() => users.id, { onDelete: 'cascade' }),
    csrfToken: varchar('csrf_token', { length: 64 }).notNull(), createdAt: created(), expiresAt: datetime('expires_at', { mode: 'date', fsp: 3 }).notNull(),
  }, t => [index(prefix + 'sessions_expiry_idx').on(t.expiresAt), index(prefix + 'sessions_user_idx').on(t.userId)]);
  const journeys = table('journeys', {
    id: id(), ownerId: varchar('owner_id', { length: 36 }).notNull().references(() => users.id),
    title: varchar('title', { length: 80 }).notNull(), destinations: json('destinations').$type<string[]>().notNull(),
    status: mysqlEnum('status', ['planning', 'completed', 'archived']).notNull().default('planning'),
    timezone: varchar('timezone', { length: 64 }).notNull().default('Asia/Shanghai'), version: int('version').notNull().default(1), createdAt: created(), updatedAt: datetime('updated_at', { mode: 'date', fsp: 3 }).notNull(),
  }, t => [index(prefix + 'journeys_owner_created_idx').on(t.ownerId, t.createdAt)]);
  const routes = table('journey_routes', {
    id: id(), journeyId: varchar('journey_id', { length: 36 }).notNull().references(() => journeys.id, { onDelete: 'cascade' }),
    ownerId: varchar('owner_id', { length: 36 }).notNull().references(() => users.id), layer: mysqlEnum('layer', ['plan', 'actual']).notNull(),
    version: int('version').notNull().default(1), note: text('note').notNull(), createdAt: created(), updatedAt: datetime('updated_at', { mode: 'date', fsp: 3 }).notNull(),
  }, t => [uniqueIndex(prefix + 'routes_journey_layer_uq').on(t.journeyId, t.layer), index(prefix + 'routes_owner_idx').on(t.ownerId)]);
  const days = table('route_days', {
    id: id(), routeId: varchar('route_id', { length: 36 }).notNull().references(() => routes.id, { onDelete: 'cascade' }), sortOrder: int('sort_order').notNull(),
    title: varchar('title', { length: 80 }).notNull(), area: varchar('area', { length: 120 }).notNull(), date: varchar('local_date', { length: 10 }), stayName: varchar('stay_name', { length: 160 }).notNull(),
  }, t => [index(prefix + 'days_route_order_idx').on(t.routeId, t.sortOrder)]);
  const stops = table('route_stops', {
    id: id(), routeId: varchar('route_id', { length: 36 }).notNull().references(() => routes.id, { onDelete: 'cascade' }), dayId: varchar('day_id', { length: 36 }).notNull().references(() => days.id, { onDelete: 'cascade' }), sortOrder: int('sort_order').notNull(),
    label: varchar('label', { length: 160 }).notNull(), region: varchar('region', { length: 120 }).notNull(), time: varchar('local_time', { length: 5 }), note: text('note').notNull(),
    role: mysqlEnum('role', ['departure', 'visit', 'waypoint', 'transfer', 'overnight']).notNull(), location: json('location').$type<Location | null>(),
  }, t => [index(prefix + 'stops_day_order_idx').on(t.dayId, t.sortOrder), index(prefix + 'stops_route_idx').on(t.routeId)]);
  const segments = table('route_segments', {
    id: id(), routeId: varchar('route_id', { length: 36 }).notNull().references(() => routes.id, { onDelete: 'cascade' }),
    fromStopId: varchar('from_stop_id', { length: 36 }).notNull().references(() => stops.id, { onDelete: 'cascade' }), toStopId: varchar('to_stop_id', { length: 36 }).notNull().references(() => stops.id, { onDelete: 'cascade' }),
    kind: mysqlEnum('kind', ['travel', 'gap']).notNull(), mode: varchar('mode', { length: 20 }).$type<TravelMode>().notNull(),
    geometryStatus: mysqlEnum('geometry_status', ['missing', 'ready', 'stale']).notNull().default('missing'), reviewStatus: mysqlEnum('review_status', ['unreviewed', 'needs_attention', 'confirmed']).notNull().default('unreviewed'),
    geometryRef: varchar('geometry_ref', { length: 36 }), geometryLocked: boolean('geometry_locked').notNull().default(false),
  }, t => [uniqueIndex(prefix + 'segments_route_pair_uq').on(t.routeId, t.fromStopId, t.toStopId)]);
  const revisions = table('route_revisions', {
    id: id(), routeId: varchar('route_id', { length: 36 }).notNull().references(() => routes.id, { onDelete: 'cascade' }), version: int('version').notNull(),
    actorId: varchar('actor_id', { length: 36 }).notNull().references(() => users.id), snapshot: json('snapshot').$type<RouteSnapshot>().notNull(), createdAt: created(),
  }, t => [uniqueIndex(prefix + 'revisions_route_version_uq').on(t.routeId, t.version)]);
  const mutations = table('idempotency_records', {
    id: id(), ownerId: varchar('owner_id', { length: 36 }).notNull().references(() => users.id, { onDelete: 'cascade' }),
    scope: varchar('scope', { length: 100 }).notNull(), key: varchar('mutation_key', { length: 80 }).notNull(), requestHash: varchar('request_hash', { length: 64 }).notNull(),
    response: json('response').$type<unknown>().notNull(), createdAt: created(), expiresAt: datetime('expires_at', { mode: 'date', fsp: 3 }).notNull(),
  }, t => [uniqueIndex(prefix + 'mutations_owner_scope_key_uq').on(t.ownerId, t.scope, t.key), index(prefix + 'mutations_expiry_idx').on(t.expiresAt)]);
  return { users, sessions, journeys, routes, days, stops, segments, revisions, mutations };
}
export const { users, sessions, journeys, routes, days, stops, segments, revisions, mutations } = buildSchema();
