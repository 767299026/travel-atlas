<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, useId } from 'vue';
import AtlasIcon from './AtlasIcon.vue';
const props = defineProps<{ city?: boolean; disabled?: boolean; zoomInDisabled?: boolean; zoomOutDisabled?: boolean }>();
const emit = defineEmits<{ zoomIn: []; zoomOut: []; reset: []; toggle: [open: boolean] }>();
const root = ref<HTMLElement>(), trigger = ref<HTMLButtonElement>(), open = ref(false), id = useId();
const labels = computed(() => props.city ? ['放大城市地图', '缩小城市地图', '查看全部城市足迹'] : ['放大足迹地图', '缩小足迹地图', '重置足迹地图']);
function setOpen(value: boolean) { open.value = value; emit('toggle', value); }
function outside(event: PointerEvent) { if (open.value && !root.value?.contains(event.target as Node)) setOpen(false); }
function escape(event: KeyboardEvent) { if (event.key === 'Escape' && open.value) { event.preventDefault(); setOpen(false); trigger.value?.focus(); } }
onMounted(() => { document.addEventListener('pointerdown', outside); document.addEventListener('keydown', escape); });
onBeforeUnmount(() => { document.removeEventListener('pointerdown', outside); document.removeEventListener('keydown', escape); });
</script>
<template>
  <div ref="root" class="atlas-map-tools" :class="{ 'is-open': open }" role="group" aria-label="地图工具" @wheel.stop.prevent>
    <button ref="trigger" class="icon-button atlas-tools-toggle" :aria-label="open ? '收起地图工具' : '展开地图工具'" :aria-expanded="open" :aria-controls="id" @click="setOpen(!open)"><AtlasIcon name="chevronDown"/></button>
    <div :id="id" class="atlas-map-tool-actions" :aria-hidden="!open" :inert="!open">
      <div class="atlas-map-tool-items">
        <button class="icon-button" :aria-label="labels[0]" :disabled="disabled || zoomInDisabled" @click="emit('zoomIn')"><AtlasIcon name="plus"/></button>
        <button class="icon-button" :aria-label="labels[1]" :disabled="disabled || zoomOutDisabled" @click="emit('zoomOut')"><AtlasIcon name="minus"/></button>
        <button class="icon-button" :aria-label="labels[2]" :disabled="disabled" @click="emit('reset')"><AtlasIcon name="locate"/></button>
      </div>
    </div>
  </div>
</template>
