<script setup lang="ts">
import { ref, reactive } from 'vue';
import { useRouter, onBeforeRouteLeave } from 'vue-router';
import { api, errorText, mutationId } from '../api';
import { parseDestinations, type JourneySummary } from '../../../packages/contracts/src/index.js';
import AtlasIcon from '../components/AtlasIcon.vue';
const router = useRouter(), busy = ref(false), error = ref(''), saved = ref(false);
const form = reactive({ title: '', origin: '', destinations: '', startDate: '', duration: 3 });
let requestKey = mutationId(), previousPayload = '';
async function create() { if (busy.value) return; busy.value = true; error.value = ''; const fields = { ...form, destinations: parseDestinations(form.destinations), startDate: form.startDate || null };
  const signature = JSON.stringify(fields); if (previousPayload && signature !== previousPayload) requestKey = mutationId(); previousPayload = signature;
  try { const result = await api<{ journey: JourneySummary }>('/journeys', 'POST', { ...fields, clientMutationId: requestKey }); saved.value = true; await router.replace('/journeys/' + result.journey.id); } catch (e) { error.value = errorText(e); } finally { busy.value = false; } }
onBeforeRouteLeave(() => saved.value || !(form.title || form.origin || form.destinations) || window.confirm('这次新建行程尚未保存，确定离开？'));
</script>
<template><section class="flow-view"><div class="flow-topbar"><button class="icon-button" aria-label="返回旅程列表" :disabled="busy" @click="router.push('/journeys')"><AtlasIcon name="back"/></button><h2>新建旅程</h2><span class="icon-button"/></div><form id="journey-create" class="flow-scroll flow-form" @submit.prevent="create"><p class="eyebrow">MAKE ROOM FOR THE JOURNEY</p><p class="form-intro">先记下大致方向。日期、地点与沿途安排，都可以慢慢补充。</p><div class="flow-field"><label for="title">旅程名称</label><input id="title" v-model="form.title" required maxlength="80" placeholder="给下一次出发起个名字"></div><div class="flow-field"><label for="origin">出发地 <span class="muted">选填</span></label><input id="origin" v-model="form.origin" maxlength="160" placeholder="如：杭州东站"><small>出发地会成为第一天的首个地点，暂时不需要选地图。</small></div><div class="flow-field"><label for="destinations">目的地 <span class="muted">可填写多个</span></label><textarea id="destinations" v-model="form.destinations" maxlength="3600" rows="2" placeholder="黄山、宏村、景德镇"></textarea><small>用逗号、顿号或换行分开，不限于一个城市。</small></div><div class="flow-form-grid"><div class="flow-field"><label for="date">出发日期 · 选填</label><input id="date" v-model="form.startDate" type="date" min="1900-01-01" max="2200-12-01"></div><div class="flow-field"><label for="duration">行程天数</label><input id="duration" v-model.number="form.duration" type="number" min="1" max="30" required></div></div><p v-if="error" class="flow-form-errors" role="alert">{{ error }}</p></form><footer class="flow-bottom"><button class="primary" type="submit" form="journey-create" :disabled="busy">{{ busy ? '正在创建…' : '开始安排' }}<AtlasIcon name="arrow"/></button></footer></section></template>
