<script setup lang="ts">
import { computed, onMounted, onBeforeUnmount, reactive, ref } from 'vue';
import { useRoute, useRouter, onBeforeRouteLeave } from 'vue-router';
import { api, draftId, errorText, mutationId } from '../api';
import { useRouteDraft } from '../useRouteDraft';
import { clone, modeLabels, travelModes, nextDate, parseDestinations, type JourneySummary, type RouteSnapshot, type RouteStop, type RouteCommand, type StopInput, type TravelMode, type Visit, type PlaceInput } from '../../../packages/contracts/src/index.js';
import AtlasIcon from '../components/AtlasIcon.vue';
import ModalSheet from '../components/ModalSheet.vue';
import ActualActions from '../components/ActualActions.vue';
import PlacePicker from '../components/PlacePicker.vue';
import DiaryCards from '../components/DiaryCards.vue';
const page = useRoute(), router = useRouter(), journey = ref<JourneySummary | null>(null), loading = ref(true), loadError = ref(''), view = ref('days'), dayId = ref('');
const isActual = computed(() => page.path.endsWith('/actual')); const visits = ref<Visit[]>([]);
const draft = useRouteDraft(); const { route, base, saving, dirty, error, conflict, storageOK, savedMessage } = draft;
const selectedDay = computed(() => route.value?.days.find(x => x.id === dayId.value) ?? route.value?.days[0]);
const dayIndex = computed(() => route.value?.days.findIndex(x => x.id === selectedDay.value?.id) ?? 0);
const editable = computed(() => !saving.value && !conflict.value);
type Modal = 'stop' | 'menu' | 'move' | 'day' | 'note' | 'metadata' | 'leave' | 'reload' | 'delete' | 'visit' | 'unvisit' | null;
const modal = ref<Modal>(null), modalError = ref(''), modalBusy = ref(false), modalDirty = ref(false), activeStop = ref<RouteStop | null>(null), newDay = ref(false);
const stopForm = reactive<StopInput & { arrivalMode: TravelMode }>({ label: '', region: '', time: null, note: '', role: 'visit', location: null, arrivalMode: 'unknown' });
const dayForm = reactive({ title: '', area: '', date: '', stayName: '' });
const metaForm = reactive({ title: '', destinations: '', status: 'planning' as JourneySummary['status'] });
const noteForm = ref(''), targetDay = ref(''), deleteKind = ref<'stop' | 'day'>('stop'); let resolveLeave: ((answer: boolean) => void) | undefined;
async function load() { loading.value = true; loadError.value = ''; try { journey.value = await api<JourneySummary>('/journeys/' + page.params.id); visits.value = await api<Visit[]>('/visits?journeyId=' + journey.value.id); const id = isActual.value ? journey.value.actualRouteId : journey.value.planRouteId; if (id) { const server = await api<RouteSnapshot>('/routes/' + id); draft.initialize(server); dayId.value = route.value!.days[0]!.id; } } catch (e) { loadError.value = errorText(e); } finally { loading.value = false; } }
onMounted(load);
const unload = (event: BeforeUnloadEvent) => { if (dirty.value || modalDirty.value) { event.preventDefault(); event.returnValue = ''; } };
onMounted(() => window.addEventListener('beforeunload', unload));
onBeforeUnmount(() => { draft.write(); window.removeEventListener('beforeunload', unload); resolveLeave?.(false); });
onBeforeRouteLeave(() => {
  if (saving.value || modalBusy.value) return false;
  if (modalDirty.value && !window.confirm('弹窗内容尚未加入行程，放弃填写并离开？')) return false;
  modalDirty.value = false;
  if (!dirty.value) return true;
  return new Promise<boolean>(resolve => { resolveLeave = resolve; modal.value = 'leave'; });
});
function closeModal() {
  if (modalBusy.value) return;
  if (modal.value === 'leave') { leave(false); return; }
  if (modalDirty.value && !window.confirm('放弃弹窗中尚未确认的修改？')) return;
  modal.value = null; modalDirty.value = false; modalError.value = '';
}
function open(kind: Modal) { modal.value = kind; modalError.value = ''; modalDirty.value = false; }
function leave(answer: boolean, discard = false) { if (discard) draft.discard(); else draft.write(); modal.value = null; const resolve = resolveLeave; resolveLeave = undefined; resolve?.(answer); }
function incoming(stop: RouteStop) { return route.value?.segments.find(x => x.toStopId === stop.id); }
function roleLabel(role: StopInput['role']) { return { departure: '出发地', visit: '游览', waypoint: '途经', transfer: '换乘', overnight: '住宿' }[role]; }
function openStop(stop: RouteStop | null) {
  if (!editable.value) return; activeStop.value = stop;
  Object.assign(stopForm, stop ? clone(stop) : { label: '', region: '', time: null, note: '', role: 'visit', location: null });
  stopForm.arrivalMode = stop ? incoming(stop)?.mode ?? 'unknown' : 'unknown'; open('stop');
}
function saveStop() {
  if (!stopForm.label.trim()) { modalError.value = '请填写地点名称。'; return; }
  const stop: StopInput = { label: stopForm.label, region: stopForm.region, time: stopForm.time || null, note: stopForm.note, role: stopForm.role, location: stopForm.location };
  const commands: RouteCommand[] = activeStop.value ? [{ type: 'update_stop', stopId: activeStop.value.id, patch: stop }, { type: 'set_arrival', stopId: activeStop.value.id, mode: stopForm.arrivalMode }] : [{ type: 'add_stop', clientRef: draftId(), dayId: selectedDay.value!.id, stop, arrivalMode: stopForm.arrivalMode }];
  if (draft.stage(commands)) { modalDirty.value = false; modal.value = null; }
  else modalError.value = error.value;
}
function menu(stop: RouteStop) { activeStop.value = stop; open('menu'); }
function reorder(index: number) {
  if (!activeStop.value || !selectedDay.value) return;
  if (draft.stage([{ type: 'move_stop', stopId: activeStop.value.id, toDayId: selectedDay.value.id, index }])) modal.value = null;
}
const stopIndex = computed(() => selectedDay.value?.stops.findIndex(x => x.id === activeStop.value?.id) ?? -1);
function move() { if (!activeStop.value || !route.value) return; const day = route.value.days.find(x => x.id === targetDay.value); if (!day) return;
  if (draft.stage([{ type: 'move_stop', stopId: activeStop.value.id, toDayId: day.id, index: day.stops.length }])) { dayId.value = day.id; modal.value = null; } }
