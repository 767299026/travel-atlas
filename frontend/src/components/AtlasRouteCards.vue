<script setup lang="ts">
import { computed, watch, nextTick } from 'vue';
import { geometrySourceLabels, modeLabels, type AtlasCityLayer } from '../../../packages/contracts/src/index.js';
import { routeThumbnail } from '../maps/routeThumbnail';
const props = defineProps<{ paths: AtlasCityLayer['paths']; selected: string }>();
defineEmits<{ select: [id: string] }>();
const cards = computed(() => props.paths.map(path => ({ ...path, preview: routeThumbnail(path.geometry) })));
watch(() => props.selected, async id => { if (!id) return; await nextTick(); document.getElementById('atlas-path-' + id)?.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' }); });
</script>
<template>
  <div class="atlas-route-cards" aria-label="已存路径卡片">
    <article v-for="path in cards" :id="'atlas-path-' + path.id" :key="path.id" class="atlas-route-card" :class="{ selected: selected === path.id }">
      <button class="atlas-route-select" :aria-label="'查看路径：' + path.fromLabel + ' → ' + path.toLabel" :aria-pressed="selected === path.id" @click="$emit('select', path.id)">
        <span class="atlas-route-preview"><svg viewBox="0 0 240 100" aria-hidden="true"><path v-for="(d, i) in path.preview" :key="i" :d="d"/><circle v-if="path.preview.length" :cx="Number(path.preview[0]!.split(/[ ,]/)[1])" :cy="Number(path.preview[0]!.split(/[ ,]/)[2])" r="3"/></svg><small>{{ modeLabels[path.mode] || '交通方式待补充' }}</small><strong>{{ path.lengthM >= 1000 ? (path.lengthM / 1000).toFixed(1) + ' km' : Math.round(path.lengthM) + ' m' }}</strong></span>
        <span class="atlas-route-card-body"><strong>{{ path.fromLabel }} → {{ path.toLabel }}</strong><small>{{ path.visitedOn }} · {{ geometrySourceLabels[path.sourceKind] }}</small><small class="muted">{{ path.title }}</small></span>
      </button>
      <RouterLink class="atlas-route-open" :to="'/journeys/' + path.journeyId + '/actual'">打开行程与图文<span aria-hidden="true"> →</span></RouterLink>
    </article>
  </div>
</template>
