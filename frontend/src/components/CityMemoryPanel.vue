<script setup lang="ts">
import { computed, ref } from 'vue';
import type { AtlasCityLayer, AtlasDetail, AtlasRecord } from '../../../packages/contracts/src/index.js';
import type { CityJourneyMemory } from '../maps/cityJourneys';
import AtlasJourneyCards from './AtlasJourneyCards.vue';
import AtlasIcon from './AtlasIcon.vue';
const props = defineProps<{ detail: AtlasDetail | null; layer: AtlasCityLayer | null; journeys: CityJourneyMemory[]; selectedJourney: string; selectedRecord: string; open: boolean; busy: boolean; error: string }>();
const emit = defineEmits<{ expand: [open: boolean]; journey: [id: string]; record: [id: string]; clear: [keepOpen?: boolean]; openJourney: [id: string]; plan: []; add: []; more: []; retry: []; edit: [record: AtlasRecord]; remove: [record: AtlasRecord] }>();
const tab = ref<'journeys' | 'places'>('journeys');
const journey = computed(() => props.journeys.find(journey => journey.id === props.selectedJourney));
const point = computed(() => props.layer?.points.find(point => point.id === props.selectedRecord));
const record = computed(() => props.detail?.records.find(record => record.id === props.selectedRecord));
const hasSelection = computed(() => !!props.selectedJourney || !!props.selectedRecord);
const title = computed(() => journey.value?.title || record.value?.label || point.value?.label || '走过的地方');
const date = computed(() => journey.value?.lastDate || record.value?.visitedOn || point.value?.visitedOn || '日期待补充');
const journeyRecords = computed(() => props.detail?.records.filter(record => record.journeyId === props.selectedJourney) ?? []);
const journeyPoints = computed(() => props.layer?.points.filter(point => point.journeyId === props.selectedJourney) ?? []);
const fallbackPoints = computed(() => journeyPoints.value.filter(point => !journeyRecords.value.some(record => record.id === point.id)));
const pointJourney = computed(() => record.value?.journeyId || point.value?.journeyId);
</script>
<template>
  <section class="atlas-memory city-memory" :class="{ expanded: open, 'has-preview': hasSelection && !open }" :aria-label="hasSelection ? '选中的回忆' : '城市回忆'">
    <header class="city-memory-heading">
      <button class="atlas-drawer-toggle" :aria-expanded="open" :aria-label="open ? '收起城市回忆' : hasSelection ? '展开选中回忆' : '展开城市回忆'" @click="emit('expand', !open)"><span><strong>{{ title }}</strong><small v-if="open && !hasSelection">{{ journeys.length }} 段旅程 · {{ detail?.place.name || layer?.place.name }}</small></span><AtlasIcon :name="open ? 'chevronDown' : 'chevronUp'" :size="18"/></button>
      <button v-if="hasSelection" class="icon-button city-selection-close" aria-label="取消选择" @click="emit('clear')"><AtlasIcon name="close" :size="18"/></button>
    </header>
    <div v-if="hasSelection && !open" class="city-memory-preview"><small>{{ date }}<template v-if="journey"> · {{ journey.source }}</template></small><button class="text-button" @click="emit('expand', true)">查看回忆<AtlasIcon name="arrow" :size="15"/></button></div>
    <div v-if="open" class="atlas-drawer-scroll city-memory-content">
      <p v-if="error" class="flow-form-errors" role="alert">{{ error }}<button class="text-button" @click="emit('retry')">重新读取</button></p>
      <template v-if="hasSelection">
        <button class="text-button city-memory-back" @click="emit('clear', true)"><AtlasIcon name="back" :size="15"/>所有回忆</button>
        <p class="city-memory-meta">{{ date }}<template v-if="journey"> · {{ journey.source }}</template></p>
        <template v-if="journey">
          <p class="small muted">{{ journey.paths.length ? '路线供回忆参考，完整来源见行程。' : '这段旅程还没有保存路径，回忆仍然在这里。' }}</p>
          <button class="secondary-button full" @click="emit('openJourney', journey.id)">打开行程与图文<AtlasIcon name="arrow" :size="16"/></button>
          <button v-for="item in journeyRecords" :key="item.id" class="city-memory-place" :aria-label="'查看地点：' + item.label" @click="emit('record', item.id)"><span><strong>{{ item.label }}</strong><small>{{ item.visitedOn || '日期待补充' }}<template v-if="!layer?.points.some(point => point.id === item.id)"> · 未在地图显示</template></small></span><AtlasIcon name="chevronRight" :size="16"/></button>
          <button v-for="item in fallbackPoints" :key="item.id" class="city-memory-place" @click="emit('record', item.id)"><span><strong>{{ item.label }}</strong><small>{{ item.visitedOn }}</small></span><AtlasIcon name="chevronRight" :size="16"/></button>
        </template>
        <template v-else>
          <p v-if="record?.note" class="city-memory-note">{{ record.note }}</p>
          <p v-if="record?.detached" class="small muted">原行程地点已移除，到访记录仍保留。</p>
          <button v-if="pointJourney" class="secondary-button full" @click="emit('openJourney', pointJourney)">打开所属行程与图文<AtlasIcon name="arrow" :size="16"/></button>
          <p v-if="!record && !point" class="small muted">此记录暂不在已加载内容中，请返回回忆列表查看。</p>
          <details v-if="record" class="city-record-actions"><summary>记录操作</summary><button class="text-button" :disabled="busy" @click="emit('edit', record)">{{ record.source === 'journey' ? '修改城市归属' : '编辑记录' }}</button><button class="text-button danger" :disabled="busy" @click="emit('remove', record)">移除记录</button></details>
        </template>
      </template>
      <template v-else>
        <div class="city-memory-tabs" role="group" aria-label="回忆浏览方式"><button :aria-pressed="tab === 'journeys'" @click="tab = 'journeys'">旅程</button><button :aria-pressed="tab === 'places'" @click="tab = 'places'">地点</button></div>
        <template v-if="tab === 'journeys'"><AtlasJourneyCards :journeys="journeys" :selected="selectedJourney" @select="emit('journey', $event)"/><p v-if="!journeys.length" class="sheet-empty">还没有关联旅程，可以先记录去过的地方。</p></template>
        <template v-else><button v-for="item in detail?.records" :key="item.id" class="city-memory-place" :aria-label="'查看地点：' + item.label" @click="emit('record', item.id)"><span><strong>{{ item.label }}</strong><small>{{ item.visitedOn || '日期待补充' }}<template v-if="item.source === 'wish'"> · 想去</template></small></span><AtlasIcon name="chevronRight" :size="16"/></button><button v-if="detail?.nextCursor" class="text-button full" @click="emit('more')">加载更多地点</button><p v-if="detail && !detail.records.length" class="sheet-empty">这个年份还没有到访记录。</p></template>
        <div class="city-memory-actions"><button class="text-button" @click="emit('add')"><AtlasIcon name="plus" :size="15"/>记录</button><button class="text-button" @click="emit('plan')">规划行程<AtlasIcon name="arrow" :size="15"/></button></div>
      </template>
      <p v-if="layer?.truncated" class="small muted">地图展示部分记录，完整内容请进入旅程查看。</p>
      <p v-if="layer?.withoutLocation" class="small muted">{{ layer.withoutLocation }} 条到访未定位，仍可在地点列表查看。</p>
    </div>
  </section>
</template>
