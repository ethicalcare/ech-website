import test from 'node:test';import assert from 'node:assert/strict';
import { parseCommand,commandFingerprint,canonical } from '../lib/admin/shared-commands.js';
import { capabilities,authorize } from '../lib/admin/permissions.js';
import { handleAdmin } from '../lib/admin/handler.js';
import { list,commit,rpc } from '../lib/admin/shared-repository.js';
import { session,provider,verifyChallenge } from '../lib/admin/session.js';
const uid='10000000-0000-4000-8000-000000000001',other='10000000-0000-4000-8000-000000000002',id='20000000-0000-4000-8000-000000000001',op='30000000-0000-4000-8000-000000000001';
const env={ADMIN_ORIGIN:'https://example.invalid',SUPABASE_URL:'https://abcdefghijklmnopqrst.supabase.co',SUPABASE_PUBLISHABLE_KEY:'fictional-public-key',TURNSTILE_SECRET_KEY:'fictional-fixture-value',TURNSTILE_SITE_KEY:'fictional-site-key',ECH_LOGIN_EMAILS:'sample@example.invalid'};
const json=(value,status=200)=>new Response(JSON.stringify(value),{status,headers:{'Content-Type':'application/json'}});
const member=(role='staff',more={})=>({user_id:uid,display_name:'Fictional operator',technical_admin:false,operational_role:role,active:true,...more});
const current=(role='staff')=>({config:{base:env.SUPABASE_URL,key:env.SUPABASE_PUBLISHABLE_KEY},token:'fictional-access',member:member(role)});
const envelope=(type='update',fields={name:'Fictional caller'},more={})=>({schema:1,operationId:op,expectedRevision:1,command:{type,id,fields},...more});
const request=(path='session',body,token=true)=>new Request(env.ADMIN_ORIGIN+'/api/admin/'+path,{method:body===undefined?'GET':'POST',headers:{...(token?{cookie:'__Host-ech-access=fictional-access'}:{}),...(body===undefined?{}:{origin:env.ADMIN_ORIGIN,'Content-Type':'application/json'})},...(body===undefined?{}:{body:JSON.stringify(body)})});
function sessionServer(role='staff',options={}) {const calls=[];return {calls,fetcher:async(url,init={})=>{calls.push({url,init});if(url.endsWith('/auth/v1/user'))return json(options.user||{id:uid,email:'sample@example.invalid'});if(url.includes('/ech_memberships?'))return json(options.members||[member(role,options.member)]);if(url.endsWith('/ech_session_active')||url.endsWith('/ech_register_session')||url.endsWith('/ech_refresh_session'))return json(options.active!==false);throw Error('Unexpected request '+url);}};}

