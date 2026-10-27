<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import type * as Leaflet from 'leaflet';
import { api, ApiError, errorText } from '../api';
import type { AtlasCity, AtlasMap, AtlasConnection } from '../../../packages/contracts/src/index.js';
import MapTools from './MapTools.vue';
import { atlasLabelPoint } from '../maps/atlasLabels';
import { atlasPalette, atlasZoomLevels, containsAtlasPoint, type AtlasCamera } from '../maps/atlasNavigation';
const props = defineProps<{ scope: string; places: AtlasCity[]; selected: string | null; camera?: AtlasCamera | null; navigationEnabled?: boolean; connections?: AtlasConnection[]; introToken?: number; photoMode?: boolean }>();
const emit = defineEmits<{ region: [code: string]; place: [key: string]; zoomScope: [code: string, camera: AtlasCamera] }>();
const container = ref<HTMLElement>(), data = ref<AtlasMap | null>(null), loading = ref(false), error = ref(''), zoom = ref(1), visitedCount = ref(0);
let library: typeof Leaflet, map: Leaflet.Map | undefined, regions: Leaflet.GeoJSON | undefined, pins: Leaflet.LayerGroup | undefined, labels: Leaflet.LayerGroup | undefined, generation = 0, disposed = false, homeZoom = 0, observer: ResizeObserver | undefined, resizeTimer: ReturnType<typeof setTimeout>;
type Label = { marker: Leaflet.Marker; text: HTMLElement; kind: 'place' | 'region'; width: number; height: number };
// Dimensions include the real font and padding; measure once, outside animation frames.
function measureLabels() {
  for (const item of labelItems) { item.width = item.text.offsetWidth; item.height = item.text.offsetHeight; }
}
function refreshLabelMetrics() { if (!disposed) { measureLabels(); layoutLabels(); } }
let labelItems: Label[] = [];
let fitting = false, cameraTouched = false, lastZoom = 0, zoomAnchor: Leaflet.LatLng | null = null;
let navigationTimer: ReturnType<typeof setTimeout> | undefined;
let navigationBusy = false;
const palette = atlasPalette, toolsOpen = ref(false), centering = ref(false);
let finishCenter: (() => void) | undefined;
const introPaths = ref<string[]>([]); let introTimer: ReturnType<typeof setTimeout> | undefined, playedIntro = 0;
function clearIntro() { clearTimeout(introTimer); introPaths.value = []; }
function playIntro() {
  const token = props.introToken ?? 0;
  if (!map || loading.value || error.value || !token || playedIntro === token) return;
  clearIntro(); playedIntro = token;
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const size = map.getSize();
  introPaths.value = (props.connections ?? []).filter(c => props.scope === 'world' || countryView.value && c.from.countryCode === 'CHN' && c.to.countryCode === 'CHN').slice(0, 3).flatMap(c => {
    if (!c.from.center || !c.to.center) return [];
    const a = map!.latLngToContainerPoint([c.from.center[1], c.from.center[0]]), b = map!.latLngToContainerPoint([c.to.center[1], c.to.center[0]]);
    if ([a, b].some(p => p.x < 0 || p.x > size.x || p.y < 0 || p.y > size.y - 34)) return [];
    const dx = b.x - a.x, dy = b.y - a.y, bend = Math.min(65, Math.hypot(dx, dy) * .3), length = Math.hypot(dx, dy) || 1;
    return [`M ${a.x} ${a.y} Q ${(a.x + b.x) / 2 + dy / length * bend} ${(a.y + b.y) / 2 - dx / length * bend} ${b.x} ${b.y}`];
  });
  introTimer = setTimeout(clearIntro, 1650);
}
watch(() => props.introToken, () => { void nextTick(playIntro); });
watch(() => props.connections, value => { if (!value?.length) clearIntro(); });
function interruptCenter() {
  if (!map || !centering.value) return;
  if (finishCenter) map.off('moveend', finishCenter); finishCenter = undefined;
  // Keep the zoomend caused by stop() out of the automatic region navigation.
  map.stop(); finishLabelZoom(); lastZoom = map.getZoom(); fitting = false; centering.value = false; cameraTouched = true;
  clearTimeout(navigationTimer);
}
function toggleTools(open: boolean) { toolsOpen.value = open; void nextTick(layoutLabels); }

