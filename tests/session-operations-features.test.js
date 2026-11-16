import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {handleAdmin} from '../lib/admin/handler.js';
import {sessionOperationsFeatures} from '../lib/admin/session-operations-features.js';
import {parseSession} from '../admin-src/app/shared/live-model.ts';
import {createSessionClient} from '../admin-src/app/shared/session.ts';
import {operationsFeatures,operationsFeatureScope} from '../admin-src/app/shared/operations-features.ts';
const id='00000000-0000-4000-8000-000000000001';
const off={reads:false,scheduleCommands:false,scheduleRecurrence:false,visitActions:false};
const all={reads:true,scheduleCommands:true,scheduleRecurrence:true,visitActions:true};
const config={ADMIN_ORIGIN:'https://staff.example.invalid',SUPABASE_URL:'https://abcdefghijklmnopqrst.supabase.co',SUPABASE_PUBLISHABLE_KEY:'fictional-key'};
const flags={ECH_HOSTED_OPERATIONS_READS:'true',ECH_HOSTED_OPERATIONS_WRITES:'true',ECH_HOSTED_SCHEDULE_COMMANDS:'true',ECH_HOSTED_SCHEDULE_RECURRENCE:'true',ECH_HOSTED_VISIT_ACTIONS:'true'};
const session=(role='manager')=>({authenticated:true,principal:{id,email:'fictional@example.invalid',technicalAdmin:false,applicationAdmin:false,operationalRole:role},capabilities:[]});
test('discovery reflects master/per-capability gates and current operational membership',()=>{
 const member={active:true,operational_role:'manager'};
 assert.deepEqual(sessionOperationsFeatures(member,{}),off);
 assert.deepEqual(sessionOperationsFeatures(member,{ECH_LOCAL_SCHEDULE_COMMANDS:true,ECH_LOCAL_VISIT_ACTIONS:true}),off);
 assert.deepEqual(sessionOperationsFeatures(member,{...flags,ECH_HOSTED_OPERATIONS_READS:false}),off);
 assert.deepEqual(sessionOperationsFeatures(member,{...flags,ECH_HOSTED_OPERATIONS_WRITES:undefined}),{...off,reads:true});
 assert.deepEqual(sessionOperationsFeatures(member,{...flags,ECH_HOSTED_SCHEDULE_COMMANDS:'false'}),{...all,scheduleCommands:false,scheduleRecurrence:false});
 for(const role of ['owner','manager'])assert.deepEqual(sessionOperationsFeatures({...member,operational_role:role},flags),all);
 assert.deepEqual(sessionOperationsFeatures({...member,operational_role:'staff'},flags),{...all,scheduleRecurrence:false});
 for(const m of [null,{...member,active:false},{...member,active:'true'},{...member,operational_role:null},{...member,operational_role:'admin'}])assert.deepEqual(sessionOperationsFeatures(m,flags),off);
 assert.deepEqual(sessionOperationsFeatures(member,Object.create(flags)),off);
});
test('old client session envelope unchanged; explicit version1 negotiates authenticated features only',async()=>{
 let active=true,valid=true,role='manager',calls=0;
 const provider=async url=>{
  calls++;const path=new URL(url).pathname;
  if(path==='/auth/v1/user')return Response.json({id,email:'fictional@example.invalid'});
  if(path==='/rest/v1/ech_memberships')return Response.json([{user_id:id,active,operational_role:role,revision:5}]);
  if(path==='/rest/v1/rpc/ech_session_active')return Response.json(valid);
  assert.fail('Unexpected provider request');
 };
 const load=(version,cookie=true)=>handleAdmin('session',new Request(config.ADMIN_ORIGIN+'/api/admin/session',{headers:{
  ...(cookie?{cookie:'__Host-ech-access=fictional-token'}:{}),...(version===undefined?{}:{'X-ECH-Operations-Features':version})}}),{...config,...flags},provider);
 for(const version of [undefined,'0','2','true','1, 1']){
  const r=await load(version);assert.equal(r.status,200);
  const body=await r.json();assert.deepEqual(Object.keys(body).sort(),['authenticated','capabilities','principal']);assert.doesNotThrow(()=>parseSession(body));
 }
 let r=await load('1'),body=await r.json();assert.equal(r.headers.get('Cache-Control'),'no-store');assert.deepEqual(body.operationsFeatures,all);assert.doesNotThrow(()=>parseSession(body));
 role=null;body=await (await load('1')).json();assert.deepEqual(body.operationsFeatures,off);assert.doesNotThrow(()=>parseSession(body));
 role='manager';active=false;assert.equal((await load('1')).status,403);
 active=true;valid=false;body=await (await load('1')).json();assert.equal(body.authenticated,false);assert.equal(Object.hasOwn(body,'operationsFeatures'),false);
 const before=calls;body=await (await load('1',false)).json();assert.equal(calls,before);assert.equal(Object.hasOwn(body,'operationsFeatures'),false);
});
test('new parser accepts legacy sessions but rejects malformed/inconsistent negotiated features',()=>{
 const old=session();assert.deepEqual(parseSession(old),old);assert.deepEqual(operationsFeatures(parseSession(old)),off);
 for(const f of [null,[],{},'true',{...all,reads:'true'},{...all,extra:true},{...all,reads:false},{...all,scheduleCommands:false}]){
  assert.throws(()=>parseSession({...old,operationsFeatures:f}),{code:'invalid_response'});
 }
 assert.throws(()=>parseSession({...session('staff'),operationsFeatures:all}),{code:'invalid_response'});
 assert.throws(()=>parseSession({...session(null),operationsFeatures:{...off,reads:true}}),{code:'invalid_response'});
 const anonymous={authenticated:false,principal:null,capabilities:[],login:{method:'email_password',siteKey:null}};
 assert.throws(()=>parseSession({...anonymous,operationsFeatures:off}),{code:'invalid_response'});
 assert.deepEqual(operationsFeatures(parseSession({...old,operationsFeatures:all})),all);
 assert.equal(Object.isFrozen(operationsFeatures(parseSession({...old,operationsFeatures:all}))),true);
 assert.deepEqual(operationsFeatures(null),off);assert.deepEqual(operationsFeatures(parseSession(anonymous)),off);
});
test('session client explicitly negotiates features and remains compatible with old servers',async()=>{
 for(const body of [session(),{...session(),operationsFeatures:all}]){
  const client=createSessionClient(async(url,options)=>{
   assert.equal(url,'/api/admin/session');assert.equal(options.headers['X-ECH-Operations-Features'],'1');
   assert.equal(options.credentials,'same-origin');assert.equal(options.cache,'no-store');
   return Response.json(body);
  });
  assert.deepEqual(await client.load(),body);
 }
});
test('UI scope distinguishes role, account and feature changes and defaults absent discovery to off',()=>{
 const a=parseSession({...session(),operationsFeatures:all});
 assert.notEqual(operationsFeatureScope(a),operationsFeatureScope({...a,operationsFeatures:off}));
 assert.notEqual(operationsFeatureScope(a),operationsFeatureScope({...a,principal:{...a.principal,operationalRole:'owner'}}));
 assert.notEqual(operationsFeatureScope(a),operationsFeatureScope({...a,principal:{...a.principal,id:'00000000-0000-4000-8000-000000000002'}}));
 assert.equal(operationsFeatureScope(parseSession(session())),operationsFeatureScope(parseSession({...session(),operationsFeatures:off})));
 assert.notEqual(operationsFeatureScope(a),operationsFeatureScope(null));
});
test('workspace compares feature scope and clears displayed session before loading changed data',async()=>{
 // Source-wiring regression, not rendered browser verification.
 const source=await readFile(new URL('../admin-src/app/shared/AdminWorkspace.tsx',import.meta.url),'utf8');
 assert.match(source,/operationsFeatureScope\(old\) === operationsFeatureScope\(current\)/);
 assert.match(source,/if \(!unchanged\) \{ clearProtected\(\); setSession\(null\); \}/);
 assert.ok(source.indexOf('if (!unchanged) { clearProtected(); setSession(null); }')<source.indexOf('const [inq, par, people] = await Promise.all'));
});