test('technical administration, operational management and assigned staff remain distinct',()=>{
 assert.deepEqual(capabilities(member(null,{technical_admin:true})),['admin.status']);
 for(const role of ['owner','manager']){assert.ok(capabilities(member(role)).includes('leads.assign'));authorize(member(role),'create');authorize(member(role),'read',{owner_id:other});}
 for(const type of ['create','assign','assignees'])assert.throws(()=>authorize(member('staff'),type),e=>e.status===403);
 authorize(member('staff'),'update',{owner_id:uid});assert.throws(()=>authorize(member('staff'),'update',{owner_id:other}));assert.throws(()=>authorize(member(null,{technical_admin:true}),'read',{owner_id:uid}));assert.deepEqual(capabilities(member('owner',{active:false})),[]);
});
test('inquiry and partner accepted fields survive validation; actor/owner injection rejected',()=>{
 const input=envelope('create',{name:'Fictional caller',phone:'0005550100',careRecipient:'Sample person',careRecipientPhone:'0005550101',careRecipientEmail:'recipient@example.invalid',preferredContact:'Phone'},{expectedRevision:0});const before=structuredClone(input);assert.deepEqual(parseCommand('inquiry',input),input);assert.deepEqual(input,before);
 const partner=envelope('create',{organization:'Sample desk',geography:'Sample area',openingAsk:'Ask',materials:'Sent',lastTouch:'2026-10-20',callScript:'Draft',contacted:false,sprint:'Top 15'},{expectedRevision:0});assert.equal(parseCommand('partner',partner).command.fields.openingAsk,'Ask');
 for(const key of ['actor','author','role','technicalAdmin','ownerId'])assert.throws(()=>parseCommand('inquiry',envelope('update',{[key]:'forged'})));
 assert.throws(()=>parseCommand('inquiry',{...input,actorId:uid}));
});
test('call date/channel/contact result and contact job title are data, not roles',()=>{
 assert.equal(parseCommand('partner',envelope('record_activity',{date:'2026-10-20',channel:'Call',madeContact:false,outcome:'No answer',note:'Try later'})).command.fields.madeContact,false);
 const person={id:other,name:'Fictional contact',role:'Manager',methods:[{id:op,kind:'email',value:'sample@example.invalid',label:'Office'}]};assert.equal(parseCommand('partner',envelope('save_person',{person})).command.fields.person.role,'Manager');
 assert.throws(()=>parseCommand('partner',envelope('record_activity',{date:'2026-02-30'})));assert.throws(()=>parseCommand('partner',envelope('update',{contacted:'true'})));assert.throws(()=>parseCommand('inquiry',envelope('update',{careRecipientEmail:'invalid'})));
});
test('canonical fingerprint binds payload not property insertion order',async()=>{const first=envelope();assert.equal(await commandFingerprint(first),await commandFingerprint(JSON.parse(canonical(first))));assert.notEqual(await commandFingerprint(first),await commandFingerprint(envelope('update',{name:'Another fictional caller'})));});
test('session verifies user, current membership AND registered session on each call',async()=>{const server=sessionServer();await session(request(),env,server.fetcher);await session(request(),env,server.fetcher);assert.equal(server.calls.filter(x=>x.url.endsWith('/auth/v1/user')).length,2);assert.equal(server.calls.filter(x=>x.url.endsWith('/ech_session_active')).length,2);assert.ok(server.calls.every(x=>x.init.redirect==='manual'));});
test('revoked session, disabled membership, missing identity and technical-only access fail closed',async()=>{
 for(const opts of [{active:false},{members:[]},{member:{active:false}},{user:{id:'bad',email:'sample@example.invalid'}}]){const server=sessionServer('staff',opts);await assert.rejects(session(request(),env,server.fetcher));}
 const server=sessionServer(null,{member:{technical_admin:true}});const response=await handleAdmin('inquiries',request('inquiries'),env,server.fetcher);assert.equal(response.status,403);assert.equal(server.calls.length,3);
});
test('anonymous session shows sign-in without exposing keys or data',async()=>{let calls=0;const response=await handleAdmin('session',request('session',undefined,false),env,async()=>{calls++;throw Error('no request');});const body=await response.json();assert.equal(body.authenticated,false);assert.deepEqual(body.capabilities,[]);assert.equal(calls,0);assert.equal(response.headers.get('Cache-Control'),'no-store');assert.equal(JSON.stringify(body).includes('fictional-public-key'),false);});
test('staff list is filtered before pagination and backend rejects a returned hidden row',async()=>{
 let url;const result=await list(current(),'inquiry',new URLSearchParams({limit:'10'}),async(u)=>{url=u;return json([{id,revision:1,owner_id:uid,data:{name:'Sample'},created_at:'2026-10-20T20:00:00Z',updated_at:'2026-10-20T20:00:00Z'}]);});assert.equal(result.items.length,1);assert.ok(new URL(url).searchParams.get('owner_id')==='eq.'+uid);assert.equal(new URL(url).searchParams.get('limit'),'11');
 await assert.rejects(list(current(),'inquiry',new URLSearchParams(),async()=>json([{id,owner_id:other,data:{}}])),e=>e.status===403);
 await assert.rejects(list(current(),'inquiry',new URLSearchParams({select:'*'}),async()=>json([])),e=>e.status===400);
});
test('staff cannot create or reassign, even by direct command',async()=>{for(const command of [envelope('create',{name:'Sample',email:'sample@example.invalid'},{expectedRevision:0}),envelope('assign',{ownerId:other})]){let calls=0;await assert.rejects(commit(current(),'inquiry',command,async()=>{calls++;return json({});}),e=>e.status===403);assert.equal(calls,0);}});
test('current row permission is checked before asking for any prior receipt',async()=>{let calls=0;await assert.rejects(commit(current(),'inquiry',envelope(),async()=>{calls++;return json([{id,revision:2,owner_id:other,data:{name:'Hidden'}}]);}),e=>e.status===403);assert.equal(calls,1);});
test('commit requires exact operation, row and revision fingerprint confirmation',async()=>{
 const input=envelope();const reply={record:{id,revision:2},receipt:{operationId:op,expectedRevision:1,revision:2,commandFingerprint:await commandFingerprint(input)}};
 for(const mutation of [()=>{},r=>{r.receipt.commandFingerprint='wrong';},r=>{r.record.id=other;},r=>{r.record.revision=3;}]){const result=structuredClone(reply);mutation(result);let calls=0;const fetcher=async(url)=>{calls++;return url.includes('/rpc/')?json(result):json([{id,owner_id:uid,data:{},revision:1,created_at:'2026-10-20T20:00:00Z',updated_at:'2026-10-20T20:00:00Z'}]);};if(result.record.id===id&&result.record.revision===2&&result.receipt.commandFingerprint===reply.receipt.commandFingerprint)assert.equal((await commit(current(),'inquiry',input,fetcher)).record.revision,2);else await assert.rejects(commit(current(),'inquiry',input,fetcher),e=>e.code==='write_unconfirmed');assert.equal(calls,2);}
});
test('database conflict and ambiguous network outcome have explicit safe errors',async()=>{await assert.rejects(rpc(current(),'ech_commit',{},async()=>json({},409)),e=>e.code==='conflict'&&e.status===409);await assert.rejects(rpc(current(),'ech_commit',{},async()=>{throw Error('reply lost');}),e=>e.code==='write_unconfirmed'&&e.status===502);});
test('cross-origin POST is denied before any provider call',async()=>{let calls=0;const req=new Request(env.ADMIN_ORIGIN+'/api/admin/logout',{method:'POST',headers:{origin:'https://other.invalid','Content-Type':'application/json'},body:'{}'});const response=await handleAdmin('logout',req,env,async()=>{calls++;return json({});});assert.equal(response.status,403);assert.equal(calls,0);});
test('login not in allowlist never sends email and returns non-enumerating result',async()=>{const calls=[];const response=await handleAdmin('login',request('login',{email:'other@example.invalid',challengeToken:'fixture-challenge'},false),env,async(url)=>{calls.push(url);return json({success:true,hostname:'example.invalid',action:'admin-login'});});assert.equal(response.status,200);assert.equal(calls.length,1);assert.deepEqual(await response.json(),{ok:true,message:'If this address is authorized, a sign-in code will be sent.'});});
test('OTP verification registers only an already-approved membership and never exposes tokens',async()=>{
 const server=sessionServer(null,{member:{technical_admin:true}});const fetcher=async(url,init)=>url.endsWith('/auth/v1/verify')?json({access_token:'fictional-access',refresh_token:'fictional-refresh',expires_in:3600}):server.fetcher(url,init);
 const response=await handleAdmin('verify',request('verify',{email:'sample@example.invalid',token:'12345678'},false),env,fetcher);assert.equal(response.status,200);assert.deepEqual(await response.json(),{ok:true});const cookie=response.headers.get('Set-Cookie');assert.match(cookie,/HttpOnly/);assert.match(cookie,/Secure/);assert.match(cookie,/SameSite=Strict/);assert.ok(server.calls.some(c=>c.url.endsWith('/ech_register_session')));
});
test('logout revokes app session before provider logout and clears cookies; failed revocation remains unconfirmed',async()=>{
 const calls=[];let response=await handleAdmin('logout',request('logout',{}),env,async(url)=>{calls.push(url);return url.includes('/rpc/')?json(true):new Response(null,{status:204});});assert.equal(response.status,200);assert.ok(calls[0].endsWith('/ech_logout_session'));assert.match(response.headers.get('Set-Cookie'),/Max-Age=0/);
 response=await handleAdmin('logout',request('logout',{}),env,async()=>{throw Error('network');});assert.equal(response.status,502);assert.match(response.headers.get('Set-Cookie'),/Max-Age=0/);assert.equal((await response.json()).error.code,'write_unconfirmed');
});
test('refresh checks revoked app session without silently registering it again',async()=>{const server=sessionServer('staff',{active:false});const req=request('refresh',{});req.headers.set('cookie','__Host-ech-refresh=fictional-refresh');const response=await handleAdmin('refresh',req,env,async(url,init)=>url.includes('/auth/v1/token?')?json({access_token:'fictional-access',refresh_token:'fictional-refresh'}):server.fetcher(url,init));assert.equal(response.status,401);assert.equal(server.calls.some(c=>c.url.endsWith('/ech_register_session')),false);assert.equal(server.calls.some(c=>c.url.endsWith('/ech_refresh_session')),true);});

