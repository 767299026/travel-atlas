import { test } from 'node:test';
import assert from 'node:assert/strict';
import { clusterScreenPoints, hitJourneys, projectWorld } from '../../frontend/src/maps/cityPicking.js';
test('clustering is stable across input order and pan, preserves every record', () => {
  const points = [{ id: 'a', x: 0, y: 0 }, { id: 'b', x: 20, y: 20 }, { id: 'c', x: 140, y: 0 }];
  const ids = (items: typeof points) => clusterScreenPoints(items).map(group => group.members.map(point => point.id));
  assert.deepEqual(ids(points), [['a', 'b'], ['c']]); assert.deepEqual(ids([...points].reverse()), ids(points));
  assert.deepEqual(ids(points.map(point => ({ ...point, x: point.x - 100.5, y: point.y + 80.2 }))), ids(points));
});
test('near points across grid borders cluster; long chains do not collapse a whole trail', () => {
  assert.equal(clusterScreenPoints([{ id: 'a', x: 51, y: 0 }, { id: 'b', x: 53, y: 0 }]).length, 1);
  assert.equal(clusterScreenPoints(Array.from({ length: 10 }, (_, i) => ({ id: String(i), x: i * 40, y: 0 }))).length, 5);
});
test('coincident records stay distinct members and invalid pixels are omitted', () => {
  const result = clusterScreenPoints([{ id: 'a', x: 1, y: 1 }, { id: 'b', x: 1, y: 1 }, { id: 'bad', x: NaN, y: 0 }]);
  assert.equal(result.length, 1); assert.equal(result[0]!.members.length, 2); assert.throws(() => clusterScreenPoints([], 0));
});
test('projection separates nearby places when zoom increases without mutating coordinates', () => {
  const a = [114.3, 30.6], b = [114.3001, 30.6], gap = (z: number) => projectWorld(b, z)[0] - projectWorld(a, z)[0];
  assert.ok(Math.abs(gap(17) / gap(15) - 4) < 1e-6); assert.deepEqual(a, [114.3, 30.6]);
});
test('route picking returns different journeys once each in distance order', () => {
  assert.deepEqual(hitJourneys([{ journeyId: 'b', parts: [[[0, 5], [100, 5]], [[0, 6], [100, 6]]] }, { journeyId: 'a', parts: [[[0, 0], [100, 0]]] }], [50, 0]), ['a', 'b']);
});
test('route picking preserves gaps and handles zero-length segments and touch tolerance', () => {
  const route = { journeyId: 'a', parts: [[[0, 0], [10, 0]], [[100, 0], [110, 0]], [[200, 0], [200, 0]]] as [number, number][][] };
  assert.deepEqual(hitJourneys([route], [50, 0]), []); assert.deepEqual(hitJourneys([route], [5, 15]), []);
  assert.deepEqual(hitJourneys([route], [5, 15], 16), ['a']); assert.deepEqual(hitJourneys([route], [200, 0]), ['a']);
});
