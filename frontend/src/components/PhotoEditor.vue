<script setup lang="ts">
import { computed, onMounted, onBeforeUnmount, ref, watch } from 'vue';
import type { AtlasCatalog, Location, MediaItem, PhotoMemory, PhotoGroupNote, PhotoInput, PhotoPlace, PhotoSave } from '../../../packages/contracts/src/index.js';
import { api, errorText, mutationId, session, uploadPhoto } from '../api';
import { photoInput, photoGroupKey, photoPlaceName } from '../photos';
import { loadAMap } from '../maps/amap';
import ModalSheet from './ModalSheet.vue';
import AtlasIcon from './AtlasIcon.vue';
import PhotoPointPicker from './PhotoPointPicker.vue';
type Draft = PhotoInput & { media: MediaItem; suggestion: PhotoPlace | null };
const props = defineProps<{ photo?: PhotoMemory; notes: PhotoGroupNote[]; maxBytes?: number }>();
const emit = defineEmits<{ close: []; saved: [] }>();
const items = ref<Draft[]>(props.photo ? [{ ...photoInput(props.photo), media: props.photo.media, suggestion: props.photo.suggestion || (props.photo.media.capture?.position ? { label: '照片拍摄位置', cityName: '', position: props.photo.media.capture.position, source: 'exif' } : null) }] : []);
const index = ref(0), current = computed(() => items.value[index.value]), step = ref<'upload' | 'edit' | 'place' | 'pick'>(props.photo ? 'edit' : 'upload');
const error = ref(''), busy = ref(false), progress = ref(''), groupNote = ref(''), applyAll = ref(false), catalog = ref<AtlasCatalog | null>(null);
const placeLabel = ref(''), cityName = ref(''), query = ref(''), results = ref<{ label: string; city: string; location: Location; code?: string }[]>([]), searching = ref(false), picked = ref<Location | null>(null);
const draftKey = 'atlas-photo-upload:v1:' + session.value?.user.id; let key = mutationId(), signature = '', draftTimer: ReturnType<typeof setTimeout> | undefined;
const title = computed(() => step.value === 'upload' ? '留住这一路的片刻' : step.value === 'place' ? '这是在哪里拍的？' : step.value === 'pick' ? '选择拍摄地点' : props.photo ? '补充这张照片' : '确认照片信息');
const noteKey = computed(() => current.value ? photoGroupKey(current.value) : '');
function loadNote() { groupNote.value = props.notes.find(n => n.key === noteKey.value)?.note || ''; }
watch(noteKey, loadNote, { immediate: true });
function writeDraft() { if (props.photo || !items.value.length) return; try { localStorage.setItem(draftKey, JSON.stringify({ savedAt: Date.now(), items: items.value, groupNote: groupNote.value, applyAll: applyAll.value })); } catch {} }
watch([items, groupNote, applyAll], () => { clearTimeout(draftTimer); draftTimer = setTimeout(writeDraft, 200); }, { deep: true });
onMounted(async () => {
  if (!props.photo) try { const raw = JSON.parse(localStorage.getItem(draftKey) || 'null'); if (raw?.items?.length && raw.savedAt > Date.now() - 6 * 86400000) { items.value = raw.items; groupNote.value = raw.groupNote || ''; applyAll.value = !!raw.applyAll; step.value = 'edit'; } } catch {}
  try { catalog.value = await api<AtlasCatalog>('/atlas/catalog'); } catch {}
});
onBeforeUnmount(() => { clearTimeout(draftTimer); });
function close() { if (busy.value) return; if (step.value === 'place' || step.value === 'pick') { step.value = 'edit'; error.value = ''; return; } clearTimeout(draftTimer); writeDraft(); emit('close'); }
const pending = new Map<string, { file: File; key: string }>();
async function selectFiles(e: Event) {
  const input = e.target as HTMLInputElement, files = [...(input.files || [])]; input.value = ''; error.value = '';
  if (!files.length) return;
  if (files.length + items.value.length > 24) { error.value = '一次最多添加 24 张照片。'; return; }
  if (files.some(f => !['image/jpeg', 'image/png', 'image/webp'].includes(f.type) || f.size > (props.maxBytes || 20971520))) { error.value = '请选择 JPG、PNG 或 WebP，单张不超过 ' + Math.floor((props.maxBytes || 20971520) / 1048576) + 'MB。'; return; }
  for (const file of files) { const id = mutationId(); pending.set(id, { file, key: id }); }
  await uploadPending();
}
async function uploadPending() {
  busy.value = true; error.value = '';
  try {
    for (const [id, entry] of pending) {
      progress.value = '正在上传 ' + entry.file.name;
      const media = await uploadPhoto(entry.file, entry.key);
      const suggestion: PhotoPlace | null = media.capture?.position ? { label: '照片拍摄位置', cityName: '', position: media.capture.position, source: 'exif' } : null;
      items.value.push({ mediaId: media.id, baseVersion: 0, takenOn: media.capture?.takenOn || null, place: null, note: '', media, suggestion }); pending.delete(id); writeDraft();
    }
    step.value = 'edit';
  } catch (e) { error.value = errorText(e); } finally { busy.value = false; progress.value = ''; }
}
function startPlace() { if (!current.value) return; placeLabel.value = current.value.place?.label || ''; cityName.value = current.value.place?.cityName || ''; query.value = ''; results.value = []; step.value = 'place'; error.value = ''; }
function applyPlace(place: PhotoPlace | null) { if (!current.value) return; current.value.place = place; if (place) current.value.suggestion = null; step.value = 'edit'; error.value = ''; }
function manualPlace() {
  if (!placeLabel.value.trim()) { error.value = '请填写拍摄地点名称，也可以返回后暂不补充。'; return; }
  applyPlace({ label: placeLabel.value.trim(), cityName: cityName.value.trim(), position: null, source: 'manual' });
}
async function search() {
  if (!query.value.trim() || searching.value) return; searching.value = true; error.value = '';
  try {
    const sdk = await loadAMap();
    results.value = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('地点搜索超时，仍可手工填写或在地图上选点。')), 12000);
      sdk.plugin('AMap.PlaceSearch', () => new sdk.PlaceSearch({ city: cityName.value || '全国', pageSize: 6, extensions: 'base' }).search(query.value.trim(), (status: string, data: any) => {
        clearTimeout(timer); if (status !== 'complete' && status !== 'no_data') { reject(new Error('暂时无法搜索地点，仍可手工填写。')); return; }
        resolve((data.poiList?.pois || []).filter((p: any) => p.location).map((p: any) => ({ label: p.name, city: p.cityname || cityName.value, location: { longitude: p.location.getLng(), latitude: p.location.getLat(), crs: 'GCJ02', source: 'amap_pick' } })));
      }));
    });
    if (!results.value.length) error.value = '没有找到匹配地点，可以手工填写或在地图上选择。';
  } catch (e) { error.value = errorText(e); } finally { searching.value = false; }
}
function pointDone() {
  if (!picked.value) { error.value = '请先轻点地图选择拍摄位置。'; return; }
  applyPlace({ label: placeLabel.value.trim() || '地图选点', cityName: cityName.value.trim(), position: picked.value, source: 'map' });
}
async function save() {
  if (busy.value || !current.value) return; busy.value = true; error.value = '';
  const first = current.value;
  const photos: PhotoInput[] = items.value.map(p => ({ mediaId: p.mediaId, baseVersion: p.baseVersion, takenOn: applyAll.value ? first.takenOn : p.takenOn, place: applyAll.value ? first.place : p.place, note: p.note }));
  const target = photoGroupKey(first), group = props.notes.find(n => n.key === target);
  const body = { items: photos, groupNote: { key: target, note: groupNote.value, version: group?.version || 0 } };
  const next = JSON.stringify(body); if (signature !== next) { key = mutationId(); signature = next; }
  try { await api('/photos', 'POST', { ...body, clientMutationId: key } satisfies PhotoSave); if (!props.photo) { clearTimeout(draftTimer); localStorage.removeItem(draftKey); } emit('saved'); }
  catch (e) { error.value = errorText(e); } finally { busy.value = false; }
}
</script>
<template><ModalSheet :title="title" :busy="busy" @close="close"><div class="photo-editor-content">
  <p v-if="error" class="memory-error" role="alert">{{ error }}</p><p v-if="progress" role="status" class="memory-panel-copy">{{ progress }}</p>
  <template v-if="step === 'upload'"><p class="memory-panel-copy">先选照片，日期、地点和备注都可以慢慢补。</p><label class="memory-upload"><AtlasIcon name="image"/><span>选择照片</span><small>可一次选择多张 · JPG / PNG / WebP</small><input type="file" accept="image/jpeg,image/png,image/webp" multiple :disabled="busy" aria-label="选择多张照片" @change="selectFiles"></label><button v-if="pending.size && !busy" class="memory-secondary" @click="uploadPending">重试上传</button><button v-if="items.length" class="memory-text-button" @click="step = 'edit'">继续整理已上传的 {{ items.length }} 张照片</button></template>
  <template v-else-if="step === 'edit' && current"><div v-if="items.length > 1" class="memory-batch-rail" aria-label="本次选择的照片"><button v-for="(p, i) in items" :key="p.mediaId" :aria-pressed="index === i" :aria-label="'整理第 ' + (i + 1) + ' 张照片'" @click="index = i"><img :src="p.media.thumbnailUrl" alt="本次照片"><small>{{ i + 1 }} / {{ items.length }}</small></button></div><div v-else class="memory-edit-preview"><img :src="current.media.previewUrl" alt="正在整理的照片"></div>
  <section v-if="current.suggestion" class="memory-suggestion"><strong>拍摄地点建议 · 待确认</strong><p>{{ photoPlaceName(current.suggestion) }}</p><small>{{ current.suggestion.source === 'exif' ? '来自原图的位置资料' : '来自原日记关联地点' }}</small><div class="photo-editor-actions"><button class="memory-text-button" @click="applyPlace(current.suggestion)">确认这个地点</button><button class="memory-text-button" @click="startPlace">修改地点</button></div></section>
  <label class="memory-field"><span>拍摄日期（选填）</span><input v-model="current.takenOn" type="date" aria-label="拍摄日期" @change="current.takenOn ||= null"></label>
  <div class="memory-field"><label>拍摄地点（选填）</label><div class="memory-location-row"><div class="od-field"><strong>{{ photoPlaceName(current.place) }}</strong><small>{{ current.place?.position ? '已确认拍摄位置' : '可以稍后补充位置' }}</small></div><button class="memory-text-button" @click="startPlace">{{ current.place ? '修改地点' : '选择地点' }}</button></div><button v-if="current.place" class="memory-text-button" @click="current.place = null">暂不标注地点</button></div>
  <label v-if="items.length > 1" class="memory-check"><input v-model="applyAll" type="checkbox">将当前日期与地点用于本次全部照片</label>
  <label class="memory-field"><span>这张照片的备注（选填）</span><textarea v-model="current.note" aria-label="这张照片的备注" maxlength="1000" placeholder="一两句就好。"></textarea></label><label class="memory-field"><span>这一组的备注（选填）</span><textarea v-model="groupNote" aria-label="这一组的备注" maxlength="1000" placeholder="如：东湖边，坐着吹了很久的风。"></textarea></label></template>
  <template v-else-if="step === 'place'"><div class="memory-field"><label for="photo-city">拍摄城市（选填）</label><input id="photo-city" v-model="cityName" list="photo-city-options" placeholder="如：武汉市"><datalist id="photo-city-options"><option v-for="city in catalog?.cities" :key="city.code" :value="city.name"/></datalist></div><div class="memory-field"><label for="photo-place-query">搜索拍摄地点</label><div class="photo-search-row"><input id="photo-place-query" v-model="query" placeholder="景点、街道或商店" @keydown.enter.prevent="search"><button class="memory-secondary" :disabled="searching" @click="search">{{ searching ? '搜索中…' : '搜索' }}</button></div></div><button v-for="result in results" :key="result.label + result.location.longitude" class="memory-option" @click="applyPlace({ label: result.label, cityName: result.city, position: result.location, source: 'map' })"><span>{{ result.city }} · {{ result.label }}</span><AtlasIcon name="chevronRight"/></button><label class="memory-field"><span>或先记下地点名称</span><input v-model="placeLabel" aria-label="手工填写拍摄地点" maxlength="100" placeholder="手工填写，位置以后补"></label><div class="photo-editor-actions"><button class="memory-secondary" @click="manualPlace">使用这个名称</button><button class="memory-text-button" @click="picked = null; step = 'pick'">在地图上选点</button></div></template>
  <template v-else-if="step === 'pick'"><PhotoPointPicker :city="cityName" :initial="current?.place?.position || current?.suggestion?.position || null" @pick="picked = $event"/><p class="memory-panel-copy">{{ picked ? '已选中位置，确认后用于这张照片。' : '轻点地图，选择照片拍摄的位置。' }}</p><label class="memory-field"><span>地点名称（选填）</span><input v-model="placeLabel" maxlength="100" placeholder="如：东湖边的小路"></label></template>
  </div><template v-if="step !== 'upload'" #footer><div class="photo-editor-actions"><button v-if="step === 'edit' && !photo" class="memory-secondary" :disabled="busy" @click="writeDraft(); emit('close')">存为草稿</button><button v-if="step === 'edit'" class="memory-primary" :disabled="busy" @click="save">{{ busy ? '正在保存…' : photo ? '保存修改' : '保存 ' + items.length + ' 张照片' }}</button><button v-else-if="step === 'place'" class="memory-secondary" @click="applyPlace(null)">暂不补充地点</button><button v-else class="memory-primary" @click="pointDone">确认拍摄地点</button></div></template></ModalSheet></template>
