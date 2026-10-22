<script setup lang="ts">
import { computed, onMounted, onBeforeUnmount, ref } from 'vue';
import { useRoute } from 'vue-router';
import type { ShareSnapshot } from '../../../packages/contracts/src/index.js';
import SharedContent from '../components/SharedContent.vue';
import '../styles/shares.css';
const route = useRoute(), snapshot = ref<ShareSnapshot | null>(null), loading = ref(true), error = ref('');
const access = computed(() => ({ id: String(route.params.id), credential: route.hash.slice(1) }));
let disposed = false; const controller = new AbortController(); let robots: HTMLMetaElement | undefined, previousTitle = '';
async function load() {
  loading.value = true; snapshot.value = null; error.value = '';
  try {
    if (!/^[A-Za-z0-9_-]{43}$/.test(access.value.credential)) throw new Error('链接不完整或已失效，请向分享者获取完整链接。');
    const response = await fetch('/api/v1/public/shares/' + encodeURIComponent(access.value.id), { credentials: 'omit', headers: { Authorization: 'Bearer ' + access.value.credential }, cache: 'no-store', signal: controller.signal });
    if (!response.ok) throw new Error(response.status === 404 ? '分享链接不存在或已失效，请向分享者获取新链接。' : '分享暂时无法打开，请稍后重试。');
    const result = await response.json(); if (!disposed) { snapshot.value = result.data; document.title = snapshot.value!.title + ' · 迹屿'; }
  } catch (e) { if (!disposed) error.value = e instanceof Error ? e.message : '分享暂时无法打开。'; } finally { if (!disposed) loading.value = false; }
}
onMounted(() => { previousTitle = document.title; robots = document.createElement('meta'); robots.name = 'robots'; robots.content = 'noindex,nofollow,nosnippet'; document.head.append(robots); void load(); });
onBeforeUnmount(() => { disposed = true; controller.abort(); robots?.remove(); document.title = previousTitle; });
</script>
<template><main class="public-share"><p v-if="loading" role="status">正在打开分享的旅程…</p><section v-else-if="error" class="shared-unavailable"><h1>暂时无法打开这份分享</h1><p role="alert">{{ error }}</p><button class="secondary-button" @click="load">重新打开</button></section><template v-else-if="snapshot"><SharedContent :snapshot="snapshot" :access="access"/><footer class="shared-footer"><p>由分享者选择内容提供，持链接可见。</p><button class="text-button" @click="load">刷新分享内容</button></footer></template></main></template>
