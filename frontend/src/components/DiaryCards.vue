<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import { api, errorText } from '../api';
import type { Diary, DiaryList } from '../../../packages/contracts/src/index.js';
import AtlasIcon from './AtlasIcon.vue';
const props = defineProps<{ journeyId?: string }>(); const router = useRouter(), items = ref<Diary[]>([]), cursor = ref<string | null>(null), busy = ref(false), error = ref('');
async function load(more = false) { busy.value = true; error.value = ''; const query = new URLSearchParams(); if (props.journeyId) query.set('journeyId', props.journeyId); if (more && cursor.value) query.set('cursor', cursor.value);
  try { const page = await api<DiaryList>('/diaries?' + query); items.value = more ? [...items.value, ...page.items] : page.items; cursor.value = page.nextCursor; } catch (e) { error.value = errorText(e); } finally { busy.value = false; } }
onMounted(() => load());
function create() { router.push('/diaries/new' + (props.journeyId ? '?journeyId=' + props.journeyId : '')); }
</script>
<template><div class="diary-cards"><div class="section-row"><h3>{{ journeyId ? '这次旅程的日记' : '我的回忆' }}</h3><button class="text-button" @click="create"><AtlasIcon name="edit" :size="17"/>写日记</button></div><p v-if="error" class="flow-form-errors" role="alert">{{ error }}<button class="text-button" @click="load()">重新读取</button></p><p v-if="busy && !items.length" class="form-intro">正在翻开回忆…</p><div v-else-if="!items.length && !error" class="flow-empty"><div class="empty-drawing"><AtlasIcon name="book" :size="40"/></div><h3>故事，等你慢慢写下</h3><p>一段文字，几张照片，把沿途留在这里。</p><button class="primary" @click="create">写下第一篇日记</button></div><div class="journey-grid"><article v-for="diary in items" :key="diary.id" class="flow-card"><button class="flow-card-main" @click="router.push('/diaries/' + diary.id)"><img v-if="diary.photos[0]?.media" class="diary-card-photo" :src="diary.photos[0].media.thumbnailUrl" :alt="diary.photos[0].caption || diary.title" loading="lazy"><span class="flow-card-body"><span class="flow-card-date">{{ diary.occurredOn || '日期未填写' }} · {{ diary.status === 'draft' ? '草稿' : '已记录' }} · 私密</span><h3>{{ diary.title }}</h3><p class="diary-excerpt">{{ diary.body || '照片里的故事，等待继续补充。' }}</p><span class="flow-card-bottom"><span>{{ diary.association?.journeyTitle || '独立日记' }} · {{ diary.photos.length }} 张照片</span><AtlasIcon name="arrow"/></span></span></button></article></div><button v-if="cursor" class="secondary-button full" :disabled="busy" @click="load(true)">加载更多日记</button></div></template>
