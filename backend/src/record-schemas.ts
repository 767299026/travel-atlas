import { placeInputSchema } from './atlas-routes.js';
import { Type as T } from '@sinclair/typebox';
const object = (properties: Parameters<typeof T.Object>[0]) => T.Object(properties, { additionalProperties: false });
const text = (maxLength: number, minLength = 0) => T.String({ maxLength, minLength });
const nullableId = T.Union([text(36, 1), T.Null()]);
const version = T.Integer({ minimum: 1 });
const date = T.String({ pattern: '^\\d{4}-\\d{2}-\\d{2}$' });
export const mutationSchema = object({ clientMutationId: text(80, 8) });
export const copyFields = { planVersion: version, actualVersion: T.Union([version, T.Null()]), dayIds: T.Array(text(36, 1), { minItems: 1, maxItems: 30, uniqueItems: true }), mode: T.Union([T.Literal('append'), T.Literal('replace')]) };
export const copyPreviewSchema = object(copyFields);
export const copyApplySchema = object({ ...copyFields, clientMutationId: text(80, 8) });
export const visitSchema = object({ place: T.Optional(placeInputSchema), routeVersion: version, visitedOn: date, note: text(4000), clientMutationId: text(80, 8) });
const diaryFields = {
  title: text(120, 1), occurredOn: T.Union([date, T.Null()]), body: text(14000), status: T.Union([T.Literal('draft'), T.Literal('written')]),
  association: T.Union([T.Null(), object({ journeyId: text(36, 1), routeId: nullableId, dayId: nullableId, stopId: nullableId })]),
  photos: T.Array(object({ mediaId: text(36, 1), caption: text(500) }), { maxItems: 24 }), clientMutationId: text(80, 8),
};
export const diaryCreateSchema = object(diaryFields);
export const diarySaveSchema = object({ ...diaryFields, baseVersion: version });
export const versionMutationSchema = object({ baseVersion: version, clientMutationId: text(80, 8) });
export const userCreateSchema = object({ username: T.String({ pattern: '^[a-zA-Z0-9_.-]{1,64}$' }), displayName: text(80, 1), password: text(128, 12), role: T.Union([T.Literal('owner'), T.Literal('editor')]) });
export const userUpdateSchema = object({ baseVersion: version, displayName: text(80, 1), role: T.Union([T.Literal('owner'), T.Literal('editor')]), active: T.Boolean() });
export const passwordSchema = object({ baseVersion: version, password: text(128, 12) });
