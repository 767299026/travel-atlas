<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { api, ApiError } from '../api';
import { loadAMap, displayConverter } from '../maps/amap';
import { geometrySourceLabels, type AtlasCityLayer, type Position } from '../../../packages/contracts/src/index.js';
import MapTools from './MapTools.vue';
const props = defineProps<{ code: string; year: string; revision: number; autoEntry?: boolean; selectedPath?: string; selectedRecord?: string }>();
const emit = defineEmits<{ record: [id: string]; journey: [id: string]; zoomOut: []; loaded: [layer: AtlasCityLayer | null]; path: [id: string]; clearSelection: [] }>();
const container = ref<HTMLElement>(), layer = ref<AtlasCityLayer | null>(null), loading = ref(false), online = ref(false), error = ref(''), showPoints = ref(true), showPaths = ref(true), zoom = ref(10), focus = ref('');
let labels: { root: HTMLElement; button: HTMLButtonElement; position: Position; id: string }[] = [];
let map: any, sdk: any, overlays: any[] = [], convert: ReturnType<typeof displayConverter>, generation = 0, rendering = 0, disposed = false, currentCity = '', observer: ResizeObserver | undefined, resizeTimer: ReturnType<typeof setTimeout> | undefined;
const unreviewed = computed(() => layer.value?.paths.some(p => p.reviewStatus !== 'confirmed'));
const sourceLabel = computed(() => [...new Set(layer.value?.paths.map(p => geometrySourceLabels[p.sourceKind]) ?? [])].join('／'));
const toolsOpen = ref(false), centering = ref(false);
let pathLines = new Map<string, any[]>(), pointMarkers = new Map<string, any>();
let cityHome: any = null, centerTimer: ReturnType<typeof setTimeout> | undefined, settleCenterTimer: ReturnType<typeof setTimeout> | undefined;
function toggleTools(open: boolean) { toolsOpen.value = open; void nextTick(layoutLabels); }
const safeError = (e: unknown) => e instanceof ApiError || e instanceof Error && /^(在线地图|显示坐标|城市定位)/.test(e.message) ? (e as Error).message : '地图显示暂时失败，请重试；足迹和原始位置仍保留。';
async function load() {
  interruptCenter();
  const current = ++generation; rendering++; loading.value = true; error.value = ''; layer.value = null; emit('loaded', null); pathLines.clear(); pointMarkers.clear(); focus.value = ''; if (map && overlays.length) map.remove(overlays); overlays = [];
  try {
    const [data, apiSdk] = await Promise.all([api<AtlasCityLayer>('/atlas/cities/' + props.code + '?year=' + props.year), loadAMap()]);
    if (disposed || current !== generation) return; layer.value = data; emit('loaded', data); sdk = apiSdk;
    if (!map) {
      convert = displayConverter(sdk); map = new sdk.Map(container.value, { zoom: 10, center: [105, 35], viewMode: '2D', resizeEnable: true, scrollWheel: false, zoomEnable: true, touchZoom: true, showLabel: true, mapStyle: 'amap://styles/whitesmoke', features: ['bg', 'road', 'point'], keyboardEnable: true, animateEnable: true });
      map.on('zoomend', zoomEnded); map.on('moveend', () => { layoutLabels(); settleCenter(); });
      online.value = true;
    }
    if (currentCity !== props.code) {
      const code = props.code;
      await new Promise<void>((resolve, reject) => { const timer = setTimeout(() => reject(new Error('城市定位超时，请重试地图。')), 15000); map.setCity(code, () => { clearTimeout(timer); resolve(); }); });
      if (disposed || current !== generation) return; currentCity = code; map.setZoom(10, true); const home = map.getCenter?.(); cityHome = Array.isArray(home) ? [...home] : home?.getLng ? [home.getLng(), home.getLat()] : null;
    }
    await render(!props.autoEntry); previousZoom = map.getZoom();
  } catch (e) { if (!disposed && current === generation) error.value = safeError(e); }
  finally { if (current === generation) loading.value = false; }
}
async function render(fit = false) {
  if (!map || !layer.value || disposed) return; const current = ++rendering, data = layer.value; error.value = '';
  try {
    const next: any[] = [], nextLabels: typeof labels = [], nextLines = new Map<string, any[]>(), nextMarkers = new Map<string, any>();
    if (showPoints.value) for (const crs of ['GCJ02', 'WGS84', 'BD09']) {
      const items = data.points.filter(p => p.location.crs === crs), positions = await convert(items.map(p => [p.location.longitude, p.location.latitude]), crs);
      items.forEach((point, i) => {
        const button = document.createElement('button'); button.type = 'button'; button.className = 'city-footprint-marker'; button.setAttribute('aria-label', point.label + '，' + point.visitedOn + '，查看到访');
        const root = document.createElement('div'); root.className = 'city-marker-object'; const dot = document.createElement('button'); dot.type = 'button'; dot.className = 'city-marker-anchor'; dot.setAttribute('aria-label', '到访点：' + point.label); dot.textContent = '●'; const text = document.createElement('span'); text.className = 'city-marker-name'; text.textContent = point.label; button.append(text); root.append(dot, button); dot.addEventListener('click', e => { e.stopPropagation(); focus.value = point.id; emit('record', point.id); });
        button.addEventListener('click', e => { e.stopPropagation(); focus.value = point.id; emit('record', point.id); });
        nextLabels.push({ root, button, position: positions[i]!, id: point.id }); const marker = new sdk.Marker({ position: positions[i], content: root, anchor: 'center', title: point.label, zIndex: 130 }); nextMarkers.set(point.id, marker); next.push(marker);
      });
    }
    if (showPaths.value) for (const path of data.paths) {
      for (const part of path.geometry.parts) {
        const positions = await convert(part as Position[], path.geometry.crs); if (positions.length < 2) continue;
        const line = new sdk.Polyline({ path: positions, strokeColor: path.sourceKind === 'manual' ? '#b76f50' : '#234a43', strokeWeight: 5, strokeOpacity: .85, strokeStyle: path.sourceKind === 'manual' ? 'dashed' : 'solid', lineJoin: 'round', zIndex: 100 });
        line.on('click', () => emit('path', path.id)); const lines = nextLines.get(path.id) ?? []; lines.push(line); nextLines.set(path.id, lines); next.push(line);
      }
    }
    if (disposed || current !== rendering) return; if (overlays.length) map.remove(overlays); overlays = next; labels = nextLabels; pathLines = nextLines; pointMarkers = nextMarkers; map.add(overlays); applySelection();
    if (fit && overlays.length) centerMap();
    zoom.value = map.getZoom(); layoutLabels();
  } catch (e) { if (!disposed && current === rendering) { if (overlays.length) map.remove(overlays); overlays = []; error.value = safeError(e); } }
}
function fitPadding(): number[] { const r = container.value?.getBoundingClientRect(); return r && r.height < 300 ? [24, 72, 40, 56] : [40, 80, 48, 64]; }
function layoutLabels() {
  if (disposed || !map?.lngLatToContainer || !container.value) return;
  const rect = container.value.getBoundingClientRect(), boxes: number[][] = [], positions = new Map(labels.map(item => [item.id, map.lngLatToContainer(item.position)]));
  const dots = [...positions.values()].map(p => [p.getX() - 8, p.getY() - 8, p.getX() + 8, p.getY() + 8]);
  const focused = props.selectedRecord || focus.value;
  const ordered = [...labels].sort((a, b) => Number(b.id === focused || b.root.contains(document.activeElement)) - Number(a.id === focused || a.root.contains(document.activeElement)));
  const metrics = ordered.map(item => ({ item, w: item.button.offsetWidth, h: item.button.offsetHeight }));
  for (const { item, w, h } of metrics) {
    const p = positions.get(item.id)!, px = p.getX(), py = p.getY(); let shown = false;
    for (const [rawX, rawY] of [[14, -h / 2], [-w - 14, -h / 2], [14, 14], [-w - 14, 14]]) {
      const dx = Math.round(rawX!), dy = Math.round(rawY!), b = [px + dx, py + dy, px + dx + w, py + dy + h];
      const hits = (a: number[], gap: number) => b[0]! < a[2]! + gap && b[2]! > a[0]! - gap && b[1]! < a[3]! + gap && b[3]! > a[1]! - gap;
      if (!w || !h || b[0]! < 8 || b[2]! > rect.width - 8 || b[1]! < 12 || b[3]! > rect.height - 36 || b[2]! > rect.width - 64 && b[1]! < (toolsOpen.value ? 200 : 64) || boxes.some(a => hits(a, 4)) || dots.some(a => hits(a, 2))) continue;
      item.button.style.left = dx + 6 + 'px'; item.button.style.top = dy + 6 + 'px'; boxes.push(b); shown = true; break;
    }
    item.button.style.visibility = shown ? 'visible' : 'hidden'; item.root.classList.toggle('is-selected', item.id === focused);
  }
}
function applySelection() {
  for (const [id, lines] of pathLines) for (const line of lines) line.setOptions?.({ strokeOpacity: props.selectedPath ? id === props.selectedPath ? 1 : .22 : .8, strokeWeight: props.selectedPath === id ? 6 : 4, zIndex: props.selectedPath === id ? 120 : 100, isOutline: props.selectedPath === id, outlineColor: '#fffdf4', borderWeight: 2 });
  layoutLabels();
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
function focusPath(id: string, animate = true) { if (showPaths.value) focusOverlays(pathLines.get(id) ?? [], animate); }
function focusVisit(id: string, animate = true) { const marker = pointMarkers.get(id); if (marker && showPoints.value) focusOverlays([marker], animate); }
function resetView() { emit('clearSelection'); centerMap(true); }
watch(() => props.selectedPath, id => { applySelection(); if (id) focusPath(id); });
watch(() => props.selectedRecord, id => { applySelection(); if (id) focusVisit(id); });
let lastWheel = 0, zoomNavigationTimer: ReturnType<typeof setTimeout> | undefined, fitting = false, previousZoom = 10;
function zoomEnded() {
  if (disposed || !map) return;
  const level = map.getZoom(), shrinking = level < previousZoom; previousZoom = level; zoom.value = level; layoutLabels();
  clearTimeout(zoomNavigationTimer); settleCenter();
  if (!loading.value && !fitting && shrinking && level <= 7) zoomNavigationTimer = setTimeout(() => { if (!disposed && map?.getZoom() <= 7) emit('zoomOut'); }, 180);
}
function wheel(e: WheelEvent) {
  if (!map || !e.deltaY || performance.now() - lastWheel < 100 || (e.target as HTMLElement).closest('.city-layer-controls,.atlas-map-tools')) return;
  interruptCenter(); lastWheel = performance.now();
  const rect = container.value!.getBoundingClientRect(), x = e.clientX - rect.left, y = e.clientY - rect.top;
  const anchor = sdk.Pixel && map.containerToLngLat ? map.containerToLngLat(new sdk.Pixel(x, y)) : null;
  map.setZoom(Math.max(3, Math.min(20, map.getZoom() + (e.deltaY < 0 ? 1 : -1))), true);
  if (anchor && map.lngLatToContainer && map.panBy) { const pixel = map.lngLatToContainer(anchor); map.panBy(x - pixel.getX(), y - pixel.getY(), 0); }
  zoom.value = map.getZoom();
}
function zoomBy(step: number) { interruptCenter(); if (map) { map.setZoom(Math.max(3, Math.min(20, map.getZoom() + step)), true); zoom.value = map.getZoom(); } }
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
  if (overlays.length) {
    const view = smooth && map.getFitZoomAndCenterByOverlays?.(overlays, fitPadding(), 15);
    if (Array.isArray(view) && typeof view[0] === 'number' && view[1]) map.setZoomAndCenter(view[0], view[1], false, 650);
    else map.setFitView(overlays, !smooth, fitPadding(), 15);
  } else if (cityHome) map.setZoomAndCenter(10, cityHome, !smooth, 650);
  else { map.setCity(props.code); map.setZoom(10, true); }
  if (!smooth) finishCenter();
}
watch(() => [props.code, props.year, props.revision], () => { if (container.value) void load(); });
onMounted(() => { void load(); observer = new ResizeObserver(() => { clearTimeout(resizeTimer); resizeTimer = setTimeout(() => { if (!disposed && map) { map.resize?.(); interruptCenter(); if (props.selectedPath) focusPath(props.selectedPath, false); else if (props.selectedRecord) focusVisit(props.selectedRecord, false); else if (overlays.length && !props.autoEntry) centerMap(); } }, 150); }); if (container.value) observer.observe(container.value); });
onBeforeUnmount(() => {
  interruptCenter(); disposed = true; generation++; rendering++; observer?.disconnect();
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
  <div class="atlas-canvas city-footprint-canvas" :data-selected-path="selectedPath || ''" :data-selected-record="selectedRecord || ''" :data-camera-moving="centering" :data-city="code" :data-zoom="zoom" :data-points="layer?.points.length ?? 0" :data-paths="layer?.paths.length ?? 0" @wheel.capture.prevent.stop="wheel">
    <div ref="container" class="city-online-map" role="group" aria-label="城市高德二维足迹地图" @pointerdown.capture="interruptCenter" @keydown.capture="interruptCenter" @focusin="layoutLabels" @focusout="layoutLabels"></div>
    <div v-if="loading || error" class="city-map-message" :role="error ? 'alert' : 'status'"><p>{{ error || '正在展开城市地图与足迹…' }}</p><button v-if="error" class="text-button" @click="load">重试城市地图</button></div>
    <MapTools city :disabled="!online || loading" :zoom-in-disabled="zoom >= 20" :zoom-out-disabled="zoom <= 3" @zoom-in="zoomBy(1)" @zoom-out="zoomBy(-1)" @reset="resetView" @toggle="toggleTools"/>
    <div v-if="layer" class="city-layer-controls" aria-label="城市足迹图层"><label><input v-model="showPoints" type="checkbox" @change="render()">到访地点 {{ layer.points.length }}</label><label><input v-model="showPaths" type="checkbox" @change="render()">已存路径 {{ layer.paths.length }}</label><small v-if="layer.withoutLocation">{{ layer.withoutLocation }} 条记录未定位，在城市列表查看</small><small v-if="!layer.points.length && !layer.paths.length">暂无精确足迹，可在实际行程补充位置后确认到访。</small><small v-if="layer.sampled">路径显示已抽样，原始路径请进入旅程查看。</small><small v-if="layer.truncated">仅显示部分记录，更多内容请进入旅程查看。</small><details v-if="layer.paths.length" class="city-layer-notes"><summary>{{ sourceLabel }}{{ unreviewed ? ' · 未核对' : '' }} · 非 GPS 实录</summary><small v-if="unreviewed">含未核对路径，请进入旅程查看来源与端点。</small><small>地图仅展示已有路径，不代表 GPS 实录或现场通行情况。</small></details></div>
  </div>
</template>
