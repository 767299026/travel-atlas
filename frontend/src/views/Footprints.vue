<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import { api, errorText, mutationId } from '../api';
import { loadAtlasCatalog } from '../atlasCatalog';
import type { AtlasCatalog, AtlasOverview, AtlasDetail, AtlasRecord, PlaceInput } from '../../../packages/contracts/src/index.js';
import AtlasMap from '../components/AtlasMap.vue';
import CityFootprintMap from '../components/CityFootprintMap.vue';
import AtlasIcon from '../components/AtlasIcon.vue';
import ModalSheet from '../components/ModalSheet.vue';
import PlaceRecordForm from '../components/PlaceRecordForm.vue';
import '../styles/atlas.css';
const router = useRouter(), overview = ref<AtlasOverview | null>(null), catalog = ref<AtlasCatalog | null>(null), scope = ref('100000'), country = ref(''), year = ref('all'), query = ref(''), selected = ref<string | null>(null), detail = ref<AtlasDetail | null>(null), expanded = ref(false), loading = ref(true), busy = ref(false), error = ref(''), detailError = ref('');
const filterPanel = ref<'time' | 'search' | null>(null);
const wide = ref(false), drawerOpen = computed(() => wide.value || expanded.value);
let media: MediaQueryList | undefined;
function syncWidth() { wide.value = media?.matches ?? false; }
onMounted(() => { media = matchMedia('(min-width: 800px)'); syncWidth(); media.addEventListener('change', syncWidth); });
onBeforeUnmount(() => media?.removeEventListener('change', syncWidth));
const addMenu = ref(false), form = ref<{ kind: 'visited' | 'wish'; record?: AtlasRecord; assign?: boolean } | null>(null), unassigned = ref<AtlasRecord[]>([]), showUnassigned = ref(false); let generation = 0, detailGeneration = 0;
const world = computed(() => scope.value === 'world'), countryName = computed(() => catalog.value?.countries.find(c => c.code === country.value)?.name), scopeName = computed(() => world.value ? countryName.value || '世界足迹' : catalog.value?.cities.find(c => c.code === scope.value)?.name || catalog.value?.provinces.find(p => p.code === scope.value)?.name || '中国足迹');
const scopedPlaces = computed(() => overview.value?.places.filter(p => world.value ? !country.value || p.place.countryCode === country.value : scope.value === '100000' ? p.place.countryCode === 'CHN' : p.place.provinceCode === scope.value || p.place.cityCode === scope.value) ?? []);
const cityScope = computed(() => !world.value && !!catalog.value?.cities.some(c => c.code === scope.value));
const focusedRecord = ref(''), cityRevision = ref(0);
async function savedRecord() { await load(); cityRevision.value++; }
function enterCity(code: string) { scope.value = code; country.value = ''; expanded.value = false; }
async function focusRecord(id: string) { focusedRecord.value = id; if (!detail.value || detail.value.place.cityCode !== scope.value) await openCity('CHN:' + scope.value); expanded.value = true; await nextTick(); document.getElementById('atlas-record-' + id)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); }
const lit = computed(() => scopedPlaces.value.filter(p => p.records > 0));
const stats = computed(() => ({ countries: new Set(lit.value.map(p => p.place.countryCode)).size, provinces: new Set(lit.value.map(p => p.place.provinceCode).filter(Boolean)).size, cities: lit.value.filter(p => p.place.cityName).length, records: lit.value.reduce((n, p) => n + p.records, 0) }));
const searchResults = computed(() => {
  const terms = query.value.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
  const matches = (value: string) => terms.every(term => value.toLocaleLowerCase().includes(term));
  const recorded = (overview.value?.places ?? []).filter(p => matches([p.place.name, p.place.provinceName, p.place.countryName].filter(Boolean).join(' '))).map(p => ({ key: p.place.key, name: p.place.name, region: p.place.provinceName || p.place.countryName, status: p.records ? p.records + ' 条到访' : '想去' }));
  const keys = new Set(recorded.map(p => p.key)); const cities = catalog.value?.cities.filter(c => terms.length > 0 && matches(c.name + ' ' + (catalog.value!.provinces.find(p => p.code === c.provinceCode)?.name || ''))).slice(0, 20).map(c => ({ key: 'CHN:' + c.code, name: c.name, region: catalog.value!.provinces.find(p => p.code === c.provinceCode)?.name || '', status: '查看城市' })).filter(c => !keys.has(c.key)) ?? []; return [...recorded, ...cities].slice(0, 20);
});
const initial = computed<PlaceInput | null>(() => detail.value ? null : world.value && country.value && country.value !== 'CHN' ? { countryCode: country.value, cityName: '' } : !world.value && scope.value !== '100000' ? { countryCode: 'CHN', areaCode: scope.value } : null);
async function load() { const current = ++generation; loading.value = true; error.value = ''; try { const [data, list] = await Promise.all([api<AtlasOverview>('/atlas?year=' + year.value), loadAtlasCatalog().catch(() => null)]); if (current !== generation) return; overview.value = data; catalog.value = list; if (!list) error.value = '地区目录暂不可用，已保存足迹仍可查看；新增或调整归属可稍后重试。'; if (selected.value) await openCity(selected.value, false, expanded.value); } catch (e) { if (current === generation) error.value = errorText(e); } finally { if (current === generation) loading.value = false; } }
onMounted(load);
async function selectYear() { filterPanel.value = null; detail.value = null; await load(); }
function selectRegion(value: string) { changeScope(value); filterPanel.value = null; }
function selectCountry() { selected.value = null; detail.value = null; detailGeneration++; filterPanel.value = null; }
function changeScope(value: string) { scope.value = value; country.value = ''; selected.value = null; detail.value = null; detailGeneration++; query.value = ''; expanded.value = false; }
async function searchCity(key: string) {
  filterPanel.value = null;
  if (cityScope.value && /^CHN:\d{6}$/.test(key) && catalog.value?.cities.some(c => c.code === key.slice(4))) { enterCity(key.slice(4)); await openCity(key, false, false); } else await openCity(key);
}
async function openCity(key: string, more = false, expand = true) {
  const current = ++detailGeneration; selected.value = key; detailError.value = ''; expanded.value = expand; if (!more) detail.value = null;
  try { const next = await api<AtlasDetail>('/atlas/places/' + encodeURIComponent(key) + '?year=' + year.value + (more && detail.value?.nextCursor ? '&cursor=' + detail.value.nextCursor : '')); if (current !== detailGeneration) return; if (more && detail.value) next.records = [...detail.value.records, ...next.records]; detail.value = next; query.value = ''; }
  catch (e) { if (current === detailGeneration) detailError.value = errorText(e); }
}
function region(code: string) {
  if (world.value) { if (code === 'CHN') changeScope('100000'); else { country.value = code; selected.value = null; detail.value = null; expanded.value = true; } return; }
  if (catalog.value?.cities.some(p => p.code === code && p.code === p.provinceCode)) { enterCity(code); void openCity('CHN:' + code, false, false); return; }
  if (catalog.value?.provinces.some(p => p.code === code)) { changeScope(code); return; }
  if (catalog.value?.cities.some(p => p.code === code)) { enterCity(code); void openCity('CHN:' + code, false, false); }
}
function up() { const city = catalog.value?.cities.find(c => c.code === scope.value); changeScope(city && city.code !== city.provinceCode ? city.provinceCode : '100000'); }
function record(kind: 'visited' | 'wish', row?: AtlasRecord, assign = false) { addMenu.value = false; showUnassigned.value = false; form.value = { kind, ...(row ? { record: row } : {}), assign }; }
async function pending() { busy.value = true; try { unassigned.value = await api('/atlas/unassigned?year=' + year.value); showUnassigned.value = true; } catch (e) { error.value = errorText(e); } finally { busy.value = false; } }
async function remove(row: AtlasRecord) {
  if (busy.value || !window.confirm(row.source === 'wish' ? '移除这条城市心愿？' : '取消这条到访记录？行程与日记会保留。')) return; busy.value = true;
  try { await api(row.source === 'journey' ? '/visits/' + row.id : '/atlas/records/' + row.id, 'DELETE', { clientMutationId: mutationId(), ...(row.source !== 'journey' ? { baseVersion: row.version } : {}) }); await savedRecord(); } catch (e) { error.value = errorText(e); } finally { busy.value = false; }
}
function plan() { if (detail.value) router.push({ path: '/journeys/new', query: { destination: detail.value.place.name, title: detail.value.place.name + '之行' } }); }
</script>
<template>
<section class="footprint-view">
  <header class="atlas-controls">
    <div class="atlas-mode">
      <div class="segmented">
        <button :aria-pressed="!world" @click="changeScope('100000')">中国</button>
        <button :aria-pressed="world" @click="changeScope('world')">世界</button>
      </div>
      <div class="atlas-quick-actions">
        <button class="atlas-filter-button" :class="{ active: year !== 'all' }" aria-haspopup="dialog" :aria-expanded="filterPanel === 'time'" @click="filterPanel = 'time'"><AtlasIcon name="calendar" :size="18"/><span>时光</span></button>
        <button class="atlas-filter-button" aria-haspopup="dialog" :aria-expanded="filterPanel === 'search'" @click="filterPanel = 'search'"><AtlasIcon name="search" :size="18"/><span>寻找</span></button>
      </div>
    </div>
  </header>
  <ModalSheet v-if="filterPanel === 'time'" title="时光" placement="top" class="atlas-filter-panel" @close="filterPanel = null">
    <label class="atlas-filter-field"><span>年份</span><select v-model="year" aria-label="足迹年份" autofocus @change="selectYear"><option value="all">全部年份</option><option v-for="y in overview?.years" :key="y" :value="y">{{ y === 'unknown' ? '年份待补充' : y + ' 年' }}</option></select></label>
  </ModalSheet>
  <ModalSheet v-if="filterPanel === 'search'" title="寻找" placement="top" class="atlas-filter-panel" @close="filterPanel = null; query = ''">
    <label class="atlas-search"><AtlasIcon name="search" :size="18"/><input v-model="query" type="search" aria-label="搜索城市足迹" placeholder="城市或地区" autofocus></label>
    <label class="atlas-filter-field"><span>{{ world ? '国家／地区' : '地区' }}</span>
      <select v-if="!world" :value="scope" aria-label="足迹地区" @change="selectRegion(($event.target as HTMLSelectElement).value)"><option value="100000">全部省份</option><option v-for="p in catalog?.provinces" :key="p.code" :value="p.code">{{ p.name }}</option><option v-if="catalog?.cities.some(c => c.code === scope && c.code !== c.provinceCode)" :value="scope">{{ scopeName }}</option></select>
      <select v-else v-model="country" aria-label="国家足迹范围" @change="selectCountry"><option value="">全部国家／地区</option><option v-for="c in catalog?.countries" :key="c.code" :value="c.code">{{ c.name }}</option></select>
    </label>
    <div class="atlas-search-results">
      <button v-for="result in searchResults" :key="result.key" class="city-result" @click="searchCity(result.key)"><span><strong>{{ result.name }}</strong><small>{{ result.region }}</small></span><small>{{ result.status }}</small></button>
      <p v-if="query.trim() && !searchResults.length" class="muted">没有找到匹配城市</p>
    </div>
  </ModalSheet>
  <div class="atlas-workspace" :class="{ 'city-scope': cityScope, 'drawer-open': expanded }"><CityFootprintMap v-if="cityScope" :key="scope" :code="scope" :year="year" :revision="cityRevision" @record="focusRecord" @journey="router.push('/journeys/' + $event + '/actual')"/><AtlasMap v-else :scope="scope" :places="overview?.places ?? []" :selected="selected" @region="region" @place="openCity($event)"/><div class="atlas-map-heading"><button v-if="!world && scope !== '100000'" class="text-button" @click="up"><AtlasIcon name="back" :size="16"/>返回上一级</button><button v-else-if="world && country" class="text-button" @click="country = ''">查看全部国家／地区</button><h2>{{ scopeName }}</h2><p class="eyebrow">ONE MEMORY AT A TIME</p></div><p v-if="loading || error" class="atlas-data-message" :role="error ? 'alert' : 'status'">{{ error || '正在读取你的足迹…' }}<button v-if="error" class="text-button" @click="load">重新读取</button></p><div class="atlas-map-bottom"><p v-if="cityScope" class="atlas-city-caption">点击到访点，打开沿途记录</p><div class="range-stat"><strong>{{ world ? stats.countries + ' 个国家／地区' : stats.provinces + ' 个省级地区' }} · {{ stats.cities }} 座城市</strong><span>{{ stats.records }} 条到访记录</span><div class="legend"><span><i></i>已去过</span><span><i class="wish-dot"></i>想去</span></div></div><button class="add-button" aria-label="新增足迹或心愿" @click="addMenu = true"><AtlasIcon name="plus"/></button></div><section class="atlas-memory" :class="{ expanded: drawerOpen }"><button class="atlas-drawer-toggle" :aria-expanded="drawerOpen" @click="expanded = !expanded"><span><strong>{{ drawerOpen ? detail?.place.name || '走过的地方' : '走过的地方' }}</strong><small v-if="drawerOpen">{{ detail ? [detail.place.countryName, detail.place.provinceName].filter(Boolean).join(' · ') : '地点与回忆，慢慢收藏' }}</small></span><AtlasIcon :name="drawerOpen ? 'chevronDown' : 'chevronUp'"/></button><div v-if="drawerOpen" class="atlas-drawer-scroll"><p v-if="detailError" class="flow-form-errors" role="alert">{{ detailError }}<button class="text-button" @click="selected && openCity(selected)">重新读取城市记录</button></p><template v-if="detail"><div class="atlas-action-row"><button class="secondary-button" @click="plan">从这里规划一程</button><button v-if="detail.place.countryCode === 'CHN' && detail.place.cityCode && scope !== detail.place.cityCode" class="text-button" @click="enterCity(detail.place.cityCode)">进入城市地图</button><button class="text-button" @click="record('visited')">记录到访</button><button class="text-button" @click="record('wish')">收藏想去</button><button class="text-button atlas-back-list" @click="selected = null; detail = null; expanded = false">返回地区列表</button></div><template v-if="drawerOpen"><p v-if="!detail.records.length" class="sheet-empty">这个年份还没有到访记录，可以收藏心愿或安排下一程。</p><article v-for="r in detail.records" :id="'atlas-record-' + r.id" :key="r.id" class="atlas-record-row" :class="{ focused: focusedRecord === r.id }"><div><strong>{{ r.label }}</strong><small>{{ r.source === 'wish' ? '城市心愿' : (r.visitedOn || '日期待补充') + (r.source === 'journey' ? ' · 行程确认' : ' · 手动记录') }}</small><p v-if="r.note">{{ r.note }}</p><p v-if="r.detached" class="small muted">原行程地点已移除，到访记录保留。</p></div><div class="atlas-row-actions"><button v-if="r.routeId" class="text-button" @click="router.push('/journeys/' + r.journeyId + '/actual')">打开行程</button><button class="text-button" :disabled="busy" @click="record(r.source === 'wish' ? 'wish' : 'visited', r, r.source === 'journey')">{{ r.source === 'journey' ? '修改归属' : '编辑' }}</button><button class="text-button danger" :disabled="busy" @click="remove(r)">移除记录</button></div></article><button v-if="detail.nextCursor" class="text-button full" @click="selected && openCity(selected, true)">加载更多城市记录</button><h3 v-if="detail.journeys.length">相关旅程</h3><button v-for="j in detail.journeys" :key="j.id" class="city-result" @click="router.push('/journeys/' + j.id)">{{ j.title }}<AtlasIcon name="chevronRight" :size="16"/></button><template v-if="detail.diaries.length"><h3>相关旅程的日记</h3><button v-for="diary in detail.diaries" :key="diary.id" class="atlas-diary-row" @click="router.push('/diaries/' + diary.id)"><img v-if="diary.coverUrl" :src="diary.coverUrl" alt="旅途照片" loading="lazy"><span><strong>{{ diary.title }}</strong><small>{{ diary.occurredOn || '日期待补充' }} · {{ diary.status === 'draft' ? '草稿' : '已写完' }}</small></span><AtlasIcon name="chevronRight" :size="16"/></button></template><template v-if="detail.plans.length"><h3>目的地含这里的计划</h3><button v-for="j in detail.plans" :key="j.id" class="city-result" @click="router.push('/journeys/' + j.id)">{{ j.title }}<AtlasIcon name="chevronRight" :size="16"/></button></template></template></template><template v-else><p v-if="overview?.unassigned" class="atlas-unassigned"><button class="text-button" :disabled="busy" @click="pending">{{ overview.unassigned }} 条到访待补充城市归属</button></p><div v-if="!scopedPlaces.length && !loading" class="atlas-empty"><h3>{{ year === 'all' ? '从第一枚足迹开始' : '这一年，留白也很好' }}</h3><p>确认去过的地方，再为下一次出发留一个心愿。</p><button class="text-button" @click="record('visited')">记录第一枚足迹<AtlasIcon name="arrow" :size="16"/></button></div><button v-for="p in scopedPlaces" :key="p.place.key" class="city-result" @click="openCity(p.place.key)"><span><strong>{{ p.place.name }}</strong><small>{{ p.records ? p.records + ' 条到访 · ' + (p.lastVisitedOn || '日期待补充') : '想去的地方' }}</small></span><AtlasIcon name="chevronRight" :size="16"/></button><p v-if="drawerOpen" class="small muted">心愿不按到访年份筛选；日期待补充的足迹单独归类。只选省份不计入城市数。</p></template></div></section></div><ModalSheet v-if="addMenu" title="你想记录什么？" @close="addMenu = false"><p class="panel-description">先留下一枚足迹，故事可以慢慢写。</p><button class="option-row" @click="record('visited')"><span class="option-symbol"><AtlasIcon name="pin"/></span><span class="od-field od-fill"><strong>标记去过的地方</strong><small>主动确认，点亮你的足迹</small></span><AtlasIcon name="chevronRight"/></button><button class="option-row" @click="record('wish')"><span class="option-symbol wish"><AtlasIcon name="heart"/></span><span class="od-field od-fill"><strong>收藏想去的地方</strong><small>下一次出发，先放在心里</small></span><AtlasIcon name="chevronRight"/></button></ModalSheet><ModalSheet v-if="showUnassigned" title="待补充城市归属" :busy="busy" @close="showUnassigned = false"><p class="small muted">这些是真实到访确认，但暂不计入省市统计。选择归属后保留原记录。</p><button v-for="r in unassigned" :key="r.id" class="city-result" @click="record('visited', r, true)"><span><strong>{{ r.label }}</strong><small>{{ r.visitedOn }}</small></span>补充归属</button></ModalSheet><PlaceRecordForm v-if="form" :kind="form.kind" :record="form.record" :assign="form.assign" :place="detail?.place" :initial="initial" @close="form = null" @saved="savedRecord"/></section></template>
