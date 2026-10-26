import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cityJourneyMemories } from '../../frontend/src/maps/cityJourneys.js';
import type { AtlasCityLayer, AtlasDetail } from '../../packages/contracts/src/index.js';

const place = { key: 'CHN:420100', countryCode: 'CHN', countryName: '中国', provinceCode: '420000', provinceName: '湖北', cityCode: '420100', cityName: '武汉', name: '武汉', center: null };
const path = (id: string, journeyId = 'journey-a', crs: 'WGS84' | 'GCJ02' = 'WGS84'): AtlasCityLayer['paths'][number] => ({ id, journeyId, title: journeyId, fromLabel: '起', toLabel: '终', visitedOn: '2026-10-01', mode: 'hike', lengthM: 100, sourceKind: 'imported_reference', reviewStatus: 'unreviewed', geometry: { crs, parts: [[[114.3, 30.6], [114.301, 30.601]]] } });
const layer = (paths: AtlasCityLayer['paths']): AtlasCityLayer => ({ place, points: [], paths, withoutLocation: 0, sampled: false, truncated: false });
test('city memories group segments into journeys without joining gaps or mutating sources', () => {
  const source = layer([path('a'), path('b'), path('c', 'journey-b')]), before = JSON.stringify(source);
  const result = cityJourneyMemories(source, null);
  assert.equal(result.length, 2); assert.equal(result[0]!.paths.length, 2); assert.equal(result[0]!.preview.length, 2); assert.equal(result[0]!.lengthM, 200); assert.equal(result[0]!.source, '导入参考'); assert.equal(JSON.stringify(source), before);
});
test('journeys with no path and no date remain accessible without inventing values', () => {
  const detail: AtlasDetail = { place, records: [], nextCursor: null, journeys: [{ id: 'unlocated', title: '仍有回忆' }], plans: [], diaries: [] };
  const [result] = cityJourneyMemories(null, detail);
  assert.equal(result!.title, '仍有回忆'); assert.equal(result!.firstDate, null); assert.equal(result!.lastDate, null); assert.deepEqual(result!.preview, []); assert.equal(result!.source, '暂无路径');
});
test('mixed coordinate systems never share one thumbnail projection', () => {
  const [result] = cityJourneyMemories(layer([path('wgs'), path('gcj', 'journey-a', 'GCJ02')]), null);
  assert.equal(result!.partialPreview, true); assert.equal(result!.preview.length, 1); assert.equal(result!.paths.length, 2);
});
test('mixed sources retain an explicit label and dates sort by occurrence', () => {
  const older = path('older'); older.visitedOn = '2025-10-01'; older.sourceKind = 'manual';
  const [result] = cityJourneyMemories(layer([older, path('newer')]), null);
  assert.equal(result!.source, '混合来源'); assert.equal(result!.firstDate, '2025-10-01'); assert.equal(result!.lastDate, '2026-10-01');
});
