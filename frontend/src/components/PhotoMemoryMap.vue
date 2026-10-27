<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import type { AtlasCity, AtlasPlace, PhotoMemory } from '../../../packages/contracts/src/index.js';
import AtlasMap from './AtlasMap.vue';
import PhotoCityMap from './PhotoCityMap.vue';
import AtlasIcon from './AtlasIcon.vue';
import { photoPlaceName } from '../photos';
const props = defineProps<{ photos: PhotoMemory[]; focus?: PhotoMemory | null }>();
const emit = defineEmits<{ open: [photos: PhotoMemory[]] }>();
const scope = ref('100000'), city = ref<AtlasPlace | null>(null), selectedKey = ref<string | null>(null), selectedIds = ref<string[]>([]);
const located = computed(() => props.photos.filter(p => p.place?.position));
const cities = computed(() => {
  const groups = new Map<string, { place: AtlasPlace; photos: PhotoMemory[] }>();
  for (const photo of located.value) {
    const position = photo.place!.position!, place = photo.city || { key: 'photo:' + (photo.place!.cityName || photo.mediaId), countryCode: 'CHN', countryName: '中国', provinceCode: null, provinceName: null, cityCode: null, cityName: photo.place!.cityName || null, name: photo.place!.cityName || '拍摄位置', center: position.crs === 'WGS84' ? [position.longitude, position.latitude] as [number, number] : null };
    if (!groups.has(place.key)) groups.set(place.key, { place, photos: [] }); groups.get(place.key)!.photos.push(photo);
  }
  return [...groups.values()];
});
const places = computed<AtlasCity[]>(() => cities.value.map(c => ({ place: c.place, records: c.photos.length, journeys: 0, firstRecordedOn: null, lastVisitedOn: null, wished: false, diaries: 0, photos: c.photos.length, cover: null })));
const unassigned = computed(() => cities.value.filter(c => !c.place.center));
const cityPhotos = computed(() => city.value ? (cities.value.find(c => c.place.key === city.value!.key)?.photos || located.value.filter(p => p.place?.cityName === city.value!.cityName)) : []);
const selected = computed(() => city.value ? cityPhotos.value.filter(p => selectedIds.value.includes(p.mediaId)) : cities.value.find(c => c.place.key === selectedKey.value)?.photos || []);
function clear() { selectedIds.value = []; selectedKey.value = null; }
function enter() { const value = cities.value.find(c => c.place.key === selectedKey.value); if (value) { city.value = value.place; selectedIds.value = []; } }
function region(code: string) {
  const value = cities.value.find(c => c.place.cityCode === code);
  if (value) { city.value = value.place; clear(); } else if (/^\d{6}$/.test(code)) { scope.value = code; clear(); }
}
watch(() => props.photos, clear);
watch(() => props.focus, photo => {
  if (!photo?.place?.position) return; const value = cities.value.find(c => c.photos.some(p => p.mediaId === photo.mediaId));
  if (value) { city.value = value.place; selectedIds.value = [photo.mediaId]; }
}, { immediate: true });
</script>
<template><div class="photo-memory-map"><div class="photo-map-workspace"><PhotoCityMap v-if="city" :key="city.key" :photos="cityPhotos" :selected="selectedIds" @select="selectedIds = $event" @back="city = null; clear()"/><AtlasMap v-else :scope="scope" :places="places" :selected="selectedKey" photo-mode @place="selectedKey = $event" @region="region" @zoom-scope="code => region(code === 'world' ? '100000' : code)"/><div class="photo-map-title"><button v-if="city || scope !== '100000'" class="memory-text-button" @click="city = null; scope = '100000'; clear()"><AtlasIcon name="back"/>全部地点</button><small>PHOTOS, PLACED</small><h3>{{ city ? city.name.replace(/市$/, '') + ' · 2D' : '照片里的中国' }}</h3></div></div><section v-if="selected.length" class="memory-map-selection"><div class="memory-map-selection-head"><img :src="selected[0]!.media.thumbnailUrl" alt="这个地点的照片"><div class="od-field"><h4>{{ city ? photoPlaceName(selected[0]!.place) : cities.find(c => c.place.key === selectedKey)?.place.name }}</h4><small>{{ selected.length }} 张照片</small></div><button class="memory-text-button" aria-label="关闭照片组摘要" @click="clear"><AtlasIcon name="close"/></button></div><div class="memory-map-summary-actions"><button v-if="!city" class="memory-secondary" @click="enter">进入城市</button><button v-else class="memory-secondary" @click="clear">继续看地图</button><button class="memory-primary" @click="emit('open', selected)">翻看这组照片</button></div></section><div v-else class="memory-map-idle">{{ located.length ? '轻点一个地点，翻回那里的相片。' : '为照片补充拍摄地点，在这里重温。' }}<button v-if="unassigned.length" class="memory-text-button" @click="city = unassigned[0]!.place; clear()">查看待补充城市的拍摄位置</button></div></div></template>
