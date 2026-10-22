<script setup lang="ts">
import { onMounted, ref, computed } from 'vue';
import { useRouter } from 'vue-router';
import { api, errorText } from '../api';
import type { JourneyList, JourneySummary } from '../../../packages/contracts/src/index.js';
import AtlasIcon from '../components/AtlasIcon.vue';
const router = useRouter(), items = ref<JourneySummary[]>([]), cursor = ref<string | null>(null), loading = ref(false), error = ref(''), filter = ref('planning');
const visible = computed(() => items.value.filter(x => x.status === filter.value));
async function load(more = false) { loading.value = true; error.value = ''; try { const page = await api<JourneyList>('/journeys' + (more && cursor.value ? '?cursor=' + encodeURIComponent(cursor.value) : '')); items.value = more ? [...items.value, ...page.items] : page.items; cursor.value = page.nextCursor; } catch (e) { error.value = errorText(e); } finally { loading.value = false; } }
onMounted(() => load());
</script>
<!-- Structure and wording adapted from OpenDesign tripsPage()/journeyCard(). -->
<template><section class="flow-view"><div class="flow-scroll"><header class="flow-header"><p class="eyebrow">A JOURNEY OF YOUR OWN</p><div class="flow-title-row"><h2>下一程，去哪里</h2><button class="icon-button" aria-label="新建旅程" @click="router.push('/journeys/new')"><AtlasIcon name="plus"/></button></div><p>先把向往，安排进日历。</p></header><div class="flow-tabs inline-tabs" role="group" aria-label="旅程状态"><button v-for="tab in [['planning','计划中'],['completed','已完成'],['archived','已归档']]" :key="tab[0]" :aria-pressed="filter === tab[0]" @click="filter = tab[0]!">{{ tab[1] }}</button></div>
  <p class="flow-count-caption">完成一段计划后，再慢慢整理回忆。</p><p v-if="error" class="flow-form-errors" role="alert">{{ error }}<button class="text-button" @click="load()">重新加载</button></p><p v-if="loading && !items.length" class="muted">正在读取旅程…</p>
  <div v-else-if="!visible.length && !error" class="flow-empty"><div class="empty-drawing"><AtlasIcon name="compass" :size="42"/></div><h3>{{ filter === 'planning' ? '下一程，还没有安排' : '这里还没有旅程' }}</h3><p>从一个想去的地方开始，慢慢补齐沿途的安排。</p><button v-if="filter === 'planning'" class="primary" @click="router.push('/journeys/new')">创建第一个行程<AtlasIcon name="arrow"/></button></div>
  <div class="journey-grid"><article v-for="journey in visible" :key="journey.id" class="flow-card"><button class="flow-card-main" @click="router.push('/journeys/' + journey.id)"><div class="flow-no-cover"><AtlasIcon name="route" :size="36"/><span class="flow-caption">{{ journey.destinations.join(' · ') || '目的地待定' }}</span></div><span class="flow-card-body"><span class="flow-card-date">{{ journey.dayCount }} 天 · {{ new Date(journey.updatedAt).toLocaleDateString('zh-CN') }} 更新</span><h3>{{ journey.title }}</h3><p>{{ journey.destinations.join(' / ') || '目的地待补充' }}</p><span class="flow-card-bottom"><span>打开行程</span><AtlasIcon name="arrow"/></span></span></button></article></div>
  <button v-if="cursor" class="secondary-button full" :disabled="loading" @click="load(true)">{{ loading ? '正在读取…' : '加载更多旅程' }}</button>
</div><footer class="flow-bottom"><button class="primary" @click="router.push('/journeys/new')"><AtlasIcon name="plus"/>新建旅程</button></footer></section></template>
