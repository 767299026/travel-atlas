<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue';
import { api, ApiError, errorText } from '../api';
import { validPosition, type Location, type RouteGeometry, type Position } from '../../../packages/contracts/src/index.js';
const props = defineProps<{ locations: { id: string; label: string; location: Location | null }[]; geometry: RouteGeometry | null; action: 'none' | 'point' | 'draw' }>();
const emit = defineEmits<{ pick: [location: Location] }>();
const container = ref<HTMLElement>(), loading = ref(false), online = ref(false), error = ref(''), sampled = ref(false);
let map: any, sdk: any, overlays: any[] = [], generation = 0, disposed = false; const cache = new Map<string, Position>();
const mapError = (error: unknown) => error instanceof ApiError || error instanceof Error && /^(在线地图|显示坐标)/.test(error.message) ? errorText(error) : '地图显示暂时失败，请重试；原始坐标和文件未改变。';
const rawParts = computed(() => props.geometry?.parts.filter(p => p.length) ?? []);
const sketch = computed(() => {
  const points = rawParts.value.flat().filter(validPosition); if (!points.length) return [];
  const minX = Math.min(...points.map(p => p[0])), maxX = Math.max(...points.map(p => p[0])), minY = Math.min(...points.map(p => p[1])), maxY = Math.max(...points.map(p => p[1]));
  const scaleX = Math.cos((maxY + minY) / 2 * Math.PI / 180), span = Math.max((maxX - minX) * scaleX, maxY - minY, 0.00001);
  return rawParts.value.map(part => part.map(p => [200 + (p[0] - (minX + maxX) / 2) * scaleX / span * 340, 140 - (p[1] - (minY + maxY) / 2) / span * 220].join(',')).join(' '));
});
async function load() {
  if (loading.value || map) return; loading.value = true; error.value = '';
  try {
    const capabilities = await api<{ amap: { jsKey: string; serviceHost: string } | null }>('/maps/capabilities');
    if (!capabilities.amap) throw new Error('在线地图尚未配置，可以使用坐标和 GPX。');
    const config = capabilities.amap;
    if (!(window as any).AMap) await new Promise<void>((resolve, reject) => {
      (window as any)._AMapSecurityConfig = { serviceHost: location.origin + config.serviceHost };
      const script = document.createElement('script'); let timer: ReturnType<typeof setTimeout>;
      const finish = (failed: boolean) => { clearTimeout(timer); script.onload = null; script.onerror = null; if (failed) { script.remove(); reject(new Error('在线地图加载失败，请检查网络或稍后重试。')); } else resolve(); };
      script.src = 'https://webapi.amap.com/maps?v=2.0&key=' + encodeURIComponent(config.jsKey); script.async = true;
      script.onload = () => finish(!(window as any).AMap); script.onerror = () => finish(true); timer = setTimeout(() => finish(true), 18000); document.head.append(script);
    });
    if (disposed) return; sdk = (window as any).AMap;
    map = new sdk.Map(container.value, { zoom: 4, center: [105, 35], viewMode: '2D', resizeEnable: true });
    map.on('click', (event: any) => { const lng = event.lnglat?.getLng(), lat = event.lnglat?.getLat(); if (props.action !== 'none' && validPosition([lng, lat])) emit('pick', { longitude: lng, latitude: lat, crs: 'GCJ02', source: 'amap_pick' }); });
    online.value = true; await render(true);
  } catch (e) { if (!disposed) error.value = mapError(e); } finally { loading.value = false; }
}
async function convert(points: Position[], crs: string): Promise<Position[]> {
  if (crs === 'GCJ02') return points;
  const type = crs === 'BD09' ? 'baidu' : 'gps', missing = points.filter(p => !cache.has(type + ':' + p.join(',')));
  for (let i = 0; i < missing.length; i += 40) {
    const batch = missing.slice(i, i + 40);
    const converted = await new Promise<Position[]>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('显示坐标转换超时；原始坐标和文件保持不变。')), 12000);
      // The SDK replaces input array entries with LngLat instances. Never pass our source/cache arrays.
      sdk.convertFrom(batch.map(([longitude, latitude]) => [longitude, latitude]), type, (status: string, result: any) => {
        clearTimeout(timer); if (status !== 'complete' || result?.locations?.length !== batch.length) { reject(new Error('显示坐标转换失败，没有将不同坐标直接混用。')); return; }
        const output = result.locations.map((p: any) => [p.getLng(), p.getLat()] as Position); if (!output.every(validPosition)) { reject(new Error('显示坐标格式无效。')); return; } resolve(output);
      });
    });
    converted.forEach((p, index) => cache.set(type + ':' + batch[index]!.join(','), p));
    if (disposed) throw new Error('Map closed');
  }
  return points.map(p => cache.get(type + ':' + p.join(','))!);
}
async function render(fit = false) {
  if (!map || disposed) return; const current = ++generation; error.value = ''; if (cache.size > 20000) cache.clear();
  try {
    const items = props.locations.filter(p => p.location), markers: { position: Position; title: string }[] = [];
    for (const crs of ['GCJ02', 'WGS84', 'BD09']) {
      const group = items.filter(p => p.location!.crs === crs); if (!group.length) continue;
      const positions = await convert(group.map(p => [p.location!.longitude, p.location!.latitude]), crs);
      group.forEach((p, i) => markers.push({ position: positions[i]!, title: p.label }));
    }
    const parts = rawParts.value, allCount = parts.reduce((n, p) => n + p.length, 0); sampled.value = allCount > 800;
    const displayParts = parts.map(part => { if (allCount <= 800 || part.length <= 2) return part; const count = Math.min(part.length, Math.max(2, Math.floor(part.length / allCount * 800))); return Array.from({ length: count }, (_, i) => part[Math.round(i * (part.length - 1) / (count - 1))]!); });
    const paths: Position[][] = []; for (const part of displayParts) paths.push(await convert(part, props.geometry?.crs ?? 'GCJ02'));
    if (disposed || current !== generation) return;
    if (overlays.length) map.remove(overlays);
    // Marker titles are plain strings; no user HTML is passed to marker content or labels.
    overlays = [...markers.map(m => new sdk.Marker({ position: m.position, title: m.title })), ...paths.filter(p => p.length >= 2).map(path => new sdk.Polyline({ path, strokeColor: '#234a43', strokeWeight: 5, strokeOpacity: 0.9 }))];
    map.add(overlays); if (fit && overlays.length) map.setFitView(overlays, false, [40, 40, 40, 40]);
  } catch (e) { if (!disposed && current === generation) { if (overlays.length) map.remove(overlays); overlays = []; error.value = mapError(e); } }
}
watch(() => [props.locations, props.geometry], () => { void render(); }, { deep: true });
onBeforeUnmount(() => { disposed = true; generation++; map?.destroy(); cache.clear(); });
</script>
<template><section class="route-map-canvas"><div ref="container" class="online-map" :class="{ 'map-visible': online }" aria-label="高德在线地图"></div><div v-if="!online" class="map-fallback"><svg v-if="sketch.length" viewBox="0 0 400 280" role="img" aria-label="路径分段示意，无地图底图"><polyline v-for="(part, index) in sketch" :key="index" :points="part" fill="none" stroke="#234a43" stroke-width="3"/></svg><p>{{ sketch.length ? '路径示意 · 各段保持独立，无地图底图' : '先选择地点或导入一份路径文件' }}</p><button class="primary" :disabled="loading" @click="load">{{ loading ? '正在加载地图…' : '加载高德在线地图' }}</button><small>加载后，显示所需的坐标会发送给高德；原件保留原坐标系。</small></div><button v-if="online" class="secondary-button map-fit" @click="render(true)">查看全部</button><p v-if="online && action !== 'none'" class="map-action-hint">{{ action === 'point' ? '点击地图，为所选地点补充位置' : '沿路径逐点点击，完成后核对并保存' }}</p><p v-if="sampled && online" class="small muted">地图显示抽样，原文件保留全部点。</p><p v-if="error" class="flow-form-errors" role="alert">{{ error }}<button v-if="!online" class="text-button" :disabled="loading" @click="load">重试加载</button><button v-else class="text-button" @click="render(true)">重试显示</button></p></section></template>
