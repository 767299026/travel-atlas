<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import type * as Leaflet from 'leaflet';
import { api, ApiError, errorText } from '../api';
import type { AtlasCity, AtlasMap } from '../../../packages/contracts/src/index.js';
import AtlasIcon from './AtlasIcon.vue';
import { atlasPalette, containsAtlasPoint, type AtlasCamera } from '../maps/atlasNavigation';
const props = defineProps<{ scope: string; places: AtlasCity[]; selected: string | null; camera?: AtlasCamera | null; navigationEnabled?: boolean }>();
const emit = defineEmits<{ region: [code: string]; place: [key: string]; zoomScope: [code: string, camera: AtlasCamera] }>();
const container = ref<HTMLElement>(), data = ref<AtlasMap | null>(null), loading = ref(false), error = ref(''), zoom = ref(1), visitedCount = ref(0);
let library: typeof Leaflet, map: Leaflet.Map | undefined, regions: Leaflet.GeoJSON | undefined, pins: Leaflet.LayerGroup | undefined, labels: Leaflet.LayerGroup | undefined, generation = 0, disposed = false, homeZoom = 0, observer: ResizeObserver | undefined, resizeTimer: ReturnType<typeof setTimeout>;
type Label = { marker: Leaflet.Marker; text: HTMLElement; kind: 'place' | 'region'; width: number };
let labelItems: Label[] = [];
let fitting = false, cameraTouched = false, lastZoom = 0, zoomAnchor: Leaflet.LatLng | null = null;
let navigationTimer: ReturnType<typeof setTimeout> | undefined;
let navigationBusy = false;
const palette = atlasPalette;
function captureWheel(event: WheelEvent) { if (map && event.deltaY) zoomAnchor = map.mouseEventToLatLng(event); }
function capturePinch(event: TouchEvent) {
  if (!map || !event.touches.length || !container.value) return;
  const [a, b] = [event.touches[0]!, event.touches[1] || event.touches[0]!], rect = container.value.getBoundingClientRect();
  zoomAnchor = map.containerPointToLatLng([(a.clientX + b.clientX) / 2 - rect.left, (a.clientY + b.clientY) / 2 - rect.top]);
}
function navigateZoom(direction: number) {
  if (props.navigationEnabled === false || !map || !data.value || !regions || error.value || fitting || loading.value || navigationBusy || !direction) return;
  const level = map.getZoom(), point = zoomAnchor || map.getCenter();
  let target = '';
  if (direction < 0) {
    if (countryView.value && level <= 1.25) target = 'world';
    else if (props.scope !== 'world' && !countryView.value && level <= 4) target = '100000';
  } else if (level >= (props.scope === 'world' ? 3.25 : countryView.value ? 5 : 7)) {
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
    const content = document.createElement('span'); content.className = 'atlas-place-content';
    const dot = document.createElement('span'); dot.className = 'pin-core'; const text = document.createElement('span'); text.className = 'pin-label'; text.textContent = p.place.name; content.append(dot, text);
    const marker = library.marker([p.place.center![1], p.place.center![0]], { icon: library.divIcon({ html: content, className: 'atlas-place-marker' + (p.records ? '' : ' wish') + (props.selected === p.place.key ? ' selected' : ''), iconSize: [14, 14], iconAnchor: [7, 7] }), keyboard: true, title: p.place.name, zIndexOffset: 200 }).addTo(pins);
    markName(marker, p.place.name + (p.records ? '，已到访' : '，想去')); marker.on('click', () => emit('place', p.place.key)); labelItems.push({ marker, text, kind: 'place', width: Math.min(p.place.name.length * 12, 168) });
  }
  const seen = new Set<string>();
  for (const f of [...data.value.features].sort((a,b)=>Number(lit(b.code))-Number(lit(a.code)))) {
    if (!f.code || !f.name || !f.center || seen.has(f.code) || places.some(p => p.place.cityCode === f.code || p.place.provinceCode === f.code && !p.place.cityCode)) continue; seen.add(f.code);
    const text = document.createElement('span'); text.className = 'atlas-region-name'; text.textContent = shortName(f.name);
    const marker = library.marker([f.center[1], f.center[0]], { icon: library.divIcon({ html: text, className: 'atlas-region-label', iconSize: [2, 2], iconAnchor: [1, 1] }), keyboard: true, title: f.name }).addTo(labels);
    markName(marker, f.name + (lit(f.code) ? '，已有足迹' : '，查看地区')); marker.on('click', () => emit('region', f.code)); labelItems.push({ marker, text, kind: 'region', width: Math.min(shortName(f.name).length * 11, 200) });
  }
  layoutLabels();
}
function layoutLabels() {
  if (!map || disposed) return; const size = map.getSize(), boxes: number[][] = [];
  for (const item of labelItems) {
    const point = map.latLngToContainerPoint(item.marker.getLatLng()), w = item.width, h = item.kind === 'place' ? 25 : 18;
    let shown = false;
    const offsets = item.kind === 'place' ? [[12,-h/2],[-w-12,-h/2],[12,-h-10],[-w-12,h/2+8]] : [[-w/2,-h/2],[-w/2,-h*1.6],[-w/2,h*.6]];
    for (const [dx,dy] of offsets) {
      const b = [point.x+dx!,point.y+dy!,point.x+dx!+w,point.y+dy!+h];
      if (b[0]!<6 || b[2]!>size.x-6 || b[1]!<6 || b[3]!>size.y-34 || b[2]!>size.x-64 && b[1]!<156 || boxes.some(a=>b[0]!<a[2]!+3 && b[2]!>a[0]!-3 && b[1]!<a[3]!+3 && b[3]!>a[1]!-3)) continue;
      item.text.style.left=dx!+'px';item.text.style.top=dy!+'px';boxes.push(b);shown=true;break;
    }
    item.text.style.visibility = shown ? 'visible' : 'hidden';
    if(item.kind==='region') item.marker.getElement()!.style.visibility=shown?'visible':'hidden';
  }
}
function fit(full = false) {
  if (!map || !library || !regions) return;
  clearTimeout(navigationTimer); zoomAnchor = null;
  let bounds: Leaflet.LatLngBounds;
  if (countryView.value && !full) bounds = library.latLngBounds([18,73.4],[53.7,135.2]);
  else if (props.scope === 'world') bounds = library.latLngBounds([-58,-180],[84,180]);
  else bounds = regions.getBounds();
  if(!bounds.isValid())return;
  fitting=true;cameraTouched=false;map.fitBounds(bounds,{padding:[10,10],animate:false});
  if(countryView.value&&!full)map.setZoom(map.getZoom()+.25,{animate:false});
  homeZoom = map.getZoom(); zoom.value = 1; lastZoom = map.getZoom(); fitting=false;layoutLabels();
}
async function load() {
  const current=++generation; const preserve = props.camera?.scope === props.scope ? props.camera : null;
  clearTimeout(navigationTimer); navigationBusy = false; zoomAnchor = null; loading.value=true;error.value='';
  try {
    const [value, sdk] = await Promise.all([api<AtlasMap>('/atlas/maps/'+props.scope),import('leaflet'),import('leaflet/dist/leaflet.css')]);
    if(disposed||current!==generation)return;data.value=value;library=sdk;await nextTick();if(disposed||current!==generation)return;
    if(!map){map=library.map(container.value!,{crs:library.CRS.EPSG4326,preferCanvas:true,renderer:library.canvas({padding:.2,tolerance:5}),zoomControl:false,attributionControl:false,minZoom:-2,maxZoom:12,zoomSnap:.25,zoomDelta:.5,zoomAnimation:true,markerZoomAnimation:true,inertia:true,scrollWheelZoom:true,wheelDebounceTime:20,wheelPxPerZoomLevel:100,touchZoom:true,bounceAtZoomLimits:false,keyboard:true});
      map.setView([35,105],2,{animate:false});pins=library.layerGroup().addTo(map);labels=library.layerGroup().addTo(map);
      map.on('dragstart zoomstart',()=>{if(!fitting){cameraTouched=true;clearTimeout(resizeTimer);clearTimeout(navigationTimer);}}); map.on('dragstart',()=>{zoomAnchor=null;});map.on('zoomend',zoomEnded);map.on('moveend',layoutLabels);
    }
    regions?.remove();regions=library.geoJSON({type:'FeatureCollection',features:value.features.map(f=>({type:'Feature',properties:{code:f.code,name:f.name},geometry:f.geometry}))} as GeoJSON.FeatureCollection,{style:regionStyle,onEachFeature:(feature,layer)=>{const code=feature.properties?.code;if(code)layer.on('click',()=>emit('region',code));}}).addTo(map);
    visitedCount.value=value.features.filter(f=>lit(f.code)).length;map.invalidateSize({pan:false});renderLabels();
    if (preserve) {
      fitting = true; map.setView([preserve.center[1], preserve.center[0]], preserve.zoom, { animate: false });
      homeZoom = map.getZoom(); lastZoom = homeZoom; zoom.value = 1; cameraTouched = true; fitting = false; layoutLabels();
    } else fit();
  }catch(e){if(!disposed&&current===generation)error.value=e instanceof ApiError ? errorText(e) : '地区地图暂时无法显示，记录仍保留，请重试。';}finally{if(current===generation){loading.value=false; navigationBusy = false;}}
}
function changeZoom(delta:number){zoomAnchor=null;clearTimeout(resizeTimer);cameraTouched=true;if(map)map.setZoom(map.getZoom()+delta);}
watch(()=>props.scope,()=>{if(container.value)void load();});
watch(()=>[props.places,props.selected],()=>{regions?.setStyle(regionStyle);visitedCount.value=data.value?.features.filter(f=>lit(f.code)).length??0;renderLabels();});
onMounted(()=>{void load();observer=new ResizeObserver(()=>{clearTimeout(resizeTimer);resizeTimer=setTimeout(()=>{if(map&&!disposed){map.invalidateSize({pan:false});if(!cameraTouched)fit();else layoutLabels();}},100);});if(container.value)observer.observe(container.value);});
onBeforeUnmount(()=>{disposed=true;generation++;observer?.disconnect();clearTimeout(resizeTimer);clearTimeout(navigationTimer);map?.remove();});
</script>
<template>
  <div class="atlas-canvas atlas-native-canvas" :style="{ '--atlas-water': palette.water, '--atlas-label': palette.label, '--atlas-surface': palette.surface }">
    <div ref="container" class="atlas-reference-map" role="group" aria-label="足迹地区地图" :data-zoom="zoom.toFixed(2)" :data-visited-regions="visitedCount" :data-region-count="data?.features.length ?? 0" :data-scope="scope" :data-level="(homeZoom + Math.log2(zoom)).toFixed(2)" data-renderer="leaflet-canvas" @wheel.capture.passive="captureWheel" @touchstart.capture.passive="capturePinch" @keydown.capture="zoomAnchor = null"></div>
    <div v-if="loading || error" class="atlas-map-status"><p :role="error ? 'alert' : 'status'">{{ error || '正在展开足迹地图…' }}</p><button v-if="error" class="text-button" @click="load">重新加载底图</button></div>
    <div class="atlas-map-tools"><button class="icon-button" aria-label="放大足迹地图" @click="changeZoom(.5)"><AtlasIcon name="plus"/></button><button class="icon-button" aria-label="缩小足迹地图" @click="changeZoom(-.5)"><AtlasIcon name="minus"/></button><button class="icon-button" aria-label="重置足迹地图" @click="fit()"><AtlasIcon name="locate"/></button></div>
    <p v-if="data" class="atlas-source"><a :href="data.sourceUrl" target="_blank" rel="noreferrer">{{ data.attribution }}</a><button class="atlas-overview-button" @click="fit(true)">查看全貌</button></p>
  </div>
</template>
