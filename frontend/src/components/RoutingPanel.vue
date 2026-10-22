<script setup lang="ts">
import { computed, onMounted, onBeforeUnmount, ref, watch } from 'vue';
import { api, ApiError, errorText, mutationId } from '../api';
import type { GeometryAsset, RouteSnapshot, RoutingCapabilities, RoutingJob, RoutingCandidate } from '../../../packages/contracts/src/index.js';
const props = defineProps<{ route: RouteSnapshot; segmentId: string; blocked: boolean }>();
const emit = defineEmits<{ preview: [candidate: RoutingCandidate | null]; adopted: [result: { route: RouteSnapshot; asset: GeometryAsset }]; busy: [value: boolean] }>();
const capabilities = ref<RoutingCapabilities | null>(null), jobs = ref<RoutingJob[]>([]), candidate = ref<RoutingCandidate | null>(null), show = ref(false), loading = ref(false), busy = ref(false), error = ref(''), message = ref(''), acknowledge = ref(false);
let timer: ReturnType<typeof setTimeout> | undefined, generation = 0, disposed = false, createKey = mutationId(), createSignature = '', adoptKey = mutationId(), adoptSignature = '';
const segment = computed(() => props.route.segments.find(s => s.id === props.segmentId)), activeJob = computed(() => jobs.value.find(j => j.status === 'queued' || j.status === 'running'));
const disabledReason = computed(() => {
  if (!capabilities.value?.enabled) return '本机区域规划尚未启用；手工补绘和 GPX 仍可使用。';
  if (props.blocked) return '先保存本页行程或路径修改，再计算候选。';
  if (!segment.value || segment.value.kind !== 'travel' || segment.value.mode !== 'hike') return '当前只支持徒步连接；请先明确交通方式并保存。';
  if (segment.value.geometryLocked) return '当前路径已保护，先解除保护并保存，再计算替换候选。';
  const stops = props.route.days.flatMap(d => d.stops); if ([segment.value.fromStopId, segment.value.toStopId].some(id => stops.find(p => p.id === id)?.location?.crs !== 'WGS84')) return '请先在户外地图或自有坐标中核对 WGS84 起终点，不会反向转换高德位置。';
  return '';
});
const coverage = computed(() => capabilities.value?.tiles.map(tile => { const [, lon, lat] = /^E(\d+)_N(\d+)$/.exec(tile) ?? []; const name = tile === 'E115_N30' ? '黄山／徽杭周边' : tile === 'E100_N30' ? '长坪沟周边' : '已安装区域'; return `${name}（东经 ${lon}–${Number(lon) + 5}°，北纬 ${lat}–${Number(lat) + 5}°）`; }).join('；'));
const statusLabels: Record<RoutingJob['status'], string> = { queued: '等待计算', running: '正在计算', succeeded: '候选已生成', failed: '计算未完成', cancelled: '已取消', obsolete: '输入已变化，旧结果未采用' };
watch(busy, value => emit('busy', value));
function schedule() { clearTimeout(timer); if (!disposed && activeJob.value) timer = setTimeout(() => { void refresh(); }, 1500); }
async function refresh() {
  const current = ++generation; clearTimeout(timer); loading.value = true;
  try {
    const list = await api<RoutingJob[]>(`/routes/${props.route.id}/routing-jobs?segmentId=${encodeURIComponent(props.segmentId)}`); if (disposed || current !== generation) return;
    jobs.value = list;
    if (candidate.value) { const next = await api<RoutingCandidate>('/routing-candidates/' + candidate.value.id); if (disposed || current !== generation) return; candidate.value = next; if (show.value) emit('preview', next); }
    error.value = '';
  } catch (e) { if (!disposed && current === generation) error.value = errorText(e); } finally { if (!disposed && current === generation) { loading.value = false; schedule(); } }
}
async function initialize() { try { capabilities.value = await api('/routing/capabilities'); await refresh(); } catch (e) { if (!disposed) error.value = errorText(e); } }
onMounted(initialize);
watch(() => `${props.route.id}:${props.segmentId}`, () => { candidate.value = null; show.value = false; acknowledge.value = false; emit('preview', null); message.value = ''; createKey = mutationId(); createSignature = ''; void refresh(); });
watch(() => props.route.version, () => { acknowledge.value = false; void refresh(); });
async function create() {
  if (busy.value || activeJob.value || disabledReason.value) return; const signature = `${props.route.id}:${props.segmentId}:${props.route.version}`; if (createSignature && createSignature !== signature) createKey = mutationId(); createSignature = signature;
  busy.value = true; error.value = ''; message.value = '';
  try { const job = await api<RoutingJob>(`/routes/${props.route.id}/segments/${props.segmentId}/routing-jobs`, 'POST', { baseVersion: props.route.version, clientMutationId: createKey }); createKey = mutationId(); createSignature = ''; jobs.value = [job, ...jobs.value.filter(j => j.id !== job.id)]; message.value = '任务已提交，只会生成候选，不会自动替换路径。'; schedule(); }
  catch (e) { error.value = errorText(e); } finally { busy.value = false; }
}
async function cancel(job: RoutingJob) {
  busy.value = true; error.value = ''; try { const result = await api<RoutingJob>('/routing-jobs/' + job.id + '/cancel', 'POST', { clientMutationId: mutationId() }); jobs.value = jobs.value.map(j => j.id === result.id ? result : j); schedule(); } catch (e) { error.value = errorText(e); } finally { busy.value = false; }
}
async function preview(job: RoutingJob) {
  if (!job.candidateId) return; const current = ++generation; clearTimeout(timer); loading.value = true; error.value = ''; acknowledge.value = false;
  try { const next = await api<RoutingCandidate>('/routing-candidates/' + job.candidateId); if (disposed || current !== generation) return; candidate.value = next; show.value = true; emit('preview', next); } catch (e) { if (!disposed && current === generation) error.value = errorText(e); } finally { if (!disposed && current === generation) { loading.value = false; schedule(); } }
}
function closePreview() { show.value = false; emit('preview', null); }
async function adopt() {
  if (!candidate.value || !candidate.value.adoptable || !acknowledge.value || props.blocked || busy.value) return;
  const body = { baseVersion: props.route.version, expectedGeometryRef: segment.value!.geometryRef, acknowledge: acknowledge.value };
  const signature = candidate.value.id + JSON.stringify(body); if (adoptSignature && adoptSignature !== signature) adoptKey = mutationId(); adoptSignature = signature;
  busy.value = true; error.value = ''; message.value = '';
  try { const result = await api<{ route: RouteSnapshot; asset: GeometryAsset }>('/routing-candidates/' + candidate.value.id + '/adopt', 'POST', { ...body, clientMutationId: adoptKey }); closePreview(); emit('adopted', result); message.value = '候选已采纳到当前路段；请核对并保存路径确认。'; await refresh(); }
  catch (e) { if (e instanceof ApiError && e.status === 409) { acknowledge.value = false; await refresh(); } error.value = errorText(e); } finally { busy.value = false; }
}
onBeforeUnmount(() => { disposed = true; generation++; clearTimeout(timer); emit('preview', null); emit('busy', false); });
</script>
<template><section class="routing-panel"><h4>沿路网生成徒步候选</h4><p class="small muted">使用本机 BRouter 和已安装的 OSM 区域路网；地图上看得到路，不代表一定能规划。候选需要你核对后采纳。</p><p v-if="capabilities?.enabled" class="small muted">当前路网范围：{{ coverage }}；起终点间距 10m–50km，当前仅支持徒步。</p><p v-if="disabledReason" class="map-notice">{{ disabledReason }}</p><div class="map-button-row"><button class="primary" :disabled="!!disabledReason || !!activeJob || busy" @click="create">{{ busy ? '正在提交…' : '计算徒步候选' }}</button><button class="text-button" :disabled="busy || loading" @click="refresh">刷新任务</button></div><p v-if="message" class="flow-save-state" role="status">{{ message }}</p><p v-if="error" class="flow-form-errors" role="alert">{{ error }}</p><ul class="routing-jobs"><li v-for="job in jobs" :key="job.id"><div><strong>{{ statusLabels[job.status] }}</strong><small>{{ new Date(job.createdAt).toLocaleString('zh-CN') }}</small><p v-if="job.failure">{{ job.failure.message }}</p></div><button v-if="job.status === 'queued' || job.status === 'running'" class="text-button" :disabled="busy" @click="cancel(job)">取消此任务</button><button v-if="job.candidateId" class="text-button" :disabled="busy || loading" @click="preview(job)">查看此候选</button></li></ul><p v-if="!jobs.length && !loading" class="small muted">还没有计算任务；不会在后台自动规划。</p><article v-if="candidate" class="routing-candidate"><h4>候选预览 · 非 GPS 实录</h4><p>二维线长约 {{ (candidate.lengthM / 1000).toFixed(2) }}km；服务里程 {{ candidate.info.providerDistanceM === null ? '未提供' : (candidate.info.providerDistanceM / 1000).toFixed(2) + 'km' }}；模型耗时 {{ candidate.info.estimatedTimeS === null ? '未提供' : Math.round(candidate.info.estimatedTimeS / 60) + ' 分钟' }}。</p><p class="small muted">起点贴合偏移 {{ Math.round(candidate.info.fromOffsetM) }}m，终点偏移 {{ Math.round(candidate.info.toOffsetM) }}m；模型耗时不是个人运动时间。</p><ul><li v-for="d in candidate.diagnostics" :key="d">{{ d }}</li></ul><p v-if="candidate.adoptedAssetId" class="flow-save-state">此候选已经采纳，当前路径仍需独立核对。</p><p v-else-if="!candidate.adoptable" class="flow-form-errors">候选已过期、输入或路径状态变化，不能覆盖当前路径；请刷新行程或重新计算。</p><p class="small muted routing-attribution">{{ candidate.info.attribution }}</p><details><summary>候选来源版本</summary><p class="small muted">BRouter {{ candidate.info.engineVersion }} / {{ candidate.info.profile }}<br>profile {{ candidate.info.profileSha256 }}<br>区域数据 {{ candidate.info.dataVersion }}</p></details><div class="map-button-row"><button class="text-button" @click="show ? closePreview() : (show = true, emit('preview', candidate))">{{ show ? '返回当前路径显示' : '在地图显示此候选' }}</button></div><label class="map-check"><input v-model="acknowledge" type="checkbox" :disabled="!candidate.adoptable || busy || blocked">已查看来源、端点和诊断，确认将此候选替换到当前路段。</label><button class="primary" :disabled="!acknowledge || !candidate.adoptable || busy || blocked" @click="adopt">采纳此候选</button></article></section></template>
