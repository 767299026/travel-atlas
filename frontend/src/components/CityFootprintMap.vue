<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { api, ApiError } from '../api';
import { loadAMap, displayConverter } from '../maps/amap';
import { geometrySourceLabels, type AtlasCityLayer, type Position } from '../../../packages/contracts/src/index.js';
import MapTools from './MapTools.vue';
import AtlasIcon from './AtlasIcon.vue';
import type { CityMapCamera } from '../maps/cityJourneys';
import { clusterScreenPoints, hitJourneys, projectWorld } from '../maps/cityPicking';
import CityMapChoices from './CityMapChoices.vue';
const props = defineProps<{ code: string; year: string; revision: number; autoEntry?: boolean; selectedJourney?: string; selectedRecord?: string; camera?: CityMapCamera | null; journeys?: { id: string; title: string }[] }>();
const emit = defineEmits<{ record: [id: string]; journey: [id: string]; zoomOut: []; loaded: [layer: AtlasCityLayer | null]; camera: [camera: CityMapCamera]; clearSelection: [] }>();
const container = ref<HTMLElement>(), layer = ref<AtlasCityLayer | null>(null), loading = ref(false), online = ref(false), error = ref(''), showPaths = ref(false), layerPanel = ref(false), renderPending = ref(false), visiblePathCount = ref(0), visiblePointCount = ref(0), zoom = ref(10), markerCount = ref(0), clusterCount = ref(0);
type LocatedPoint = { point: AtlasCityLayer['points'][number]; position: Position };
let locatedPoints: LocatedPoint[] = [], markerOverlays: any[] = [], fitAnchors: any[] = [], markerAnchors: { position: Position; radius: number }[] = [], convertedRoutes: { journeyId: string; parts: Position[][] }[] = [], clusteredZoom = -1, clusteredProjection = '', clusterFrame = 0;
const choices = ref<{ kind: 'records' | 'journeys'; ids: string[] } | null>(null);
let choiceFocus: HTMLElement | null = null, choiceFocusCluster = '';
const choiceRows = computed(() => (choices.value?.ids ?? []).map(id => {
  if (choices.value?.kind === 'records') { const point = locatedPoints.find(item => item.point.id === id)?.point; return { id, label: point?.label || '到访记录', date: point?.visitedOn || '', context: props.journeys?.find(journey => journey.id === point?.journeyId)?.title || layer.value?.paths.find(path => path.journeyId === point?.journeyId)?.title || '' }; }
  const paths = layer.value?.paths.filter(path => path.journeyId === id) ?? []; return { id, label: props.journeys?.find(journey => journey.id === id)?.title || paths[0]?.title || '相关旅程', date: paths.map(path => path.visitedOn).filter(Boolean).sort().at(-1) || '', context: '查看这一程' };
}).sort((a, b) => b.date.localeCompare(a.date) || a.label.localeCompare(b.label) || a.id.localeCompare(b.id)));
function openChoices(kind: 'records' | 'journeys', ids: string[], trigger?: HTMLElement) { choiceFocus = trigger || (document.activeElement instanceof HTMLElement ? document.activeElement : null); choiceFocusCluster = choiceFocus?.dataset.clusterId || ''; choices.value = { kind, ids }; }
function closeChoices(restoreFocus = true) { choices.value = null; if (restoreFocus) { const next = choiceFocus?.isConnected ? choiceFocus : [...(container.value?.querySelectorAll<HTMLElement>('.city-cluster-anchor') ?? [])].find(button => button.dataset.clusterId === choiceFocusCluster) ?? container.value; next?.focus({ preventScroll: true }); } }
function choose(id: string) { const kind = choices.value?.kind; closeChoices(false); if (kind === 'records') emit('record', id); else if (kind === 'journeys') emit('journey', id); }
function project(position: Position): [number, number] { const pixel = map?.lngLatToContainer?.(position); return pixel ? [pixel.getX(), pixel.getY()] : projectWorld(position, map?.getZoom() ?? 10); }
let labels: { root: HTMLElement; button: HTMLButtonElement; position: Position; id: string }[] = [];
let map: any, sdk: any, overlays: any[] = [], convert: ReturnType<typeof displayConverter>, generation = 0, rendering = 0, disposed = false, currentCity = '', observer: ResizeObserver | undefined, resizeTimer: ReturnType<typeof setTimeout> | undefined;
const unreviewed = computed(() => layer.value?.paths.some(p => p.reviewStatus !== 'confirmed'));
const sourceLabel = computed(() => [...new Set(layer.value?.paths.map(p => geometrySourceLabels[p.sourceKind]) ?? [])].join('／'));
const toolsOpen = ref(false), centering = ref(false), maximumZoom = ref(20);
let overlayGesture = false, dismissedChoiceGesture = false;
let clusterAttemptTimer: ReturnType<typeof setTimeout> | undefined;
function cancelClusterAttempt() { clearTimeout(clusterAttemptTimer); }
function beginMapPointer(event: PointerEvent) { cancelClusterAttempt(); dismissedChoiceGesture = !!choices.value; closeChoices(false); overlayGesture = !!(event.target as HTMLElement).closest('.city-marker-object'); interruptCenter(); layerPanel.value = false; }
const displayedPoints = computed(() => { const points = layer.value?.points ?? []; return props.selectedJourney ? points.filter(point => point.journeyId === props.selectedJourney) : props.selectedRecord ? points.filter(point => point.id === props.selectedRecord) : points; });
const displayedPaths = computed(() => { const paths = layer.value?.paths ?? []; return props.selectedJourney ? paths.filter(path => path.journeyId === props.selectedJourney) : props.selectedRecord ? [] : showPaths.value ? paths : []; });
let pathLines = new Map<string, any[]>(), pointMarkers = new Map<string, any>();
let cityHome: any = null, centerTimer: ReturnType<typeof setTimeout> | undefined, settleCenterTimer: ReturnType<typeof setTimeout> | undefined;
function toggleTools(open: boolean) { toolsOpen.value = open; void nextTick(layoutLabels); }
watch(layerPanel, () => { void nextTick(layoutLabels); });
const safeError = (e: unknown) => e instanceof ApiError || e instanceof Error && /^(在线地图|显示坐标|城市定位)/.test(e.message) ? (e as Error).message : '地图显示暂时失败，请重试；足迹和原始位置仍保留。';
async function load() {
  cancelClusterAttempt();
  interruptCenter();
  const initialCamera = props.camera;
  const current = ++generation; rendering++; loading.value = true; error.value = ''; layer.value = null; emit('loaded', null); pathLines.clear(); pointMarkers.clear(); choices.value = null; locatedPoints = []; markerOverlays = []; fitAnchors = []; markerAnchors = []; convertedRoutes = []; clusteredZoom = -1; markerCount.value = 0; clusterCount.value = 0; if (map && overlays.length) map.remove(overlays); overlays = []; labels = []; visiblePointCount.value = 0; visiblePathCount.value = 0;
  try {
    const [data, apiSdk] = await Promise.all([api<AtlasCityLayer>('/atlas/cities/' + props.code + '?year=' + props.year), loadAMap()]);
    if (disposed || current !== generation) return; layer.value = data; emit('loaded', data); sdk = apiSdk;
    if (!map) {
      convert = displayConverter(sdk); map = new sdk.Map(container.value, { zoom: 10, zooms: [3, 20], center: [105, 35], viewMode: '2D', resizeEnable: true, scrollWheel: false, zoomEnable: true, touchZoom: true, showLabel: true, mapStyle: 'amap://styles/whitesmoke', features: ['bg', 'road'], keyboardEnable: true, animateEnable: true });
      const range = map.getZooms?.(); if (Array.isArray(range) && Number.isFinite(range[1])) maximumZoom.value = Math.min(20, range[1]);
      map.on('click', (event: any) => { layerPanel.value = false; if (overlayGesture || dismissedChoiceGesture) return; if (choices.value) { closeChoices(false); return; } if (!pickRoute(event)) emit('clearSelection'); });
      map.on('dragstart', () => { cancelClusterAttempt(); closeChoices(false); });
      map.on('zoomend', zoomEnded); map.on('moveend', () => { scheduleMarkers(); layoutLabels(); settleCenter(); publishCamera(); });
      online.value = true;
    }
    if (currentCity !== props.code) {
      const code = props.code;
      await new Promise<void>((resolve, reject) => { const timer = setTimeout(() => reject(new Error('城市定位超时，请重试地图。')), 15000); map.setCity(code, () => { clearTimeout(timer); resolve(); }); });
      if (disposed || current !== generation) return; currentCity = code; map.setZoom(10, true); const home = map.getCenter?.(); cityHome = Array.isArray(home) ? [...home] : home?.getLng ? [home.getLng(), home.getLat()] : null;
    }
    if (initialCamera) map.setZoomAndCenter(initialCamera.zoom, [...initialCamera.center], true);
    await render(!props.autoEntry && !initialCamera); previousZoom = map.getZoom(); publishCamera();
  } catch (e) { if (!disposed && current === generation) error.value = safeError(e); }
  finally { if (current === generation) loading.value = false; }
}
async function convertCurrent(points: Position[], crs: string, current: number): Promise<Position[]> {
  const result: Position[] = [];
  for (let i = 0; i < points.length; i += 40) {
    if (disposed || current !== rendering) throw new Error('Map render superseded');
    result.push(...await convert(points.slice(i, i + 40), crs));
  }
  return result;
}
async function render(fit = false): Promise<boolean> {
  if (!map || !layer.value || disposed) return false;
  cancelClusterAttempt(); const current = ++rendering, points = displayedPoints.value, paths = displayedPaths.value;
  error.value = ''; renderPending.value = true;
  if (overlays.length) map.remove(overlays);
  overlays = []; labels = []; pathLines.clear(); pointMarkers.clear(); visiblePointCount.value = 0; visiblePathCount.value = 0; choices.value = null; locatedPoints = []; markerOverlays = []; fitAnchors = []; markerAnchors = []; convertedRoutes = []; markerCount.value = 0; clusterCount.value = 0; clusteredZoom = -1;
  try {
    const next: any[] = [], nextPoints: LocatedPoint[] = [], nextLines = new Map<string, any[]>(), nextRoutes: typeof convertedRoutes = [];
    for (const crs of ['WGS84', 'BD09'] as const) {
      const positions: Position[] = [...points.filter(p => p.location.crs === crs).map(p => [p.location.longitude, p.location.latitude] as Position), ...paths.filter(p => p.geometry.crs === crs).flatMap(p => p.geometry.parts.flat() as Position[])];
      if (positions.length) await convertCurrent(positions, crs, current);
      if (disposed || current !== rendering) return false;
    }
    for (const crs of ['GCJ02', 'WGS84', 'BD09']) {
      const items = points.filter(p => p.location.crs === crs), positions = await convertCurrent(items.map(p => [p.location.longitude, p.location.latitude]), crs, current);
      items.forEach((point, i) => nextPoints.push({ point, position: positions[i]! }));
    }
    for (const path of paths) for (const part of path.geometry.parts) {
      const positions = await convertCurrent(part as Position[], path.geometry.crs, current);
      if (positions.length < 2) continue;
      const active = !!props.selectedJourney;
      const line = new sdk.Polyline({ path: positions, strokeColor: path.sourceKind === 'manual' ? '#a16e50' : '#234a43', strokeWeight: active ? 5 : 2, strokeOpacity: active ? .95 : .35, strokeStyle: path.sourceKind === 'manual' ? 'dashed' : 'solid', lineJoin: 'round', zIndex: active ? 120 : 100, isOutline: active, outlineColor: '#fffdf4', borderWeight: 2, bubble: false });
      line.on('click', (event: any) => { if (disposed || current !== rendering) return; overlayGesture = true; if (!pickRoute(event)) emit('journey', path.journeyId); });
      nextRoutes.push({ journeyId: path.journeyId, parts: [positions] });
      const lines = nextLines.get(path.id) ?? []; lines.push(line); nextLines.set(path.id, lines); next.push(line);
    }
    if (disposed || current !== rendering) return false;
    overlays = next; pathLines = nextLines; convertedRoutes = nextRoutes; locatedPoints = nextPoints; fitAnchors = nextPoints.map(item => new sdk.Marker({ position: item.position })); map.add(overlays);
    refreshMarkers(true); visiblePointCount.value = nextPoints.length; visiblePathCount.value = nextLines.size;
    if (fit && overlays.length) centerMap();
    zoom.value = map.getZoom(); await nextTick(); layoutLabels(); return true;
  } catch (e) { if (!disposed && current === rendering) error.value = safeError(e); return false; }
  finally { if (!disposed && current === rendering) renderPending.value = false; }
}
function scheduleMarkers() { cancelAnimationFrame(clusterFrame); clusterFrame = requestAnimationFrame(() => { clusterFrame = requestAnimationFrame(() => refreshMarkers()); }); }
function refreshMarkers(force = false) {
  if (!map || disposed || !locatedPoints.length) return;
  const current = rendering, level = map.getZoom(), anchor = locatedPoints[0]!.position, other = locatedPoints.find(item => item.position[0] !== anchor[0] || item.position[1] !== anchor[1])?.position ?? anchor;
  const a = project(anchor), b = project(other), projection = (b[0] - a[0]).toFixed(2) + ':' + (b[1] - a[1]).toFixed(2);
  if (!force && level === clusteredZoom && projection === clusteredProjection) { layoutLabels(); return; } clusteredZoom = level; clusteredProjection = projection;
  const active = document.activeElement instanceof HTMLElement && document.activeElement.closest('.city-marker-object') ? document.activeElement : null;
  const old = new Set(markerOverlays); if (markerOverlays.length) map.remove(markerOverlays); overlays = overlays.filter(item => !old.has(item));
  labels = []; pointMarkers.clear(); markerOverlays = []; markerAnchors = [];
  const groups = clusterScreenPoints(locatedPoints.map(item => { const [x, y] = project(item.position); return { id: item.point.id, x, y, item }; }));
  for (const group of groups) {
    const item = group.anchor.item, root = document.createElement('div'); root.className = 'city-marker-object';
    const button = document.createElement('button'); button.type = 'button';
    if (group.members.length > 1) {
      root.classList.add('is-cluster'); button.className = 'city-cluster-anchor'; button.dataset.recordCount = String(group.members.length); button.dataset.clusterId = group.anchor.id; button.setAttribute('aria-label', group.members.length + ' 条到访记录，放大或选择'); button.textContent = String(group.members.length);
      button.addEventListener('click', event => { event.stopPropagation(); if (disposed || current !== rendering) return; overlayGesture = true; pickCluster(group.members.map(member => member.item), button); });
    } else {
      button.className = 'city-marker-anchor'; button.setAttribute('aria-label', '到访点：' + item.point.label); button.textContent = '●';
      const name = document.createElement('button'); name.type = 'button'; name.className = 'city-footprint-marker'; name.style.visibility = 'hidden'; name.setAttribute('aria-label', item.point.label + '，' + item.point.visitedOn + '，查看到访');
      const text = document.createElement('span'); text.className = 'city-marker-name'; text.textContent = item.point.label; name.append(text);
      const pick = (event: Event) => { event.stopPropagation(); if (disposed || current !== rendering) return; overlayGesture = true; emit('record', item.point.id); };
      button.addEventListener('click', pick); name.addEventListener('click', pick); root.append(name); labels.push({ root, button: name, position: item.position, id: item.point.id });
    }
    root.prepend(button); const marker = new sdk.Marker({ position: item.position, content: root, anchor: 'center', zIndex: group.members.length > 1 ? 135 : 130, title: group.members.length > 1 ? group.members.length + ' 条到访记录' : item.point.label });
    for (const member of group.members) pointMarkers.set(member.id, marker);
    markerAnchors.push({ position: item.position, radius: group.members.length > 1 ? 22 : 9 }); markerOverlays.push(marker);
  }
  map.add(markerOverlays); overlays.push(...markerOverlays); markerCount.value = groups.length; clusterCount.value = groups.filter(group => group.members.length > 1).length; layoutLabels();
  if (active) { container.value?.focus({ preventScroll: true }); }
}
function pickCluster(items: LocatedPoint[], trigger: HTMLElement) {
  cancelClusterAttempt();
  const first = items[0]!.position;
  const spreadM = Math.max(...items.map(item => Math.hypot((item.position[0] - first[0]) * Math.cos(first[1] * Math.PI / 180), item.position[1] - first[1]) * 111320));
  if (spreadM <= 5 || map.getZoom() >= maximumZoom.value - .01) { openChoices('records', items.map(item => item.point.id), trigger); return; }
  const pixels = items.map(item => project(item.position)), rect = container.value!.getBoundingClientRect();
  const width = Math.max(...pixels.map(point => point[0])) - Math.min(...pixels.map(point => point[0]));
  const height = Math.max(...pixels.map(point => point[1])) - Math.min(...pixels.map(point => point[1]));
  const factor = Math.min(4, Math.max(1, rect.width - 144) / (width + 52), Math.max(1, rect.height - 88) / (height + 52));
  const startedZoom = map.getZoom(), nextZoom = Math.min(maximumZoom.value, startedZoom + Math.max(.5, Math.log2(factor)));
  const center = [(Math.min(...items.map(item => item.position[0])) + Math.max(...items.map(item => item.position[0]))) / 2, (Math.min(...items.map(item => item.position[1])) + Math.max(...items.map(item => item.position[1]))) / 2];
  interruptCenter(); fitting = true; const smooth = !matchMedia('(prefers-reduced-motion: reduce)').matches; centering.value = smooth;
  if (smooth) centerTimer = setTimeout(finishCenter, 850);
  map.setZoomAndCenter(nextZoom, center, !smooth, 650); if (!smooth) finishCenter();
  const current = rendering, deadline = performance.now() + 3000;
  let lastZoom = map.getZoom(), stableSamples = 0;
  const checkProgress = () => {
    if (disposed || current !== rendering) return;
    const actual = map.getZoom(); stableSamples = Math.abs(actual - lastZoom) < .01 ? stableSamples + 1 : 0; lastZoom = actual;
    if (stableSamples < 2 && performance.now() < deadline) { clusterAttemptTimer = setTimeout(checkProgress, 250); return; }
    // If one zoom still cannot separate these records, let the user choose without repeated zoom attempts.
    const remaining = clusterScreenPoints(items.map(item => { const [x, y] = project(item.position); return { id: item.point.id, x, y }; }));
    if (remaining.length === 1) openChoices('records', items.map(item => item.point.id), trigger);
  };
  clusterAttemptTimer = setTimeout(checkProgress, smooth ? 1100 : 250);
}
function pickRoute(event: any): boolean {
  const coordinate = event?.lnglat;
  if (!coordinate || !map) return false;
  const position: Position = Array.isArray(coordinate) ? [coordinate[0], coordinate[1]] : [coordinate.getLng(), coordinate.getLat()];
  const hits = hitJourneys(convertedRoutes.map(route => ({ journeyId: route.journeyId, parts: route.parts.map(part => part.map(project)) })), project(position), 14);
  if (hits.length) overlayGesture = true;
  if (hits.length > 1) openChoices('journeys', hits);
  else if (hits.length === 1) emit('journey', hits[0]!);
  return hits.length > 0;
}
function fitPadding(): number[] { const r = container.value?.getBoundingClientRect(); return r && r.height < 300 ? [24, 72, 40, 56] : [40, 80, 48, 64]; }
function layoutLabels() {
  if (disposed || !map?.lngLatToContainer || !container.value) return;
  const rect = container.value.getBoundingClientRect(), boxes: number[][] = [], positions = new Map(labels.map(item => [item.id, map.lngLatToContainer(item.position)]));
  const dots = markerAnchors.map(anchor => { const [x, y] = project(anchor.position), r = anchor.radius; return [x - r, y - r, x + r, y + r]; });
  const focused = props.selectedRecord || '';
  const endpoints = new Set([displayedPaths.value[0]?.fromLabel, displayedPaths.value.at(-1)?.toLabel]);
  const budget = rect.width < 500 ? 4 : 7;
  let shownCount = 0;
  const blockers = [...container.value.parentElement!.querySelectorAll('.atlas-map-tools,.city-map-layers,.city-map-choices')].map(element => { const r = element.getBoundingClientRect(); return [r.left - rect.left, r.top - rect.top, r.right - rect.left, r.bottom - rect.top]; });
  const ordered = [...labels].sort((a, b) => Number(b.id === focused || b.root.contains(document.activeElement)) - Number(a.id === focused || a.root.contains(document.activeElement)));
  const metrics = ordered.map(item => ({ item, w: item.button.offsetWidth, h: item.button.offsetHeight }));
  for (const { item, w, h } of metrics) {
    const p = positions.get(item.id)!, px = p.getX(), py = p.getY(); let shown = false;
    const allowed = item.id === focused || item.root.contains(document.activeElement) || shownCount < budget && (zoom.value >= 14 || !!props.selectedJourney && endpoints.has(item.button.textContent || ''));
    for (const [rawX, rawY] of (allowed ? [[14, -h / 2], [-w - 14, -h / 2], [14, 14], [-w - 14, 14]] : [])) {
      const dx = Math.round(rawX!), dy = Math.round(rawY!), b = [px + dx, py + dy, px + dx + w, py + dy + h];
      const hits = (a: number[], gap: number) => b[0]! < a[2]! + gap && b[2]! > a[0]! - gap && b[1]! < a[3]! + gap && b[3]! > a[1]! - gap;
      if (!w || !h || b[0]! < 8 || b[2]! > rect.width - 8 || b[1]! < 12 || b[3]! > rect.height - 36 || b[2]! > rect.width - 64 && b[1]! < (toolsOpen.value ? 200 : 64) || blockers.some(a => hits(a, 6)) || boxes.some(a => hits(a, 4)) || dots.some(a => hits(a, 2))) continue;
      item.button.style.left = dx + 6 + 'px'; item.button.style.top = dy + 6 + 'px'; boxes.push(b); shownCount++; shown = true; break;
    }
    item.button.style.visibility = shown ? 'visible' : 'hidden'; item.root.classList.toggle('is-selected', item.id === focused);
  }
}
function focusOverlays(items: any[], animate = true) {
  if (!map || !items.length) return;
  interruptCenter(); fitting = true;
  const smooth = animate && !matchMedia('(prefers-reduced-motion: reduce)').matches;
  const view = map.getFitZoomAndCenterByOverlays?.(items, fitPadding(), 15);
  centering.value = smooth;
  if (smooth) centerTimer = setTimeout(finishCenter, 850);
  if (Array.isArray(view) && typeof view[0] === 'number' && view[1]) map.setZoomAndCenter(view[0], view[1], !smooth, 650);
  else map.setFitView(items, !smooth, fitPadding(), 15);
  if (!smooth) finishCenter();
}
function focusJourney(animate = true) { focusOverlays([...pathLines.values()].flat().length ? [...pathLines.values()].flat() : fitAnchors, animate); }
function focusVisit(id: string, animate = true) { const marker = pointMarkers.get(id); if (marker) focusOverlays([marker], animate); }
async function resetView() { cancelClusterAttempt(); emit('clearSelection'); await nextTick(); if (await render()) centerMap(true); }
watch(() => [props.selectedJourney, props.selectedRecord, showPaths.value], async (value, before) => {
  if (!await render()) return;
  if (value[0] && value[0] !== before[0]) focusJourney();
  else if (value[1] && value[1] !== before[1]) focusVisit(props.selectedRecord!);
});
let lastWheel = 0, zoomNavigationTimer: ReturnType<typeof setTimeout> | undefined, fitting = false, previousZoom = 10;
function publishCamera() {
  if (!map || disposed) return;
  const center = map.getCenter?.(), position = Array.isArray(center) ? center : center?.getLng ? [center.getLng(), center.getLat()] : null;
  if (position && position.every(Number.isFinite)) emit('camera', { center: [position[0], position[1]], zoom: map.getZoom() });
}
function zoomEnded() {
  if (disposed || !map) return;
  const level = map.getZoom(), shrinking = level < previousZoom; previousZoom = level; zoom.value = level; scheduleMarkers(); layoutLabels(); publishCamera();
  clearTimeout(zoomNavigationTimer); settleCenter();
  if (!loading.value && !fitting && shrinking && level <= 7) zoomNavigationTimer = setTimeout(() => { if (!disposed && map?.getZoom() <= 7) emit('zoomOut'); }, 180);
}
function wheel(e: WheelEvent) {
  if ((e.target as HTMLElement).closest('.city-map-layers,.atlas-map-tools,.city-map-choices')) return;
  e.preventDefault(); e.stopPropagation();
  cancelClusterAttempt();
  closeChoices(false);
  if (!map || !e.deltaY || performance.now() - lastWheel < 100) return;
  interruptCenter(); lastWheel = performance.now();
  const rect = container.value!.getBoundingClientRect(), x = e.clientX - rect.left, y = e.clientY - rect.top;
  const anchor = sdk.Pixel && map.containerToLngLat ? map.containerToLngLat(new sdk.Pixel(x, y)) : null;
  map.setZoom(Math.max(3, Math.min(maximumZoom.value, map.getZoom() + (e.deltaY < 0 ? 1 : -1))), true);
  if (anchor && map.lngLatToContainer && map.panBy) { const pixel = map.lngLatToContainer(anchor); map.panBy(x - pixel.getX(), y - pixel.getY(), 0); }
  zoom.value = map.getZoom();
}
function zoomBy(step: number) { cancelClusterAttempt(); closeChoices(false); interruptCenter(); if (map) { map.setZoom(Math.max(3, Math.min(maximumZoom.value, map.getZoom() + step)), true); zoom.value = map.getZoom(); } }
function finishCenter() {
  clearTimeout(centerTimer); clearTimeout(settleCenterTimer);
  previousZoom = map?.getZoom() ?? 10; zoom.value = previousZoom; centering.value = false; fitting = false; layoutLabels();
}
function settleCenter() { if (centering.value) { clearTimeout(settleCenterTimer); settleCenterTimer = setTimeout(finishCenter, 60); } }
function interruptCenter() {
  if (!map || !centering.value) return;
  // An immediate update to the current supplier camera cancels the in-flight transition.
  clearTimeout(centerTimer); clearTimeout(settleCenterTimer);
  const center = map.getCenter?.(); if (center) map.setZoomAndCenter(map.getZoom(), center, true);
  finishCenter(); clearTimeout(zoomNavigationTimer);
}
function centerMap(animate = false) {
  if (!map) return;
  interruptCenter(); clearTimeout(zoomNavigationTimer); fitting = true;
  const smooth = animate && !matchMedia('(prefers-reduced-motion: reduce)').matches;
  centering.value = smooth;
  if (smooth) centerTimer = setTimeout(finishCenter, 850);
  const items = [...pathLines.values()].flat().concat(fitAnchors);
  if (items.length) {
    const view = smooth && map.getFitZoomAndCenterByOverlays?.(items, fitPadding(), 15);
    if (Array.isArray(view) && typeof view[0] === 'number' && view[1]) map.setZoomAndCenter(view[0], view[1], false, 650);
    else map.setFitView(items, !smooth, fitPadding(), 15);
  } else if (cityHome) map.setZoomAndCenter(10, cityHome, !smooth, 650);
  else { map.setCity(props.code); map.setZoom(10, true); }
  if (!smooth) finishCenter();
}
watch(() => [props.code, props.year, props.revision], () => { if (container.value) void load(); });
onMounted(() => { void load(); observer = new ResizeObserver(() => { clearTimeout(resizeTimer); resizeTimer = setTimeout(() => { if (!disposed && map) { map.resize?.(); interruptCenter(); layoutLabels(); } }, 150); }); if (container.value) observer.observe(container.value); });
onBeforeUnmount(() => {
  interruptCenter(); disposed = true; generation++; rendering++; observer?.disconnect();
  cancelAnimationFrame(clusterFrame);
  cancelClusterAttempt();
  clearTimeout(resizeTimer); clearTimeout(zoomNavigationTimer); clearTimeout(centerTimer); clearTimeout(settleCenterTimer);
  const retired = map; map = undefined;
  if (retired) {
    retired.setStatus?.({ animateEnable: false, dragEnable: false, zoomEnable: false, keyboardEnable: false });
    const center = retired.getCenter?.(); if (center) retired.setZoomAndCenter(retired.getZoom(), center, true);
    // The SDK can still have a queued pointer/animation callback calling getStatus().
    // Drain that short tail against a disabled instance before releasing its internals.
    setTimeout(() => retired.destroy(), 120);
  }
});
</script>
<template>
  <div class="atlas-canvas city-footprint-canvas" :data-selected-journey="selectedJourney || ''" :data-selected-record="selectedRecord || ''" :data-camera-moving="centering" :data-rendering="renderPending" :data-city="code" :data-zoom="zoom" :data-points="layer?.points.length ?? 0" :data-paths="layer?.paths.length ?? 0" :data-visible-points="visiblePointCount" :data-visible-paths="visiblePathCount" :data-markers="markerCount" :data-clusters="clusterCount" :aria-busy="loading || renderPending" @wheel.capture="wheel">
    <div ref="container" class="city-online-map" role="group" tabindex="-1" aria-label="城市高德二维足迹地图" @pointerdown.capture="beginMapPointer" @keydown.capture="interruptCenter" @focusin="layoutLabels" @focusout="layoutLabels"></div>
    <div v-if="loading || error" class="city-map-message" :role="error ? 'alert' : 'status'"><p>{{ error || '正在展开城市地图与足迹…' }}</p><button v-if="error" class="text-button" @click="load">重试城市地图</button></div>
    <p v-else-if="layer && !layer.points.length && !layer.paths.length" class="city-map-empty" role="status">暂无已定位足迹<small>展开下方回忆，查看或补充记录。</small></p>
    <MapTools city :disabled="!online || loading" :zoom-in-disabled="zoom >= maximumZoom" :zoom-out-disabled="zoom <= 3" @zoom-in="zoomBy(1)" @zoom-out="zoomBy(-1)" @reset="resetView" @toggle="toggleTools"><button class="icon-button" aria-label="地图内容" :aria-expanded="layerPanel" :disabled="!layer || loading" @click="layerPanel = !layerPanel"><AtlasIcon name="layers"/></button></MapTools>
    <CityMapChoices v-if="choices" :kind="choices.kind" :rows="choiceRows" @select="choose" @close="closeChoices()"/>
    <section v-if="layerPanel && layer" class="city-map-layers" aria-label="地图内容设置" @keydown.esc.stop.prevent="layerPanel = false">
      <label><input v-model="showPaths" type="checkbox" :disabled="!!selectedJourney || !!selectedRecord">显示全部路线</label>
      <p v-if="selectedJourney || selectedRecord">关闭当前选择后，可切换全部路线。</p>
      <p>{{ layer.points.length }} 条已定位到访 · {{ layer.paths.length }} 段已存路径</p>
      <p v-if="layer.paths.length">{{ sourceLabel }}{{ unreviewed ? ' · 含未核对路径' : '' }}。参考路径不等于 GPS 实录。</p>
      <p v-if="layer.withoutLocation">{{ layer.withoutLocation }} 条到访未定位，可在地点列表查看。</p>
      <p v-if="layer.sampled">地图路径经过显示抽样，原始文件保留。</p>
      <button class="text-button" @click="layerPanel = false">关闭</button>
    </section>
  </div>
</template>
