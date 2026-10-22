import { ref, computed } from 'vue';
import { api, errorText, session, mutationId, draftId, ApiError } from './api';
import { applyCommands, clone, type RouteSnapshot, type RouteCommand, type CommandResult } from '../../packages/contracts/src/index.js';
interface SavedDraft { base: RouteSnapshot; operations: RouteCommand[]; key: string; savedAt: string }
export function useRouteDraft() {
  const base = ref<RouteSnapshot | null>(null), route = ref<RouteSnapshot | null>(null), operations = ref<RouteCommand[]>([]);
  const saving = ref(false), error = ref(''), conflict = ref(false), storageOK = ref(true), savedMessage = ref('');
  const dirty = computed(() => operations.value.length > 0); let key: string = mutationId(); let storageKey = '';
  const write = () => {
    try { if (!storageKey) return; if (!dirty.value) localStorage.removeItem(storageKey); else localStorage.setItem(storageKey, JSON.stringify({ base: base.value, operations: operations.value, key, savedAt: new Date().toISOString() })); storageOK.value = true; }
    catch { storageOK.value = false; }
  };
  function initialize(server: RouteSnapshot) {
    base.value = clone(server); route.value = clone(server); operations.value = []; conflict.value = false;
    // Each tab keeps its own draft; two tabs must not overwrite each other's pending edits.
    let tab = 'fallback';
    try { tab = sessionStorage.getItem('tj:tab') || mutationId(); sessionStorage.setItem('tj:tab', tab); } catch { storageOK.value = false; }
    storageKey = `tj:draft:${session.value!.user.id}:${server.id}:${tab}`;
    try {
      const text = localStorage.getItem(storageKey); if (!text) return;
      const saved: SavedDraft = JSON.parse(text);
      if (saved.base?.id !== server.id || !Array.isArray(saved.operations) || saved.operations.length > 256 || typeof saved.key !== 'string') throw new Error();
      const restored = applyCommands(saved.base, saved.operations, ref => ref ?? draftId()).route;
      base.value = saved.base; operations.value = saved.operations; key = saved.key; route.value = restored;
      conflict.value = server.version !== saved.base.version;
      savedMessage.value = '已恢复此页面的本机草稿';
    } catch { error.value = '本机草稿无法读取，服务器版本已加载。原草稿未删除。'; }
  }
  function stage(commands: RouteCommand[]) {
    if (saving.value || conflict.value || !base.value) return false;
    try {
      if (operations.value.length + commands.length > 256) throw new Error('本次编辑较多，请先保存后继续。');
      const combined = [...operations.value, ...commands];
      const next = applyCommands(base.value, combined, ref => ref ?? draftId());
      operations.value = combined; route.value = next.route; key = mutationId(); error.value = ''; savedMessage.value = ''; write(); return true;
    } catch (e) { error.value = errorText(e); return false; }
  }
  async function save() {
    if (!dirty.value || !base.value || saving.value || conflict.value) return;
    saving.value = true; error.value = '';
    try {
      const result = await api<CommandResult>(`/routes/${base.value.id}/commands`, 'POST', { baseVersion: base.value.version, clientMutationId: key, operations: clone(operations.value) });
      base.value = result.route; route.value = clone(result.route); operations.value = []; key = mutationId(); write(); savedMessage.value = `已保存到服务器 · 版本 ${result.route.version}`;
    } catch (e) { error.value = errorText(e); if (e instanceof ApiError && e.status === 409) conflict.value = true; write(); }
    finally { saving.value = false; }
  }
  async function reload() {
    if (!base.value) return;
    // Caller obtains an explicit choice before discarding. Fetch first: a failed request keeps all edits.
    const server = await api<RouteSnapshot>(`/routes/${base.value.id}`);
    base.value = server; route.value = clone(server); operations.value = []; key = mutationId(); conflict.value = false; error.value = ''; write(); savedMessage.value = `已加载服务器版本 ${server.version}`;
  }
  function discard() { if (!base.value) return; route.value = clone(base.value); operations.value = []; key = mutationId(); write(); }
  function exportDraft() {
    const file = new Blob([JSON.stringify({ base: base.value, operations: operations.value, edited: route.value }, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(file); const anchor = document.createElement('a'); anchor.href = url; anchor.download = '迹屿-行程草稿.json'; anchor.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  return { base, route, operations, saving, error, conflict, storageOK, savedMessage, dirty, initialize, stage, save, reload, discard, exportDraft, write };
}
