<script setup lang="ts">
import { nextTick, onMounted, onBeforeUnmount, ref, watch } from 'vue';
import type { PhotoMemory, Position } from '../../../packages/contracts/src/index.js';
import { displayConverter, loadAMap } from '../maps/amap';
import { clusterScreenPoints, projectWorld } from '../maps/cityPicking';
import { errorText } from '../api';
import MapTools from './MapTools.vue';
const props = defineProps<{ photos: PhotoMemory[]; selected: string[] }>();
const emit = defineEmits<{ select: [ids: string[]]; back: [] }>();
const container = ref<HTMLElement>(), loading = ref(true), error = ref('');
let map: any, sdk: any, convert: ReturnType<typeof displayConverter>, markers: any[] = [], points: { photo: PhotoMemory; position: Position }[] = [], generation = 0, disposed = false, frame = 0, observer: ResizeObserver | undefined;
function project(position: Position): [number, number] { const p = map.lngLatToContainer?.(position); return p ? [p.getX(), p.getY()] : projectWorld(position, map.getZoom()); }
function draw() {
  if (!map || disposed) return; if (markers.length) map.remove(markers); markers = [];
  const current = generation, groups = clusterScreenPoints(points.map(p => { const [x, y] = project(p.position); return { id: p.photo.mediaId, x, y, item: p }; }));
  for (const group of groups) {
    const photo = group.anchor.item.photo, button = document.createElement('button'), id = 'photo-drop-' + photo.mediaId;
    button.type = 'button'; button.className = 'photo-city-drop' + (group.members.some(p => props.selected.includes(p.id)) ? ' selected' : ''); button.setAttribute('aria-label', (photo.place?.label || '拍摄地点') + '，' + group.members.length + ' 张照片');
    button.innerHTML = '<svg viewBox="0 0 26 34" aria-hidden="true"><defs><clipPath id="' + id + '"><path d="M13 33S1 19 1 13a12 12 0 1 1 24 0c0 6-12 20-12 20Z"/></clipPath></defs><path d="M13 33S1 19 1 13a12 12 0 1 1 24 0c0 6-12 20-12 20Z" fill="#fffdf4"/><image x="1" width="24" height="34" preserveAspectRatio="xMidYMid slice" clip-path="url(#' + id + ')"/><path class="photo-drop-outline" d="M13 33S1 19 1 13a12 12 0 1 1 24 0c0 6-12 20-12 20Z"/></svg>';
    button.querySelector('image')!.setAttribute('href', photo.media.thumbnailUrl);
    button.addEventListener('click', event => { event.stopPropagation(); if (!disposed && current === generation) emit('select', group.members.map(m => m.id)); });
    markers.push(new sdk.Marker({ position: group.anchor.item.position, content: button, anchor: 'bottom-center', zIndex: 140 }));
  }
  map.add(markers);
}
function schedule() { cancelAnimationFrame(frame); frame = requestAnimationFrame(() => { frame = requestAnimationFrame(draw); }); }
function fit() { if (map && points.length) map.setFitView(points.map(point => new sdk.Marker({ position: point.position })), false, [60, 70, 70, 50], 16); }
async function render(fitView = false) {
  if (!map) return; const current = ++generation; loading.value = true; error.value = ''; const next: typeof points = [];
  try {
    for (const crs of ['GCJ02', 'WGS84', 'BD09']) {
      const list = props.photos.filter(p => p.place?.position?.crs === crs), converted = await convert(list.map(p => [p.place!.position!.longitude, p.place!.position!.latitude]), crs);
      list.forEach((photo, i) => next.push({ photo, position: converted[i]! }));
    }
    if (disposed || current !== generation) return; points = next; draw(); if (fitView) fit();
  } catch (e) { if (current === generation) error.value = errorText(e); } finally { if (current === generation) loading.value = false; }
}
async function load() {
  try {
    sdk = await loadAMap(); if (disposed) return; convert = displayConverter(sdk);
    map = new sdk.Map(container.value, { zoom: 11, zooms: [3, 20], center: [114.3, 30.58], viewMode: '2D', resizeEnable: true, mapStyle: 'amap://styles/whitesmoke', features: ['bg', 'road', 'point'], showLabel: true });
    map.on('zoomend', () => { schedule(); if (map.getZoom() < 7) emit('back'); }); map.on('moveend', schedule);
    await render(true); observer = new ResizeObserver(() => { map?.resize?.(); schedule(); }); if (container.value) observer.observe(container.value);
  } catch (e) { error.value = errorText(e); loading.value = false; }
}
watch(() => props.photos.map(p => p.mediaId + ':' + JSON.stringify(p.place)).join('|'), () => { void render(true); });
watch(() => props.selected, () => { void nextTick(draw); });
onMounted(load); onBeforeUnmount(() => { disposed = true; generation++; observer?.disconnect(); cancelAnimationFrame(frame); const previous = map; map = undefined; if (previous) { previous.setStatus?.({ animateEnable: false }); setTimeout(() => previous.destroy(), 120); } });
</script>
<template><div class="photo-city-map" :aria-busy="loading"><div ref="container" class="photo-city-surface" aria-label="照片拍摄地点高德二维地图"></div><MapTools city @zoom-in="map?.setZoom(Math.min(20, map.getZoom() + 1))" @zoom-out="map?.setZoom(Math.max(3, map.getZoom() - 1))" @reset="fit"/><p v-if="loading" class="photo-map-message" role="status">正在展开照片拍摄地点…</p><p v-if="error" class="photo-map-message memory-error" role="alert">{{ error }}<button class="memory-text-button" @click="map ? render(true) : load()">重试</button></p></div></template>