function editDay(add = false) {
  if (!route.value || !selectedDay.value) return; newDay.value = add;
  const last = route.value.days.at(-1)!;
  Object.assign(dayForm, add ? { title: `第 ${route.value.days.length + 1} 天`, area: '', date: nextDate(last.date, 1) ?? '', stayName: '' } : { ...selectedDay.value, date: selectedDay.value.date ?? '' }); open('day');
}
function saveDay() {
  const id = newDay.value ? draftId() : selectedDay.value!.id;
  const command: RouteCommand = newDay.value ? { type: 'add_day', clientRef: id, title: dayForm.title, area: dayForm.area, date: dayForm.date || null } : { type: 'update_day', dayId: id, patch: { title: dayForm.title, area: dayForm.area, date: dayForm.date || null, stayName: dayForm.stayName } };
  const commands = [command]; if (newDay.value && dayForm.stayName) commands.push({ type: 'update_day', dayId: id, patch: { stayName: dayForm.stayName } });
  if (draft.stage(commands)) { dayId.value = id; modalDirty.value = false; modal.value = null; } else modalError.value = error.value;
}
function remove() {
  const command: RouteCommand = deleteKind.value === 'stop' ? { type: 'remove_stop', stopId: activeStop.value!.id } : { type: 'remove_day', dayId: selectedDay.value!.id };
  if (draft.stage([command])) { modal.value = null; dayId.value = selectedDay.value!.id; } else modalError.value = error.value;
}
function editMetadata() { if (!journey.value) return; Object.assign(metaForm, { title: journey.value.title, destinations: journey.value.destinations.join('、'), status: journey.value.status }); open('metadata'); }
let metaRequest = '', metaKey = mutationId();
async function saveMetadata() {
  if (!journey.value || modalBusy.value) return; modalBusy.value = true; modalError.value = '';
  const body = { baseVersion: journey.value.version, title: metaForm.title, destinations: parseDestinations(metaForm.destinations), status: metaForm.status };
  if (JSON.stringify(body) !== metaRequest) { metaRequest = JSON.stringify(body); metaKey = mutationId(); }
  try { journey.value = await api<JourneySummary>('/journeys/' + journey.value.id, 'PATCH', { ...body, clientMutationId: metaKey }); modal.value = null; modalDirty.value = false; }
  catch (e) { modalError.value = errorText(e); } finally { modalBusy.value = false; }
}
async function reload() { modalBusy.value = true; modalError.value = ''; try { await draft.reload(); dayId.value = route.value!.days[0]!.id; journey.value = await api<JourneySummary>('/journeys/' + page.params.id); modal.value = null; } catch (e) { modalError.value = errorText(e); } finally { modalBusy.value = false; } }
function saveNote() { if (draft.stage([{ type: 'set_route_note', note: noteForm.value }])) { modal.value = null; modalDirty.value = false; } }
const visitPlace = ref<PlaceInput | null>(null);
const visitForm = reactive({ visitedOn: '', note: '' }); let visitKey = mutationId(), visitSignature = '';
function visitFor(stop: RouteStop | null) { return stop ? visits.value.find(v => v.stopId === stop.id) : undefined; }
function startVisit(stop: RouteStop) { activeStop.value = stop; visitPlace.value = null; visitForm.visitedOn = selectedDay.value?.date ?? new Date().toLocaleDateString('sv-SE'); visitForm.note = ''; visitKey = mutationId(); visitSignature = ''; open('visit'); }
async function saveVisit() { if (!route.value || !activeStop.value) return; modalBusy.value = true; modalError.value = ''; const body = { routeVersion: route.value.version, ...visitForm, ...(visitPlace.value ? { place: visitPlace.value } : {}) }; if (visitSignature && visitSignature !== JSON.stringify(body)) visitKey = mutationId(); visitSignature = JSON.stringify(body); try { await api(`/routes/${route.value.id}/stops/${activeStop.value.id}/visit`, 'POST', { ...body, clientMutationId: visitKey }); visits.value = await api<Visit[]>('/visits?journeyId=' + journey.value!.id); modalDirty.value = false; modal.value = null; } catch (e) { modalError.value = errorText(e); } finally { modalBusy.value = false; } }
async function unvisit() { const visit = visitFor(activeStop.value); if (!visit) return; modalBusy.value = true; try { await api('/visits/' + visit.id, 'DELETE', { clientMutationId: visitKey }); visits.value = visits.value.filter(v => v.id !== visit.id); modal.value = null; } catch (e) { modalError.value = errorText(e); } finally { modalBusy.value = false; } }
async function actualReady(_route: RouteSnapshot) { if (isActual.value) await load(); else await router.push('/journeys/' + journey.value!.id + '/actual'); }
function writeDiary(stop?: RouteStop) { if (!route.value || !journey.value) return; const query = new URLSearchParams({ journeyId: journey.value.id, routeId: route.value.id }); if (stop && selectedDay.value) { query.set('dayId', selectedDay.value.id); query.set('stopId', stop.id); } router.push('/diaries/new?' + query); }
const draftSummary = computed(() => route.value?.days.map((d, i) => `第 ${i + 1} 天 · ${d.title}\n${d.stops.map(s => '  ' + s.label + (s.note ? '：' + s.note : '')).join('\n')}`).join('\n\n'));
</script>
<!-- Migrated from the original view()/journeyEditor()/pointPanel() structures. -->
<template><section class="flow-view"><header class="flow-topbar"><button class="icon-button" aria-label="返回旅程列表" :disabled="saving" @click="router.push('/journeys')"><AtlasIcon name="back"/></button><h2>我的行程</h2><div class="flow-top-actions"><button class="icon-button" aria-label="编辑旅程信息" :disabled="!journey || saving" @click="editMetadata"><AtlasIcon name="edit"/></button></div></header>
  <div v-if="loading || loadError" class="flow-scroll"><p class="form-intro" :role="loadError ? 'alert' : undefined">{{ loading ? '正在打开行程…' : loadError }}</p><button v-if="loadError" class="secondary-button" @click="load">重新加载</button></div>
  <div v-else-if="journey && !route" class="flow-scroll"><h1 class="editor-title">{{ journey.title }}</h1><p class="form-intro">还没有实际记录。可以从计划补记，也可以重新记录实际走过的地方。</p><ActualActions :journey="journey" :disabled="false" @ready="actualReady"/><button class="text-button full" @click="router.push('/journeys/' + journey.id + '/edit')">返回计划安排</button></div>
  <template v-else-if="route && journey"><div class="flow-tabs editor-tabs" role="group" aria-label="行程视图"><button :aria-pressed="view === 'overview'" @click="view = 'overview'">行程概览</button><button :aria-pressed="view === 'days'" @click="view = 'days'">每日安排</button><button :aria-pressed="view === 'diaries'" @click="view = 'diaries'">日记</button></div><div class="flow-scroll">
    <h1 class="editor-title">{{ journey.title }}</h1><div class="route-layer-selector" role="group" aria-label="计划与实际"><button :aria-pressed="!isActual" :disabled="saving" @click="router.push('/journeys/' + journey.id + '/edit')">计划安排</button><button :aria-pressed="isActual" :disabled="saving" @click="router.push('/journeys/' + journey.id + '/actual')">实际记录</button></div><p class="editor-summary">{{ journey.destinations.join(' / ') || '目的地待补充' }} · {{ route.days.length }} 天 · {{ journey.status === 'planning' ? '计划中' : journey.status === 'completed' ? '已完成' : '已归档' }}</p>
    <div v-if="dirty" class="flow-draft-banner"><div class="draft-info"><strong>{{ conflict ? '发现服务器版本更新' : '修改尚未保存到服务器' }}</strong><span>{{ storageOK ? '草稿已保留在此浏览器页面' : '本机存储不可用，请保持页面打开或下载草稿' }}</span></div><button @click="draft.exportDraft">下载草稿</button></div>
    <p v-if="savedMessage && !dirty" class="flow-save-state" role="status">{{ savedMessage }}</p><div v-if="error" class="flow-form-errors" role="alert"><p>{{ error }}</p><div v-if="conflict" class="error-actions"><button class="text-button" @click="open('reload')">核对草稿与服务器版本</button><button class="text-button" @click="draft.exportDraft">下载草稿</button></div></div>
    <button class="secondary-button full map-entry" :disabled="saving" @click="router.push('/journeys/' + journey.id + (isActual ? '/actual/map' : '/map'))"><AtlasIcon name="route" :size="17"/>查看路线地图与 GPX</button><button class="text-button full" :disabled="dirty || saving" @click="router.push('/journeys/' + journey.id + '/share' + (isActual ? '?layer=actual' : ''))">分享这次旅程</button><p v-if="isActual" class="record-origin">{{ route.copiedFrom ? `根据计划版本 ${route.copiedFrom.version} 补记，可独立修改；并非 GPS 实录。` : '由你手动补记的实际安排，并非 GPS 实录。' }}</p><DiaryCards v-if="view === 'diaries'" :journey-id="journey.id"/>
    <template v-else-if="view === 'overview'"><ActualActions :journey="journey" :disabled="dirty || !editable" @ready="actualReady"/><button class="text-button full" :disabled="dirty || saving" @click="writeDiary()">为这次旅程写日记</button><button v-for="(day,index) in route.days" :key="day.id" class="flow-day-overview day-overview-button" @click="dayId = day.id; view = 'days'"><b>D{{ index + 1 }}</b><span class="od-field od-fill"><strong>{{ day.title || '当天安排' }}</strong><small>{{ day.date || '日期待定' }} · {{ day.area || '地区待补充' }}</small><small>{{ day.stops.map(p => p.label).join(' → ') || '还没有安排地点' }}</small></span><AtlasIcon name="chevronRight"/></button><div class="section-row"><h3>行程备注</h3><button class="text-button" :disabled="!editable" @click="noteForm = route.note; open('note')">编辑备注</button></div><p class="route-note">{{ route.note || '交通、装备、预约与其他想记下的事。' }}</p></template>
    <template v-else><div class="flow-day-rail" role="group" aria-label="选择日期"><button v-for="(day,index) in route.days" :key="day.id" :aria-pressed="selectedDay?.id === day.id" :aria-selected="selectedDay?.id === day.id" @click="dayId = day.id"><strong>第 {{ index + 1 }} 天</strong><small>{{ day.date?.slice(5).replace('-', '.') || '日期待定' }}</small></button><button :disabled="!editable || route.days.length >= 30" aria-label="增加一天" @click="editDay(true)"><AtlasIcon name="plus"/></button></div>
      <template v-if="selectedDay"><div class="flow-day-context"><div class="od-fill"><h3>{{ selectedDay.title || `第 ${dayIndex + 1} 天` }}</h3><small>{{ selectedDay.area || '地区待补充' }}<span v-if="selectedDay.stayName"> · 住宿：{{ selectedDay.stayName }}</span></small></div><button class="flow-inline-button" :disabled="!editable" @click="editDay()">编辑当天</button></div>
      <div v-if="!selectedDay.stops.length" class="flow-day-empty"><p>这一天，留给新的风景。</p><span>先添加一个地点，沿途的安排可以慢慢补齐。</span></div>
      <article v-for="(stop,index) in selectedDay.stops" :key="stop.id" class="flow-point"><div v-if="incoming(stop)" class="arrival-label" :class="{ gap: incoming(stop)?.kind === 'gap' }"><AtlasIcon :name="incoming(stop)?.mode === 'walk' || incoming(stop)?.mode === 'hike' ? 'walk' : 'route'" :size="15"/><span>{{ modeLabels[incoming(stop)!.mode] }} · {{ incoming(stop)?.geometryStatus === 'ready' ? '已有路线' : '尚未生成路线' }}</span></div><button class="flow-point-main" :disabled="!editable" :aria-label="'编辑地点：' + stop.label" @click="openStop(stop)"><span class="flow-point-num">{{ index + 1 }}</span><span class="od-field od-fill"><strong>{{ stop.label }}</strong><small>{{ [stop.time, roleLabel(stop.role), stop.region, stop.location ? '已定位' : '待定位'].filter(Boolean).join(' · ') }}</small><p v-if="stop.note">{{ stop.note }}</p></span></button><p v-if="isActual && visitFor(stop)" class="visit-badge"><AtlasIcon name="check" :size="14"/>已到访 · {{ visitFor(stop)!.visitedOn }}</p><div class="flow-point-tools"><button v-if="isActual && !visitFor(stop)" class="flow-point-action" :disabled="dirty || !editable" @click="startVisit(stop)">确认到访</button><button class="flow-point-action" :disabled="!editable" :aria-label="'编辑' + stop.label" @click="openStop(stop)"><AtlasIcon name="edit" :size="16"/>编辑</button><button class="flow-point-action" :disabled="!editable" :aria-label="stop.label + '的更多操作'" @click="menu(stop)"><AtlasIcon name="more" :size="16"/>更多</button></div></article>
      <button class="flow-add-point" :disabled="!editable || route.days.flatMap(d => d.stops).length >= 200" @click="openStop(null)"><AtlasIcon name="plus"/>添加地点</button></template>
    </template>
  </div><footer class="flow-bottom"><span class="save-info" aria-live="polite">{{ saving ? '正在提交修改…' : dirty ? '有未保存修改' : `服务器版本 ${base?.version}` }}</span><button class="primary" :disabled="!dirty || !editable" @click="draft.save">{{ saving ? '正在保存…' : '保存行程' }}<AtlasIcon name="check" :size="18"/></button></footer></template>

  <ModalSheet v-if="modal" :key="modal" :title="({stop: activeStop ? '编辑地点' : '添加地点', menu: '地点操作', move: '移到另一天', day: newDay ? '增加一天' : '编辑当天', note: '行程备注', metadata: '旅程信息', leave: '修改尚未保存', reload: '核对未保存草稿', delete: '确认移除', visit: '确认到访', unvisit: '取消到访'})[modal]" :busy="modalBusy" @close="closeModal">
    <form v-if="modal === 'stop'" id="stop-form" @submit.prevent="saveStop" @input="modalDirty = true" @change="modalDirty = true"><p class="modal-title-note">地点可以先记名字，之后再补充地图位置。</p><div class="flow-field"><label for="stop-name">地点名称</label><input id="stop-name" v-model="stopForm.label" maxlength="160" required autofocus></div><div class="flow-field"><label for="stop-region">所在地区 · 选填</label><input id="stop-region" v-model="stopForm.region" maxlength="120" placeholder="如：安徽省黄山市"></div><div class="flow-form-grid"><div class="flow-field"><label for="stop-role">地点用途</label><select id="stop-role" v-model="stopForm.role"><option value="visit">游览</option><option value="departure">出发地</option><option value="waypoint">途经</option><option value="transfer">换乘</option><option value="overnight">住宿</option></select></div><div class="flow-field"><label for="stop-time">预计时间 · 选填</label><input id="stop-time" v-model="stopForm.time" type="time"></div></div><div class="flow-field"><label for="stop-mode">到达此处的交通方式</label><select id="stop-mode" v-model="stopForm.arrivalMode"><option v-for="mode in travelModes" :key="mode" :value="mode">{{ modeLabels[mode] }}</option></select><small>全程首个地点无需接驳；调整顺序后，新连接需要重新确认。</small></div><div class="flow-field"><label for="stop-note">地点备注 · 选填</label><textarea id="stop-note" v-model="stopForm.note" maxlength="10000" rows="4" placeholder="门票、预约、开放时间，或想留意的事"></textarea></div></form>
    <div v-else-if="modal === 'menu'" class="stop-menu"><p class="modal-title-note">{{ activeStop?.label }}</p><button :disabled="stopIndex <= 0" @click="reorder(stopIndex - 1)"><AtlasIcon name="up"/>向上移动</button><button :disabled="stopIndex >= selectedDay!.stops.length - 1" @click="reorder(stopIndex + 1)"><AtlasIcon name="down"/>向下移动</button><button :disabled="stopIndex <= 0" @click="reorder(0)"><AtlasIcon name="up"/>移到当天开头</button><button :disabled="stopIndex >= selectedDay!.stops.length - 1" @click="reorder(selectedDay!.stops.length - 1)"><AtlasIcon name="down"/>移到当天末尾</button><button :disabled="route!.days.length < 2" @click="targetDay = route!.days.find(d => d.id !== selectedDay!.id)!.id; open('move')"><AtlasIcon name="moveDay"/>移到另一天</button><button :disabled="dirty || saving" @click="writeDiary(activeStop!)"><AtlasIcon name="book"/>为这个地点写日记</button><button v-if="isActual && visitFor(activeStop)" @click="visitKey = mutationId(); open('unvisit')"><AtlasIcon name="close"/>取消这次到访确认</button><button class="danger" @click="deleteKind = 'stop'; open('delete')"><AtlasIcon name="trash"/>移除这个地点</button></div>
    <form v-else-if="modal === 'move'" id="move-form" @submit.prevent="move"><p class="confirm-copy">将“{{ activeStop?.label }}”移到所选日期末尾，时间和备注会一起保留。新接驳将标记为待定。</p><div class="flow-field"><label for="target-day">目标日期</label><select id="target-day" v-model="targetDay"><option v-for="(day,index) in route!.days.filter(d => d.id !== selectedDay!.id)" :key="day.id" :value="day.id">{{ day.title }} · {{ day.date || '日期待定' }}</option></select></div></form>
    <form v-else-if="modal === 'day'" id="day-form" @submit.prevent="saveDay" @input="modalDirty = true"><div class="flow-field"><label for="day-title">当天主题</label><input id="day-title" v-model="dayForm.title" maxlength="80"></div><div class="flow-field"><label for="day-area">所在地区 · 选填</label><input id="day-area" v-model="dayForm.area" maxlength="120"></div><div class="flow-field"><label for="day-date">日期 · 选填</label><input id="day-date" v-model="dayForm.date" type="date" min="1900-01-01" max="2200-12-31"></div><div class="flow-field"><label for="day-stay">住宿安排 · 选填</label><input id="day-stay" v-model="dayForm.stayName" maxlength="160"></div><button v-if="!newDay" type="button" class="text-button danger" :disabled="route!.days.length <= 1 || !!selectedDay!.stops.length" @click="deleteKind = 'day'; modalDirty = false; open('delete')"><AtlasIcon name="trash" :size="16"/>移除这一天</button><p v-if="!newDay && selectedDay!.stops.length" class="small muted">先移走或移除地点，再删除这一天。</p></form>
    <form v-else-if="modal === 'note'" id="note-form" @submit.prevent="saveNote" @input="modalDirty = true"><div class="flow-field"><label for="route-note">为这次出行记下的事</label><textarea id="route-note" v-model="noteForm" class="note-area" maxlength="10000" rows="8"></textarea></div></form>
    <form v-else-if="modal === 'metadata'" id="metadata-form" @submit.prevent="saveMetadata" @input="modalDirty = true" @change="modalDirty = true"><div class="flow-field"><label for="meta-title">旅程名称</label><input id="meta-title" v-model="metaForm.title" required maxlength="80"></div><div class="flow-field"><label for="meta-destinations">目的地</label><textarea id="meta-destinations" v-model="metaForm.destinations" maxlength="3600" rows="2"></textarea></div><div class="flow-field"><label for="meta-status">旅程状态</label><select id="meta-status" v-model="metaForm.status"><option value="planning">计划中</option><option value="completed">已完成</option><option value="archived">已归档</option></select><small>标记完成仅更新状态，请在实际记录中确认到访，并单独写下日记。</small></div></form>
    <form v-else-if="modal === 'visit'" id="visit-form" @submit.prevent="saveVisit" @input="modalDirty = true"><p class="confirm-copy">确认自己已到访“{{ activeStop?.label }}”。复制计划和标记完成不会自动产生到访。</p><div class="flow-field"><label for="visited-on">实际到访日期</label><input id="visited-on" v-model="visitForm.visitedOn" type="date" required min="1900-01-01" max="2200-12-31"></div><PlacePicker v-model="visitPlace" label="在足迹地图中归属到哪里 · 可稍后补充"/><div class="flow-field"><label for="visit-note">到访备注 · 选填</label><textarea id="visit-note" v-model="visitForm.note" maxlength="4000"></textarea></div></form><p v-else-if="modal === 'unvisit'" class="confirm-copy">取消“{{ activeStop?.label }}”的到访确认？实际安排与日记会保留。</p>
    <p v-else-if="modal === 'leave'" class="confirm-copy">行程修改还没有保存到服务器。可以保留本机草稿，下次在此页面继续。</p>
    <div v-else-if="modal === 'reload'"><p class="confirm-copy">以下是当前草稿。建议先下载备份，再加载服务器最新版本，手动核对需要补回的修改。</p><pre class="draft-compare">{{ draftSummary }}</pre><button class="text-button full" @click="draft.exportDraft">下载完整草稿</button><p class="small muted">加载成功后，会放弃此页面的待提交修改；加载失败时保留。</p></div>
    <p v-else-if="modal === 'delete'" class="confirm-copy">{{ deleteKind === 'stop' ? `移除“${activeStop?.label}”？相关接驳会重新整理。` : '移除这一天？其他日期保持不变。' }}点击保存行程后才会提交。</p>
    <p v-if="modalError" class="flow-form-errors" role="alert">{{ modalError }}</p>
    <template #footer><div v-if="modal === 'leave'" class="modal-actions"><button class="primary" :disabled="!storageOK" @click="leave(true)">保留草稿并离开</button><button class="secondary-button" @click="leave(false)">继续编辑</button><button class="text-button" @click="leave(true, true)">放弃修改并离开</button></div><div v-else-if="modal === 'reload'" class="modal-actions"><button class="primary" :disabled="modalBusy" @click="reload">{{ modalBusy ? '正在加载…' : '放弃本页修改，加载最新版本' }}</button><button class="secondary-button" :disabled="modalBusy" @click="closeModal">保留草稿，继续核对</button></div><button v-else-if="modal === 'unvisit'" class="primary" :disabled="modalBusy" @click="unvisit">确认取消到访</button><button v-else-if="modal === 'delete'" class="primary" @click="remove">确认移除</button><button v-else-if="modal !== 'menu'" class="primary" :disabled="modalBusy" :form="{stop:'stop-form',move:'move-form',day:'day-form',note:'note-form',metadata:'metadata-form',visit:'visit-form'}[modal]" type="submit">{{ modalBusy ? '正在保存…' : modal === 'metadata' ? '保存旅程信息' : '确认修改' }}</button></template>
  </ModalSheet>
</section></template>
