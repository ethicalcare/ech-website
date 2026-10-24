import { SharedError, parseSession, type Session } from './live-model.ts';
export async function readJson(response: Response, maximum = 3_000_000): Promise<unknown> {
  if (response.redirected || response.headers.get('content-type')?.split(';')[0].trim().toLowerCase() !== 'application/json') throw new SharedError('invalid_response', 'Unverified server response.');
  const reader = response.body?.getReader(); if (!reader) throw new SharedError('invalid_response', 'Missing server response.');
  const chunks: Uint8Array[] = []; let length = 0;
  try { while (true) { const part = await reader.read(); if (part.done) break; length += part.value.length; if (length > maximum) { await reader.cancel(); throw new SharedError('invalid_response', 'Server response exceeds the supported limit.'); } chunks.push(part.value); } } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(length); let offset = 0; for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  try { return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); } catch { throw new SharedError('invalid_response', 'Invalid server JSON.'); }
}
export function requestOptions(): RequestInit { return { credentials: 'same-origin', mode: 'same-origin', cache: 'no-store', redirect: 'error', referrerPolicy: 'no-referrer', signal: AbortSignal.timeout(15_000) }; }
export function statusError(status: number, mutation = false): SharedError {
  if (status === 401 || status === 403) return new SharedError(status === 401 ? 'unauthenticated' : 'forbidden', 'This session no longer permits the request. Sign in or reload account status.');
  if (status === 409) return new SharedError('conflict', 'This record changed. Your draft is retained. Reload and review before saving again.');
  if (status === 400 || status === 422) return new SharedError('invalid_request', 'The request was rejected. Review the retained draft.');
  return new SharedError(mutation ? 'write_unconfirmed' : 'unavailable', mutation ? 'Save outcome unknown. Keep the draft and operation identity; inspect saved state before retrying.' : 'Shared records are unavailable. Reload to verify access.', mutation ? 'unknown' : false);
}
export function createSessionClient(fetcher: typeof fetch) {
  async function post(path: string, body: object) { const response = await fetcher(path, { ...requestOptions(), method: 'POST', headers: { Accept: 'application/json', 'Content-Type': 'application/json' }, body: JSON.stringify(body) }); if (response.status !== 200) throw statusError(response.status); const value = await readJson(response, 32000); if (!value || typeof value !== 'object' || (value as {ok?:unknown}).ok !== true) throw new SharedError('invalid_response', 'Sign-in response could not be verified.'); }
  return {
    async google() { const response=await fetcher('/api/admin/google',{...requestOptions(),method:'POST',headers:{Accept:'application/json'}});if(response.status!==200)throw statusError(response.status);const value=await readJson(response,4096) as {url?:unknown};if(typeof value?.url!=='string')throw new SharedError('invalid_response','Google sign-in could not be started.');const url=new URL(value.url);if(url.protocol!=='https:'||!/^[a-z0-9]{20}\.supabase\.co$/.test(url.hostname)||url.pathname!=='/auth/v1/authorize'||url.searchParams.get('provider')!=='google')throw new SharedError('invalid_response','Google sign-in destination could not be verified.');return url.href; },
    async load(): Promise<Session> { const response = await fetcher('/api/admin/session', { ...requestOptions(), headers: { Accept: 'application/json' } }); if (response.status !== 200) throw statusError(response.status); return parseSession(await readJson(response, 32000)); },
    async login(email: string, challengeToken: string) { if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254 || !challengeToken || challengeToken.length > 2048) throw new SharedError('invalid_request', 'Enter an individual email and complete the sign-in check.'); await post('/api/admin/login', { email, challengeToken }); },
    async password(email: string, password: string, challengeToken: string) { await post('/api/admin/password', {email, password, challengeToken}); },
    async verify(email: string, token: string) { if (!/^\d{8}$/.test(token)) throw new SharedError('invalid_request', 'Enter the eight-digit email code.'); await post('/api/admin/verify', { email, token }); },
    async logout() { await post('/api/admin/logout', {}); },
  };
}
