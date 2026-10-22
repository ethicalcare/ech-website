import { AdminError, exact, text, UUID } from './shared-commands.js';
import { capabilities } from './permissions.js';
const accessName = '__Host-ech-access', refreshName = '__Host-ech-refresh';
export function settings(env) {
  let origin, base;
  try { origin = new URL(env.ADMIN_ORIGIN); base = new URL(env.SUPABASE_URL); } catch { throw new AdminError(503,'unavailable','Staff access is not configured.'); }
  if (origin.protocol !== 'https:' || origin.origin !== env.ADMIN_ORIGIN || base.protocol !== 'https:' || !/^[a-z0-9]{20}\.supabase\.co$/.test(base.hostname) || base.origin !== env.SUPABASE_URL || !env.SUPABASE_PUBLISHABLE_KEY) throw new AdminError(503,'unavailable','Staff access is not configured.');
  return { origin: origin.origin, base: base.origin, key: env.SUPABASE_PUBLISHABLE_KEY };
}
export function cookies(request) { return Object.fromEntries((request.headers.get('cookie') || '').split(';').map(s=>s.trim().split(/=(.*)/s).slice(0,2)).filter(p=>p.length===2)); }
export function cookieHeaders(tokens) {
  if (!tokens || typeof tokens.access_token !== 'string' || !tokens.access_token || typeof tokens.refresh_token !== 'string' || !tokens.refresh_token || /[;\r\n]/.test(tokens.access_token+tokens.refresh_token)) throw new AdminError(502,'write_unconfirmed','Sign-in could not be confirmed.');
  const age = Math.min(3600,Math.max(1,Number(tokens.expires_in)||3600));
  return [`${accessName}=${tokens.access_token}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${age}`,`${refreshName}=${tokens.refresh_token}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=604800`];
}
export const clearCookies = () => [accessName,refreshName].map(n=>`${n}=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0`);
export async function provider(config,path,token,fetcher,options={}) {
  const response = await fetcher(config.base+path,{...options,redirect:'manual',cache:'no-store',signal:AbortSignal.timeout(10000),headers:{apikey:config.key,...(token?{Authorization:'Bearer '+token}:{}),'Content-Type':'application/json',...options.headers}});
  if (response.status>=300&&response.status<400||!response.ok) {
    const rejected=response.status===401||(path==='/auth/v1/token?grant_type=password'&&[400,422].includes(response.status));
    throw new AdminError(rejected?401:503,rejected?'unauthenticated':'unavailable','Staff access could not be verified.');
  }
  return response.json();
}
export async function session(request,env,fetcher,options={}) {
  const config=settings(env), token=cookies(request)[accessName];
  if (!token || token.length>12000) throw new AdminError(401,'unauthenticated','Sign in to continue.');
  const user=await provider(config,'/auth/v1/user',token,fetcher);
  if (!UUID.test(user?.id||'') || !user.email || user.banned_until && Date.parse(user.banned_until)>Date.now()) throw new AdminError(401,'unauthenticated','Sign in to continue.');
  if(options.requireVerifiedEmail && !user.email_confirmed_at)throw new AdminError(401,'unauthenticated','Sign-in identity could not be verified.');
  if(options.expectedEmail && user.email.toLowerCase()!==options.expectedEmail)throw new AdminError(401,'unauthenticated','Sign-in identity could not be verified.');
  const response=await provider(config,'/rest/v1/ech_memberships?user_id=eq.'+encodeURIComponent(user.id)+'&select=user_id,display_name,technical_admin,operational_role,application_admin,active,revision',token,fetcher);
  const member=Array.isArray(response)&&response.length===1?response[0]:null;
  if (!member?.active || member.user_id!==user.id) throw new AdminError(403,'forbidden','This account is not enabled for staff access.');
  const name=options.register?'ech_register_session':options.refresh?'ech_refresh_session':'ech_session_active';
  const active=await provider(config,'/rest/v1/rpc/'+name,token,fetcher,{method:'POST',body:'{}'});
  if(active!==true)throw new AdminError(401,'unauthenticated','This session is no longer active.');
  return {config,token,member,principal:{id:user.id,email:user.email,technicalAdmin:member.technical_admin===true,applicationAdmin:member.application_admin===true,operationalRole:member.operational_role},capabilities:capabilities(member)};
}
export async function jsonBody(request,max=262144) {
  if (request.headers.get('content-type')?.split(';')[0].trim()!=='application/json') throw new AdminError(400,'invalid_request','Use the staff application.');
  const reader=request.body?.getReader(); if(!reader) throw new AdminError(400,'invalid_request','Request body required.');
  const chunks=[];let length=0;
  try { while(true){const {done,value}=await reader.read();if(done)break;length+=value.byteLength;if(length>max){await reader.cancel();throw new AdminError(400,'invalid_request','Request too large.');}chunks.push(value);} } finally {reader.releaseLock();}
  const bytes=new Uint8Array(length);let i=0;for(const chunk of chunks){bytes.set(chunk,i);i+=chunk.byteLength;}
  try{return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));}catch{throw new AdminError(400,'invalid_request','Invalid request body.');}
}
export function sameOrigin(request,config) { if(request.headers.get('origin')!==config.origin) throw new AdminError(403,'forbidden','Open the staff application on its configured site.'); }
export function emailInput(body) { exact(body,['email','challengeToken']);text(body.email,254,true);text(body.challengeToken,2048,true);if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(body.email))throw new AdminError(400,'invalid_request','Enter a valid email.');return body.email.trim().toLowerCase(); }

export async function verifyChallenge(body,config,env,fetcher) {
  const verification=await fetcher('https://challenges.cloudflare.com/turnstile/v0/siteverify',{method:'POST',redirect:'manual',signal:AbortSignal.timeout(8000),headers:{'Content-Type':'application/json'},body:JSON.stringify({secret:env.TURNSTILE_SECRET_KEY,response:body.challengeToken})});
  if(verification.status>=300&&verification.status<400)throw new AdminError(503,'unavailable','Staff access could not be verified.');
  const result=await verification.json();
  if(!verification.ok||!result.success||result.hostname!==new URL(config.origin).hostname||result.action!=='admin-login')throw new AdminError(400,'invalid_request','Complete the sign-in security check.');
}
