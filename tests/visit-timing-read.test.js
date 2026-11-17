import test from 'node:test';import assert from 'node:assert/strict';
import {handleAdmin} from '../lib/admin/handler.js';
import {isVisitTiming} from '../lib/operations/visit-timing-wire.js';
import {createVisitTimingClient} from '../admin-src/app/shared/visit-timing-client.ts';
const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const env={ADMIN_ORIGIN:'https://staff.example.invalid',SUPABASE_URL:'https://abcdefghijklmnopqrst.supabase.co',SUPABASE_PUBLISHABLE_KEY:'fictional',ECH_HOSTED_OPERATIONS_READS:'true',ECH_HOSTED_OPERATIONAL_TIMING:'true'};
const point=()=>({local:'2026-11-17T10:00:00.000',zone:'America/Vancouver',instant:'2026-11-17T17:00:00.000Z',offsetMinutes:-420});
const snapshot=()=>({visitId:id(2),visitRevision:3,state:'recorded',entries:[{id:id(3),label:'Support',tasks:[{id:id(4),text:'Fictional task',timing:{kind:'suggested',target:{kind:'point',at:point()}}}]}]});
function fixture({role='staff',status=200,value=snapshot(),active=true}={}){
 const calls=[];const fetcher=async(url,options)=>{const path=new URL(url).pathname;
  if(path==='/auth/v1/user')return Response.json({id:id(1),email:'fixture@example.invalid'});
  if(path==='/rest/v1/ech_memberships')return Response.json([{user_id:id(1),active,operational_role:role,revision:7}]);
  if(path==='/rest/v1/rpc/ech_session_active')return Response.json(true);
  calls.push({path,options});assert.equal(path,'/rest/v1/rpc/ech_operations_visit_operational_timing_read');return Response.json(value,{status});
 };return {calls,fetcher,role};
}
const request=(role='staff',query=`visitTiming=${id(2)}&revision=3`,actor=id(1))=>new Request(env.ADMIN_ORIGIN+'/api/admin/operations?'+query,{headers:{cookie:'__Host-ech-access=fictional','X-ECH-Schedule-Actor':actor,'X-ECH-Schedule-Role':role}});
test('authenticated client to handler to timing RPC roundtrip preserves canonical scope; unknown stays unknown',async()=>{
 for(const role of ['owner','manager','staff'])for(const value of [snapshot(),{visitId:id(2),visitRevision:3,state:'unknown',entries:null}]){
  const f=fixture({role,value});const client=createVisitTimingClient((path,options)=>handleAdmin('operations',new Request(env.ADMIN_ORIGIN+path,{...options,headers:{...options.headers,cookie:'__Host-ech-access=fictional'}}),env,f.fetcher),id(1),role);
  assert.deepEqual(await client(id(2),3,new AbortController().signal),value);assert.equal(f.calls.length,1);const call=f.calls[0];assert.deepEqual(JSON.parse(call.options.body),{p_visit:id(2),p_visit_revision:3,p_role:role,p_membership_revision:7});assert.equal(call.options.redirect,'manual');assert.equal(call.options.headers.Authorization,'Bearer fictional');
 }
});
test('strict default-off gate, actor binding and malformed query stop before timing RPC',async()=>{
 for(const flag of [undefined,false,true,'TRUE',' true','true ']){const f=fixture();assert.equal((await handleAdmin('operations',request(),{...env,ECH_HOSTED_OPERATIONAL_TIMING:flag},f.fetcher)).status,405);assert.equal(f.calls.length,0);}
 for(const req of [request('staff',undefined,id(8)),request('manager'),request('staff',`visitTiming=${id(2)}&revision=03`),request('staff',`visitTiming=${id(2)}&revision=3&revision=3`),request('staff',`visitTiming=${id(2)}&revision=3&extra=1`)]){const f=fixture();assert((await handleAdmin('operations',req,env,f.fetcher)).status>=400);assert.equal(f.calls.length,0);}
 const f=fixture();assert.equal((await handleAdmin('operations',request(),{...env,ECH_HOSTED_OPERATIONS_READS:'false'},f.fetcher)).status,404);assert.equal(f.calls.length,0);
});
test('provider denial and invalid payload fail closed without leaking provider text',async()=>{
 for(const status of [401,403,409,412,500]){const f=fixture({status,value:{private:'SECRET-FIXTURE'}});const r=await handleAdmin('operations',request(),env,f.fetcher);assert.equal(r.status,status===500?503:status);assert(!(await r.text()).includes('SECRET-FIXTURE'));}
 for(const mutate of [v=>v.visitRevision=99,v=>v.extra='SECRET-FIXTURE',v=>v.entries[0].tasks[0].timing.target.at.zone='UTC',v=>v.entries[0].tasks[0].timing.target.at.offsetMinutes=-480,v=>v.entries[0].tasks.push(v.entries[0].tasks[0]),v=>v.state='missed',v=>{v.state='unknown';}]){const value=snapshot();mutate(value);assert.equal(isVisitTiming(value,id(2),3),false);const f=fixture({value});assert.equal((await handleAdmin('operations',request(),env,f.fetcher)).status,503);}
});
test('flexible and suggested windows are valid; empty/reversed windows and fabricated civil times reject',()=>{
 const v=snapshot(),task=v.entries[0].tasks[0];task.timing={kind:'flexible'};assert(isVisitTiming(v,id(2),3));
 task.timing={kind:'suggested',target:{kind:'window',start:point(),end:{...point(),local:'2026-11-17T11:00:00.000',instant:'2026-11-17T18:00:00.000Z'}}};assert(isVisitTiming(v,id(2),3));task.timing.target.end=point();assert(!isVisitTiming(v,id(2),3));
 task.timing={kind:'suggested',target:{kind:'point',at:{...point(),local:'2026-02-30T10:00:00.000'}}};assert(!isVisitTiming(v,id(2),3));
});
test('cancelled client read makes no request',async()=>{let calls=0;const c=new AbortController();c.abort();await assert.rejects(createVisitTimingClient(async()=>{calls++;},id(1),'staff')(id(2),3,c.signal));assert.equal(calls,0);});
test('oversized, redirected and invalid UTF-8 provider responses cannot reach client',async()=>{
 for(const response of [new Response('x'.repeat(150001),{headers:{'Content-Type':'application/json'}}),new Response(new Uint8Array([0xff]),{headers:{'Content-Type':'application/json'}}),new Response('{}',{headers:{'Content-Type':'text/html'}})]){
  const f=fixture(),fetcher=(url,options)=>url.endsWith('/ech_operations_visit_operational_timing_read')?Promise.resolve(response):f.fetcher(url,options);
  assert.equal((await handleAdmin('operations',request(),env,fetcher)).status,503);
 }
 const f=fixture(),response=Response.json(snapshot());Object.defineProperty(response,'redirected',{value:true});
 assert.equal((await handleAdmin('operations',request(),env,(url,options)=>url.endsWith('/ech_operations_visit_operational_timing_read')?Promise.resolve(response):f.fetcher(url,options))).status,503);
});
test('inherited timing enablement is ignored and timing POST never invokes timing RPC',async()=>{
 const f=fixture();const inherited=Object.assign(Object.create({ECH_HOSTED_OPERATIONAL_TIMING:'true'}),env);delete inherited.ECH_HOSTED_OPERATIONAL_TIMING;
 assert.equal((await handleAdmin('operations',request(),inherited,f.fetcher)).status,405);assert.equal(f.calls.length,0);
 const post=new Request(request().url,{method:'POST',headers:{cookie:'__Host-ech-access=fictional',Origin:env.ADMIN_ORIGIN,'Content-Type':'application/json','X-ECH-Schedule-Actor':id(1),'X-ECH-Schedule-Role':'staff'},body:'{}'});
 assert((await handleAdmin('operations',post,{...env,ECH_HOSTED_OPERATIONS_WRITES:'true'},f.fetcher)).status>=400);assert.equal(f.calls.length,0);
});

