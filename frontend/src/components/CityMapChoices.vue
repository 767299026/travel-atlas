<script setup lang="ts">
import { onMounted, ref } from 'vue';
import AtlasIcon from './AtlasIcon.vue';
defineProps<{ kind: 'records' | 'journeys'; rows: { id: string; label: string; date: string; context: string }[] }>();
defineEmits<{ select: [id: string]; close: [] }>();
const heading = ref<HTMLElement>();
onMounted(() => heading.value?.focus({ preventScroll: true }));
</script>
<template>
  <section class="city-map-choices" :aria-label="kind === 'records' ? '选择到访记录' : '选择经过的旅程'" @keydown.esc.stop.prevent="$emit('close')" @wheel.stop>
    <header><h3 ref="heading" tabindex="-1">这里有 {{ rows.length }} {{ kind === 'records' ? '条到访记录' : '段旅程' }}</h3><button class="icon-button" aria-label="关闭候选列表" @click="$emit('close')"><AtlasIcon name="close" :size="18"/></button></header>
    <div class="city-choice-list"><button v-for="row in rows" :key="row.id" class="city-map-choice" :data-choice-id="row.id" @click="$emit('select', row.id)"><span><strong>{{ row.label }}</strong><small>{{ row.date || '日期待补充' }}<template v-if="row.context"> · {{ row.context }}</template></small></span><AtlasIcon name="chevronRight" :size="16"/></button></div>
  </section>
</template>
