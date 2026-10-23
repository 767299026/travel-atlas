<script setup lang="ts">
import { onMounted, onBeforeUnmount, ref, nextTick } from 'vue';
import AtlasIcon from './AtlasIcon.vue';
defineProps<{ title: string; busy?: boolean; placement?: 'top' }>(); const emit = defineEmits<{ close: [] }>();
const panel = ref<HTMLDialogElement>(); const oldFocus = document.activeElement as HTMLElement | null;
onMounted(async () => { panel.value?.showModal(); await nextTick(); ((panel.value?.querySelector('[autofocus]') || panel.value?.querySelector('input, textarea, select, button')) as HTMLElement | null)?.focus(); });
onBeforeUnmount(() => { panel.value?.close(); oldFocus?.focus(); });
const backdrop = (event: MouseEvent) => { if (event.target === panel.value) emit('close'); };
</script>
<template><dialog ref="panel" class="atlas-dialog" :class="{ 'atlas-dialog-top': placement === 'top' }" aria-modal="true" :aria-label="title" @keydown.esc.prevent.stop="!busy && emit('close')" @cancel.prevent="!busy && emit('close')" @click="!busy && backdrop($event)"><section class="panel"><div class="panel-top"><h2>{{ title }}</h2><button class="icon-button" aria-label="关闭弹窗" :disabled="busy" @click="emit('close')"><AtlasIcon name="close"/></button></div><div class="panel-scroll"><slot/></div><div v-if="$slots.footer" class="modal-footer"><slot name="footer"/></div></section></dialog></template>
