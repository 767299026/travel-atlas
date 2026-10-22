import { Type as T } from '@sinclair/typebox';
const object = (fields: Parameters<typeof T.Object>[0]) => T.Object(fields, { additionalProperties: false });
const id = T.String({ minLength: 1, maxLength: 80 }), version = T.Integer({ minimum: 1 });
export const xmlSchema = T.String({ minLength: 1, maxLength: 1048576 });
const position = T.Tuple([T.Number({ minimum: -180, maximum: 180 }), T.Number({ minimum: -90, maximum: 90 })]);
export const geometrySchema = object({ crs: T.Union([T.Literal('WGS84'), T.Literal('GCJ02')]), parts: T.Array(T.Array(position, { minItems: 2, maxItems: 10000 }), { minItems: 1, maxItems: 100 }) });
const common = { baseVersion: version, clientMutationId: T.String({ minLength: 8, maxLength: 80 }), expectedGeometryRef: T.Union([id, T.Null()]), sourceNote: T.String({ minLength: 1, maxLength: 2000 }) };
export const geometrySaveSchema = T.Union([
  object({ ...common, kind: T.Literal('manual'), geometry: geometrySchema }),
  object({ ...common, kind: T.Literal('gpx'), xml: xmlSchema, filename: T.String({ minLength: 1, maxLength: 200 }), rightsConfirmed: T.Boolean() }),
]);
export const gpxPreviewSchema = object({ xml: xmlSchema });
export const exportSchema = object({ baseVersion: version, allowPartial: T.Boolean() });
