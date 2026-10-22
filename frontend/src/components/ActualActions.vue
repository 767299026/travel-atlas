<script setup lang="ts">
import { computed, ref } from 'vue';
import { api, errorText, mutationId } from '../api';
import type { ActualCopyInput, ActualCopyPreview, JourneySummary, RouteSnapshot } from '../../../packages/contracts/src/index.js';
import AtlasIcon from './AtlasIcon.vue';
import ModalSheet from './ModalSheet.vue';
const props = defineProps<{ journey: JourneySummary; disabled: boolean }>();
const emit = defineEmits<{ ready: [route: RouteSnapshot] }>();
const open = ref(false), busy = ref(false), error = ref(''), plan = ref<RouteSnapshot | null>(null), actual = ref<RouteSnapshot | null>(null), selected = ref<string[]>([]), mode = ref(''), confirmed = ref(false), preview = ref<ActualCopyPreview | null>(null);
const input = computed<ActualCopyInput>(() => ({ planVersion: plan.value!.version, actualVersion: actual.value?.version ?? null, dayIds: selected.value, mode: mode.value as 'append' | 'replace' }));
let key = mutationId(), signature = '', emptyKey = mutationId();
async function show() {
  open.value = true; busy.value = true; error.value = ''; preview.value = null; confirmed.value = false;
  try { const journey = await api<JourneySummary>('/journeys/' + props.journey.id); plan.value = await api<RouteSnapshot>('/routes/' + journey.planRouteId); actual.value = journey.actualRouteId ? await api<RouteSnapshot>('/routes/' + journey.actualRouteId) : null; selected.value = plan.value.days.map(d => d.id); mode.value = actual.value ? '' : 'replace'; }
  catch (e) { error.value = errorText(e); } finally { busy.value = false; }
}
function changed() { preview.value = null; confirmed.value = false; }
async function inspect() { busy.value = true; error.value = ''; try { preview.value = await api<ActualCopyPreview>(`/journeys/${props.journey.id}/actual-copy-previews`, 'POST', input.value); } catch (e) { error.value = errorText(e); } finally { busy.value = false; } }
async function copy() {
  if (!preview.value || busy.value) return; busy.value = true; error.value = '';
  const body = input.value; if (JSON.stringify(body) !== signature) { signature = JSON.stringify(body); key = mutationId(); }
  try { const result = await api<{ route: RouteSnapshot }>(`/journeys/${props.journey.id}/actual-copy`, 'POST', { ...body, clientMutationId: key }); open.value = false; emit('ready', result.route); }
  catch (e) { error.value = errorText(e); } finally { busy.value = false; }
}
async function empty() { if (busy.value) return; busy.value = true; error.value = ''; try { const route = await api<RouteSnapshot>(`/journeys/${props.journey.id}/actual`, 'POST', { clientMutationId: emptyKey }); emit('ready', route); } catch (e) { error.value = errorText(e); } finally { busy.value = false; } }
</script>
<template><div class="actual-actions"><button class="secondary-button" :disabled="disabled || busy" @click="show"><AtlasIcon name="copy" :size="17"/>从计划补记实际</button><button v-if="!journey.actualRouteId" class="text-button" :disabled="disabled || busy" @click="empty">创建空白实际记录</button><p v-if="disabled" class="small muted">先保存当前修改，再补充实际记录。</p><p v-if="error && !open" class="flow-form-errors" role="alert">{{ error }}</p></div>
<ModalSheet v-if="open" title="从计划补记实际" :busy="busy" @close="open = false"><p class="confirm-copy">复制后可独立修改，不会改变原计划。完成状态、到访和日记都需要另行记录；这不是 GPS 实录。</p><template v-if="plan"><fieldset class="copy-days" :disabled="busy"><legend>选择要复制的日期</legend><label v-for="(day,index) in plan.days" :key="day.id"><input v-model="selected" type="checkbox" :value="day.id" @change="changed">第 {{ index + 1 }} 天 · {{ day.title }} <small>{{ day.stops.length }} 个地点</small></label></fieldset><fieldset v-if="actual" class="copy-days" :disabled="busy"><legend>实际记录已有内容，请选择处理方式</legend><label><input v-model="mode" type="radio" value="append" @change="changed">追加为新的日期，保留现有实际安排</label><label><input v-model="mode" type="radio" value="replace" @change="changed">替换全部实际安排及路线备注</label></fieldset><div v-if="preview" class="copy-preview"><p>将复制 {{ preview.addedDays }} 天、{{ preview.addedStops }} 个地点。</p><p v-if="preview.replacedDays">将替换现有 {{ preview.replacedDays }} 天的实际安排。</p><p>保留 {{ preview.preservedVisits }} 条到访和 {{ preview.preservedDiaries }} 篇日记；原地点移除后仍保留关联名称快照。</p><label v-if="actual && mode === 'replace'"><input v-model="confirmed" type="checkbox">我已核对，确认替换实际安排</label></div></template><p v-if="error" class="flow-form-errors" role="alert">{{ error }}</p><template #footer><button v-if="!preview" class="primary" :disabled="busy || !plan || !selected.length || !mode" @click="inspect">{{ busy ? '正在核对…' : '预览复制影响' }}</button><button v-else class="primary" :disabled="busy || !!actual && mode === 'replace' && !confirmed" @click="copy">{{ busy ? '正在复制…' : '确认复制到实际记录' }}</button></template></ModalSheet></template>
