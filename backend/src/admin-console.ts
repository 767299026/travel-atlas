import { adminPhotos, registerAdminPhotoRoutes } from './admin-photos.js';
import { adminFilters } from '../../packages/contracts/src/admin.js';
import { randomUUID, createHmac } from 'node:crypto';
import { and, asc, count, desc, eq, gt, isNull, or, sql, type SQLWrapper, type SQL } from 'drizzle-orm';
import type { MySqlTable } from 'drizzle-orm/mysql-core';
import { Type } from '@sinclair/typebox';
import type { FastifyInstance } from 'fastify';
import type { Database } from './db/client.js';
import type { RouteContext } from './record-routes.js';
import type { AppConfig } from './config.js';
import { DomainError } from '../../packages/contracts/src/index.js';
import type { AdminEntry, AdminResource } from '../../packages/contracts/src/admin.js';
import { hashToken } from './security.js';

export function registerAdminConsole(app: FastifyInstance, database: Database, config: AppConfig, context: RouteContext) {
 const { db, schema: s } = database;
 const auth = { preHandler: async (request: Parameters<RouteContext['authenticate']>[0]) => { await context.authenticate(request); if (request.auth!.user.role !== 'owner') throw new DomainError('FORBIDDEN', '仅管理员可以访问管理端。', 403); } };
 const query = Type.Object({ page: Type.Optional(Type.String({ pattern: '^[1-9][0-9]{0,3}$' })), q: Type.Optional(Type.String({ maxLength: 100 })) }, { additionalProperties: false });
 type Query = { page?: string; q?: string; status?: string };
 const catalogQuery=Type.Object({...query.properties,status:Type.Optional(Type.String({maxLength:40}))},{additionalProperties:false});
 const photoCatalog=adminPhotos(database);registerAdminPhotoRoutes(app,database,config,auth,context);
 const paging = (q: Query) => ({ page: Number(q.page ?? 1), pageSize: 20, offset: (Number(q.page ?? 1) - 1) * 20 });
 const pattern = (q: Query) => '%' + (q.q ?? '').trim().replace(/[!%_]/g, c => '!' + c) + '%';
 const contains = (column: SQLWrapper, q: Query) => sql`${column} LIKE ${pattern(q)} ESCAPE '!'`;
 const total = async (table: MySqlTable, where?: SQL) => Number((await db.select({ n: count() }).from(table).where(where))[0]?.n ?? 0);
 const owner = { ownerId: s.users.id, ownerName: s.users.displayName };
 const state = (row: Pick<typeof s.shares.$inferSelect,'id'|'tokenHash'|'revokedAt'|'expiresAt'>, active: boolean) => row.revokedAt ? 'revoked' : !active ? 'disabled' : !config.shareSecret || hashToken(createHmac('sha256', config.shareSecret).update('travel-atlas-share-v1:' + row.id).digest('base64url')) !== row.tokenHash ? 'invalid' : row.expiresAt <= new Date() ? 'expired' : 'active';
 const details = (values: Record<string, unknown>) => Object.entries(values).map(([label, value]) => ({ label, value: value == null || value === '' ? '—' : String(value) }));
 async function list(resource: AdminResource, q: Query) {
  const { page, pageSize, offset } = paging(q); let items: AdminEntry[] = [], n = 0;
  if(q.status && !adminFilters[resource].some(f=>f.value===q.status))throw new DomainError('VALIDATION_ERROR','该资料类型不支持此筛选。',400);
  if (resource === 'journeys') {
   const where = and(q.status?eq(s.journeys.status,q.status as 'planning'|'completed'|'archived'):undefined,q.q?.trim() ? or(contains(s.journeys.title,q), contains(s.journeys.destinations,q), contains(s.users.displayName,q)) : undefined);
   n = Number((await db.select({ n: count() }).from(s.journeys).innerJoin(s.users, eq(s.users.id,s.journeys.ownerId)).where(where))[0]?.n ?? 0);
   const rows = await db.select({ row:s.journeys,...owner }).from(s.journeys).innerJoin(s.users,eq(s.users.id,s.journeys.ownerId)).where(where).orderBy(desc(s.journeys.updatedAt),asc(s.journeys.id)).limit(pageSize).offset(offset);
   items = rows.map(({row,...user})=>({id:row.id,title:row.title,subtitle:row.destinations.join(' · ') || '目的地待定',...user,status:row.status,updatedAt:row.updatedAt.toISOString(),details:details({'目的地':row.destinations.join(' · '),'时区':row.timezone,'版本':row.version,'创建时间':row.createdAt.toISOString()})}));
  } else if (resource === 'photos') {
   return photoCatalog.list(q.status??'',q.q?.trim()?or(contains(s.media.filename,q),contains(s.users.displayName,q)):undefined,page);
  } else if(resource==='visits') {
   const where=and(q.status==='unassigned'?isNull(s.visits.place):q.status==='assigned'?sql`${s.visits.place} IS NOT NULL`:undefined,q.q?.trim()?or(contains(s.visits.label,q),contains(s.visits.region,q),contains(s.users.displayName,q)):undefined);
   n=Number((await db.select({n:count()}).from(s.visits).innerJoin(s.users,eq(s.users.id,s.visits.ownerId)).where(where))[0]?.n??0);
   const rows=await db.select({row:s.visits,...owner}).from(s.visits).innerJoin(s.users,eq(s.users.id,s.visits.ownerId)).where(where).orderBy(desc(s.visits.createdAt),asc(s.visits.id)).limit(pageSize).offset(offset);
   items=rows.map(({row,...user})=>({id:row.id,title:row.label,subtitle:row.region,...user,status:row.place?'assigned':'unassigned',updatedAt:row.createdAt.toISOString(),details:details({'到访日期':row.visitedOn,'备注':row.note,'所属旅程 ID':row.journeyId})}));
  } else if(resource==='diaries') {
   const where=and(q.status?eq(s.diaries.status,q.status as 'draft'|'written'):undefined,q.q?.trim()?or(contains(s.diaries.title,q),contains(s.users.displayName,q)):undefined);
   n=Number((await db.select({n:count()}).from(s.diaries).innerJoin(s.users,eq(s.users.id,s.diaries.ownerId)).where(where))[0]?.n??0);
   const rows=await db.select({id:s.diaries.id,title:s.diaries.title,status:s.diaries.status,occurredOn:s.diaries.occurredOn,updatedAt:s.diaries.updatedAt,...owner}).from(s.diaries).innerJoin(s.users,eq(s.users.id,s.diaries.ownerId)).where(where).orderBy(desc(s.diaries.updatedAt),asc(s.diaries.id)).limit(pageSize).offset(offset);
   items=rows.map(row=>({...row,subtitle:row.occurredOn??'日期未填写',updatedAt:row.updatedAt.toISOString(),details:details({'记录日期':row.occurredOn})}));
  } else {
   const where=q.q?.trim()?or(contains(s.shares.snapshot,q),contains(s.users.displayName,q)):undefined;
   n=Number((await db.select({n:count()}).from(s.shares).innerJoin(s.users,eq(s.users.id,s.shares.ownerId)).where(where))[0]?.n??0);
   const rows=await db.select({row:s.shares,active:s.users.active,...owner}).from(s.shares).innerJoin(s.users,eq(s.users.id,s.shares.ownerId)).where(where).orderBy(desc(s.shares.createdAt),asc(s.shares.id)).limit(pageSize).offset(offset);
   items=rows.map(({row,active,...user})=>({id:row.id,title:row.snapshot.title,subtitle:row.snapshot.layer==='actual'?'实际记录快照':'计划安排快照',...user,status:state(row,active),updatedAt:row.createdAt.toISOString(),details:details({'到期时间':row.expiresAt.toISOString(),'撤销时间':row.revokedAt?.toISOString(),'图文篇数':row.snapshot.diaries.length,'照片张数':row.snapshot.diaries.reduce((n,d)=>n+d.photos.length,0)})}));
  }
  return { items:items.map(item=>({...item,resource,...(resource==='journeys'?{editPath:'/journeys/'+item.id}:resource==='diaries'?{editPath:'/diaries/'+item.id+'/edit'}:resource==='visits'?{editPath:'/journeys/'+item.details.find(d=>d.label==='所属旅程 ID')?.value+'/actual'}:{})})),total:n,page,pageSize };
 }
 app.get<{Params:{resource:AdminResource};Querystring:Query}>('/api/v1/admin/catalog/:resource',{...auth,schema:{params:Type.Object({resource:Type.Union(['journeys','photos','visits','diaries','shares'].map(v=>Type.Literal(v)))}),querystring:catalogQuery}},async request=>context.respond(request,await list(request.params.resource,request.query)));
 app.get('/api/v1/admin/dashboard',auth,async request=>{
  const [journeys,photos,visits,places,diaries,users,activeUsers,unlocatedPhotos,undatedPhotos,unassignedVisits,failedJobs,recent,shares]=await Promise.all([
   total(s.journeys),total(s.media,eq(s.media.state,'ready')),total(s.visits),total(s.placeRecords,eq(s.placeRecords.kind,'visited')),total(s.diaries),total(s.users),total(s.users,eq(s.users.active,true)),
   photoCatalog.count('needs_location'),photoCatalog.count('needs_date'),
   total(s.visits,isNull(s.visits.place)),total(s.routingJobs,eq(s.routingJobs.status,'failed')),list('journeys',{}),
   db.select({row:{id:s.shares.id,tokenHash:s.shares.tokenHash,revokedAt:s.shares.revokedAt,expiresAt:s.shares.expiresAt},active:s.users.active}).from(s.shares).innerJoin(s.users,eq(s.users.id,s.shares.ownerId)).where(and(isNull(s.shares.revokedAt),gt(s.shares.expiresAt,new Date())))
  ]);
  const [media]=await db.select({n:sql<string>`COALESCE(SUM(${s.media.storedBytes}),0)`}).from(s.media).where(eq(s.media.state,'ready'));
  return context.respond(request,{journeys,photos,visits,places,diaries,users,activeUsers,activeShares:shares.filter(r=>state(r.row,r.active)==='active').length,mediaBytes:Number(media?.n??0),attention:{unlocatedPhotos,undatedPhotos,unassignedVisits,failedJobs},recent:recent.items.slice(0,5),checkedAt:new Date().toISOString()});
 });
 app.get('/api/v1/admin/services',auth,async request=>{
  await db.execute(sql`SELECT 1`);
  return context.respond(request,[
   {id:'database',name:'MySQL 数据库',state:'ready',label:'查询正常',description:'业务数据与账号会话；本次请求已完成数据库查询。'},
   {id:'media',name:'私有照片存储',state:'configured',label:'本机存储',description:`原图与衍生图独立鉴权；单账号额度 ${Math.round(config.mediaQuotaBytes/1048576)} MB，单文件上限 ${Math.round(config.uploadMaxBytes/1048576)} MB。`},
   {id:'amap',name:'高德地图',state:config.amap?'configured':'unconfigured',label:config.amap?'已配置':'未配置',description:'用于地点搜索与城市 2D 地图；此处未发起供应商连通测试。'},
   {id:'routing',name:'区域徒步路由',state:config.routing?'configured':'unconfigured',label:config.routing?'已配置':'未配置',description:config.routing?`BRouter ${config.routing.engineVersion} · ${config.routing.tiles.length} 个区域数据块；未检查当前进程。`:'尚未启用区域 BRouter。'},
   {id:'sharing',name:'行程分享',state:config.shareSecret?'configured':'unconfigured',label:config.shareSecret?'已配置':'未配置',description:'持链接访问、独立快照，可在分享管理中撤销。'},
   {id:'siyuan',name:'思源资料库',state:'planned',label:'待接入',description:'后续接入笔记快照、提取与人工审核；当前不执行同步。'},
   {id:'ai',name:'AI 出行助手',state:'planned',label:'待建设',description:'预留资料检索、带引用问答与规划草稿；当前不产生 AI 调用。'}
  ]);
 });
 app.get<{Querystring:Query}>('/api/v1/admin/events',{...auth,schema:{querystring:query}},async request=>{
  const {page,pageSize,offset}=paging(request.query),q=request.query;
  const where=q.q?.trim()?or(contains(s.auditEvents.action,q),contains(s.auditEvents.targetId,q),contains(s.users.displayName,q)):undefined;
  const [n]=await db.select({n:count()}).from(s.auditEvents).innerJoin(s.users,eq(s.users.id,s.auditEvents.actorId)).where(where);
  const rows=await db.select({id:s.auditEvents.id,action:s.auditEvents.action,actorName:s.users.displayName,targetId:s.auditEvents.targetId,createdAt:s.auditEvents.createdAt}).from(s.auditEvents).innerJoin(s.users,eq(s.users.id,s.auditEvents.actorId)).where(where).orderBy(desc(s.auditEvents.createdAt),asc(s.auditEvents.id)).limit(pageSize).offset(offset);
  const users=await db.select({id:s.users.id,name:s.users.displayName}).from(s.users);
  return context.respond(request,{items:rows.map(r=>({...r,targetName:users.find(u=>u.id===r.targetId)?.name??r.targetId,createdAt:r.createdAt.toISOString()})),total:Number(n?.n??0),page,pageSize});
 });
 app.post<{Params:{id:string};Body:{acknowledge:boolean}}>('/api/v1/admin/shares/:id/revoke',{...auth,schema:{params:Type.Object({id:Type.String({format:'uuid'})}),body:Type.Object({acknowledge:Type.Literal(true)},{additionalProperties:false})}},async request=>{
  const result=await db.transaction(async ex=>{
   const [row]=await ex.select({id:s.shares.id,ownerId:s.shares.ownerId}).from(s.shares).where(eq(s.shares.id,request.params.id));if(!row)throw new DomainError('NOT_FOUND','分享记录不存在。',404);
   await ex.select({id:s.users.id}).from(s.users).where(eq(s.users.id,row.ownerId)).for('update');
   const [locked]=await ex.select().from(s.shares).where(eq(s.shares.id,row.id)).for('update');if(!locked)throw new DomainError('NOT_FOUND','分享记录不存在。',404);
   if(!locked.revokedAt){await ex.update(s.shares).set({revokedAt:new Date()}).where(eq(s.shares.id,row.id));await ex.insert(s.auditEvents).values({id:randomUUID(),actorId:request.auth!.user.id,action:'share.revoke',targetId:row.id,createdAt:new Date()});}return {id:row.id,state:'revoked'};
  });return context.respond(request,result);
 });
}