function captureWheel(event: WheelEvent) { interruptCenter(); if (map && event.deltaY) zoomAnchor = map.mouseEventToLatLng(event); }
function capturePinch(event: TouchEvent) {
  interruptCenter();
  if (!map || !event.touches.length || !container.value) return;
  const [a, b] = [event.touches[0]!, event.touches[1] || event.touches[0]!], rect = container.value.getBoundingClientRect();
  zoomAnchor = map.containerPointToLatLng([(a.clientX + b.clientX) / 2 - rect.left, (a.clientY + b.clientY) / 2 - rect.top]);
}
function navigateZoom(direction: number) {
  if (props.navigationEnabled === false || !map || !data.value || !regions || error.value || fitting || loading.value || navigationBusy || !direction) return;
  const level = map.getZoom(), point = zoomAnchor || map.getCenter();
  let target = '';
  if (direction < 0) {
    if (countryView.value && level <= atlasZoomLevels.leaveChina) target = 'world';
    else if (props.scope !== 'world' && !countryView.value && level <= atlasZoomLevels.leaveProvince) target = '100000';
  } else if (level >= (props.scope === 'world' ? atlasZoomLevels.enterChina : countryView.value ? atlasZoomLevels.enterProvince : atlasZoomLevels.enterCity)) {
    // Bounds prune the candidates. Polygon containment avoids selecting a nearby coastal region over water.
    regions.eachLayer(layer => {
      const polygon = layer as Leaflet.Polygon & { feature?: GeoJSON.Feature };
      const code = polygon.feature?.properties?.code;
      if (target || !code || !polygon.getBounds?.().contains(point)) return;
      const feature = data.value!.features.find(f => f.code === code);
      if (feature && containsAtlasPoint(feature, [point.lng, point.lat]) && (props.scope !== 'world' || code === 'CHN')) target = code === 'CHN' ? '100000' : code;
    });
  }
  if (!target || target === props.scope) return;
  navigationBusy = true;
  const center = map.getCenter(); emit('zoomScope', target, { scope: target, center: [center.lng, center.lat], zoom: level });
}
function zoomEnded() {
  if (!map || disposed) return;
  const current = map.getZoom(), direction = Math.sign(current - lastZoom); lastZoom = current;
  zoom.value = Math.pow(2, current - homeZoom); layoutLabels(); clearTimeout(navigationTimer);
  if (!fitting && !loading.value && !navigationBusy && direction) navigationTimer = setTimeout(() => navigateZoom(direction), 180);
}

