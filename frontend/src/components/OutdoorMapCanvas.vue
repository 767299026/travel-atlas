<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue';
import type * as Leaflet from 'leaflet';
import { validPosition, type Location, type RouteGeometry } from '../../../packages/contracts/src/index.js';
const props = defineProps<{ locations: { id: string; label: string; location: Location | null }[]; geometry: RouteGeometry | null; action: 'none' | 'point' | 'draw' }>();
const emit = defineEmits<{ pick: [location: Location] }>();
const container = ref<HTMLElement>(), online = ref(false), loading = ref(false), error = ref('');
let library: typeof Leaflet | undefined, map: Leaflet.Map | undefined, overlays: Leaflet.FeatureGroup | undefined, tiles: Leaflet.TileLayer | undefined, disposed = false;
const omitted = computed(() => props.locations.filter(p => p.location && p.location.crs !== 'WGS84').length + (props.geometry && props.geometry.crs !== 'WGS84' ? 1 : 0));
function render(fit = false) {
  if (!map || !library || !overlays) return; overlays.clearLayers();
  for (const p of props.locations) if (p.location?.crs === 'WGS84') {
    const label = document.createElement('span'); label.textContent = p.label;
    library.circleMarker([p.location.latitude, p.location.longitude], { radius: 6, color: '#234a43', weight: 2, fillOpacity: 0.9 }).bindTooltip(label).addTo(overlays);
  }
  if (props.geometry?.crs === 'WGS84') for (const part of props.geometry.parts) if (part.length >= 2) library.polyline(part.map(p => [p[1], p[0]]), { color: '#234a43', weight: 5, opacity: 0.9 }).addTo(overlays);
  if (fit) { const bounds = overlays.getBounds(); if (bounds.isValid()) map.fitBounds(bounds, { padding: [30, 30], maxZoom: 16, animate: false }); else map.setView([33, 110], 4); }
}
async function load() {
  if (loading.value || map) return; loading.value = true; error.value = '';
  try {
    const [sdk] = await Promise.all([import('leaflet'), import('leaflet/dist/leaflet.css')]); if (disposed) return; library = sdk;
    map = library.map(container.value!, { minZoom: 3, maxZoom: 18, zoomAnimation: false, fadeAnimation: false, scrollWheelZoom: false }); overlays = library.featureGroup().addTo(map);
    tiles = library.tileLayer('https://tile.openmaps.fr/openhikingmap/{z}/{x}/{y}.png', { minZoom: 3, maxZoom: 18, maxNativeZoom: 18, keepBuffer: 0, updateWhenIdle: true, updateWhenZooming: false, referrerPolicy: 'strict-origin-when-cross-origin',
      attribution: '<a href="https://wiki.openstreetmap.org/wiki/OpenHikingMap">© OpenHikingMap</a> <a href="https://openmaps.fr/donate">❤️ Donation</a> <a href="https://www.openstreetmap.org/copyright">© OpenStreetMap</a>' }).addTo(map);
    tiles.on('tileerror', () => { if (!disposed) error.value = '部分户外图块暂时不可用，坐标和路径仍保留；可稍后重试或切换高德。'; });
    map.on('click', event => { const { lng, lat } = event.latlng; if (props.action !== 'none' && validPosition([lng, lat])) emit('pick', { longitude: lng, latitude: lat, crs: 'WGS84', source: 'outdoor_pick' }); });
    online.value = true; await nextTick(); if (disposed) return; map.invalidateSize({ pan: false }); render(true);
  } catch { if (!disposed) error.value = '户外地图暂时无法加载，可以继续使用坐标或 GPX。'; } finally { loading.value = false; }
}
watch(() => [props.locations, props.geometry], () => render(), { deep: true });
onBeforeUnmount(() => { disposed = true; map?.remove(); });
</script>
<template><section class="route-map-canvas outdoor-canvas"><div ref="container" class="online-map" :class="{ 'map-visible': online }" aria-label="OpenHikingMap 户外地图"></div><div v-if="!online" class="map-fallback"><h3>社区户外地图</h3><p>查看小径、等高线和 WGS84 路径，位置不与高德坐标直接混用。</p><button class="primary" :disabled="loading" @click="load">{{ loading ? '正在加载户外地图…' : '加载户外地图' }}</button><small>由 OpenMaps.fr 提供在线图块，加载会发送当前地图区域和站点来源；不预下载，没有离线包。</small></div><button v-if="online" class="secondary-button map-fit" @click="render(true)">查看全部</button><p v-if="online && action !== 'none'" class="map-action-hint">{{ action === 'point' ? '点击户外地图，为地点补充 WGS84 位置' : '逐点补绘 WGS84 路径，缺口另起一段' }}</p><p v-if="omitted" class="outdoor-omitted">{{ omitted }} 项使用其他坐标系，未叠加到户外图；请在原底图查看或重新核对位置。</p><p v-if="error" class="flow-form-errors" role="alert">{{ error }}<button class="text-button" :disabled="loading" @click="online ? (error = '', tiles?.redraw()) : load()">重试户外地图</button></p></section></template>
