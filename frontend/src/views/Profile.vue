<script setup lang="ts">
import { ref } from 'vue';
import { api, session, errorText } from '../api';
import AtlasIcon from '../components/AtlasIcon.vue';
const busy = ref(false), error = ref('');
async function logout() { busy.value = true; try { await api('/auth/logout', 'POST'); session.value = null; } catch (e) { error.value = errorText(e); } finally { busy.value = false; } }
</script>
<template><section class="flow-view"><div class="flow-scroll"><header class="flow-header"><p class="eyebrow">A LITTLE SPACE OF YOUR OWN</p><h2>我的旅行簿</h2><p>留住沿途，也给下一程留一点期待。</p></header><div class="profile-mark"><AtlasIcon name="user" :size="32"/></div><h3>{{ session?.user.displayName }}</h3><p class="muted">{{ session?.user.username }}</p><div class="profile-note"><AtlasIcon name="lock"/><p>现在的旅程仅自己可见。你可以随时回到旅程，继续补充安排。</p></div><p v-if="error" class="flow-form-errors" role="alert">{{ error }}</p><button class="secondary-button full" :disabled="busy" @click="logout">{{ busy ? '正在退出…' : '退出登录' }}</button></div></section></template>