const countryView = computed(() => props.scope === '100000');
const shortName = (name: string) => countryView.value ? name.replace(/壮族自治区|回族自治区|维吾尔自治区|特别行政区|自治区|省|市$/g, '') : name;
const scopePlaces = () => props.places.filter(p => p.place.center && (props.scope === 'world' ? false : countryView.value ? p.place.countryCode === 'CHN' : p.place.provinceCode === props.scope || p.place.cityCode === props.scope));
function lit(code: string) { return props.places.some(p => p.records > 0 && (props.scope === 'world' ? p.place.countryCode === code : countryView.value ? p.place.provinceCode === code : p.place.cityCode === code || p.place.provinceCode === p.place.cityCode && p.place.provinceCode === props.scope)); }
function regionStyle(feature?: GeoJSON.Feature): Leaflet.PolylineOptions { return { color: palette.border, weight: .9, fillColor: lit(feature?.properties?.code ?? '') ? palette.visited : palette.land, fillOpacity: 1, opacity: 1, smoothFactor: 1.2 }; }
function markName(marker: Leaflet.Marker, text: string) { const element = marker.getElement(); if (element) { element.setAttribute('aria-label', text); element.setAttribute('role', 'button'); } }
function renderLabels() {
  if (!map || !pins || !labels || !library || !data.value) return; pins.clearLayers(); labels.clearLayers(); labelItems = [];
  const places = scopePlaces().sort((a, b) => Number(b.place.key === props.selected) - Number(a.place.key === props.selected) || b.records - a.records);
  for (const p of places) {
    if (props.photoMode) {
      const root = document.createElement('span'); root.className = 'photo-overview-sign'; root.textContent = p.place.name.replace(/市$/, '');
      const marker = library.marker([p.place.center![1], p.place.center![0]], { icon: library.divIcon({ html: root, className: 'photo-overview-marker' + (props.selected === p.place.key ? ' selected' : ''), iconSize: [44, 44], iconAnchor: [22, 36] }), keyboard: true, title: p.place.name, zIndexOffset: 250 }).addTo(pins);
      markName(marker, p.place.name + '，' + p.photos + ' 张照片'); marker.on('click', () => emit('place', p.place.key)); continue;
    }
    const content = document.createElement('span'); content.className = 'atlas-place-content';
    const dot = document.createElement('span'); dot.className = 'pin-core'; const text = document.createElement('span'); text.className = 'pin-label'; text.textContent = p.place.name; content.append(dot, text);
    const marker = library.marker([p.place.center![1], p.place.center![0]], { icon: library.divIcon({ html: content, className: 'atlas-place-marker' + (p.records ? '' : ' wish') + (props.selected === p.place.key ? ' selected' : ''), iconSize: [14, 14], iconAnchor: [7, 7] }), keyboard: true, title: p.place.name, zIndexOffset: 200 }).addTo(pins);
    markName(marker, p.place.name + (p.records ? '，已到访' : '，想去')); marker.on('click', () => emit('place', p.place.key)); labelItems.push({ marker, text, kind: 'place', width: 0, height: 0 });
  }
  const seen = new Set<string>();
  for (const f of [...data.value.features].sort((a,b)=>Number(lit(b.code))-Number(lit(a.code)))) {
    if (!f.code || !f.name || seen.has(f.code) || places.some(p => p.place.cityCode === f.code || p.place.provinceCode === f.code && !p.place.cityCode)) continue; seen.add(f.code);
    const anchor = atlasLabelPoint(f, map); if (!anchor) continue;
    const text = document.createElement('span'); text.className = 'atlas-region-name'; text.textContent = shortName(f.name);
    const marker = library.marker([anchor[1], anchor[0]], { icon: library.divIcon({ html: text, className: 'atlas-region-label', iconSize: [2, 2], iconAnchor: [1, 1] }), keyboard: true, title: f.name }).addTo(labels);
    Object.assign(marker.getElement()!.dataset, { regionCode: f.code, labelLongitude: String(anchor[0]), labelLatitude: String(anchor[1]) });
    markName(marker, f.name + (lit(f.code) ? '，已有足迹' : '，查看地区')); marker.on('click', () => emit('region', f.code)); labelItems.push({ marker, text, kind: 'region', width: 0, height: 0 });
  }
  measureLabels(); layoutLabels();
}
function layoutLabels() {
  if (!map || disposed) return;
  const size = map.getSize(), boxes: number[][] = [];
  // A keyboard-focused name gets the same collision handling, rather than a CSS override.
  const ordered = [...labelItems].sort((a, b) => Number(b.marker.getElement() === document.activeElement) - Number(a.marker.getElement() === document.activeElement));
  // Keep names away from the actual visit dots as well as other names.
  const dots = labelItems.filter(item => item.kind === 'place').map(item => {
    const p = map!.latLngToContainerPoint(item.marker.getLatLng()); return [p.x - 8, p.y - 8, p.x + 8, p.y + 8];
  });
  const overlaps = (b: number[], a: number[], gap = 4) => b[0]! < a[2]! + gap && b[2]! > a[0]! - gap && b[1]! < a[3]! + gap && b[3]! > a[1]! - gap;
  for (const item of ordered) {
    const point = map.latLngToContainerPoint(item.marker.getLatLng()), w = item.width, h = item.height;
    let shown = false;
    // Administrative names stay at their geographic anchor. Reveal them as space permits;
    // moving a province name above/below its anchor makes it look like a neighbouring region.
    const offsets = item.kind === 'place' ? [[12, -h / 2], [-w - 12, -h / 2], [12, -h - 10], [-w - 12, 10]] : [[-w / 2, -h / 2]];
    for (const [rawX, rawY] of offsets) {
      const dx = Math.round(rawX!), dy = Math.round(rawY!);
      const b = [point.x + dx, point.y + dy, point.x + dx + w, point.y + dy + h];
      if (!w || !h || b[0]! < 6 || b[2]! > size.x - 6 || b[1]! < 6 || b[3]! > size.y - 34 || b[2]! > size.x - 64 && b[1]! < (toolsOpen.value ? 200 : 64) || boxes.some(a => overlaps(b, a)) || dots.some(a => overlaps(b, a, 2))) continue;
      // The visit icon's top-left is seven pixels away from its geographical anchor.
      const origin = item.kind === 'place' ? 7 : 1;
      item.text.style.left = dx + origin + 'px'; item.text.style.top = dy + origin + 'px';
      boxes.push(b); shown = true; break;
    }
    item.text.style.visibility = shown ? 'visible' : 'hidden';
    if (item.kind === 'region') item.marker.getElement()!.style.visibility = shown ? 'visible' : 'hidden';
  }
}
function startLabelZoom() { if (container.value) container.value.dataset.labelsMoving = 'true'; }
function finishLabelZoom() {
  // Leaflet has updated all marker anchors before zoomend. Restore text after collision layout.
  layoutLabels(); if (container.value) container.value.dataset.labelsMoving = 'false';
}
function fit(full = false, animate = false) {
  if (!map || !library || !regions) return;
  interruptCenter(); clearTimeout(navigationTimer); zoomAnchor = null;
  let bounds: Leaflet.LatLngBounds;
  if (countryView.value && !full) bounds = library.latLngBounds([18,73.4],[53.7,135.2]);
  else if (props.scope === 'world') bounds = library.latLngBounds([-58,-180],[84,180]);
  else bounds = regions.getBounds();
  if (!bounds.isValid()) return;
  const targetZoom = Math.min(map.getMaxZoom(), Math.max(map.getMinZoom(), map.getBoundsZoom(bounds, false, library.point(24, 24))));
  // Mercator's centre is the midpoint in projected space, not the mean latitude.
  const center = map.unproject(map.project(bounds.getNorthWest(), 0).add(map.project(bounds.getSouthEast(), 0)).divideBy(2), 0);
  fitting = true; cameraTouched = false; homeZoom = targetZoom;
  const finish = () => {
    if (!map || disposed) return;
    map.off('moveend', finish); finishCenter = undefined;
    lastZoom = map.getZoom(); zoom.value = Math.pow(2, lastZoom - homeZoom);
    fitting = false; centering.value = false; layoutLabels();
  };
  if (animate && !matchMedia('(prefers-reduced-motion: reduce)').matches && (Math.abs(map.getZoom() - targetZoom) > .01 || map.latLngToContainerPoint(center).distanceTo(map.getSize().divideBy(2)) > 1)) {
    centering.value = true; finishCenter = finish; map.once('moveend', finish);
    map.flyTo(center, targetZoom, { duration: .65 });
  } else {
    map.setView(center, targetZoom, { animate: false }); finish();
  }
}
async function load() {
  interruptCenter();
  const current=++generation; const preserve = props.camera?.scope === props.scope ? props.camera : null;
  clearTimeout(navigationTimer); navigationBusy = false; zoomAnchor = null; loading.value=true;error.value='';
  try {
    const [value, sdk] = await Promise.all([api<AtlasMap>('/atlas/maps/'+props.scope),import('leaflet'),import('leaflet/dist/leaflet.css')]);
    if(disposed||current!==generation)return;data.value=value;library=sdk;await nextTick();if(disposed||current!==generation)return;
    if(!map){map=library.map(container.value!,{crs:library.CRS.EPSG3857,preferCanvas:true,renderer:library.canvas({padding:.2,tolerance:5}),zoomControl:false,attributionControl:false,minZoom:-2,maxZoom:13,zoomSnap:.25,zoomDelta:.5,zoomAnimation:true,markerZoomAnimation:true,inertia:true,scrollWheelZoom:true,wheelDebounceTime:20,wheelPxPerZoomLevel:100,touchZoom:true,bounceAtZoomLimits:false,keyboard:true});
      map.setView([35,105],2,{animate:false});pins=library.layerGroup().addTo(map);labels=library.layerGroup().addTo(map);
      map.on('movestart',clearIntro);map.on('dragstart zoomstart',()=>{if(!fitting){cameraTouched=true;clearTimeout(resizeTimer);clearTimeout(navigationTimer);}}); map.on('dragstart',()=>{interruptCenter();zoomAnchor=null;});map.on('zoomstart',startLabelZoom);map.on('zoomend',finishLabelZoom);map.on('zoomend',zoomEnded);map.on('moveend',layoutLabels);
    }
    regions?.remove();regions=library.geoJSON({type:'FeatureCollection',features:value.features.map(f=>({type:'Feature',properties:{code:f.code,name:f.name},geometry:f.geometry}))} as GeoJSON.FeatureCollection,{style:regionStyle,onEachFeature:(feature,layer)=>{const code=feature.properties?.code;if(code)layer.on('click',()=>emit('region',code));}}).addTo(map);
    visitedCount.value=value.features.filter(f=>lit(f.code)).length;map.invalidateSize({pan:false});renderLabels();
    if (preserve) {
      fitting = true; map.setView([preserve.center[1], preserve.center[0]], preserve.zoom, { animate: false });
      homeZoom = map.getZoom(); lastZoom = homeZoom; zoom.value = 1; cameraTouched = true; fitting = false; layoutLabels();
    } else fit();
  }catch(e){if(!disposed&&current===generation)error.value=e instanceof ApiError ? errorText(e) : '地区地图暂时无法显示，记录仍保留，请重试。';}finally{if(current===generation){loading.value=false; navigationBusy = false; void nextTick(playIntro);}}
}
function changeZoom(delta:number){interruptCenter();zoomAnchor=null;clearTimeout(resizeTimer);cameraTouched=true;if(map)map.setZoom(map.getZoom()+delta);}
watch(()=>props.scope,()=>{if(container.value)void load();});
watch(()=>[props.places,props.selected],()=>{regions?.setStyle(regionStyle);visitedCount.value=data.value?.features.filter(f=>lit(f.code)).length??0;renderLabels();});
onMounted(()=>{void load();void document.fonts.ready.then(refreshLabelMetrics);document.fonts.addEventListener('loadingdone',refreshLabelMetrics);observer=new ResizeObserver(()=>{clearTimeout(resizeTimer);resizeTimer=setTimeout(()=>{if(map&&!disposed){interruptCenter();map.invalidateSize({pan:false});if(!cameraTouched)fit();else layoutLabels();}},100);});if(container.value)observer.observe(container.value);});
onBeforeUnmount(()=>{clearIntro();interruptCenter();disposed=true;generation++;document.fonts.removeEventListener('loadingdone',refreshLabelMetrics);observer?.disconnect();clearTimeout(resizeTimer);clearTimeout(navigationTimer);map?.remove();});
</script>
<template>
  <div class="atlas-canvas atlas-native-canvas" :style="{ '--atlas-water': palette.water, '--atlas-label': palette.label, '--atlas-surface': palette.surface }">
    <div ref="container" class="atlas-reference-map" role="group" aria-label="足迹地区地图" :data-zoom="zoom.toFixed(2)" :data-visited-regions="visitedCount" :data-region-count="data?.features.length ?? 0" :data-camera-moving="centering" :data-scope="scope" :data-level="(homeZoom + Math.log2(zoom)).toFixed(2)" data-projection="EPSG:3857" @focusin="layoutLabels" @focusout="layoutLabels" data-renderer="leaflet-canvas" @wheel.capture.passive="clearIntro(); captureWheel($event)" @touchstart.capture.passive="capturePinch" @pointerdown.capture="clearIntro(); interruptCenter()" @keydown.capture="clearIntro(); interruptCenter(); zoomAnchor = null"></div>
    <div v-if="loading || error" class="atlas-map-status"><p :role="error ? 'alert' : 'status'">{{ error || '正在展开足迹地图…' }}</p><button v-if="error" class="text-button" @click="load">重新加载底图</button></div>
    <svg v-if="introPaths.length" class="atlas-journey-intro" aria-hidden="true"><path v-for="(d, i) in introPaths" :key="i" :d="d" pathLength="1" :style="{ animationDelay: i * 80 + 'ms' }"/></svg>
    <MapTools :disabled="loading || !data" @zoom-in="changeZoom(.5)" @zoom-out="changeZoom(-.5)" @reset="fit(false, true)" @toggle="toggleTools"/>
    <p v-if="data" class="atlas-source"><a :href="data.sourceUrl" target="_blank" rel="noreferrer">{{ data.attribution }}</a><button class="atlas-overview-button" @click="fit(true, true)">查看全貌</button></p>
  </div>
</template>
