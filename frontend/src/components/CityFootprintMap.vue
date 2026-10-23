<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { api, ApiError } from '../api';
import { loadAMap, displayConverter } from '../maps/amap';
import { geometrySourceLabels, type AtlasCityLayer, type Position } from '../../../packages/contracts/src/index.js';
import AtlasIcon from './AtlasIcon.vue';
const props = defineProps<{ code: string; year: string; revision: number }>();
const emit = defineEmits<{ record: [id: string]; journey: [id: string] }>();
const container = ref<HTMLElement>(), layer = ref<AtlasCityLayer | null>(null), loading = ref(false), online = ref(false), error = ref(''), showPoints = ref(true), showPaths = ref(true), zoom = ref(10), focus = ref('');
let labels: { root: HTMLElement; button: HTMLButtonElement; position: Position }[] = [];
let map: any, sdk: any, overlays: any[] = [], convert: ReturnType<typeof displayConverter>, generation = 0, rendering = 0, disposed = false, currentCity = '', observer: ResizeObserver | undefined, resizeTimer: ReturnType<typeof setTimeout> | undefined;
const unreviewed = computed(() => layer.value?.paths.some(p => p.reviewStatus !== 'confirmed'));
const sourceLabel = computed(() => [...new Set(layer.value?.paths.map(p => geometrySourceLabels[p.sourceKind]) ?? [])].join('／'));
const safeError = (e: unknown) => e instanceof ApiError || e instanceof Error && /^(在线地图|显示坐标|城市定位)/.test(e.message) ? (e as Error).message : '地图显示暂时失败，请重试；足迹和原始位置仍保留。';
async function load() {
  const current = ++generation; rendering++; loading.value = true; error.value = ''; layer.value = null; focus.value = ''; if (map && overlays.length) map.remove(overlays); overlays = [];
  try {
    const [data, apiSdk] = await Promise.all([api<AtlasCityLayer>('/atlas/cities/' + props.code + '?year=' + props.year), loadAMap()]);
    if (disposed || current !== generation) return; layer.value = data; sdk = apiSdk;
    if (!map) {
      convert = displayConverter(sdk); map = new sdk.Map(container.value, { zoom: 10, center: [105, 35], viewMode: '2D', resizeEnable: true, scrollWheel: false, zoomEnable: true, touchZoom: true, showLabel: true, keyboardEnable: true, animateEnable: false });
      map.on('zoomend', () => { if (!disposed) { zoom.value = map.getZoom(); layoutLabels(); } }); map.on('moveend', layoutLabels);
      online.value = true;
    }
    if (currentCity !== props.code) {
      const code = props.code;
      await new Promise<void>((resolve, reject) => { const timer = setTimeout(() => reject(new Error('城市定位超时，请重试地图。')), 15000); map.setCity(code, () => { clearTimeout(timer); resolve(); }); });
      if (disposed || current !== generation) return; currentCity = code; map.setZoom(10);
    }
    await render(true);
  } catch (e) { if (!disposed && current === generation) error.value = safeError(e); }
  finally { if (current === generation) loading.value = false; }
}
async function render(fit = false) {
  if (!map || !layer.value || disposed) return; const current = ++rendering, data = layer.value; error.value = '';
  try {
    const next: any[] = [], nextLabels: typeof labels = [];
    if (showPoints.value) for (const crs of ['GCJ02', 'WGS84', 'BD09']) {
      const items = data.points.filter(p => p.location.crs === crs), positions = await convert(items.map(p => [p.location.longitude, p.location.latitude]), crs);
      items.forEach((point, i) => {
        const button = document.createElement('button'); button.type = 'button'; button.className = 'city-footprint-marker'; button.setAttribute('aria-label', point.label + '，' + point.visitedOn + '，查看到访');
        const root = document.createElement('div'); root.className = 'city-marker-object'; const dot = document.createElement('button'); dot.type = 'button'; dot.className = 'city-marker-anchor'; dot.setAttribute('aria-label', '到访点：' + point.label); dot.textContent = '●'; const text = document.createElement('span'); text.className = 'city-marker-name'; text.textContent = point.label; button.append(text); root.append(dot, button); dot.addEventListener('click', e => { e.stopPropagation(); focus.value = point.id; emit('record', point.id); });
        button.addEventListener('click', e => { e.stopPropagation(); focus.value = point.id; emit('record', point.id); });
        nextLabels.push({ root, button, position: positions[i]! }); next.push(new sdk.Marker({ position: positions[i], content: root, anchor: 'center', title: point.label, zIndex: 130 }));
      });
    }
    if (showPaths.value) for (const path of data.paths) {
      for (const part of path.geometry.parts) {
        const positions = await convert(part as Position[], path.geometry.crs); if (positions.length < 2) continue;
        const line = new sdk.Polyline({ path: positions, strokeColor: path.sourceKind === 'manual' ? '#b76f50' : '#234a43', strokeWeight: 5, strokeOpacity: .85, strokeStyle: path.sourceKind === 'manual' ? 'dashed' : 'solid', lineJoin: 'round', zIndex: 100 });
        line.on('click', () => emit('journey', path.journeyId)); next.push(line);
      }
    }
    if (disposed || current !== rendering) return; if (overlays.length) map.remove(overlays); overlays = next; labels = nextLabels; map.add(overlays);
    if (fit && overlays.length) map.setFitView(overlays, true, fitPadding(), 15);
    zoom.value = map.getZoom(); layoutLabels();
  } catch (e) { if (!disposed && current === rendering) { if (overlays.length) map.remove(overlays); overlays = []; error.value = safeError(e); } }
}
function fitPadding(): number[] { const r = container.value?.getBoundingClientRect(); return r && r.height < 300 ? [24, 72, 40, 56] : [40, 80, 48, 64]; }
function layoutLabels() {
  if (disposed || !map?.lngLatToContainer || !container.value) return;
  const rect = container.value.getBoundingClientRect(), boxes: number[][] = [];
  for (const item of labels) {
    const p = map.lngLatToContainer(item.position), px = p.getX(), py = p.getY(), w = Math.max(60, item.button.offsetWidth || 110), h = 36;
    let shown = false;
    for (const [dx, dy] of [[14, -20], [-w - 14, -20], [14, 18], [-w - 14, 18], [14, -60], [-w - 14, 58]]) {
      const b = [px + dx!, py + dy!, px + dx! + w, py + dy! + h];
      if (b[0]! < 8 || b[2]! > rect.width - 8 || b[1]! < 12 || b[3]! > rect.height - 36 || b[2]! > rect.width - 64 && b[1]! < 152 || boxes.some(a => b[0]! < a[2]! + 4 && b[2]! > a[0]! - 4 && b[1]! < a[3]! + 4 && b[3]! > a[1]! - 4)) continue;
      item.button.style.left = dx! + 'px'; item.button.style.top = dy! + 'px'; boxes.push(b); shown = true; break;
    }
    item.button.style.visibility = shown ? 'visible' : 'hidden';
  }
}
let lastWheel = 0;
function wheel(e: WheelEvent) {
  if (!map || !e.deltaY || performance.now() - lastWheel < 100 || (e.target as HTMLElement).closest('.city-layer-controls,.atlas-map-tools')) return;
  lastWheel = performance.now();
  const rect = container.value!.getBoundingClientRect(), x = e.clientX - rect.left, y = e.clientY - rect.top;
  const anchor = sdk.Pixel && map.containerToLngLat ? map.containerToLngLat(new sdk.Pixel(x, y)) : null;
  map.setZoom(Math.max(3, Math.min(20, map.getZoom() + (e.deltaY < 0 ? 1 : -1))), true);
  if (anchor && map.lngLatToContainer && map.panBy) { const pixel = map.lngLatToContainer(anchor); map.panBy(x - pixel.getX(), y - pixel.getY(), 0); }
  zoom.value = map.getZoom();
}
function zoomBy(step: number) { if (map) { map.setZoom(Math.max(3, Math.min(20, map.getZoom() + step))); zoom.value = map.getZoom(); } }
function fit() { if (overlays.length) map.setFitView(overlays, true, fitPadding(), 15); else { map?.setCity(props.code); map?.setZoom(10); } }
watch(() => [props.code, props.year, props.revision], () => { if (container.value) void load(); });
onMounted(() => { void load(); observer = new ResizeObserver(() => { clearTimeout(resizeTimer); resizeTimer = setTimeout(() => { if (!disposed && map) { map.resize?.(); if (overlays.length) fit(); } }, 150); }); if (container.value) observer.observe(container.value); });
onBeforeUnmount(() => { disposed = true; generation++; rendering++; observer?.disconnect(); clearTimeout(resizeTimer); map?.destroy(); });
</script>
<template>
  <div class="atlas-canvas city-footprint-canvas" :data-city="code" :data-zoom="zoom" :data-points="layer?.points.length ?? 0" :data-paths="layer?.paths.length ?? 0" @wheel.capture.prevent.stop="wheel">
    <div ref="container" class="city-online-map" role="group" aria-label="城市高德二维足迹地图"></div>
    <div v-if="loading || error" class="city-map-message" :role="error ? 'alert' : 'status'"><p>{{ error || '正在展开城市地图与足迹…' }}</p><button v-if="error" class="text-button" @click="load">重试城市地图</button></div>
    <div class="atlas-map-tools"><button class="icon-button" aria-label="放大城市地图" :disabled="!online || zoom >= 20" @click="zoomBy(1)"><AtlasIcon name="plus"/></button><button class="icon-button" aria-label="缩小城市地图" :disabled="!online || zoom <= 3" @click="zoomBy(-1)"><AtlasIcon name="minus"/></button><button class="icon-button" aria-label="查看全部城市足迹" :disabled="!online" @click="fit"><AtlasIcon name="locate"/></button></div>
    <div v-if="layer" class="city-layer-controls" aria-label="城市足迹图层"><label><input v-model="showPoints" type="checkbox" @change="render()">到访地点 {{ layer.points.length }}</label><label><input v-model="showPaths" type="checkbox" @change="render()">已存路径 {{ layer.paths.length }}</label><small v-if="layer.withoutLocation">{{ layer.withoutLocation }} 条记录未定位，在城市列表查看</small><small v-if="!layer.points.length && !layer.paths.length">暂无精确足迹，可在实际行程补充位置后确认到访。</small><small v-if="layer.sampled">路径显示已抽样，原始路径请进入旅程查看。</small><small v-if="layer.truncated">仅显示部分记录，更多内容请进入旅程查看。</small><details v-if="layer.paths.length" class="city-layer-notes"><summary>{{ sourceLabel }}{{ unreviewed ? ' · 未核对' : '' }} · 非 GPS 实录</summary><small v-if="unreviewed">含未核对路径，请进入旅程查看来源与端点。</small><small>地图仅展示已有路径，不代表 GPS 实录或现场通行情况。</small></details></div>
  </div>
</template>
