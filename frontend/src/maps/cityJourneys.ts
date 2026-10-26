import { geometrySourceLabels, type AtlasCityLayer, type AtlasDetail } from '../../../packages/contracts/src/index.js';
import { routeThumbnail } from './routeThumbnail';

export interface CityMapCamera { center: [number, number]; zoom: number }

export interface CityJourneyMemory {
  id: string;
  title: string;
  paths: AtlasCityLayer['paths'];
  firstDate: string | null;
  lastDate: string | null;
  source: string;
  preview: string[];
  partialPreview: boolean;
  lengthM: number;
}

/** A memory is a journey. Preserve separate geometry parts, sources and missing dates. */
export function cityJourneyMemories(layer: AtlasCityLayer | null, detail: AtlasDetail | null): CityJourneyMemory[] {
  const groups = new Map<string, { title: string; paths: AtlasCityLayer['paths']; dates: string[] }>();
  const group = (id: string, title = '') => {
    if (!groups.has(id)) groups.set(id, { title, paths: [], dates: [] });
    const item = groups.get(id)!;
    if (title) item.title = title;
    return item;
  };
  for (const journey of detail?.journeys ?? []) group(journey.id, journey.title);
  for (const path of layer?.paths ?? []) {
    const item = group(path.journeyId, path.title);
    item.paths.push(path);
    if (path.visitedOn) item.dates.push(path.visitedOn);
  }
  for (const point of layer?.points ?? []) {
    const item = group(point.journeyId);
    if (point.visitedOn) item.dates.push(point.visitedOn);
  }
  for (const record of detail?.records ?? []) if (record.journeyId && record.source !== 'wish') {
    const item = group(record.journeyId);
    if (record.visitedOn) item.dates.push(record.visitedOn);
  }
  return [...groups].map(([id, item]) => {
    const dates = item.dates.sort(), sources = [...new Set(item.paths.map(path => geometrySourceLabels[path.sourceKind]))];
    const crs = item.paths.find(path => path.geometry.crs === 'WGS84')?.geometry.crs ?? item.paths[0]?.geometry.crs;
    // A thumbnail must not silently mix WGS84 and provider coordinates.
    const compatible = item.paths.filter(path => path.geometry.crs === crs);
    return { id, title: item.title || '相关旅程', paths: item.paths, firstDate: dates[0] ?? null, lastDate: dates.at(-1) ?? null,
      source: sources.length > 1 ? '混合来源' : sources[0] ?? '暂无路径',
      preview: crs ? routeThumbnail({ crs, parts: compatible.flatMap(path => path.geometry.parts) }) : [],
      partialPreview: compatible.length !== item.paths.length,
      lengthM: item.paths.reduce((sum, path) => sum + path.lengthM, 0) };
  }).sort((a, b) => (b.lastDate ?? '').localeCompare(a.lastDate ?? '') || a.title.localeCompare(b.title));
}
