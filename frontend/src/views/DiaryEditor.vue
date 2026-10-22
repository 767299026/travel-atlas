<script setup lang="ts">
import { computed, onMounted, onBeforeUnmount, reactive, ref, watch } from 'vue';
import { useRoute, useRouter, onBeforeRouteLeave } from 'vue-router';
import { api, ApiError, errorText, mutationId, session, uploadPhoto } from '../api';
import { clone, type Diary, type DiaryInput, type DiaryAssociationInput, type JourneyList, type JourneySummary, type RouteSnapshot } from '../../../packages/contracts/src/index.js';
import AtlasIcon from '../components/AtlasIcon.vue';
import ModalSheet from '../components/ModalSheet.vue';
const route = useRoute(), router = useRouter(); const id = typeof route.params.id === 'string' ? route.params.id : null;
const form = reactive<DiaryInput>({ title: '', occurredOn: null, body: '', status: 'draft', association: null, photos: [] });
const ready = ref(false), loading = ref(true), saving = ref(false), uploading = ref(false), error = ref(''), uploadError = ref(''), status = ref(''), conflict = ref(false), storageOK = ref(true), modal = ref<'leave' | 'reload' | null>(null);
const version = ref<number | null>(null), baseline = ref(''), journeys = ref<JourneySummary[]>([]), journeyCursor = ref<string | null>(null), selectedRoute = ref<RouteSnapshot | null>(null), linking = ref(false), uploadCount = ref('');
const leavingSaved = ref(false), maxUploadBytes = ref(20 * 1024 * 1024);
const fileInput = ref<HTMLInputElement>(); let originalMedia = new Set<string>(), key: string = mutationId(), lastSubmitted = '', storageKey = '', resolveLeave: ((answer: boolean) => void) | undefined;
let pendingUploads: { file: File; key: string }[] = [];
function clean(): DiaryInput { return { title: form.title, occurredOn: form.occurredOn || null, body: form.body, status: form.status, association: form.association ? { ...form.association } : null, photos: form.photos.map(p => ({ mediaId: p.mediaId, caption: p.caption })) }; }
const signature = computed(() => JSON.stringify(clean())), dirty = computed(() => ready.value && signature.value !== baseline.value);
const selectedJourney = computed(() => journeys.value.find(j => j.id === form.association?.journeyId));
const selectedDay = computed(() => selectedRoute.value?.days.find(d => d.id === form.association?.dayId));
const busy = computed(() => saving.value || uploading.value || linking.value);
function writeDraft() {
  if (!ready.value || !storageKey) return;
  try { if (dirty.value) localStorage.setItem(storageKey, JSON.stringify({ form: clone(form), baseVersion: version.value, baseline: baseline.value, key, originalMedia: [...originalMedia] })); else localStorage.removeItem(storageKey); storageOK.value = true; } catch { storageOK.value = false; }
}
watch(signature, () => { if (ready.value && !saving.value) { key = mutationId(); error.value = ''; status.value = ''; writeDraft(); } }, { flush: 'sync' });
async function loadJourneys(more = false) { const result = await api<JourneyList>('/journeys' + (more && journeyCursor.value ? '?cursor=' + encodeURIComponent(journeyCursor.value) : '')); journeys.value = more ? [...journeys.value, ...result.items] : result.items; journeyCursor.value = result.nextCursor; }
async function loadAssociation() {
  if (!form.association) { selectedRoute.value = null; return; }
  const association = form.association;
  if (!journeys.value.some(j => j.id === association.journeyId)) journeys.value.push(await api<JourneySummary>('/journeys/' + association.journeyId));
  selectedRoute.value = association.routeId ? await api<RouteSnapshot>('/routes/' + association.routeId) : null;
}
async function load() {
  loading.value = true; ready.value = false; error.value = '';
  try {
    await loadJourneys(); maxUploadBytes.value = (await api<{ uploadMaxBytes: number }>('/media/capabilities')).uploadMaxBytes; const server = id ? await api<Diary>('/diaries/' + id) : null;
    if (server) {
      Object.assign(form, { title: server.title, occurredOn: server.occurredOn, body: server.body, status: server.status, photos: clone(server.photos), association: server.association ? { journeyId: server.association.journeyId, routeId: server.association.routeId, dayId: server.association.dayId, stopId: server.association.stopId } : null });
      version.value = server.version; originalMedia = new Set(server.photos.map(p => p.mediaId));
    } else if (typeof route.query.journeyId === 'string') form.association = { journeyId: route.query.journeyId, routeId: typeof route.query.routeId === 'string' ? route.query.routeId : null, dayId: typeof route.query.dayId === 'string' ? route.query.dayId : null, stopId: typeof route.query.stopId === 'string' ? route.query.stopId : null };
    await loadAssociation(); if (!server && selectedDay.value?.date) form.occurredOn = selectedDay.value.date;
    baseline.value = signature.value;
    let tab = 'fallback'; try { tab = sessionStorage.getItem('tj:tab') || mutationId(); sessionStorage.setItem('tj:tab', tab); } catch { storageOK.value = false; }
    storageKey = `tj:diary:${session.value!.user.id}:${id ?? route.fullPath}:${tab}`;
    try { const savedText = localStorage.getItem(storageKey); if (savedText) {
      const draft = JSON.parse(savedText); if (!draft.form || !Array.isArray(draft.form.photos) || draft.form.photos.length > 24 || typeof draft.key !== 'string') throw new Error();
      Object.assign(form, draft.form); version.value = draft.baseVersion; baseline.value = draft.baseline; key = draft.key; originalMedia = new Set(draft.originalMedia ?? []); conflict.value = !!server && server.version !== draft.baseVersion; status.value = '已恢复本机日记草稿'; await loadAssociation();
    } } catch { error.value = '本机草稿暂时无法完整恢复，请保留页面并核对关联信息。'; }
    ready.value = true;
  } catch (e) { error.value = errorText(e); } finally { loading.value = false; }
}
onMounted(load);
async function selectJourney(value: string) {
  linking.value = true; error.value = '';
  try { if (!value) { form.association = null; selectedRoute.value = null; return; } form.association = { journeyId: value, routeId: null, dayId: null, stopId: null }; selectedRoute.value = null; }
  finally { linking.value = false; }
}
async function selectRoute(value: string) {
  if (!form.association) return; linking.value = true; error.value = '';
  try { const snapshot = value ? await api<RouteSnapshot>('/routes/' + value) : null; form.association = { ...form.association, routeId: value || null, dayId: null, stopId: null }; selectedRoute.value = snapshot; }
  catch (e) { error.value = errorText(e); } finally { linking.value = false; }
}
function selectDay(value: string) { if (!form.association) return; form.association = { ...form.association, dayId: value || null, stopId: null }; if (!form.occurredOn && selectedDay.value?.date) form.occurredOn = selectedDay.value.date; }
function selectStop(value: string) { if (form.association) form.association = { ...form.association, stopId: value || null }; }
async function save(target: 'draft' | 'written') {
  if (busy.value || conflict.value || !ready.value) return;
  if (!form.title.trim()) { error.value = '请先给日记写个标题。'; return; }
  form.status = target; writeDraft(); const input = clean();
  if (lastSubmitted && lastSubmitted !== signature.value) key = mutationId(); lastSubmitted = signature.value;
  saving.value = true; error.value = '';
  try {
    const result = await api<Diary>(id ? '/diaries/' + id : '/diaries', id ? 'PUT' : 'POST', { ...input, ...(id ? { baseVersion: version.value } : {}), clientMutationId: key });
    baseline.value = signature.value; version.value = result.version; originalMedia = new Set(result.photos.map(p => p.mediaId)); writeDraft(); status.value = '已保存到服务器'; leavingSaved.value = true; await router.replace('/diaries/' + result.id);
  } catch (e) { error.value = errorText(e); if (e instanceof ApiError && e.status === 409) conflict.value = true; writeDraft(); }
  finally { saving.value = false; }
}
async function uploadSelected(files: FileList | null) {
  if (!files || busy.value) return; const picked = [...files]; if (fileInput.value) fileInput.value.value = '';
  if (form.photos.length + pendingUploads.length + picked.length > 24) { uploadError.value = '每篇日记最多保留 24 张照片，未完成的上传也计入；可以先移除未完成的上传再选图。'; return; }
  pendingUploads.push(...picked.map(file => ({ file, key: mutationId() }))); await uploadPending();
}
async function uploadPending() {
  uploading.value = true; uploadError.value = ''; const total = pendingUploads.length; let finished = 0;
  try {
    while (pendingUploads.length) {
      const next = pendingUploads[0]!; uploadCount.value = `正在上传 ${finished + 1} / ${total}：${next.file.name}`;
      if (next.file.size > maxUploadBytes.value) throw new Error(`单张照片最多 ${Math.floor(maxUploadBytes.value / 1048576)}MB，请缩小后重选。`);
      const image = await uploadPhoto(next.file, next.key); form.photos.push({ mediaId: image.id, caption: '', media: image }); pendingUploads.shift(); finished++;
    }
  } catch (e) { uploadError.value = errorText(e); } finally { uploading.value = false; uploadCount.value = ''; writeDraft(); }
}
function discardUploads() { pendingUploads = []; uploadError.value = ''; }
function removePhoto(index: number) { if (busy.value || !window.confirm('移除这张照片？保存日记后，已关联的原图也会删除。')) return; const [photo] = form.photos.splice(index, 1); if (photo && !originalMedia.has(photo.mediaId)) void api('/media/' + photo.mediaId, 'DELETE').catch(() => { uploadError.value = '未关联照片的清理尚未确认，将由后续维护清理。'; }); }
function movePhoto(index: number, offset: number) { const photo = form.photos[index]; if (!photo || index + offset < 0 || index + offset >= form.photos.length || busy.value) return; form.photos.splice(index, 1); form.photos.splice(index + offset, 0, photo); }
function download() { const blob = new Blob([JSON.stringify({ form: clean(), version: version.value }, null, 2)], { type: 'application/json' }); const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = '迹屿-日记草稿.json'; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); }
function leave(answer: boolean, discard = false) { if (discard) { baseline.value = signature.value; try { localStorage.removeItem(storageKey); } catch {} } else writeDraft(); modal.value = null; const resolve = resolveLeave; resolveLeave = undefined; resolve?.(answer); }
async function reload() { if (!id) return; saving.value = true; try { const result = await api<Diary>('/diaries/' + id); Object.assign(form, { title: result.title, occurredOn: result.occurredOn, body: result.body, status: result.status, association: result.association ? { journeyId: result.association.journeyId, routeId: result.association.routeId, dayId: result.association.dayId, stopId: result.association.stopId } : null, photos: result.photos }); version.value = result.version; baseline.value = signature.value; conflict.value = false; error.value = ''; originalMedia = new Set(result.photos.map(p => p.mediaId)); writeDraft(); await loadAssociation(); modal.value = null; } catch (e) { error.value = errorText(e); } finally { saving.value = false; } }
onBeforeRouteLeave(() => { if (leavingSaved.value) return true; if (busy.value) { error.value = '正在上传或保存，请稍候再离开。'; return false; } if (!dirty.value) return true; return new Promise<boolean>(resolve => { resolveLeave = resolve; modal.value = 'leave'; }); });
const beforeUnload = (event: BeforeUnloadEvent) => { if (dirty.value || busy.value) { event.preventDefault(); event.returnValue = ''; } };
onMounted(() => window.addEventListener('beforeunload', beforeUnload));
onBeforeUnmount(() => { writeDraft(); window.removeEventListener('beforeunload', beforeUnload); resolveLeave?.(false); });
</script>
<template><section class="flow-view"><header class="flow-topbar"><button class="icon-button" aria-label="返回日记" :disabled="busy" @click="router.push(id ? '/diaries/' + id : '/memories')"><AtlasIcon name="back"/></button><h2>{{ id ? '编辑日记' : '写下这一程' }}</h2><span class="icon-button"/></header><form class="flow-scroll flow-form diary-editor" @submit.prevent="save('written')"><p v-if="loading" class="form-intro">正在打开草稿…</p><p v-if="error" class="flow-form-errors" role="alert">{{ error }}<button v-if="conflict" type="button" class="text-button" @click="modal = 'reload'">核对后加载服务器版本</button></p><template v-if="ready"><div v-if="dirty" class="flow-draft-banner"><div class="draft-info"><strong>日记尚未保存到服务器</strong><span>{{ storageOK ? '文字和照片关联草稿已保留在此浏览器页面' : '本机存储不可用，请下载草稿并保持页面打开' }}</span></div><button type="button" @click="download">下载草稿</button></div><p v-if="status" class="flow-save-state" role="status">{{ status }}</p><fieldset class="diary-fields" :disabled="busy || conflict"><div class="flow-field"><label for="diary-title">日记标题</label><input id="diary-title" v-model="form.title" required maxlength="120" placeholder="给这段回忆起个名字"></div><div class="flow-field"><label for="diary-date">记录日期 · 选填</label><input id="diary-date" v-model="form.occurredOn" type="date" min="1900-01-01" max="2200-12-31"></div><details class="diary-link-options" :open="!!form.association"><summary><AtlasIcon name="route" :size="17"/>{{ form.association ? '已关联旅程 · 可修改' : '关联旅程、某一天或地点 · 选填' }}</summary><div class="flow-field"><label for="diary-journey">关联旅程</label><select id="diary-journey" :value="form.association?.journeyId ?? ''" @change="selectJourney(($event.target as HTMLSelectElement).value)"><option value="">独立日记，不关联旅程</option><option v-for="journey in journeys" :key="journey.id" :value="journey.id">{{ journey.title }}</option></select><button v-if="journeyCursor" type="button" class="text-button" @click="loadJourneys(true)">加载更多旅程选项</button></div><div v-if="form.association && selectedJourney" class="flow-field"><label for="diary-route">关联范围</label><select id="diary-route" :value="form.association.routeId ?? ''" @change="selectRoute(($event.target as HTMLSelectElement).value)"><option value="">整次旅程</option><option :value="selectedJourney.planRouteId">计划安排中的日期或地点</option><option v-if="selectedJourney.actualRouteId" :value="selectedJourney.actualRouteId">实际记录中的日期或地点</option></select></div><div v-if="selectedRoute" class="flow-field"><label for="diary-day">关联日期</label><select id="diary-day" :value="form.association?.dayId ?? ''" @change="selectDay(($event.target as HTMLSelectElement).value)"><option value="">不限某一天</option><option v-for="(day,index) in selectedRoute.days" :key="day.id" :value="day.id">第 {{ index + 1 }} 天 · {{ day.title }}</option></select><small v-if="form.association?.dayId && !selectedDay">原日期已移除，保留原名称快照；可以重新选择。</small></div><div v-if="selectedDay" class="flow-field"><label for="diary-stop">关联地点</label><select id="diary-stop" :value="form.association?.stopId ?? ''" @change="selectStop(($event.target as HTMLSelectElement).value)"><option value="">不限某个地点</option><option v-for="stop in selectedDay.stops" :key="stop.id" :value="stop.id">{{ stop.label }}</option></select></div></details><div class="flow-field"><label for="diary-body">正文</label><textarea id="diary-body" v-model="form.body" class="journal-body" maxlength="14000" rows="12" placeholder="天气、风景、路上的人，或一件想记得的小事。"></textarea><small>{{ form.body.length }} / 14000 字</small></div></fieldset><section class="diary-photo-editor"><div class="section-row"><h3>照片与说明</h3><span class="small muted">{{ form.photos.length }} / 24</span></div><p class="small muted">支持 JPG、PNG、WebP，单张最多 {{ Math.floor(maxUploadBytes / 1048576) }}MB。原图私密保存，阅读图会移除位置等元数据。</p><div class="photo-edit-grid"><article v-for="(photo,index) in form.photos" :key="photo.mediaId" class="photo-edit-card"><img v-if="photo.media" :src="photo.media.thumbnailUrl" :alt="photo.caption || `第 ${index + 1} 张照片`" loading="lazy"><div class="flow-field"><label :for="'caption-' + photo.mediaId">照片 {{ index + 1 }} 的说明</label><textarea :id="'caption-' + photo.mediaId" v-model="photo.caption" :disabled="busy || conflict" maxlength="500" rows="2"></textarea></div><div class="photo-edit-tools"><button class="icon-button" type="button" :aria-label="`照片${index + 1}前移`" :disabled="busy || conflict || index === 0" @click="movePhoto(index, -1)"><AtlasIcon name="up" :size="17"/></button><button class="icon-button" type="button" :aria-label="`照片${index + 1}后移`" :disabled="busy || conflict || index === form.photos.length - 1" @click="movePhoto(index, 1)"><AtlasIcon name="down" :size="17"/></button><button class="text-button" type="button" :disabled="busy || conflict" @click="removePhoto(index)">移除照片</button></div></article></div><input ref="fileInput" class="visually-hidden" id="diary-photos" type="file" multiple accept="image/jpeg,image/png,image/webp" :disabled="busy || conflict" @change="uploadSelected(($event.target as HTMLInputElement).files)"><button type="button" class="flow-upload full" :disabled="busy || conflict || form.photos.length >= 24" @click="fileInput?.click()"><AtlasIcon name="image"/>添加旅行照片</button><p v-if="uploadCount" class="flow-save-state" role="status">{{ uploadCount }}</p><p v-if="uploadError" class="flow-form-errors" role="alert">{{ uploadError }}<button v-if="pendingUploads.length" type="button" class="text-button" :disabled="busy" @click="uploadPending">重试未完成的上传</button><button v-if="pendingUploads.length" type="button" class="text-button" :disabled="busy" @click="discardUploads">移除未完成的上传，重新选图</button></p><p class="small muted">上传成功后，请保存日记以关联照片。未关联照片可由维护任务在 7 天后清理。</p></section><p class="private-editor-note"><AtlasIcon name="lock" :size="15"/>这篇日记和照片仅自己可见。</p></template></form><footer v-if="ready" class="flow-bottom"><button class="secondary-button" :disabled="busy || conflict" @click="save('draft')">保存草稿</button><button class="primary" :disabled="busy || conflict" @click="save('written')">{{ saving ? '正在保存…' : '保存记录' }}<AtlasIcon name="check" :size="18"/></button></footer><ModalSheet v-if="modal" :title="modal === 'leave' ? '日记尚未保存' : '核对日记草稿'" :busy="saving" @close="modal === 'leave' ? leave(false) : modal = null"><p class="confirm-copy">{{ modal === 'leave' ? '可以保留本机草稿，下次在此页面继续。只有服务器确认保存后，日记和照片关联才会生效。' : '先下载当前草稿，再加载服务器版本进行核对。加载成功会放弃此页面待提交的文字和照片关联修改。' }}</p><button class="text-button full" @click="download">下载当前草稿</button><template #footer><div v-if="modal === 'leave'" class="modal-actions"><button class="primary" :disabled="!storageOK" @click="leave(true)">保留日记草稿并离开</button><button class="secondary-button" @click="leave(false)">继续写日记</button><button class="text-button" @click="leave(true, true)">放弃本次修改并离开</button></div><div v-else class="modal-actions"><button class="primary" :disabled="saving" @click="reload">放弃本页修改，加载服务器版本</button><button class="secondary-button" :disabled="saving" @click="modal = null">保留本机草稿</button></div></template></ModalSheet></section></template>
