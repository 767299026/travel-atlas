<script setup lang="ts">
import { ref, watch } from 'vue';
import { api, errorText, mutationId } from '../api';
import { placeInputFor, type AtlasPlace, type AtlasRecord, type PlaceInput } from '../../../packages/contracts/src/index.js';
import PlacePicker from './PlacePicker.vue';
import ModalSheet from './ModalSheet.vue';
const props = defineProps<{ kind: 'visited' | 'wish'; place?: AtlasPlace | null; record?: AtlasRecord | null; assign?: boolean; initial?: PlaceInput | null }>();
const emit = defineEmits<{ close: []; saved: [] }>();
const input = ref<PlaceInput | null>(props.record?.place ? placeInputFor(props.record.place) : props.place ? placeInputFor(props.place) : props.initial ?? null), date = ref(props.record?.visitedOn ?? ''), note = ref(props.record?.note ?? ''), busy = ref(false), error = ref(''); let key = mutationId();
watch(() => JSON.stringify([input.value, date.value, note.value]), () => { key = mutationId(); });
async function save() {
  if (!input.value) { error.value = '请选择要记录的地区或城市。'; return; } busy.value = true; error.value = '';
  try {
    if (props.assign && props.record) await api('/visits/' + props.record.id + '/place', 'PUT', { place: input.value, baseVersion: props.record.version, clientMutationId: key });
    else { const editing = props.record && props.record.source !== 'journey'; await api('/atlas/records' + (editing ? '/' + props.record!.id : ''), editing ? 'PUT' : 'POST', { kind: props.kind, place: input.value, visitedOn: props.kind === 'wish' ? null : date.value || null, note: note.value, clientMutationId: key, ...(editing ? { baseVersion: props.record!.version } : {}) }); }
    emit('saved'); emit('close');
  } catch (e) { error.value = errorText(e); } finally { busy.value = false; }
}
</script>
<template><ModalSheet :title="assign ? '补充到访城市归属' : kind === 'wish' ? record ? '编辑城市心愿' : '收藏想去的地方' : record ? '编辑城市足迹' : '记录去过的地方'" :busy="busy" @close="emit('close')"><p class="small muted">{{ assign ? '保留原始到访内容，为这条记录选择城市归属。' : kind === 'wish' ? '心愿只记录向往，不会点亮已到访。' : '仅在确认自己去过时保存；可不关联行程，日期可以稍后补充。' }}</p><fieldset class="atlas-form" :disabled="busy"><PlacePicker v-model="input"/><template v-if="!assign"><div v-if="kind === 'visited'" class="flow-field"><label for="place-date">到访日期 · 可留空</label><input id="place-date" v-model="date" type="date" min="1900-01-01" max="2200-12-31"><small>未填写日期的足迹归入“年份待补充”。</small></div><div class="flow-field"><label for="place-note">{{ kind === 'wish' ? '想去的理由' : '到访备注' }}</label><textarea id="place-note" v-model="note" maxlength="4000" rows="3"></textarea></div></template></fieldset><p v-if="error" class="flow-form-errors" role="alert">{{ error }}</p><template #footer><button class="primary" :disabled="busy" @click="save">{{ busy ? '正在保存…' : assign ? '保存城市归属' : kind === 'wish' ? '保存心愿' : '确认到访并保存' }}</button></template></ModalSheet></template>
