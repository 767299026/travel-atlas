<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { api, errorText, session, ApiError } from './api';
import type { SessionData } from '../../packages/contracts/src/index.js';
import AtlasIcon from './components/AtlasIcon.vue';
const route = useRoute(), router = useRouter(); const loading = ref(true), busy = ref(false), username = ref(''), password = ref(''), error = ref('');
async function check() { loading.value = true; error.value = ''; try { session.value = await api<SessionData>('/auth/session'); } catch (e) { if (!(e instanceof ApiError && e.status === 401)) error.value = errorText(e); } finally { loading.value = false; } }
const publicPage = computed(() => route.meta.public === true);
watch(publicPage, value => { if (value) loading.value = false; else void check(); }, { immediate: true });
async function login() { busy.value = true; error.value = ''; try { session.value = await api<SessionData>('/auth/login', 'POST', { username: username.value, password: password.value }); password.value = ''; } catch (e) { error.value = errorText(e); } finally { busy.value = false; } }
</script>
<template><RouterView v-if="publicPage" :key="route.fullPath"/><div v-else class="atlas web-atlas" :class="{ 'map-page': route.path === '/map', 'flow-compact': session && (route.params.id || route.meta.compact || route.path.startsWith('/diaries/')) }">
  <header class="app-header"><div class="brand-row od-row"><RouterLink to="/map" class="brand" aria-label="迹屿首页"><svg class="brand-symbol" viewBox="0 0 30 36" aria-hidden="true"><path d="M3 29 11 8l6 12 5-8 6 17Z" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M3 33h24" stroke="currentColor"/><circle cx="23" cy="5" r="3" fill="#DB8062"/></svg><div><div class="brand-name"><h1>迹屿</h1><em>Travel Atlas</em></div><p class="tagline">把向往，慢慢走成回忆</p></div></RouterLink><span class="private-label"><AtlasIcon name="lock" :size="14"/>私人旅行簿</span></div></header>
  <main v-if="loading" class="login-page" aria-live="polite"><p>正在打开旅行簿…</p></main>
  <main v-else-if="!session" class="login-page"><div class="login-card"><p class="eyebrow">YOUR NEXT CHAPTER</p><h2>旅程，从这里开始</h2><p class="muted">登录，继续安排下一次出发。</p><form class="flow-form" @submit.prevent="login"><div class="flow-field"><label for="username">账号</label><input id="username" v-model="username" autocomplete="username" required maxlength="64"></div><div class="flow-field"><label for="password">密码</label><input id="password" v-model="password" type="password" autocomplete="current-password" required maxlength="128"></div><p v-if="error" class="flow-form-errors" role="alert">{{ error }}</p><button class="primary" :disabled="busy">{{ busy ? '正在登录…' : '打开我的旅行簿' }}<AtlasIcon name="arrow"/></button></form></div></main>
  <main v-else class="app-content"><RouterView :key="route.fullPath + session.user.id"/></main>
  <nav v-if="session" class="bottom-nav" aria-label="主导航"><button :aria-current="route.path === '/map' ? 'page' : undefined" @click="router.push('/map')"><AtlasIcon name="map"/>地图</button><button :aria-current="route.path.startsWith('/journeys') ? 'page' : undefined" @click="router.push('/journeys')"><AtlasIcon name="route"/>旅程</button><button :aria-current="route.path === '/memories' || route.path.startsWith('/diaries') ? 'page' : undefined" @click="router.push('/memories')"><AtlasIcon name="book"/>回忆</button><button :aria-current="route.path === '/me' ? 'page' : undefined" @click="router.push('/me')"><AtlasIcon name="user"/>我的</button></nav>
</div></template>
