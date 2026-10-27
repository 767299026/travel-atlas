<script setup lang="ts">
import { onMounted, onBeforeUnmount, ref } from 'vue';
import type { Location } from '../../../packages/contracts/src/index.js';
import { loadAMap, displayConverter } from '../maps/amap';
import { errorText } from '../api';
const props = defineProps<{ city: string; initial: Location | null }>();
const emit = defineEmits<{ pick: [position: Location] }>();
const container = ref<HTMLElement>(), error = ref(''), loading = ref(true); let map: any, marker: any, disposed = false;
async function load() {
  loading.value = true; error.value = '';
  try {
    const sdk = await loadAMap(); if (disposed) return;
    map = new sdk.Map(container.value, { zoom: 11, center: [114.3, 30.58], viewMode: '2D', resizeEnable: true });
    if (props.initial) { const p = (await displayConverter(sdk)([[props.initial.longitude, props.initial.latitude]], props.initial.crs))[0]!; if (disposed) return; map.setZoomAndCenter(15, p, true); marker = new sdk.Marker({ position: p }); map.add([marker]); }
    else if (props.city) map.setCity(props.city);
    map.on('click', (e: any) => { if (disposed) return; const p: [number, number] = Array.isArray(e.lnglat) ? e.lnglat : [e.lnglat.getLng(), e.lnglat.getLat()]; if (!p.every(Number.isFinite)) return; if (marker) map.remove([marker]); marker = new sdk.Marker({ position: p }); map.add([marker]); emit('pick', { longitude: p[0], latitude: p[1], crs: 'GCJ02', source: 'amap_pick' }); });
  } catch (e) { if (!disposed) error.value = errorText(e); } finally { if (!disposed) loading.value = false; }
}
onMounted(load); onBeforeUnmount(() => { disposed = true; const previous = map; map = undefined; if (previous) setTimeout(() => previous.destroy(), 120); });
</script>
<template><div class="photo-point-picker"><div ref="container" aria-label="选择照片拍摄地点的地图"></div><p v-if="loading" role="status">正在打开拍摄地点地图…</p><p v-if="error" class="memory-error">{{ error }}<button class="text-button" @click="load">重试</button></p></div></template>
