<script setup lang="ts">
import { iconPaths } from './icons';
defineProps<{ name: string; size?: number }>();
</script>
<template><svg class="od-icon" :width="size ?? 22" :height="size ?? 22" viewBox="0 0 24 24" aria-hidden="true" focusable="false" v-html="iconPaths[name] ?? iconPaths.compass"></svg></template>
