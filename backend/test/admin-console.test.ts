import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { config } from '../src/config.js';
import { openDatabase } from '../src/db/client.js';
import { migrate, removeTestTables } from '../src/db/migrate.js';
import { buildApp } from '../src/app.js';
import { hashPassword } from '../src/security.js';

test('admin console permissions, inventory and revocation', async t => {
 const cfg={...config,prefix:'tjt_'+randomBytes(4).toString('hex')+'_',shareSecret:randomBytes(32).toString('hex'),loginRateMax:100,rateLimitMax:1000};
 const d=openDatabase(cfg);let app:Awaited<ReturnType<typeof buildApp>>|undefined;
 try {
  await migrate(d.pool,cfg.prefix);const password=randomBytes(24).toString('hex'),passwordHash=await hashPassword(password),ownerId=randomUUID(),editorId=randomUUID();
  await d.db.insert(d.schema.users).values([{id:ownerId,username:'owner',displayName:'管理员',passwordHash,role:'owner',createdAt:new Date()},{id:editorId,username:'editor',displayName:'编辑',passwordHash,role:'editor',createdAt:new Date()}]);
  app=await buildApp(cfg,d,{routingWorker:false});const origin=cfg.origins[0]!;
  const login=async(username:string)=>{const r=await app!.inject({method:'POST',url:'/api/v1/auth/login',headers:{origin},payload:{username,password}});assert.equal(r.statusCode,200);return{origin,cookie:'atlas_session='+r.cookies[0]!.value,'x-csrf-token':r.json().data.csrfToken};};
  const owner=await login('owner'),editor=await login('editor');
  const get=(path:string,headers:Record<string,string>=owner)=>app!.inject({url:'/api/v1'+path,headers});
  const post=(path:string,payload:unknown,headers:Record<string,string>=owner)=>app!.inject({method:'POST',url:'/api/v1'+path,payload,headers});
  await t.test('every console read denies anonymous and editor',async()=>{for(const path of ['/admin/dashboard','/admin/services','/admin/events',...['journeys','photos','visits','diaries','shares'].map(r=>'/admin/catalog/'+r)]){assert.equal((await get(path,{})).statusCode,401,path);assert.equal((await get(path,editor)).statusCode,403,path);assert.equal((await get(path)).statusCode,200,path);}});
  let journey:any,link:any;
  await t.test('global paginated inventory includes editor records and escapes wildcard search',async()=>{
   for(let i=0;i<23;i++){const r=await post('/workspace/journeys',{title:i===0?'武汉 100% 徒步':`武汉行程 ${String(i).padStart(2,'0')}`,destination:'武汉市',clientMutationId:randomUUID()},editor);assert.equal(r.statusCode,200,r.body);if(i===0)journey=r.json().data;}
   const first=(await get('/admin/catalog/journeys')).json().data;assert.equal(first.total,23);assert.equal(first.items.length,20);assert.equal(first.items[0].ownerName,'编辑');
   const next=(await get('/admin/catalog/journeys?page=2')).json().data;assert.equal(next.items.length,3);assert.equal(new Set([...first.items,...next.items].map((r:any)=>r.id)).size,23);
   assert.equal((await get('/admin/catalog/journeys?q='+encodeURIComponent('%'))).json().data.total,1);
   assert.equal((await get('/admin/catalog/journeys?q='+encodeURIComponent('武汉市'))).json().data.total,23);
   assert.equal((await get('/admin/catalog/journeys?page=0')).statusCode,400);assert.equal((await get('/admin/catalog/journeys?extra=x')).statusCode,400);assert.equal((await get('/admin/catalog/users')).statusCode,400);
   const summary=(await get('/admin/dashboard')).json().data;assert.equal(summary.journeys,23);assert.equal(summary.photos,0);assert.equal(summary.activeUsers,2);assert.equal(summary.recent.length,5);
  });
  await t.test('catalog and service responses exclude credentials and source content',async()=>{
   const service=await get('/admin/services');assert.equal(service.json().data.find((s:any)=>s.id==='database').state,'ready');assert.equal(service.json().data.find((s:any)=>s.id==='siyuan').state,'planned');
   const text=service.body+(await get('/admin/catalog/journeys')).body+(await get('/admin/dashboard')).body;
   for(const secret of [password,passwordHash,cfg.mysql.password,cfg.shareSecret,'passwordHash','tokenHash','csrfToken'])assert.ok(!text.includes(secret),'credential leaked');
  });
  await t.test('owner can auditably revoke an editor share without learning its bearer token',async()=>{
   const options={title:'武汉公开快照',layer:'plan',includeDates:false,includeNotes:false,diaryIds:[],includePhotos:false,expiresInDays:7};
   const preview=(await post('/journeys/'+journey.id+'/share-preview',options,editor)).json().data;
   const created=await post('/journeys/'+journey.id+'/shares',{...options,previewFingerprint:preview.fingerprint,acknowledge:true,clientMutationId:randomUUID()},editor);assert.equal(created.statusCode,200,created.body);link=created.json().data;
   const listed=await get('/admin/catalog/shares');assert.equal(listed.json().data.items[0].status,'active');assert.ok(!listed.body.includes(link.path.split('#')[1]));assert.ok(!listed.body.includes('tokenHash'));assert.equal((await get('/admin/dashboard')).json().data.activeShares,1);
   const url='/public/shares/'+link.id,headers={authorization:'Bearer '+link.path.split('#')[1]};assert.equal((await get(url,headers)).statusCode,200);
   const path='/admin/shares/'+link.id+'/revoke';assert.equal((await post(path,{acknowledge:true},editor)).statusCode,403);assert.equal((await post(path,{acknowledge:true},{origin,cookie:owner.cookie})).statusCode,403);assert.equal((await post(path,{acknowledge:false})).statusCode,400);
   assert.equal((await post(path,{acknowledge:true})).statusCode,200);assert.equal((await post(path,{acknowledge:true})).statusCode,200);assert.equal((await get(url,headers)).statusCode,404);
   assert.equal((await get('/admin/catalog/shares')).json().data.items[0].status,'revoked');assert.equal((await get('/admin/dashboard')).json().data.activeShares,0);
   const audit=(await get('/admin/events?q=share.revoke')).json().data;assert.equal(audit.total,1);assert.equal(audit.items[0].targetId,link.id);assert.equal(audit.items[0].actorName,'管理员');assert.equal((await get('/admin/catalog/journeys')).json().data.total,23);
  });
  await t.test('disabled owners and changed signing key are not counted as active shares',async()=>{
   await d.db.update(d.schema.shares).set({revokedAt:null}).where(eq(d.schema.shares.id,link.id));
   await d.db.update(d.schema.users).set({active:false}).where(eq(d.schema.users.id,editorId));assert.equal((await get('/admin/catalog/shares')).json().data.items[0].status,'disabled');assert.equal((await get('/admin/dashboard')).json().data.activeShares,0);
   await d.db.update(d.schema.users).set({active:true}).where(eq(d.schema.users.id,editorId));await d.db.update(d.schema.shares).set({tokenHash:'0'.repeat(64)}).where(eq(d.schema.shares.id,link.id));assert.equal((await get('/admin/catalog/shares')).json().data.items[0].status,'invalid');
  });
  await t.test('photo location quality requires coordinates and excludes hidden photos from attention',async()=>{
   const mediaId=randomUUID();await d.db.insert(d.schema.media).values({id:mediaId,ownerId:editorId,filename:'位置待整理.jpg',extension:'jpg',width:20,height:20,originalBytes:1024,storedBytes:2048,checksum:'0'.repeat(64),state:'ready',createdAt:new Date()});
   await d.db.insert(d.schema.photoMemories).values({mediaId,ownerId:editorId,takenOn:null,place:{label:'武汉',cityName:'武汉市',position:null,source:'manual'},note:'',hidden:false,version:1,createdAt:new Date(),updatedAt:new Date()});
   assert.equal((await get('/admin/catalog/photos')).json().data.items[0].status,'place_only');assert.equal((await get('/admin/dashboard')).json().data.attention.unlocatedPhotos,1);
   await d.db.update(d.schema.photoMemories).set({place:{label:'武汉',cityName:'武汉市',position:{longitude:114.3,latitude:30.5,crs:'GCJ02'},source:'map'}}).where(eq(d.schema.photoMemories.mediaId,mediaId));assert.equal((await get('/admin/catalog/photos')).json().data.items[0].status,'located');assert.equal((await get('/admin/dashboard')).json().data.attention.unlocatedPhotos,0);
   await d.db.update(d.schema.photoMemories).set({place:null,hidden:true}).where(eq(d.schema.photoMemories.mediaId,mediaId));assert.equal((await get('/admin/catalog/photos')).json().data.items[0].status,'hidden');assert.equal((await get('/admin/dashboard')).json().data.attention.unlocatedPhotos,0);
  });
 } finally {await app?.close();await removeTestTables(d.pool,cfg.prefix);await d.pool.end();}
});
