<script setup lang="ts">
import { onMounted, onBeforeUnmount, ref, watch } from 'vue';
import type { Location, Position, RouteStop } from '../../../packages/contracts/src/index.js';
import { displayConverter, loadAMap } from '../maps/amap';
import { errorText } from '../api';
import MapTools from './MapTools.vue';
const props = defineProps<{ points: RouteStop[]; selected?: string | null; pending?: boolean; refine?: boolean; city?: string }>();
const emit = defineEmits<{ select: [id: string]; pick: [location: Location] }>();
const surface = ref<HTMLElement>(), error = ref(''), busy = ref(true); let sdk: any, map: any, overlays: any[] = [], generation = 0, disposed = false, convert: ReturnType<typeof displayConverter>, observer: ResizeObserver | undefined, readyTimer: ReturnType<typeof setTimeout> | undefined, readyDone: (()=>void) | undefined;
let positions: { id: string; position: Position }[] = [];
function fit(immediately = false) { if (map && positions.length) map.setFitView(overlays.slice(0,positions.length), immediately, [55, 55, 55, 55], props.refine ? 17 : 16); }
async function draw(fitView = false) {
  if (!map) return; const current = ++generation; busy.value = true; error.value = '';
  try {
    const next: typeof positions = [];
    for (const crs of ['GCJ02','WGS84','BD09']) { const points = props.points.filter(p => p.location?.crs === crs), values = await convert(points.map(p => [p.location!.longitude,p.location!.latitude]), crs); points.forEach((p,i) => next.push({ id: p.id, position: values[i]! })); }
    if (current !== generation || disposed) return; positions = next; if (overlays.length) map.remove(overlays); overlays = [];
    for (const p of positions) { const index = props.points.findIndex(s => s.id === p.id), button = document.createElement('button'); button.type = 'button'; button.className = 'journey-map-pin' + (props.selected === p.id ? ' selected' : ''); button.textContent = String(index + 1); button.setAttribute('aria-label', props.points[index]!.label); button.onclick = () => { if (!disposed && current === generation) emit('select', p.id); }; overlays.push(new sdk.Marker({ position:p.position, content:button, anchor:'center', zIndex:150 })); }
    // This straight line describes ordering only, not a routed or recorded track.
    if (!props.pending && !props.refine) for (let i=1;i<props.points.length;i++) { const a=positions.find(p=>p.id===props.points[i-1]!.id), b=positions.find(p=>p.id===props.points[i]!.id); if(a&&b) overlays.push(new sdk.Polyline({path:[a.position,b.position],strokeColor:'#557b70',strokeWeight:2,strokeStyle:'dashed',zIndex:80})); }
    map.add(overlays); if (fitView) { fit(true); if (!positions.length && props.city) map.setCity(props.city); }
  } catch(e) { if(current===generation) error.value=errorText(e); } finally { if(current===generation) busy.value=false; }
}
async function load() {
  try { sdk=await loadAMap();if(disposed)return;convert=displayConverter(sdk);map=new sdk.Map(surface.value,{center:[104,35],zoom:4,viewMode:'2D',resizeEnable:true,scrollWheel:true,features:['bg','road','point','building'],mapStyle:'amap://styles/whitesmoke'});await new Promise<void>(resolve=>{readyDone=()=>{clearTimeout(readyTimer);resolve()};map.on('complete',readyDone);readyTimer=setTimeout(readyDone,12000)});if(disposed)return;await draw(true);
    if(props.refine) map.on('moveend',()=>{const p=map.getCenter();emit('pick',{longitude:p.getLng(),latitude:p.getLat(),crs:'GCJ02',source:'amap_pick'})});
    observer=new ResizeObserver(()=>map?.resize?.());if(surface.value)observer.observe(surface.value);
  }catch(e){error.value=errorText(e);busy.value=false;}
}
watch(()=>JSON.stringify(props.points.map(p=>[p.id,p.location])),()=>void draw(true));watch(()=>props.selected,()=>void draw());
onMounted(load);onBeforeUnmount(()=>{disposed=true;readyDone?.();generation++;observer?.disconnect();const previous=map;map=undefined;if(previous)setTimeout(()=>previous.destroy(),120)});
</script>
<template><div class="journey-map" :aria-busy="busy"><div ref="surface" class="journey-map-surface" aria-label="旅程地点高德二维地图"></div><span v-if="refine" class="journey-map-center" aria-hidden="true">＋</span><MapTools city @zoom-in="map?.setZoom(map.getZoom()+1)" @zoom-out="map?.setZoom(map.getZoom()-1)" @reset="fit()"/><p v-if="busy" class="journey-map-message" role="status">正在展开地图…</p><p v-if="error" class="journey-map-message" role="alert">{{ error }}<button class="text-button" @click="map ? draw(true) : load()">重试</button></p><small v-if="!refine" class="journey-map-credit">{{ pending ? '地点分布' : '顺序示意 · 非导航路线' }}</small></div></template>
