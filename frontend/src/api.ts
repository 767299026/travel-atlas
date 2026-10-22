import { ref } from 'vue';
import type { SessionData } from '../../packages/contracts/src/index.js';
export const session = ref<SessionData | null>(null);
export class ApiError extends Error { constructor(public code: string, message: string, public status: number) { super(message); } }
export async function api<T>(path: string, method = 'GET', body?: unknown): Promise<T> {
  let result: Response;
  try { result = await fetch('/api/v1' + path, { method, credentials: 'same-origin', headers: {
    ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
    ...(session.value && method !== 'GET' ? { 'X-CSRF-Token': session.value.csrfToken } : {}),
  }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }); }
  catch { throw new ApiError('NETWORK_ERROR', '连接失败，修改尚未保存到服务器。请稍后重试。', 0); }
  let payload: { data?: T; error?: { code: string; message: string } };
  try { payload = await result.json(); } catch { throw new ApiError('INVALID_RESPONSE', '服务器返回异常，修改尚未确认保存。', result.status); }
  if (!result.ok) {
    if (result.status === 401 && path !== '/auth/login') session.value = null;
    throw new ApiError(payload.error?.code ?? 'REQUEST_FAILED', payload.error?.message ?? '请求失败，请稍后重试。', result.status);
  }
  return payload.data as T;
}
export const errorText = (error: unknown) => error instanceof Error ? error.message : '操作失败，请重试。';
export const mutationId = () => crypto.randomUUID();
export const draftId = () => 'draft:' + crypto.randomUUID();
