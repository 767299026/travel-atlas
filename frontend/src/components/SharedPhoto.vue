<script setup lang="ts">
import { onMounted, onBeforeUnmount, ref } from 'vue';
const props = defineProps<{ shareId: string; credential: string; photoKey: string; caption: string }>();
const host = ref<HTMLElement>(), source = ref(''), error = ref(false), loading = ref(false); let observer: IntersectionObserver | undefined, disposed = false;
const controller = new AbortController();
async function load() {
  if (loading.value || source.value || disposed) return; loading.value = true; error.value = false;
  try {
    const response = await fetch(`/api/v1/public/shares/${encodeURIComponent(props.shareId)}/photos/${encodeURIComponent(props.photoKey)}`, { headers: { Authorization: 'Bearer ' + props.credential }, credentials: 'omit', cache: 'no-store', signal: controller.signal });
    if (!response.ok || response.headers.get('content-type')?.split(';')[0] !== 'image/webp') throw new Error();
    const blob = await response.blob(); if (!disposed) source.value = URL.createObjectURL(blob);
  } catch { if (!disposed) error.value = true; } finally { loading.value = false; }
}
onMounted(() => { observer = new IntersectionObserver(entries => { if (entries.some(e => e.isIntersecting)) { observer?.disconnect(); void load(); } }, { rootMargin: '150px' }); observer.observe(host.value!); });
onBeforeUnmount(() => { disposed = true; observer?.disconnect(); controller.abort(); if (source.value) URL.revokeObjectURL(source.value); });
</script>
<template><div ref="host" class="shared-photo"><img v-if="source" :src="source" :alt="caption || '分享的旅途照片'" decoding="async"><p v-else-if="error" class="muted">照片暂不可用或已移除。<button class="text-button" @click="load">重试照片</button></p><p v-else class="muted">{{ loading ? '正在加载照片…' : '旅途照片' }}</p></div></template>
