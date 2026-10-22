<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { api, errorText } from '../api';
import type { AtlasCity, AtlasMap, AtlasGeometry } from '../../../packages/contracts/src/index.js';
import AtlasIcon from './AtlasIcon.vue';
const props = defineProps<{ scope: string; places: AtlasCity[]; selected: string | null }>();
const emit = defineEmits<{ region: [code: string]; place: [key: string] }>();
const canvas = ref<HTMLElement>(), svg = ref<SVGSVGElement>(), units = ref(1), data = ref<AtlasMap | null>(null), loading = ref(false), error = ref(''), zoom = ref(1), pan = ref([0, 0]);
let dragged = false, generation = 0, observer: ResizeObserver | undefined;
let start: { x: number; y: number; pan: number[] } | null = null;
function rings(geometry: AtlasGeometry['geometry']): number[][][] { const c = geometry.coordinates as any; return geometry.type === 'Polygon' || geometry.type === 'MultiLineString' ? c : geometry.type === 'MultiPolygon' ? c.flat() : geometry.type === 'LineString' ? [c] : []; }
const features = computed(() => data.value?.features ?? []);
const project = computed(() => {
  let bounds = [-180, -58, 180, 85]; const ratio = props.scope === 'world' ? 1 : .83;
  if (props.scope !== 'world' && features.value.length) { const points = features.value.flatMap(f => rings(f.geometry).flat()); bounds = [Infinity, Infinity, -Infinity, -Infinity]; for (const p of points) { bounds[0] = Math.min(bounds[0]!, p[0]!); bounds[1] = Math.min(bounds[1]!, p[1]!); bounds[2] = Math.max(bounds[2]!, p[0]!); bounds[3] = Math.max(bounds[3]!, p[1]!); } }
  const [x1, y1, x2, y2] = bounds as [number, number, number, number], scale = Math.min(740 / Math.max((x2 - x1) * ratio, .01), 420 / Math.max(y2 - y1, .01)) * zoom.value;
  return (p: number[]) => [(p[0]! - (x1 + x2) / 2) * ratio * scale + 400 + pan.value[0]!, ((y1 + y2) / 2 - p[1]!) * scale + 270 + pan.value[1]!];
});
const paths = computed(() => features.value.map(f => ({ ...f, path: rings(f.geometry).map(ring => ring.map((p, i) => { const xy = project.value(p); return `${i ? 'L' : 'M'}${xy[0]!.toFixed(2)},${xy[1]!.toFixed(2)}`; }).join('') + (f.geometry.type.includes('Polygon') ? 'Z' : '')).join('') })));
const pinFont = computed(() => Math.max(17, 12 * units.value));
const pins = computed(() => {
  const list = props.places.filter(p => p.place.center && (props.scope === '100000' ? p.place.countryCode === 'CHN' : props.scope === 'world' ? false : p.place.provinceCode === props.scope || p.place.cityCode === props.scope)).map(p => ({ ...p, point: project.value(p.place.center!) })).sort((a, b) => Number(b.place.key === props.selected) - Number(a.place.key === props.selected) || b.records - a.records);
  const boxes: number[][] = [], h = pinFont.value * 1.6, gap = pinFont.value * .65;
  return list.map(p => {
    const label = p.place.name.length > 8 ? p.place.name.slice(0, 8) + '…' : p.place.name, labelWidth = label.length * pinFont.value;
    let offset = [gap, 0], box = [0, 0, 0, 0], showLabel = false;
    for (const [dx, dy] of [[gap, 0], [-labelWidth - gap, 0], [gap, -h], [-labelWidth - gap, h], [gap, h * 2], [-labelWidth - gap, -h * 2]]) {
      const x = p.point[0]! + dx!, y = p.point[1]! + dy!, candidate = [x - 4, y - h / 2, x + labelWidth + 4, y + h / 2];
      if (candidate[0]! < 6 || candidate[2]! > 794 || candidate[1]! < 6 || candidate[3]! > 554 || boxes.some(b => candidate[0]! < b[2]! && candidate[2]! > b[0]! && candidate[1]! < b[3]! && candidate[3]! > b[1]!)) continue;
      offset = [dx!, dy!]; box = candidate; showLabel = true; boxes.push(candidate); break;
    }
    return { ...p, label, labelWidth, offset, box, showLabel };
  });
});
function lit(code: string) { return props.places.some(p => p.records > 0 && (props.scope === 'world' ? p.place.countryCode === code : props.scope === '100000' ? p.place.provinceCode === code : p.place.cityCode === code || p.place.provinceCode === p.place.cityCode && p.place.provinceCode === props.scope)); }
const fontSize = computed(() => Math.max(15, 11 * units.value));
const labels = computed(() => {
  const boxes: number[][] = [], result: { code: string; name: string; x: number; y: number; center: number[]; moved: boolean }[] = [], seen = new Set<string>();
  for (const f of [...features.value].sort((a, b) => Number(lit(b.code)) - Number(lit(a.code)))) {
    if (!f.code || !f.name || !f.center || seen.has(f.code)) continue; seen.add(f.code);
    const center = project.value(f.center), name = props.scope === '100000' ? f.name.replace(/壮族自治区|回族自治区|维吾尔自治区|特别行政区|自治区|省|市$/g, '') : f.name;
    const w = Math.min(name.length, 12) * fontSize.value, h = fontSize.value * 1.4;
    if (center[0]! < 10 || center[0]! > 790 || center[1]! < 20 || center[1]! > 540) continue;
    for (const [dx, dy] of [[0, 0], [0, -h], [0, h], [-w / 2, h], [w / 2, -h]]) {
      const x = Math.max(w / 2 + 8, Math.min(792 - w / 2, center[0]! + dx!)), y = center[1]! + dy!, box = [x - w / 2 - 4, y - h / 2, x + w / 2 + 4, y + h / 2];
      if (box[1]! < 10 || box[3]! > 550 || boxes.some(b => box[0]! < b[2]! && box[2]! > b[0]! && box[1]! < b[3]! && box[3]! > b[1]!)) continue;
      // Leave footprint labels unobscured; region labels reappear when zooming in.
      if (pins.value.some(p => p.showLabel && box[0]! < p.box[2]! && box[2]! > p.box[0]! && box[1]! < p.box[3]! && box[3]! > p.box[1]!)) continue;
      boxes.push(box); result.push({ code: f.code, name, x, y, center, moved: !!dx || !!dy }); break;
    }
  }
  return result;
});
function region(code: string, keyboard = false) { if ((!dragged || keyboard) && code) emit('region', code); }
function pick(key: string, keyboard = false) { if (!dragged || keyboard) emit('place', key); }
async function load() { const current = ++generation; loading.value = true; error.value = ''; data.value = null; reset(); try { const value = await api<AtlasMap>('/atlas/maps/' + props.scope); if (current === generation) data.value = value; } catch (e) { if (current === generation) error.value = errorText(e); } finally { if (current === generation) loading.value = false; } }
watch(() => props.scope, load, { immediate: true });
function local(x: number, y: number) { const matrix = svg.value?.getScreenCTM(); return matrix ? new DOMPoint(x, y).matrixTransform(matrix.inverse()) : new DOMPoint(400, 280); }
function pointerDown(e: PointerEvent) { if (e.button !== 0) return; dragged = false; const p = local(e.clientX, e.clientY); start = { x: p.x, y: p.y, pan: [...pan.value] }; }
function pointerMove(e: PointerEvent) { if (!start || !e.buttons) { start = null; return; } const p = local(e.clientX, e.clientY), x = p.x - start.x, y = p.y - start.y; if (Math.abs(x) + Math.abs(y) > 5 * units.value) { dragged = true; (e.currentTarget as Element).setPointerCapture(e.pointerId); } if (dragged) pan.value = [start.pan[0]! + x, start.pan[1]! + y]; }
function zoomAt(next: number, x = 400, y = 270) { next = Math.max(1, Math.min(8, next)); const factor = next / zoom.value; pan.value = [(pan.value[0]! - x + 400) * factor + x - 400, (pan.value[1]! - y + 270) * factor + y - 270]; zoom.value = next; }
function wheel(e: WheelEvent) { const p = local(e.clientX, e.clientY), delta = e.deltaY * (e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 560 : 1); zoomAt(zoom.value * Math.exp(-Math.max(-150, Math.min(150, delta)) * .003), p.x, p.y); }
function reset() { zoom.value = 1; pan.value = [0, 0]; }
onMounted(() => { observer = new ResizeObserver(() => { const r = canvas.value?.getBoundingClientRect(); if (r) units.value = 1 / Math.max(.1, Math.min(r.width / 800, r.height / 560)); }); if (canvas.value) observer.observe(canvas.value); });
onBeforeUnmount(() => { generation++; observer?.disconnect(); });
</script>
<template>
  <div ref="canvas" class="atlas-canvas" @wheel.prevent="wheel">
    <svg v-if="data" ref="svg" viewBox="0 0 800 560" role="group" aria-label="足迹地区地图" :data-zoom="zoom.toFixed(2)" @pointerdown="pointerDown" @pointermove="pointerMove" @pointerup="start = null" @pointercancel="start = null">
      <defs><pattern id="atlas-grid" width="56" height="56" patternUnits="userSpaceOnUse"><path d="M56 0H0V56" fill="none" stroke="#b7cbbd" stroke-width=".4" opacity=".4"/></pattern></defs><rect width="800" height="560" fill="url(#atlas-grid)"/>
      <path v-for="(f,index) in paths" :key="f.code + ':' + index" class="map-region" :class="{ visited: lit(f.code) }" :d="f.path" fill-rule="evenodd" :role="f.code ? 'button' : undefined" :tabindex="f.code ? 0 : undefined" :aria-label="f.name + (lit(f.code) ? '，已有足迹' : '，查看地区')" @click="region(f.code)" @keydown.enter.prevent="region(f.code, true)" @keydown.space.prevent="region(f.code, true)"><title>{{ f.name }}</title></path>
      <g class="atlas-region-labels" aria-hidden="true" pointer-events="none"><g v-for="label in labels" :key="label.code"><line v-if="label.moved" :x1="label.center[0]" :y1="label.center[1]" :x2="label.x" :y2="label.y"/><text :x="label.x" :y="label.y" :font-size="fontSize" text-anchor="middle" dominant-baseline="central">{{ label.name }}</text></g></g>
      <g v-for="pin in pins" :key="pin.place.key" class="pin" :class="{ wish: pin.records === 0 }" role="button" tabindex="0" :aria-label="pin.place.name + (pin.records ? '，已到访' : '，想去')" :transform="`translate(${pin.point[0]},${pin.point[1]})`" @click.stop="pick(pin.place.key)" @keydown.enter.prevent="pick(pin.place.key, true)" @keydown.space.prevent="pick(pin.place.key, true)">
        <title>{{ pin.place.name }} · {{ pin.records ? pin.records + ' 条到访' : '想去' }}</title><circle v-if="selected === pin.place.key" class="pin-halo" r="20"/>
        <path v-if="pin.showLabel && pin.offset[1]" :d="`M0,0L${pin.offset[0]},${pin.offset[1]}`" class="pin-leader"/>
        <rect v-if="pin.showLabel" class="hit" :x="pin.offset[0]! - 5" :y="pin.offset[1]! - pinFont * .8" :width="pin.labelWidth + 10" :height="pinFont * 1.6" rx="7"/>
        <circle class="pin-hit" r="16"/><circle class="pin-core" r="5"/>
        <text v-if="pin.showLabel" class="pin-label" :style="{ fontSize: pinFont + 'px' }" :x="pin.offset[0]" :y="pin.offset[1]" dominant-baseline="central">{{ pin.label }}</text>
      </g>
    </svg>
    <div v-if="loading || error" class="atlas-map-status"><p :role="error ? 'alert' : 'status'">{{ error || '正在展开足迹地图…' }}</p><button v-if="error" class="text-button" @click="load">重新加载底图</button></div>
    <div class="atlas-map-tools"><button class="icon-button" aria-label="放大足迹地图" :disabled="zoom >= 8" @click="zoomAt(zoom * 1.4)"><AtlasIcon name="plus"/></button><button class="icon-button" aria-label="缩小足迹地图" :disabled="zoom <= 1" @click="zoomAt(zoom / 1.4)"><AtlasIcon name="minus"/></button><button class="icon-button" aria-label="重置足迹地图" @click="reset"><AtlasIcon name="locate"/></button></div>
    <p v-if="data" class="atlas-source"><a :href="data.sourceUrl" target="_blank" rel="noreferrer">{{ data.attribution }}</a><br>滚轮缩放 · 拖动查看 · 放大显示更多区域名称</p>
  </div>
</template>
