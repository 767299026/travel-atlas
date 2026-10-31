import { and, asc, count, desc, eq, isNull, not, or, sql, type SQL } from 'drizzle-orm';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { Type } from '@sinclair/typebox';
import type { Database } from './db/client.js';
import type { AppConfig } from './config.js';
import type { RouteContext } from './record-routes.js';
import { mediaService } from './media.js';
import { photoService } from './photos.js';
import { photoInputSchema } from './photo-routes.js';
import { DomainError, type PhotoInput } from '../../packages/contracts/src/index.js';
import type { AdminEntry, AdminPhotoDetail } from '../../packages/contracts/src/admin.js';

export function adminPhotos(database: Database) {
 const { db, schema: s } = database;
 const visible = or(isNull(s.photoMemories.mediaId), eq(s.photoMemories.hidden,false));
 const noPosition = sql`COALESCE(JSON_TYPE(JSON_EXTRACT(${s.photoMemories.place}, '$.position')), 'NULL') = 'NULL'`;
 const effectiveDate = sql<string|null>`CASE WHEN ${s.photoMemories.mediaId} IS NOT NULL THEN ${s.photoMemories.takenOn} ELSE ${s.diaries.occurredOn} END`;
 const relatedLabel = sql<string|null>`JSON_UNQUOTE(JSON_EXTRACT(${s.diaries.association}, '$.stopLabel'))`;
 const hasName = or(not(isNull(s.photoMemories.place)),and(isNull(s.photoMemories.mediaId),sql`${relatedLabel} IS NOT NULL AND ${relatedLabel} != '' AND ${relatedLabel} != 'null'`));
 const filters: Record<string,SQL|undefined> = {
  needs_location: and(visible,noPosition), needs_date: and(visible,isNull(effectiveDate)),
  located: and(visible,not(noPosition)), place_only: and(visible,noPosition,hasName),
  hidden: eq(s.photoMemories.hidden,true), unfiled: and(isNull(s.photoMemories.mediaId),isNull(s.diaries.id)),
 };
 const joins = () => db.select({ image:s.media,memory:s.photoMemories,ownerName:s.users.displayName,caption:s.diaryPhotos.caption,destinations:s.journeys.destinations,
  diary:{id:s.diaries.id,title:s.diaries.title,occurredOn:s.diaries.occurredOn,association:s.diaries.association} })
  .from(s.media).innerJoin(s.users,eq(s.users.id,s.media.ownerId))
  .leftJoin(s.photoMemories,eq(s.photoMemories.mediaId,s.media.id))
  .leftJoin(s.diaryPhotos,eq(s.diaryPhotos.mediaId,s.media.id))
  .leftJoin(s.diaries,and(eq(s.diaries.id,s.diaryPhotos.diaryId),eq(s.diaries.ownerId,s.media.ownerId)))
  .leftJoin(s.journeys,and(eq(s.journeys.id,sql<string>`JSON_UNQUOTE(JSON_EXTRACT(${s.diaries.association}, '$.journeyId'))`),eq(s.journeys.ownerId,s.media.ownerId)));
 const counts = (condition?:SQL) => db.select({n:count()}).from(s.media)
  .leftJoin(s.photoMemories,eq(s.photoMemories.mediaId,s.media.id)).leftJoin(s.diaryPhotos,eq(s.diaryPhotos.mediaId,s.media.id))
  .leftJoin(s.diaries,and(eq(s.diaries.id,s.diaryPhotos.diaryId),eq(s.diaries.ownerId,s.media.ownerId)))
  .innerJoin(s.users,eq(s.users.id,s.media.ownerId)).where(and(eq(s.media.state,'ready'),condition));
 type Row=Awaited<ReturnType<typeof joins>>[number];
 function metadata(row:Row):AdminPhotoDetail {
  const related=row.diary?.association?.stopLabel?{label:row.diary.association.stopLabel,cityName:row.destinations?.[0]??'',position:null,source:'diary' as const}:null;
  return {mediaId:row.image.id,filename:row.image.filename,ownerId:row.image.ownerId,ownerName:row.ownerName,
   baseVersion:row.memory?.version??0,takenOn:row.memory?row.memory.takenOn:row.diary?.occurredOn??null,
   place:row.memory?row.memory.place:related,note:row.memory?.note??row.caption??'',hidden:row.memory?.hidden??false,
   capture:row.image.capture??null,width:row.image.width,height:row.image.height,previewUrl:`/api/v1/admin/photos/${row.image.id}/content?variant=preview`,
   source:row.memory?'photo':row.diary?'diary':'upload',diary:row.diary?{id:row.diary.id,title:row.diary.title,journeyId:row.diary.association?.journeyId??null,stopLabel:row.diary.association?.stopLabel??null}:null};
 }
 return {
  async count(status:string){return Number((await counts(filters[status]))[0]?.n??0);},
  async list(status:string,search:SQL|undefined,page:number){
   const where=and(eq(s.media.state,'ready'),filters[status],search),rows=await joins().where(where).orderBy(desc(s.media.createdAt),asc(s.media.id)).limit(20).offset((page-1)*20);
   const n=Number((await counts(and(filters[status],search)))[0]?.n??0);
   const items:AdminEntry[]=rows.map(row=>{const m=metadata(row),bytes=row.image.storedBytes;
    return {id:m.mediaId,resource:'photos',title:m.filename,subtitle:`${m.width} × ${m.height} · ${bytes<1048576?(bytes/1024).toFixed(1)+' KB':(bytes/1048576).toFixed(1)+' MB'}`,
     ownerId:m.ownerId,ownerName:m.ownerName,status:m.hidden?'hidden':m.place?.position?'located':m.place?'place_only':'unlocated',updatedAt:row.image.createdAt.toISOString(),
     photo:{thumbUrl:`/api/v1/admin/photos/${m.mediaId}/content?variant=thumb`,baseVersion:m.baseVersion,takenOn:m.takenOn},
     details:[{label:'拍摄日期',value:m.takenOn??'—'},{label:'地点',value:m.place?.label??'—'},{label:'备注',value:m.note||'—'}]};});
   return {items,total:n,page,pageSize:20};
  },
  async detail(id:string){const [row]=await joins().where(and(eq(s.media.id,id),eq(s.media.state,'ready')));if(!row)throw new DomainError('NOT_FOUND','照片不存在或已移除。',404);return metadata(row);},
 };
}
export function registerAdminPhotoRoutes(app:FastifyInstance,database:Database,config:AppConfig,auth:{preHandler:(request:FastifyRequest)=>Promise<void>},context:RouteContext){
 const service=adminPhotos(database),media=mediaService(database,config),photos=photoService(database),params=Type.Object({id:Type.String({format:'uuid'})});
 app.get<{Params:{id:string}}>('/api/v1/admin/photos/:id',{...auth,schema:{params}},async request=>context.respond(request,await service.detail(request.params.id)));
 app.get<{Params:{id:string};Querystring:{variant?:'preview'|'thumb'}}>('/api/v1/admin/photos/:id/content',{...auth,schema:{params,querystring:Type.Object({variant:Type.Optional(Type.Union([Type.Literal('preview'),Type.Literal('thumb')]))},{additionalProperties:false})}},async(request,reply)=>{
  const detail=await service.detail(request.params.id),row=await media.lookup(detail.ownerId,detail.mediaId);reply.type('image/webp');return reply.send(await media.files.stream(row.id,request.query.variant??'preview',row.extension));
 });
 app.put<{Params:{id:string};Body:PhotoInput&{clientMutationId:string}}>('/api/v1/admin/photos/:id',{...auth,schema:{params,body:Type.Object({...photoInputSchema.properties,clientMutationId:Type.String({minLength:8,maxLength:80})},{additionalProperties:false})}},async request=>{
  if(request.body.mediaId!==request.params.id)throw new DomainError('VALIDATION_ERROR','照片标识不一致。',400);
  const detail=await service.detail(request.params.id),{clientMutationId,...item}=request.body;
  return context.respond(request,await photos.save(detail.ownerId,{items:[item],clientMutationId},request.auth!.user.id));
 });
}
