<script setup lang="ts">
import type { CityJourneyMemory } from '../maps/cityJourneys';
import AtlasIcon from './AtlasIcon.vue';
defineProps<{ journeys: CityJourneyMemory[]; selected: string }>();
defineEmits<{ select: [id: string] }>();
</script>
<template>
  <div class="city-journey-cards" aria-label="城市旅程回忆">
    <button v-for="journey in journeys" :key="journey.id" :data-journey-id="journey.id" class="city-journey-card" :class="{ selected: selected === journey.id }" :aria-label="'查看旅程：' + journey.title" :aria-pressed="selected === journey.id" @click="$emit('select', journey.id)">
      <span class="city-journey-sketch"><svg v-if="journey.preview.length" viewBox="0 0 240 100" aria-hidden="true"><path v-for="(path, i) in journey.preview" :key="i" :d="path"/></svg><AtlasIcon v-else name="book" :size="24"/></span>
      <span class="city-journey-copy"><strong>{{ journey.title }}</strong><small>{{ journey.lastDate || '日期待补充' }}<template v-if="journey.firstDate && journey.firstDate !== journey.lastDate"> · 多日</template></small><small>{{ journey.source }}<template v-if="journey.paths.length"> · 已存约 {{ (journey.lengthM / 1000).toFixed(1) }} km</template><template v-if="journey.partialPreview"> · 部分缩略</template></small></span>
      <AtlasIcon name="chevronRight" :size="16"/>
    </button>
  </div>
</template>
