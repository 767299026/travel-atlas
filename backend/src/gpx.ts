import { DOMParser, type Element } from '@xmldom/xmldom';
import { DomainError, geometryLimits, geometrySourceLabels, validateGeometry, geometryLength, isDate, type GpxPreview, type GeometryAsset } from '../../packages/contracts/src/index.js';
const invalid = () => new DomainError('INVALID_GPX', 'GPX 无法解析：请使用 UTF-8、带正确命名空间的 GPX 1.0／1.1 轨迹或路线文件，检查坐标、分段和采样字段。');
export function parseGpx(xml: string): GpxPreview {
  if (Buffer.byteLength(xml, 'utf8') > geometryLimits.gpxBytes) throw new DomainError('FILE_TOO_LARGE', 'GPX 文件最多 1MiB，请先分割或简化。', 413);
  if (/<!\s*(DOCTYPE|ENTITY)/i.test(xml) || /<\?xml[^?]*encoding\s*=\s*['"](?!utf-8['"])[^'"]+['"]/i.test(xml)) throw invalid();
  // Bound nesting before constructing a DOM; no DTD/external entities are accepted.
  let depth = 0; for (const token of xml.matchAll(/<[^>]*>/g)) {
    const value = token[0]; if (/^<\//.test(value)) depth--; else if (!/^<[!?]/.test(value) && !/\/>$/.test(value)) depth++;
    if (depth > 32) throw invalid();
  }
  try {
    const document = new DOMParser({ onError: () => { throw invalid(); } }).parseFromString(xml, 'application/xml');
    const root = document.documentElement, ns = root?.namespaceURI;
    if (!root || root.localName !== 'gpx' || !['http://www.topografix.com/GPX/1/1', 'http://www.topografix.com/GPX/1/0'].includes(ns ?? '') || root.getAttribute('version') !== (ns!.endsWith('/1') ? '1.1' : '1.0')) throw invalid();
    const children = (el: Element, name: string): Element[] => Array.from(el.childNodes).filter((n): n is Element => n.nodeType === 1 && (n as Element).namespaceURI === ns && (n as Element).localName === name);
    const parts: GpxPreview['geometry']['parts'] = [], samples: GpxPreview['samples'] = [];
    let count = 0;
    const add = (nodes: Element[]) => {
      if (!nodes.length) throw invalid();
      const part: typeof parts[number] = [], pointSamples: typeof samples[number] = [];
      for (const point of nodes) {
        if (++count > geometryLimits.points) throw new DomainError('LIMIT_EXCEEDED', 'GPX 最多 10000 个点，请先分割或简化。');
        const lon = point.getAttribute('lon'), lat = point.getAttribute('lat'), decimal = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/;
        if (!lon?.trim() || !lat?.trim() || !decimal.test(lon.trim()) || !decimal.test(lat.trim())) throw invalid();
        part.push([Number(lon), Number(lat)]);
        const elevations = children(point, 'ele'), times = children(point, 'time'); if (elevations.length > 1 || times.length > 1) throw invalid();
        const elevationText = elevations[0]?.textContent?.trim(), time = times[0]?.textContent?.trim() ?? null;
        const elevation = elevationText === undefined ? null : Number(elevationText);
        if (elevationText === '' || elevation !== null && (!Number.isFinite(elevation) || elevation < -12000 || elevation > 100000)) throw invalid();
        if (time !== null && (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(time) || !Number.isFinite(Date.parse(time)) || !isDate(time.slice(0, 10)))) throw invalid();
        pointSamples.push({ elevation, time });
      }
      parts.push(part); samples.push(pointSamples);
    };
    const tracks = children(root, 'trk'), routes = children(root, 'rte');
    if (tracks.length && routes.length) throw new DomainError('AMBIGUOUS_GPX', '文件同时含有路线和轨迹，可能是同一条路的两份表达。请拆分后导入，避免重复计程。');
    for (const track of tracks) { const segments = children(track, 'trkseg'); if (!segments.length) throw invalid(); for (const segment of segments) add(children(segment, 'trkpt')); }
    for (const route of routes) add(children(route, 'rtept'));
    const geometry: GpxPreview['geometry'] = { crs: 'WGS84', parts }; validateGeometry(geometry);
    const warnings = ['按参考轨迹导入；时间和海拔保留为文件采样，不代表已确认 GPS 实录或到访。', 'GPX 按标准 WGS84 解释；请核对来源，实际使用其他坐标系的文件不要直接导入。'];
    if (parts.length > 1) warnings.push(`${parts.length} 个分段保持独立；缺口没有直线连接或计程。`);
    if (children(root, 'wpt').length) warnings.push('独立航点未转换为路径；原文件保留供回查。');
    return { geometry, samples, pointCount: count, lengthM: geometryLength(geometry), warnings };
  } catch (error) { if (error instanceof DomainError) throw error; throw invalid(); }
}
export const escapeXml = (text: string) => text.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[c]!)).replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, '');
export function writeGpx(title: string, assets: GeometryAsset[], partial: boolean) {
  const tracks = assets.map((asset, index) => `<trk><name>${escapeXml(title)} · ${index + 1}</name><desc>${escapeXml(`${geometrySourceLabels[asset.sourceKind]}；非自动确认 GPS 实录。${asset.sourceNote}`)}</desc>${asset.routingInfo ? `<src>${escapeXml(asset.routingInfo.attribution)}</src><link href="https://www.openstreetmap.org/copyright"><text>OpenStreetMap contributors / ODbL 1.0</text></link>` : ''}${asset.geometry.parts.map((part, p) => `<trkseg>${part.map(([lon, lat], i) => {
    const sample = asset.samples?.[p]?.[i];
    return `<trkpt lat="${lat}" lon="${lon}">${sample?.elevation !== null && sample?.elevation !== undefined ? `<ele>${sample.elevation}</ele>` : ''}${sample?.time ? `<time>${escapeXml(sample.time)}</time>` : ''}</trkpt>`;
  }).join('')}</trkseg>`).join('')}</trk>`).join('');
  return `<?xml version="1.0" encoding="UTF-8"?>\n<gpx version="1.1" creator="Travel Atlas" xmlns="http://www.topografix.com/GPX/1/1"><metadata><name>${escapeXml(title)}</name><desc>${partial ? '部分路线：缺失段和接驳缺口未导出。' : ''}规划／参考／补绘数据，来源见各轨迹说明。</desc></metadata>${tracks}</gpx>\n`;
}
