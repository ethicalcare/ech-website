import { AdminError, exact, text, UUID } from './shared-commands.js';
import { settings, session, provider, jsonBody, sameOrigin, emailInput, cookieHeaders, clearCookies, cookies, verifyChallenge } from './session.js';
import { rpc, list, commit, history, assignees } from './shared-repository.js';
import { importPartner } from './partner-import.js';
import { membershipList, membershipCommit, backup } from './application-admin.js';
const generic={ok:true,message:'If this address is authorized, a sign-in code will be sent.'};
function reply(status,body,cookieValues=[]) {const headers=new Headers({'Content-Type':'application/json','Cache-Control':'no-store','X-Content-Type-Options':'nosniff','X-Robots-Tag':'noindex','Referrer-Policy':'no-referrer','X-Frame-Options':'DENY'});for(const value of cookieValues)headers.append('Set-Cookie',value);return new Response(JSON.stringify(body),{status,headers});}
export async function handleAdmin(action,request,env,fetcher=fetch) {
  let operationId,logout=false;
  try {
    const config=settings(env),method=request.method;
    if(!['GET','POST'].includes(method))return reply(405,{error:{code:'invalid_request',message:'Method not allowed.'}});
    if(method==='POST')sameOrigin(request,config);
    if(action==='login'&&method==='POST') {
      const body=await jsonBody(request,4096),email=emailInput(body);
      await verifyChallenge(body,config,env,fetcher);
      const allowed=(env.ECH_LOGIN_EMAILS||'').split(',').map(s=>s.trim().toLowerCase());
      if(!allowed.includes(email))return reply(200,generic);
      await provider(config,'/auth/v1/otp',null,fetcher,{method:'POST',body:JSON.stringify({email,create_user:false})});
      return reply(200,generic);
    }
    if(action==='password'&&method==='POST') {
      const body=exact(await jsonBody(request,8192),['email','password','challengeToken']);
      const email=emailInput({email:body.email,challengeToken:body.challengeToken});
      if(typeof body.password!=='string'||!body.password.length||body.password.length>4096)throw new AdminError(400,'invalid_request','Enter your password.');
      await verifyChallenge(body,config,env,fetcher);
      if(!(env.ECH_LOGIN_EMAILS||'').split(',').map(s=>s.trim().toLowerCase()).includes(email))throw new AdminError(401,'unauthenticated','Sign-in could not be verified.');
      const tokens=await provider(config,'/auth/v1/token?grant_type=password',null,fetcher,{method:'POST',body:JSON.stringify({email,password:body.password})});
      const headers=cookieHeaders(tokens);
      await session(new Request(config.origin,{headers:{cookie:'__Host-ech-access='+tokens.access_token}}),env,fetcher,{register:true,expectedEmail:email,requireVerifiedEmail:true});
      return reply(200,{ok:true},headers);
    }
    if(action==='verify'&&method==='POST') {
      const body=exact(await jsonBody(request,4096),['email','token']);text(body.email,254,true);if(!/^\d{8}$/.test(body.token))throw new AdminError(400,'invalid_request','Enter the emailed sign-in code.');
      if(!(env.ECH_LOGIN_EMAILS||'').split(',').map(s=>s.trim().toLowerCase()).includes(body.email.trim().toLowerCase()))throw new AdminError(403,'forbidden','Sign-in could not be verified.');
      const tokens=await provider(config,'/auth/v1/verify',null,fetcher,{method:'POST',body:JSON.stringify({email:body.email.trim().toLowerCase(),token:body.token,type:'email'})});
      const headers=cookieHeaders(tokens);
      const current=await session(new Request(config.origin,{headers:{cookie:'__Host-ech-access='+tokens.access_token}}),env,fetcher,{register:true,expectedEmail:body.email.trim().toLowerCase()});
      if(!current.member.active)throw new AdminError(403,'forbidden','Account unavailable.');
      return reply(200,{ok:true},headers);
    }
    if(action==='logout'&&method==='POST') {
      logout=true;let token=cookies(request)['__Host-ech-access'];
      if(!token&&cookies(request)['__Host-ech-refresh']){const tokens=await provider(config,'/auth/v1/token?grant_type=refresh_token',null,fetcher,{method:'POST',body:JSON.stringify({refresh_token:cookies(request)['__Host-ech-refresh']})});token=tokens.access_token;}
      if(token){await rpc({config,token},'ech_logout_session',{},fetcher);const response=await fetcher(config.base+'/auth/v1/logout?scope=local',{method:'POST',redirect:'error',signal:AbortSignal.timeout(10000),headers:{apikey:config.key,Authorization:'Bearer '+token}});if(!response.ok)throw new AdminError(502,'write_unconfirmed','Server sign-out could not be fully confirmed. Browser cookies were cleared.');}
      return reply(200,{ok:true},clearCookies());
    }
    if(action==='refresh'&&method==='POST') {
      const token=cookies(request)['__Host-ech-refresh'];if(!token)throw new AdminError(401,'unauthenticated','Sign in again.');
      const tokens=await provider(config,'/auth/v1/token?grant_type=refresh_token',null,fetcher,{method:'POST',body:JSON.stringify({refresh_token:token})});
      await session(new Request(config.origin,{headers:{cookie:'__Host-ech-access='+tokens.access_token}}),env,fetcher,{refresh:true});
      return reply(200,{ok:true},cookieHeaders(tokens));
    }
    let current;
    try{current=await session(request,env,fetcher);}catch(error){if(action==='session'&&method==='GET'&&error.status===401)return reply(200,{authenticated:false,principal:null,capabilities:[],login:{method:'email_password',siteKey:env.TURNSTILE_SITE_KEY||null}});throw error;}
    if(action==='session'&&method==='GET')return reply(200,{authenticated:true,principal:current.principal,capabilities:current.capabilities});
    if(action==='imports'&&method==='POST') {
      const body=await jsonBody(request,65536);operationId=UUID.test(body?.operationId||'')?body.operationId:undefined;
      return reply(200,await importPartner(current,body,fetcher));
    }
    if(action==='memberships') {
      if(method==='GET')return reply(200,await membershipList(current,new URL(request.url).searchParams,fetcher));
      const body=await jsonBody(request,8192);operationId=UUID.test(body?.operationId||'')?body.operationId:undefined;
      return reply(200,await membershipCommit(current,body,fetcher));
    }
    if(action==='backup'&&method==='GET')return reply(200,await backup(current,new URL(request.url).searchParams,fetcher));
    if(action==='assignees'&&method==='GET')return reply(200,await assignees(current,fetcher));
    if(action==='history'&&method==='GET')return reply(200,await history(current,new URL(request.url).searchParams,fetcher));
    const kind=action==='inquiries'?'inquiry':action==='partners'?'partner':null;
    if(!kind)throw new AdminError(400,'invalid_request','Invalid endpoint.');
    if(method==='GET')return reply(200,await list(current,kind,new URL(request.url).searchParams,fetcher));
    const body=await jsonBody(request);operationId=UUID.test(body?.operationId||'')?body.operationId:undefined;
    return reply(200,await commit(current,kind,body,fetcher));
  }catch(error){const status=error instanceof AdminError?error.status:503,code=error instanceof AdminError?error.code:'unavailable';return reply(status,{error:{code,message:error instanceof AdminError?error.message:'Staff service is unavailable.'},...(operationId?{operationId}:{})},logout?clearCookies():[]);}
}
