import { Type as T } from '@sinclair/typebox';
import type { FastifyInstance } from 'fastify';
import type { AppConfig } from './config.js';
import type { Database } from './db/client.js';
import type { RouteContext } from './record-routes.js';
import { object, stopFields, dayFields } from './schemas.js';
import { workspaceService, type WorkspaceRecord } from './workspace.js';
import type { WorkspaceSave } from '../../packages/contracts/src/index.js';
const uuid = T.String({ format: 'uuid' }), text = (n: number) => T.String({ maxLength: n }), mutation = T.String({ minLength: 8, maxLength: 80 });
const version = T.Integer({ minimum: 1 }), mode = T.Union(['unknown','walk','hike','drive','transit','rail','flight','bike','boat','other'].map(v => T.Literal(v)));
const place = object({ countryCode: T.String({ minLength: 3, maxLength: 3 }), areaCode: T.Optional(text(6)), cityName: T.Optional(text(80)) });
const prefs = object({ places: T.Record(T.String({format:'uuid'}), place), poiIds: T.Record(T.String({format:'uuid'}), text(100)), stayNotes: T.Record(T.String({format:'uuid'}), text(300)), defaultModes: T.Record(T.String({format:'uuid'}), mode) });
export function registerWorkspaceRoutes(app: FastifyInstance, database: Database, config: AppConfig, { authenticate, respond }: RouteContext) {
  const store = workspaceService(database, config), auth = { preHandler: authenticate }; type Id = { id: string };
  app.get<{Params:Id}>('/api/v1/journeys/:id/workspace', auth, async r => respond(r, await store.read(r.auth!.user.id, r.params.id)));
  app.post<{Body:{title:string;destination:string;clientMutationId:string}}>('/api/v1/workspace/journeys', {...auth,schema:{body:object({title:T.String({minLength:1,maxLength:80}),destination:text(120),clientMutationId:mutation})}},async r=>respond(r,await store.create(r.auth!.user.id,r.body)));
  app.put<{Params:Id;Body:WorkspaceSave}>('/api/v1/journeys/:id/workspace', {...auth,schema:{body:object({journeyVersion:version,routeVersion:version,title:T.String({minLength:1,maxLength:80}),destinations:T.Array(T.String({minLength:1,maxLength:120}),{maxItems:30}),status:T.Union(['planning','completed','archived'].map(v => T.Literal(v))),days:T.Array(object({...dayFields,id:uuid,unscheduled:T.Optional(T.Boolean()),stops:T.Array(object({...stopFields,id:uuid}),{maxItems:200})}),{minItems:1,maxItems:31}),preferences:prefs,arrivalModes:T.Record(T.String({format:'uuid'}),mode),clientMutationId:mutation})}},async r=>respond(r,await store.save(r.auth!.user.id,r.params.id,r.body)));
  app.post<{Params:Id;Body:WorkspaceRecord}>('/api/v1/journeys/:id/workspace/visits', {...auth,schema:{body:object({journeyVersion:version,routeVersion:version,visitedOn:T.String({pattern:'^\\d{4}-\\d{2}-\\d{2}$'}),selected:T.Array(object({sourceId:T.Optional(uuid),stop:object(stopFields),place:T.Optional(place)}),{minItems:1,maxItems:200}),clientMutationId:mutation})}},async r=>respond(r,await store.record(r.auth!.user.id,r.params.id,r.body)));
  app.delete<{Params:Id;Body:Parameters<typeof store.remove>[2]}>('/api/v1/journeys/:id', {...auth,schema:{body:object({journeyVersion:version,routeVersions:T.Record(T.String({format:'uuid'}),version),acknowledge:T.Boolean(),clientMutationId:mutation})}},async r=>respond(r,await store.remove(r.auth!.user.id,r.params.id,r.body)));
}