function brokenStream(kind){
 const secret=new Error('SECRET-TRANSPORT');
 if(kind==='locked'){const response=Response.json(snapshot());response.body.getReader();return response;}
 if(kind==='rejecting')return new Response(new ReadableStream({pull(controller){controller.error(secret);}}),{headers:{'Content-Type':'application/json'}});
 const response=Response.json(snapshot());Object.defineProperty(response,'body',{value:{getReader(){return {async read(){return {done:true};},releaseLock(){throw secret;}};}}});return response;
}
test('reader acquisition, read and release failures are sanitized by backend and client',async()=>{
 for(const kind of ['locked','rejecting','release']){
  const response=brokenStream(kind),f=fixture();
  const result=await handleAdmin('operations',request(),env,(url,options)=>url.endsWith('/ech_operations_visit_operational_timing_read')?Promise.resolve(response):f.fetcher(url,options));
  assert.equal(result.status,503);assert(!(await result.text()).includes('SECRET-TRANSPORT'));
  const client=createVisitTimingClient(async()=>brokenStream(kind),id(1),'staff');
  await assert.rejects(client(id(2),3,new AbortController().signal),error=>error.code==='unavailable'&&error.message==='Visit timing could not be verified.');
 }
});
test('caller abort during failed body read preserves caller cancellation',async()=>{
 const controller=new AbortController(),reason=new Error('Caller cancelled');
 const response=Response.json(snapshot());Object.defineProperty(response,'body',{value:{getReader(){return {async read(){controller.abort(reason);throw new Error('SECRET-TRANSPORT');},releaseLock(){}};}}});
 await assert.rejects(createVisitTimingClient(async()=>response,id(1),'staff')(id(2),3,controller.signal),error=>error===reason);
});
