import { Type as T } from '@sinclair/typebox';

const object = (properties: Parameters<typeof T.Object>[0]) => T.Object(properties, { additionalProperties: false });
const text = (maxLength: number, minLength = 0) => T.String({ maxLength, minLength });
const nullable = <X extends ReturnType<typeof T.String> | ReturnType<typeof T.Object>>(schema: X) => T.Union([schema, T.Null()]);
const id = text(80, 1);
const date = nullable(T.String({ pattern: '^\\d{4}-\\d{2}-\\d{2}$' }));
const mode = T.Union(['unknown', 'walk', 'hike', 'drive', 'transit', 'rail', 'flight', 'bike', 'boat', 'other'].map(x => T.Literal(x)));
const location = nullable(object({ longitude: T.Number({ minimum: -180, maximum: 180 }), latitude: T.Number({ minimum: -90, maximum: 90 }), crs: T.Union(['WGS84', 'GCJ02', 'BD09'].map(x => T.Literal(x))), source: T.Optional(T.Union(['manual_coordinate', 'amap_pick', 'gpx_endpoint'].map(x => T.Literal(x)))) }));
const stopFields = {
  label: text(160, 1), region: text(120), time: nullable(T.String({ pattern: '^([01]\\d|2[0-3]):[0-5]\\d$' })),
  note: text(10000), role: T.Union(['departure', 'visit', 'waypoint', 'transfer', 'overnight'].map(x => T.Literal(x))), location,
};
const dayFields = { title: text(80), area: text(120), date, stayName: text(160) };
const command = T.Union([
  object({ type: T.Literal('add_day'), clientRef: id, title: dayFields.title, area: dayFields.area, date }),
  object({ type: T.Literal('update_day'), dayId: id, patch: T.Partial(object(dayFields)) }),
  object({ type: T.Literal('remove_day'), dayId: id }),
  object({ type: T.Literal('add_stop'), clientRef: id, dayId: id, stop: object(stopFields), arrivalMode: mode }),
  object({ type: T.Literal('update_stop'), stopId: id, patch: T.Partial(object(stopFields)) }),
  object({ type: T.Literal('move_stop'), stopId: id, toDayId: id, index: T.Integer({ minimum: 0, maximum: 200 }) }),
  object({ type: T.Literal('remove_stop'), stopId: id }),
  object({ type: T.Literal('set_arrival'), stopId: id, mode }),
  object({ type: T.Literal('review_segment'), segmentId: id, geometryRef: id }),
  object({ type: T.Literal('clear_segment_geometry'), segmentId: id, geometryRef: id }),
  object({ type: T.Literal('set_segment_lock'), segmentId: id, locked: T.Boolean() }),
  object({ type: T.Literal('set_route_note'), note: text(10000) }),
]);
export const loginSchema = object({ username: text(64, 1), password: text(128, 1) });
export const createSchema = object({ title: text(80, 1), destinations: T.Array(text(120, 1), { maxItems: 30 }), origin: text(160), startDate: date, duration: T.Integer({ minimum: 1, maximum: 30 }), clientMutationId: text(80, 8) });
export const commandsSchema = object({ baseVersion: T.Integer({ minimum: 1 }), clientMutationId: text(80, 8), operations: T.Array(command, { minItems: 1, maxItems: 256 }) });
export const metadataSchema = object({ baseVersion: T.Integer({ minimum: 1 }), title: text(80, 1), destinations: T.Array(text(120, 1), { maxItems: 30 }), status: T.Union(['planning', 'completed', 'archived'].map(x => T.Literal(x))), clientMutationId: text(80, 8) });
