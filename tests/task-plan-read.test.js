import test from 'node:test';import assert from 'node:assert/strict';import {readFile} from 'node:fs/promises';
import {handleAdmin} from '../lib/admin/handler.js';
import {isTaskPlanRead} from '../lib/operations/task-plan-read-wire.js';
import {createTaskPlanReadClient} from '../admin-src/app/shared/task-plan-read-client.ts';
const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const env={ADMIN_ORIGIN:'https://staff.example.invalid',SUPABASE_URL:'https://abcdefghijklmnopqrst.supabase.co',SUPABASE_PUBLISHABLE_KEY:'fictional',ECH_HOSTED_OPERATIONS_READS:'true',ECH_HOSTED_TASK_PLAN_READ:'true'};
const snapshot=()=>({schema:1,membershipRevision:7,clientId:id(2),instructionsVersion:3,planToken:'a'.repeat(64),plan:{categories:[{id:id(3),label:'Support',tasks:[{id:id(4),text:'Fictional task'}]}],authorId:id(1),authorLabel:'Fictional author',authoredAt:'2026-11-01T17:00:00.000Z',sourceReference:'Fictional source'}});
function fixture({role='manager',status=200,value=snapshot(),active=true}={}){
 const calls=[];const fetcher=async(url,options)=>{const path=new URL(url).pathname;
  if(path==='/auth/v1/user')return Response.json({id:id(1),email:'fixture@example.invalid'});
  if(path==='/rest/v1/ech_memberships')return Response.json([{user_id:id(1),active,operational_role:role,revision:7}]);
  if(path==='/rest/v1/rpc/ech_session_active')return Response.json(true);
  calls.push({path,options});assert.equal(path,'/rest/v1/rpc/ech_operations_task_plan_read');return Response.json(value,{status});
 };return {calls,fetcher};
}
const query=`taskPlan=${id(2)}&instructionsVersion=3&membershipRevision=7`;
const request=(role='manager',q=query,actor=id(1))=>new Request(env.ADMIN_ORIGIN+'/api/admin/operations?'+q,{headers:{cookie:'__Host-ech-access=fictional','X-ECH-Schedule-Actor':actor,'X-ECH-Schedule-Role':role}});
test('manager and owner exact plan read roundtrip preserves authored order and explicit absence',async()=>{
 for(const role of ['owner','manager'])for(const value of [snapshot(),{...snapshot(),plan:null,planToken:null}]){
  const f=fixture({role,value});const client=createTaskPlanReadClient((path,options)=>handleAdmin('operations',new Request(env.ADMIN_ORIGIN+path,{...options,headers:{...options.headers,cookie:'__Host-ech-access=fictional'}}),env,f.fetcher),id(1),role);
  assert.deepEqual(await client(id(2),3,7,new AbortController().signal),value);assert.equal(f.calls.length,1);const call=f.calls[0];assert.deepEqual(JSON.parse(call.options.body),{p_role:role,p_revision:7,p_client:id(2),p_version:3});assert.equal(call.options.redirect,'manual');assert.equal(call.options.cache,'no-store');assert.equal(call.options.headers.Authorization,'Bearer fictional');
 }
});
test('strict default-off read gate, staff denial and stale scopes stop before provider',async()=>{
 for(const flag of [undefined,false,true,'TRUE',' true','true ']){const f=fixture();assert.equal((await handleAdmin('operations',request(),{...env,ECH_HOSTED_TASK_PLAN_READ:flag},f.fetcher)).status,405);assert.equal(f.calls.length,0);}
 for(const [req,f] of [[request('staff'),fixture({role:'staff'})],[request('manager',query,id(8)),fixture()],[request('owner'),fixture()],[request('manager',query.replace('Revision=7','Revision=6')),fixture()],[request(),fixture({active:false})]]){assert((await handleAdmin('operations',req,env,f.fetcher)).status>=400);assert.equal(f.calls.length,0);}
 for(const q of [query+'&extra=1',query+'&instructionsVersion=3',query.replace('Version=3','Version=03'),query.replace('Version=3','Version=0'),query.replace(id(2),'bad')]){const f=fixture();assert.equal((await handleAdmin('operations',request('manager',q),env,f.fetcher)).status,400);assert.equal(f.calls.length,0);}
 const f=fixture();assert.equal((await handleAdmin('operations',request(),{...env,ECH_HOSTED_OPERATIONS_READS:'false'},f.fetcher)).status,404);assert.equal(f.calls.length,0);
});
test('provider refusal and malformed source projection stay sanitized',async()=>{
 for(const status of [401,403,409,412,500]){const f=fixture({status,value:{private:'SECRET-FIXTURE'}});const r=await handleAdmin('operations',request(),env,f.fetcher);assert.equal(r.status,status===500?503:status);assert(!(await r.text()).includes('SECRET-FIXTURE'));}
 for(const mutate of [v=>v.instructionsVersion=99,v=>v.membershipRevision=8,v=>v.clientId=id(9),v=>v.extra='SECRET',v=>v.plan.categories[0].tasks.push(v.plan.categories[0].tasks[0]),v=>v.plan.categories.push(v.plan.categories[0]),v=>v.plan.authorLabel=' bad ',v=>v.plan.authoredAt='2026-02-30T17:00:00.000Z',v=>v.plan.categories[0].tasks[0].extra='SECRET',v=>v.plan.categories[0].tasks[0].text='x'.repeat(501),v=>v.plan=null,v=>v.planToken=null,v=>v.planToken='v1:'+'a'.repeat(64)]){
  const value=snapshot();mutate(value);assert.equal(isTaskPlanRead(value,id(2),3,7),false);const f=fixture({value});assert.equal((await handleAdmin('operations',request(),env,f.fetcher)).status,503);
 }
 const empty=snapshot();empty.plan.categories=[];assert(isTaskPlanRead(empty,id(2),3,7));assert.notEqual(empty.plan,null,'empty authored plan is not missing plan');
});
test('bounds reject oversized, invalid UTF-8, redirect and broken transport without provider details',async()=>{
 const responses=[()=>new Response('x'.repeat(100001),{headers:{'Content-Type':'application/json'}}),()=>new Response(new Uint8Array([255]),{headers:{'Content-Type':'application/json'}}),()=>new Response('{}',{headers:{'Content-Type':'text/html'}}),()=>{const r=Response.json(snapshot());Object.defineProperty(r,'redirected',{value:true});return r;},()=>{const r=Response.json(snapshot());r.body.getReader();return r;},()=>new Response(new ReadableStream({pull(c){c.error(Error('SECRET-TRANSPORT'));}}),{headers:{'Content-Type':'application/json'}})];
 for(const make of responses){const f=fixture();const r=await handleAdmin('operations',request(),env,(url,options)=>url.endsWith('/ech_operations_task_plan_read')?Promise.resolve(make()):f.fetcher(url,options));assert.equal(r.status,503);assert(!(await r.text()).includes('SECRET'));}
});
test('client cancellation and staff role make no request; wrong source response is rejected',async()=>{
 let calls=0;const fetcher=async()=>{calls++;return Response.json({...snapshot(),clientId:id(9)});};const c=new AbortController();c.abort();await assert.rejects(createTaskPlanReadClient(fetcher,id(1),'manager')(id(2),3,7,c.signal));await assert.rejects(createTaskPlanReadClient(fetcher,id(1),'staff')(id(2),3,7,new AbortController().signal));assert.equal(calls,0);await assert.rejects(createTaskPlanReadClient(fetcher,id(1),'manager')(id(2),3,7,new AbortController().signal),{code:'invalid_response'});
});
test('inherited opt-in is ignored and write requests do not invoke private read',async()=>{
 const f=fixture();const inherited=Object.assign(Object.create({ECH_HOSTED_TASK_PLAN_READ:'true'}),env);delete inherited.ECH_HOSTED_TASK_PLAN_READ;assert.equal((await handleAdmin('operations',request(),inherited,f.fetcher)).status,405);
 const post=new Request(request().url,{method:'POST',headers:{cookie:'__Host-ech-access=fictional',Origin:env.ADMIN_ORIGIN,'Content-Type':'application/json','X-ECH-Schedule-Actor':id(1),'X-ECH-Schedule-Role':'manager'},body:'{}'});assert((await handleAdmin('operations',post,{...env,ECH_HOSTED_OPERATIONS_WRITES:'true'},f.fetcher)).status>=400);assert.equal(f.calls.length,0);
});
test('existing SQL remains private, exact-version, source-rechecked and ungranted',async()=>{
 const sql=await readFile(new URL('../migrations/20261114001500_operations_visit_task_plan_read.sql',import.meta.url),'utf8');assert.match(sql,/ech_operations_task_plan_read\(p_role text,p_revision bigint,p_client uuid,p_version bigint\)/);assert.match(sql,/r.instructions_version<>p_version/);assert.match(sql,/ech_task_plan_manager_enter/);assert.match(sql,/ech_operations_client_source\(r.inquiry_id\) is distinct from q/);assert.match(sql,/revoke all on function public.ech_operations_task_plan_read/);
});
test('category/task limits and Unicode metadata preserve the existing bounded projection',()=>{
 const v=snapshot();v.plan.categories[0].tasks=Array.from({length:101},(_,i)=>({id:id(100+i),text:'Task'}));assert(!isTaskPlanRead(v,id(2),3,7));
 v.plan.categories=Array.from({length:21},(_,i)=>({id:id(100+i),label:'Category',tasks:[]}));assert(!isTaskPlanRead(v,id(2),3,7));
 v.plan.categories=[];v.plan.authorLabel='😀'.repeat(160);assert(isTaskPlanRead(v,id(2),3,7));v.plan.authorLabel+='😀';assert(!isTaskPlanRead(v,id(2),3,7));
});
test('client and server sanitize stream release/read failures',async()=>{
 const broken=()=>{const r=Response.json(snapshot());Object.defineProperty(r,'body',{value:{getReader(){return {async read(){return {done:true};},releaseLock(){throw Error('SECRET-RELEASE');}};}}});return r;};
 const f=fixture();const r=await handleAdmin('operations',request(),env,(url,options)=>url.endsWith('/ech_operations_task_plan_read')?Promise.resolve(broken()):f.fetcher(url,options));assert.equal(r.status,503);assert(!(await r.text()).includes('SECRET'));
 const client=createTaskPlanReadClient(async()=>broken(),id(1),'manager');await assert.rejects(client(id(2),3,7,new AbortController().signal),error=>error.code==='unavailable'&&!error.message.includes('SECRET'));
});
