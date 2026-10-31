import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { mkdtemp,rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { eq } from 'drizzle-orm';
import sharp from 'sharp';
import { config } from '../src/config.js';
import { openDatabase } from '../src/db/client.js';
import { migrate, removeTestTables } from '../src/db/migrate.js';
import { buildApp } from '../src/app.js';
import { hashPassword } from '../src/security.js';
import { mediaService } from '../src/media.js';

test('admin curation filters, private preview and photo editing',async t=>{
 const mediaRoot=await mkdtemp(join(tmpdir(),'admin-curation-')),cfg={...config,mediaRoot,prefix:'tjt_'+randomBytes(4).toString('hex')+'_',rateLimitMax:1000,loginRateMax:100},d=openDatabase(cfg);
 let app:Awaited<ReturnType<typeof buildApp>>|undefined;
 try{await migrate(d.pool,cfg.prefix);const password=randomBytes(24).toString('hex'),passwordHash=await hashPassword(password),ownerId=randomUUID(),editorId=randomUUID();
 await d.db.insert(d.schema.users).values([{id:ownerId,username:'owner',displayName:'管理员',passwordHash,role:'owner',createdAt:new Date()},{id:editorId,username:'editor',displayName:'摄影者',passwordHash,role:'editor',createdAt:new Date()}]);app=await buildApp(cfg,d,{routingWorker:false});
 const origin=cfg.origins[0]!,login=async(username:string)=>{const r=await app!.inject({method:'POST',url:'/api/v1/auth/login',headers:{origin},payload:{username,password}});assert.equal(r.statusCode,200);return{origin,cookie:'atlas_session='+r.cookies[0]!.value,'x-csrf-token':r.json().data.csrfToken}};
 const owner=await login('owner'),editor=await login('editor');
 const get=(path:string,headers:Record<string,string>=owner)=>app!.inject({url:'/api/v1'+path,headers});
 const write=(path:string,body:unknown,headers:Record<string,string>=owner,method:'POST'|'PUT'='POST')=>app!.inject({method,url:'/api/v1'+path,payload:body,headers});
 const journey=(await write('/journeys',{title:'武汉周末',destinations:['武汉市'],origin:'',duration:1,startDate:null,clientMutationId:randomUUID()},editor)).json().data;
 const changedRoute=(await write('/routes/'+journey.route.id+'/commands',{baseVersion:journey.route.version,operations:[{type:'add_stop',clientRef:'draft:jiangtan',dayId:journey.route.days[0].id,stop:{label:'沿江步道',region:'武汉市',time:null,note:'',role:'visit',location:null},arrivalMode:'walk'}],clientMutationId:randomUUID()},editor)).json().data.route;
 const image=await sharp({create:{width:80,height:120,channels:3,background:'#687d52'}}).withExif({IFD0:{Artist:'PRIVATE_EXIF_MARKER'}}).jpeg().toBuffer();
 const media=await mediaService(d,cfg).upload(editorId,randomUUID(),'江边照片.jpg',async()=>image),unfiled=await mediaService(d,cfg).upload(editorId,randomUUID(),'待收录.jpg',async()=>image);
 const diaryResult=await write('/diaries',{title:'旧图文记录',occurredOn:'2026-10-21',body:'PRIVATE_DIARY_BODY',status:'written',association:{journeyId:journey.journey.id,routeId:journey.route.id,dayId:journey.route.days[0].id,stopId:changedRoute.days[0].stops[0].id},photos:[{mediaId:media.id,caption:'旧照片的说明'}],clientMutationId:randomUUID()},editor);assert.equal(diaryResult.statusCode,200,diaryResult.body);const diary=diaryResult.json().data;
 const readPhoto=async()=>(await get('/admin/photos/'+media.id)).json().data;
 await t.test('legacy dates and captions are inherited and quality counts match filtered rows',async()=>{
  const detail=await readPhoto();assert.equal(detail.takenOn,'2026-10-21');assert.equal(detail.note,'旧照片的说明');assert.equal(detail.source,'diary');assert.equal(detail.baseVersion,0);assert.equal(detail.diary.id,diary.id);assert.equal(detail.place.cityName,'武汉市');
  const dashboard=(await get('/admin/dashboard')).json().data;
  assert.equal(dashboard.attention.unlocatedPhotos,2);assert.equal(dashboard.attention.undatedPhotos,1);
  assert.equal((await get('/admin/catalog/photos?status=needs_date')).json().data.total,1);assert.equal((await get('/admin/catalog/photos?status=needs_location')).json().data.total,2);
  assert.equal((await get('/admin/catalog/photos?status=unfiled')).json().data.items[0].id,unfiled.id);
  assert.equal((await get('/admin/catalog/journeys?status=planning')).json().data.total,1);assert.equal((await get('/admin/catalog/journeys?status=completed')).json().data.total,0);assert.equal((await get('/admin/catalog/diaries?status=written')).json().data.total,1);
  assert.equal((await get('/admin/catalog/photos?status=planning')).statusCode,400);assert.equal((await get('/admin/catalog/journeys?status=needs_date')).statusCode,400);
 });
 await t.test('photo detail and derivatives require administrator; originals remain on owner API',async()=>{
  for(const path of ['/admin/photos/'+media.id,'/admin/photos/'+media.id+'/content?variant=preview','/admin/photos/'+media.id+'/content?variant=thumb']){assert.equal((await get(path,{})).statusCode,401);assert.equal((await get(path,editor)).statusCode,403);const r=await get(path);assert.equal(r.statusCode,200,path);if(path.includes('/content')){const meta=await sharp(r.rawPayload).metadata();assert.equal(meta.format,'webp');assert.equal(meta.exif,undefined);}}
  assert.equal((await get('/admin/photos/'+media.id+'/content?variant=original')).statusCode,400);assert.equal((await get('/media/'+media.id+'/content',owner)).statusCode,404);
  assert.ok(!(await get('/admin/photos/'+media.id)).body.includes('PRIVATE_DIARY_BODY'));assert.equal((await get('/admin/photos/'+randomUUID())).statusCode,404);
 });
 await t.test('editing inherited captions preserves the legacy city and original diary',async()=>{
  const detail=await readPhoto(),body={mediaId:media.id,baseVersion:detail.baseVersion,takenOn:detail.takenOn,place:detail.place,note:'单独整理的照片备注',clientMutationId:randomUUID()};
  const saved=await write('/admin/photos/'+media.id,body,owner,'PUT');assert.equal(saved.statusCode,200,saved.body);const library=(await get('/photos',editor)).json().data.items;assert.equal(library[0].place.cityName,'武汉市');assert.equal(library[0].place.label,'沿江步道');assert.equal((await get('/diaries/'+diary.id,editor)).json().data.photos[0].caption,'旧照片的说明');
 });
 let savedBody:any;
 await t.test('save is versioned and idempotent, records actor and leaves legacy diary and footprints intact',async()=>{
  const detail=await readPhoto(),auditBefore=(await get('/admin/events?q=photo.update')).json().data.total;savedBody={mediaId:media.id,baseVersion:detail.baseVersion,takenOn:'2026-10-22',place:{label:'汉口江滩',cityName:'武汉市',cityCode:'420100',position:{longitude:114.303,latitude:30.601,crs:'GCJ02',source:'amap_pick'},source:'map'},note:'沿江吹风',clientMutationId:randomUUID()};
  assert.equal((await write('/admin/photos/'+media.id,savedBody,editor,'PUT')).statusCode,403);assert.equal((await write('/admin/photos/'+media.id,savedBody,{origin,cookie:owner.cookie},'PUT')).statusCode,403);
  const r=await write('/admin/photos/'+media.id,savedBody,owner,'PUT');assert.equal(r.statusCode,200,r.body);assert.equal((await write('/admin/photos/'+media.id,savedBody,owner,'PUT')).statusCode,200);
  const after=await readPhoto();assert.equal(after.baseVersion,detail.baseVersion+1);assert.equal(after.note,'沿江吹风');assert.equal(after.takenOn,'2026-10-22');assert.equal(after.place.position.longitude,114.303);
  assert.equal((await get('/admin/catalog/photos?status=located')).json().data.total,1);assert.equal((await get('/admin/dashboard')).json().data.attention.unlocatedPhotos,1);
  const original=(await get('/diaries/'+diary.id,editor)).json().data;assert.equal(original.photos[0].caption,'旧照片的说明');assert.equal(original.occurredOn,'2026-10-21');assert.equal((await d.db.select().from(d.schema.visits)).length,0);
  const audit=(await get('/admin/events?q=photo.update')).json().data;assert.equal(audit.total,auditBefore+1);assert.equal(audit.items[0].actorName,'管理员');assert.equal(audit.items[0].targetId,media.id);
 });
 await t.test('stale saves, invalid dates and mismatched IDs preserve current values',async()=>{
  assert.equal((await write('/admin/photos/'+media.id,{...savedBody,clientMutationId:randomUUID(),note:'stale'},owner,'PUT')).statusCode,409);
  assert.equal((await write('/admin/photos/'+media.id,{...savedBody,baseVersion:1,takenOn:'2026-02-31',clientMutationId:randomUUID()},owner,'PUT')).statusCode,422);
  assert.equal((await write('/admin/photos/'+media.id,{...savedBody,mediaId:unfiled.id},owner,'PUT')).statusCode,400);assert.equal((await readPhoto()).note,'沿江吹风');
 });
 await t.test('hidden and deleted media cannot be restored by admin editing',async()=>{
  await d.db.update(d.schema.photoMemories).set({hidden:true,version:2}).where(eq(d.schema.photoMemories.mediaId,media.id));
  assert.equal((await write('/admin/photos/'+media.id,{...savedBody,baseVersion:2,clientMutationId:randomUUID()},owner,'PUT')).statusCode,409);
  assert.equal((await get('/admin/catalog/photos?status=hidden')).json().data.total,1);assert.equal((await get('/admin/catalog/photos?status=needs_location')).json().data.total,1);
  await d.db.update(d.schema.media).set({state:'deleted'}).where(eq(d.schema.media.id,media.id));assert.equal((await get('/admin/photos/'+media.id)).statusCode,404);assert.equal((await get('/admin/photos/'+media.id+'/content')).statusCode,404);
 });
 }finally{await app?.close();await removeTestTables(d.pool,cfg.prefix);await d.pool.end();await rm(mediaRoot,{recursive:true,force:true});}
});
