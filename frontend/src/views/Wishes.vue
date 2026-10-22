<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import { api, errorText, mutationId } from '../api';
import type { AtlasRecord } from '../../../packages/contracts/src/index.js';
import PlaceRecordForm from '../components/PlaceRecordForm.vue';
import AtlasIcon from '../components/AtlasIcon.vue';
import '../styles/atlas.css';
const router = useRouter(), rows = ref<AtlasRecord[]>([]), loading = ref(true), busy = ref(false), error = ref(''), query = ref(''), editor = ref<{ row?: AtlasRecord } | null>(null);
const visible = computed(() => rows.value.filter(r => (r.place!.name + r.place!.provinceName + r.place!.countryName + r.note).includes(query.value)));
async function load() { loading.value = true; error.value = ''; try { rows.value = await api('/atlas/wishes'); } catch (e) { error.value = errorText(e); } finally { loading.value = false; } }
onMounted(load);
async function remove(r: AtlasRecord) { if (!window.confirm('移除这座城市的心愿？到访和行程会保留。')) return; busy.value = true; try { await api('/atlas/records/' + r.id, 'DELETE', { baseVersion: r.version, clientMutationId: mutationId() }); await load(); } catch (e) { error.value = errorText(e); } finally { busy.value = false; } }
</script>
<template><section class="flow-view"><header class="flow-topbar"><button class="icon-button" aria-label="返回我的" @click="router.push('/me')"><AtlasIcon name="back"/></button><h2>我的心愿</h2><button class="icon-button" aria-label="新增城市心愿" @click="editor = {}"><AtlasIcon name="plus"/></button></header><div class="flow-scroll"><p class="eyebrow">SOMEDAY, SOMEWHERE</p><h1 class="editor-title">下一站，慢慢出发</h1><p class="muted">收藏向往的地方，再慢慢安排进日历。</p><div class="collection-filters"><input v-model="query" type="search" aria-label="搜索城市心愿" placeholder="搜索城市、地区或心愿"></div><p v-if="loading" role="status">正在翻开心愿…</p><p v-if="error" class="flow-form-errors" role="alert">{{ error }}<button class="text-button" @click="load">重新读取心愿</button></p><div v-if="!loading && !visible.length" class="flow-empty"><AtlasIcon name="heart" :size="38"/><h3>{{ rows.length ? '没有匹配的心愿' : '给下一次出发留个位置' }}</h3><p>心愿不会自动成为到访足迹。</p><button class="primary" @click="editor = {}">收藏想去的城市</button></div><article v-for="r in visible" :key="r.id" class="wishlist-card"><h3>{{ r.place?.name }}</h3><p class="muted">{{ [r.place?.countryName, r.place?.provinceName].filter(Boolean).join(' · ') }}</p><p v-if="r.note">{{ r.note }}</p><div class="wishlist-actions"><button class="secondary-button" @click="router.push({ path: '/journeys/new', query: { destination: r.place!.name, title: r.place!.name + '之行' } })">规划这一程</button><button class="text-button" @click="editor = { row: r }">编辑心愿</button><button class="text-button danger" :disabled="busy" @click="remove(r)">移除心愿</button></div></article></div><PlaceRecordForm v-if="editor" kind="wish" :record="editor.row" @close="editor = null" @saved="load"/></section></template>
