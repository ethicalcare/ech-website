import { AdminError, UUID } from './shared-commands.js';
import { settings, sameOrigin, cookies, provider, cookieHeaders, clearCookies, session } from './session.js';
import { ACCESS_REVIEWER_ID } from './access-requests.js';
const flowCookie='__Host-ech-google';
const b64=bytes=>btoa(String.fromCharCode(...bytes)).replaceAll('+','-').replaceAll('/','_').replace(/=+$/,'');
const clearFlow=()=>`${flowCookie}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;
function redirect(location,values=[]) { const headers=new Headers({'Location':location,'Cache-Control':'no-store','Referrer-Policy':'no-referrer','X-Content-Type-Options':'nosniff','X-Frame-Options':'DENY'});for(const cookie of values)headers.append('Set-Cookie',cookie);return new Response(null,{status:303,headers}); }
export function googleEnabled(env) { return env.ECH_GOOGLE_SIGN_IN_ENABLED==='true'; }
export async function handleGoogle(action,request,env,fetcher=fetch) {
  const config=settings(env);
  if(!googleEnabled(env))throw new AdminError(404,'unavailable','Google sign-in is not enabled.');
  if(action==='google') {
    if(request.method!=='POST')throw new AdminError(405,'invalid_request','Use the Google sign-in button.');
    sameOrigin(request,config);
    const flow=b64(crypto.getRandomValues(new Uint8Array(32))),verifier=b64(crypto.getRandomValues(new Uint8Array(32)));
    const challenge=b64(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(verifier))));
    const callback=new URL('/api/admin/google-callback',config.origin);callback.searchParams.set('flow',flow);
    const authorize=new URL('/auth/v1/authorize',config.base);
    for(const [key,value] of Object.entries({provider:'google',redirect_to:callback.href,code_challenge:challenge,code_challenge_method:'s256',scopes:'openid email profile',prompt:'select_account'}))authorize.searchParams.set(key,value);
    return new Response(JSON.stringify({url:authorize.href}),{status:200,headers:{'Content-Type':'application/json','Cache-Control':'no-store','Referrer-Policy':'no-referrer','X-Content-Type-Options':'nosniff','Set-Cookie':`${flowCookie}=${flow}.${verifier}.${Date.now()}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=600`}});
  }
  const finish=(state,clearApplication=false)=>redirect(config.origin+'/?access='+state,[clearFlow(),...(clearApplication?clearCookies():[])]);
  if(request.method!=='GET')return finish('error');
  const url=new URL(request.url),stored=cookies(request)[flowCookie]||'';
  const match=stored.match(/^([A-Za-z0-9_-]{43})\.([A-Za-z0-9_-]{43})\.(\d{13})$/);
  if(!match||url.searchParams.getAll('flow').length!==1||url.searchParams.get('flow')!==match[1]||Date.now()-Number(match[3])>600000||Number(match[3])>Date.now()+5000)return finish('error');
  const code=url.searchParams.get('code');
  if(url.searchParams.has('error')||url.searchParams.getAll('code').length!==1||!code||code.length>2048)return finish('error');
  try {
    const tokens=await provider(config,'/auth/v1/token?grant_type=pkce',null,fetcher,{method:'POST',body:JSON.stringify({auth_code:code,code_verifier:match[2]})});
    cookieHeaders(tokens);
    const user=await provider(config,'/auth/v1/user',tokens.access_token,fetcher);
    if(!UUID.test(user.id||'')||typeof user.email!=='string'||!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(user.email)||(user.email.toLowerCase()==='erick@bloxlabs.tech'&&user.id!==ACCESS_REVIEWER_ID))return finish('error');
    if(!user.email_confirmed_at||!Array.isArray(user.identities)||!user.identities.some(identity=>identity.provider==='google'&&identity.identity_data?.email_verified===true&&String(identity.identity_data.email||'').toLowerCase()===String(user.email||'').toLowerCase()))return finish('error');
    const result=await provider(config,'/rest/v1/rpc/ech_request_access',tokens.access_token,fetcher,{method:'POST',body:'{}'});
    if(!['pending','approved','denied','revoked'].includes(result?.state))return finish('error');
    if(result.state!=='approved')return finish(result.state,true);
    await session(new Request(config.origin,{headers:{cookie:'__Host-ech-access='+tokens.access_token}}),env,fetcher,{register:true,expectedEmail:user.email.toLowerCase(),requireVerifiedEmail:true});
    return redirect(config.origin+'/?view=partners',[clearFlow(),...cookieHeaders(tokens)]);
  } catch { return finish('error'); }
}
