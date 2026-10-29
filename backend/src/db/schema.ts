import { mysqlTableCreator, varchar, text, mediumtext, double, int, boolean, datetime, json, mysqlEnum, uniqueIndex, index, foreignKey } from 'drizzle-orm/mysql-core';
import type { Location, RouteSnapshot, TravelMode, CopySource, DiaryAssociation, RouteGeometry, PointSample, RoutingInput, RoutingInfo, ShareSnapshot, ShareBindings, AtlasPlace, PhotoCapture, PhotoPlace } from '../../../packages/contracts/src/index.js';

export function buildSchema(prefix = '') {
  const table = mysqlTableCreator(name => prefix + name);
  const id = () => varchar('id', { length: 36 }).primaryKey();
  const created = () => datetime('created_at', { mode: 'date', fsp: 3 }).notNull();
  const users = table('users', {
    id: id(), username: varchar('username', { length: 64 }).notNull(), displayName: varchar('display_name', { length: 80 }).notNull(),
    passwordHash: varchar('password_hash', { length: 256 }).notNull(), role: varchar('role', { length: 20 }).notNull().default('owner'),
    active: boolean('active').notNull().default(true), version: int('version').notNull().default(1), createdAt: created(),
  }, t => [uniqueIndex(prefix + 'users_username_uq').on(t.username)]);
  const sessions = table('sessions', {
    tokenHash: varchar('token_hash', { length: 64 }).primaryKey(), userId: varchar('user_id', { length: 36 }).notNull().references(() => users.id, { onDelete: 'cascade' }),
    csrfToken: varchar('csrf_token', { length: 64 }).notNull(), createdAt: created(), expiresAt: datetime('expires_at', { mode: 'date', fsp: 3 }).notNull(),
  }, t => [index(prefix + 'sessions_expiry_idx').on(t.expiresAt), index(prefix + 'sessions_user_idx').on(t.userId)]);
  const journeys = table('journeys', {
    id: id(), ownerId: varchar('owner_id', { length: 36 }).notNull().references(() => users.id),
    title: varchar('title', { length: 80 }).notNull(), destinations: json('destinations').$type<string[]>().notNull(),
    status: mysqlEnum('status', ['planning', 'completed', 'archived']).notNull().default('planning'),
    planningPreferences: json('planning_preferences').$type<import('../../../packages/contracts/src/workspace.js').PlanningPreferences | null>(),
    timezone: varchar('timezone', { length: 64 }).notNull().default('Asia/Shanghai'), version: int('version').notNull().default(1), createdAt: created(), updatedAt: datetime('updated_at', { mode: 'date', fsp: 3 }).notNull(),
  }, t => [index(prefix + 'journeys_owner_created_idx').on(t.ownerId, t.createdAt)]);
  const routes = table('journey_routes', {
    id: id(), journeyId: varchar('journey_id', { length: 36 }).notNull().references(() => journeys.id, { onDelete: 'cascade' }),
    ownerId: varchar('owner_id', { length: 36 }).notNull().references(() => users.id), layer: mysqlEnum('layer', ['plan', 'actual']).notNull(),
    version: int('version').notNull().default(1), note: text('note').notNull(), copiedFrom: json('copied_from').$type<CopySource | null>(), createdAt: created(), updatedAt: datetime('updated_at', { mode: 'date', fsp: 3 }).notNull(),
  }, t => [uniqueIndex(prefix + 'routes_journey_layer_uq').on(t.journeyId, t.layer), index(prefix + 'routes_owner_idx').on(t.ownerId)]);
  const days = table('route_days', {
    unscheduled: boolean('is_unscheduled').notNull().default(false),
    id: id(), routeId: varchar('route_id', { length: 36 }).notNull().references(() => routes.id, { onDelete: 'cascade' }), sortOrder: int('sort_order').notNull(),
    title: varchar('title', { length: 80 }).notNull(), area: varchar('area', { length: 120 }).notNull(), date: varchar('local_date', { length: 10 }), stayName: varchar('stay_name', { length: 160 }).notNull(), copiedFrom: json('copied_from').$type<CopySource | null>(),
  }, t => [index(prefix + 'days_route_order_idx').on(t.routeId, t.sortOrder)]);
  const stops = table('route_stops', {
    id: id(), routeId: varchar('route_id', { length: 36 }).notNull().references(() => routes.id, { onDelete: 'cascade' }), dayId: varchar('day_id', { length: 36 }).notNull().references(() => days.id, { onDelete: 'cascade' }), sortOrder: int('sort_order').notNull(),
    label: varchar('label', { length: 160 }).notNull(), region: varchar('region', { length: 120 }).notNull(), time: varchar('local_time', { length: 5 }), note: text('note').notNull(),
    role: mysqlEnum('role', ['departure', 'visit', 'waypoint', 'transfer', 'overnight']).notNull(), location: json('location').$type<Location | null>(), copiedFrom: json('copied_from').$type<CopySource | null>(),
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
  const visits = table('visits', {
    id: id(), ownerId: varchar('owner_id', { length: 36 }).notNull().references(() => users.id), journeyId: varchar('journey_id', { length: 36 }).notNull().references(() => journeys.id),
    routeId: varchar('route_id', { length: 36 }).notNull().references(() => routes.id), stopId: varchar('stop_id', { length: 36 }).notNull(),
    place: json('place').$type<AtlasPlace | null>(), location: json('location').$type<Location | null>(), version: int('version').notNull().default(1),
    label: varchar('label', { length: 160 }).notNull(), region: varchar('region', { length: 120 }).notNull(), visitedOn: varchar('visited_on', { length: 10 }).notNull(), note: text('note').notNull(), createdAt: created(),
  }, t => [uniqueIndex(prefix + 'visits_owner_stop_uq').on(t.ownerId, t.stopId), index(prefix + 'visits_owner_journey_idx').on(t.ownerId, t.journeyId)]);
  const diaries = table('diaries', {
    id: id(), ownerId: varchar('owner_id', { length: 36 }).notNull().references(() => users.id), title: varchar('title', { length: 120 }).notNull(),
    occurredOn: varchar('occurred_on', { length: 10 }), body: text('body').notNull(), status: mysqlEnum('status', ['draft', 'written']).notNull(), association: json('association').$type<DiaryAssociation | null>(),
    version: int('version').notNull().default(1), createdAt: created(), updatedAt: datetime('updated_at', { mode: 'date', fsp: 3 }).notNull(),
  }, t => [index(prefix + 'diaries_owner_created_idx').on(t.ownerId, t.createdAt)]);
  const media = table('media', {
    id: id(), ownerId: varchar('owner_id', { length: 36 }).notNull().references(() => users.id), filename: varchar('filename', { length: 200 }).notNull(), extension: varchar('extension', { length: 8 }).notNull(),
    width: int('width').notNull(), height: int('height').notNull(), originalBytes: int('original_bytes').notNull(), storedBytes: int('stored_bytes').notNull(), checksum: varchar('checksum', { length: 64 }).notNull(),
    state: mysqlEnum('state', ['ready', 'deleted']).notNull().default('ready'), capture: json('capture_metadata').$type<PhotoCapture | null>(), createdAt: created(),
  }, t => [index(prefix + 'media_owner_state_idx').on(t.ownerId, t.state)]);
  const diaryPhotos = table('diary_photos', {
    id: id(), diaryId: varchar('diary_id', { length: 36 }).notNull().references(() => diaries.id, { onDelete: 'cascade' }), mediaId: varchar('media_id', { length: 36 }).notNull().references(() => media.id), sortOrder: int('sort_order').notNull(), caption: varchar('caption', { length: 1000 }).notNull(),
  }, t => [uniqueIndex(prefix + 'diary_photos_media_uq').on(t.mediaId), index(prefix + 'diary_photos_order_idx').on(t.diaryId, t.sortOrder)]);
  const auditEvents = table('audit_events', {
    id: id(), actorId: varchar('actor_id', { length: 36 }).notNull().references(() => users.id), action: varchar('action', { length: 40 }).notNull(), targetId: varchar('target_id', { length: 36 }).notNull(), createdAt: created(),
  }, t => [index(prefix + 'audit_created_idx').on(t.createdAt)]);
  const geometries = table('geometry_assets', {
    id: id(), ownerId: varchar('owner_id', { length: 36 }).notNull().references(() => users.id), routeId: varchar('route_id', { length: 36 }).notNull().references(() => routes.id),
    sourceKind: mysqlEnum('source_kind', ['manual', 'imported_reference', 'routing']).notNull(), sourceNote: text('source_note').notNull(),
    geometry: json('geometry').$type<RouteGeometry>().notNull(), samples: json('samples').$type<PointSample[][] | null>(),
    pointCount: int('point_count').notNull(), lengthM: double('length_m').notNull(), exportPolicy: mysqlEnum('export_policy', ['allowed', 'unverified']).notNull(),
    filename: varchar('filename', { length: 200 }), originalXml: mediumtext('original_xml'), checksum: varchar('checksum', { length: 64 }).notNull(),
    diagnostics: json('diagnostics').$type<string[]>().notNull(), routingInfo: json('routing_info').$type<RoutingInfo | null>(), createdAt: created(),
  }, t => [index(prefix + 'geometry_owner_route_idx').on(t.ownerId, t.routeId)]);
  const routingJobs = table('routing_jobs', {
    id: id(), ownerId: varchar('owner_id', { length: 36 }).notNull().references(() => users.id), routeId: varchar('route_id', { length: 36 }).notNull().references(() => routes.id), segmentId: varchar('segment_id', { length: 36 }).notNull(),
    status: mysqlEnum('status', ['queued', 'running', 'succeeded', 'failed', 'cancelled', 'obsolete']).notNull(), input: json('input').$type<RoutingInput>().notNull(), fingerprint: varchar('fingerprint', { length: 64 }).notNull(),
    candidateId: varchar('candidate_id', { length: 36 }), failureCode: varchar('failure_code', { length: 50 }), failureMessage: varchar('failure_message', { length: 300 }),
    leaseToken: varchar('lease_token', { length: 36 }), leaseExpiresAt: datetime('lease_expires_at', { mode: 'date', fsp: 3 }),
    createdAt: created(), startedAt: datetime('started_at', { mode: 'date', fsp: 3 }), finishedAt: datetime('finished_at', { mode: 'date', fsp: 3 }), expiresAt: datetime('expires_at', { mode: 'date', fsp: 3 }).notNull(),
  }, t => [index(prefix + 'routing_job_status_idx').on(t.status, t.createdAt), index(prefix + 'routing_job_owner_idx').on(t.ownerId, t.createdAt)]);
  const routingCandidates = table('routing_candidates', {
    id: id(), jobId: varchar('job_id', { length: 36 }).notNull().references(() => routingJobs.id, { onDelete: 'cascade' }), ownerId: varchar('owner_id', { length: 36 }).notNull().references(() => users.id), routeId: varchar('route_id', { length: 36 }).notNull().references(() => routes.id), segmentId: varchar('segment_id', { length: 36 }).notNull(),
    input: json('input').$type<RoutingInput>().notNull(), fingerprint: varchar('fingerprint', { length: 64 }).notNull(), geometry: json('geometry').$type<RouteGeometry>().notNull(), info: json('info').$type<RoutingInfo>().notNull(), lengthM: double('length_m').notNull(), diagnostics: json('diagnostics').$type<string[]>().notNull(),
    adoptedAssetId: varchar('adopted_asset_id', { length: 36 }), createdAt: created(), expiresAt: datetime('expires_at', { mode: 'date', fsp: 3 }).notNull(),
  }, t => [uniqueIndex(prefix + 'routing_candidate_job_uq').on(t.jobId), index(prefix + 'routing_candidate_owner_idx').on(t.ownerId, t.expiresAt)]);
  const shares = table('share_links', {
    id: id(), ownerId: varchar('owner_id', { length: 36 }).notNull().references(() => users.id), journeyId: varchar('journey_id', { length: 36 }).notNull().references(() => journeys.id),
    tokenHash: varchar('token_hash', { length: 64 }).notNull(), snapshot: json('snapshot').$type<ShareSnapshot>().notNull(), bindings: json('bindings').$type<ShareBindings[]>().notNull(),
    createdAt: created(), expiresAt: datetime('expires_at', { mode: 'date', fsp: 3 }).notNull(), revokedAt: datetime('revoked_at', { mode: 'date', fsp: 3 }),
  }, t => [index(prefix + 'share_owner_journey_idx').on(t.ownerId, t.journeyId), index(prefix + 'share_expiry_idx').on(t.expiresAt)]);
  const placeRecords = table('place_records', {
    id: id(), ownerId: varchar('owner_id', { length: 36 }).notNull().references(() => users.id), kind: mysqlEnum('kind', ['visited', 'wish']).notNull(), placeKey: varchar('place_key', { length: 40 }).notNull(), place: json('place').$type<AtlasPlace>().notNull(),
    visitedOn: varchar('visited_on', { length: 10 }), note: text('note').notNull(), version: int('version').notNull().default(1), createdAt: created(),
  }, t => [index(prefix + 'place_owner_kind_idx').on(t.ownerId, t.kind), index(prefix + 'place_owner_key_idx').on(t.ownerId, t.placeKey)]);
  const photoMemories = table('photo_memories', {
    mediaId: varchar('media_id', { length: 36 }).primaryKey().references(() => media.id), ownerId: varchar('owner_id', { length: 36 }).notNull().references(() => users.id),
    takenOn: varchar('taken_on', { length: 10 }), place: json('place').$type<PhotoPlace | null>(), note: text('note').notNull(), hidden: boolean('hidden').notNull().default(false),
    version: int('version').notNull().default(1), createdAt: created(), updatedAt: datetime('updated_at', { mode: 'date', fsp: 3 }).notNull(),
  }, t => [index(prefix + 'photo_owner_date_idx').on(t.ownerId, t.takenOn)]);
  const photoNotes = table('photo_group_notes', {
    id: id(), ownerId: varchar('owner_id', { length: 36 }).notNull().references(() => users.id), groupKey: varchar('group_key', { length: 500 }).notNull(), note: text('note').notNull(), version: int('version').notNull().default(1),
  }, t => [uniqueIndex(prefix + 'photo_note_owner_group_uq').on(t.ownerId, t.groupKey)]);
  return { users, sessions, journeys, routes, days, stops, segments, revisions, mutations, visits, diaries, media, diaryPhotos, auditEvents, geometries, routingJobs, routingCandidates, shares, placeRecords, photoMemories, photoNotes };
}
export const { users, sessions, journeys, routes, days, stops, segments, revisions, mutations, visits, diaries, media, diaryPhotos, auditEvents, geometries, routingJobs, routingCandidates, shares, placeRecords, photoMemories, photoNotes } = buildSchema();
