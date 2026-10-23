<script setup lang="ts">
import { ref } from 'vue';
import type { AtlasCity } from '../../../packages/contracts/src/index.js';
import AtlasIcon from './AtlasIcon.vue';
defineProps<{ places: AtlasCity[]; selected: string | null }>();
defineEmits<{ select: [place: AtlasCity] }>();
const failedCovers = ref(new Set<string>());
</script>
<template>
  <div class="atlas-city-cards">
    <button v-for="city in places" :key="city.place.key" class="atlas-city-card" :class="{ selected: selected === city.place.key, wish: !city.records }" :aria-label="'查看' + city.place.name + '足迹'" @click="$emit('select', city)">
      <span class="atlas-city-card-image" :class="{ 'has-cover': !!city.cover }">
        <img v-if="city.cover && !failedCovers.has(city.cover.url)" :src="city.cover.url" :alt="city.cover.title + '的旅程封面'" loading="lazy" @error="failedCovers.add(city.cover.url)">
        <AtlasIcon v-else :name="city.records ? 'pin' : 'heart'" :size="30"/>
        <small v-if="city.cover" class="atlas-cover-kind">{{ failedCovers.has(city.cover.url) ? '照片暂时不可用' : '相关旅程封面' }}</small><small v-else class="atlas-cover-kind">{{ city.records ? '等你补上照片' : '留给下一次出发' }}</small>
      </span>
      <span class="atlas-city-card-body"><strong>{{ city.place.name }}</strong><small>{{ city.records ? (city.lastVisitedOn ? '最近记录 ' + city.lastVisitedOn : '日期待补充') : '想去的地方' }}</small><small v-if="city.firstRecordedOn && city.firstRecordedOn !== city.lastVisitedOn">最早记录 {{ city.firstRecordedOn }}</small><span class="atlas-city-card-counts">{{ city.records ? city.records + ' 条到访' : '城市心愿' }}<template v-if="city.journeys"> · {{ city.journeys }} 段旅程</template></span><small v-if="city.diaries" class="atlas-card-memories">相关旅程 · {{ city.diaries }} 篇日记<span v-if="city.photos"> · {{ city.photos }} 张照片</span></small></span>
    </button>
  </div>
</template>
