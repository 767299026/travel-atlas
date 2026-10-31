<script setup lang="ts">
import { iconPaths } from '../../../frontend/src/components/icons';
defineProps<{ name: string }>();
const extra: Record<string,string> = {
 grid:'<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>',
 settings:'<path d="M4 7h16M4 17h16"/><circle cx="9" cy="7" r="3" fill="var(--paper,#fffefa)"/><circle cx="15" cy="17" r="3" fill="var(--paper,#fffefa)"/>',
 clock:'<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
 menu:'<path d="M4 6h16M4 12h16M4 18h16"/>',
 logout:'<path d="M9 4H4v16h5M13 8l4 4-4 4M8 12h13"/>',
 refresh:'<path d="M20 7V3l-3 3a8 8 0 1 0 2 10M20 7h-5"/>'
};
</script>
<template><svg class="od-icon" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false" v-html="extra[name] ?? iconPaths[name] ?? iconPaths.compass"></svg></template>
