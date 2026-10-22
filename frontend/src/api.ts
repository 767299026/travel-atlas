import { ref } from 'vue';
import type { SessionData } from '../../packages/contracts/src/index.js';
export const session = ref<SessionData | null>(null);
export class ApiError extends Error { constructor(public code: string, message: string, public status: number) { super(message); } }
export async function api<T>(path: string, method = 'GET', body?: unknown): Promise<T> {
  let result: Response;
  try { result = await fetch('/api/v1' + path, { method, credentials: 'same-origin', headers: {
    ...(body === undefined || body instanceof FormData ? {} : { 'Content-Type': 'application/json' }),
    ...(session.value && method !== 'GET' ? { 'X-CSRF-Token': session.value.csrfToken } : {}),
  }, ...(body === undefined ? {} : { body: body instanceof FormData ? body : JSON.stringify(body) }) }); }
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
export const mutationId = () => {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  // getRandomValues is also available on the current HTTP preview origin.
  const bytes = crypto.getRandomValues(new Uint8Array(16)); bytes[6] = (bytes[6]! & 15) | 64; bytes[8] = (bytes[8]! & 63) | 128;
  const hex = [...bytes].map(value => value.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
};
export const draftId = () => 'draft:' + mutationId();
export async function uploadPhoto(file: File, key: string) {
  const body = new FormData(); body.set('file', file); let response: Response;
  try { response = await fetch('/api/v1/media', { method: 'POST', credentials: 'same-origin', body, headers: { 'X-CSRF-Token': session.value?.csrfToken ?? '', 'X-Upload-Id': key } }); }
  catch { throw new ApiError('UPLOAD_FAILED', '照片上传连接失败，可重试；已填写的日记会保留。', 0); }
  let payload; try { payload = await response.json(); } catch { throw new ApiError('UPLOAD_FAILED', '照片上传未确认，请重试。', response.status); }
  if (!response.ok) { if (response.status === 401) session.value = null; throw new ApiError(payload.error?.code ?? 'UPLOAD_FAILED', payload.error?.message ?? '照片上传失败，请重试。', response.status); }
  return payload.data as import('../../packages/contracts/src/index.js').MediaItem;
}