test('standalone inquiry note retains note-only payload and assigned update authorization',()=>{const input=envelope('record_note',{note:'Family asked for a call tomorrow.'});assert.deepEqual(parseCommand('inquiry',input).command.fields,{note:'Family asked for a call tomorrow.'});authorize({active:true,user_id:uid,operational_role:'staff'},'record_note',{owner_id:uid});assert.throws(()=>parseCommand('inquiry',envelope('record_note',{note:' ',next:'Injected'})));assert.throws(()=>parseCommand('inquiry',envelope('record_note',{note:'x'.repeat(3001)})));});


test('server requests use manual redirects and reject every 3xx without a second request',async()=>{
 for(let status=300;status<400;status++){
  let calls=0;const fetcher=async(url,init)=>{calls++;assert.equal(init.redirect,'manual');return new Response(null,{status,headers:{Location:'https://untrusted.example/redirect'}});};
  await assert.rejects(()=>provider(current().config,'/auth/v1/user','fictional-access',fetcher),{status:503});assert.equal(calls,1);
  calls=0;await assert.rejects(()=>verifyChallenge({challengeToken:'fictional-challenge'},{origin:env.ADMIN_ORIGIN},env,fetcher),{status:503});assert.equal(calls,1);
  calls=0;await assert.rejects(()=>rpc(current(),'ech_session_active',{},fetcher),{status:502});assert.equal(calls,1);
  calls=0;await assert.rejects(()=>list(current('owner'),'partner',new URLSearchParams(),fetcher),{status:503});assert.equal(calls,1);
 }
});
test('logout refuses provider redirects and clears cookies without forwarding tokens',async()=>{
 let calls=0;const fetcher=async(url,init)=>{calls++;assert.equal(init.redirect,'manual');if(url.endsWith('/ech_logout_session'))return json(true);assert.equal(url,env.SUPABASE_URL+'/auth/v1/logout?scope=local');return new Response(null,{status:307,headers:{Location:'https://untrusted.example/redirect'}});};
 const result=await handleAdmin('logout',request('logout',{}),env,fetcher);assert.equal(result.status,502);assert.equal(calls,2);assert.match(result.headers.get('Set-Cookie'),/Max-Age=0/);
});
