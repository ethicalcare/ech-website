import test from 'node:test';
import assert from 'node:assert/strict';
import { handleAdmin } from '../lib/admin/handler.js';
import { capabilities, requireApplicationAdmin } from '../lib/admin/permissions.js';
import { membershipCommit, membershipList, backup, parseMembership } from '../lib/admin/application-admin.js';
import { commandFingerprint } from '../lib/admin/shared-commands.js';
const id='1fbc76c6-8521-4f9e-b0c9-f174ada676aa';
const operationId='00000000-0000-4000-8000-000000000001';
const env={ADMIN_ORIGIN:'https://staff.example.test',SUPABASE_URL:'https://abcdefghijklmnopqrst.supabase.co',SUPABASE_PUBLISHABLE_KEY:'public-key',TURNSTILE_SECRET_KEY:'secret',ECH_LOGIN_EMAILS:'erick@bloxlabs.tech'};
const response=value=>new Response(JSON.stringify(value));
const post=(body,origin=env.ADMIN_ORIGIN)=>new Request(env.ADMIN_ORIGIN+'/api/admin/password',{method:'POST',headers:{origin,'Content-Type':'application/json'},body:JSON.stringify(body)});
const credentials={email:'Erick@bloxlabs.tech',password:'test-password',challengeToken:'test-challenge'};
const envelope=()=>({schema:1,operationId,expectedRevision:1,command:{type:'upsert',email:'staff@example.test',fields:{displayName:'Staff',technicalAdmin:false,operationalRole:'staff',applicationAdmin:false,active:true}}});
const current={config:{base:env.SUPABASE_URL,key:'public-key'},token:'access',member:{active:true,application_admin:true}};
function passwordProvider(overrides={}) {
  const calls=[];
  const fetcher=async(url,options={})=>{
    calls.push({url,options});
    if(url.includes('siteverify'))return response({success:true,hostname:'staff.example.test',action:'admin-login',...overrides.challenge});
    if(url.endsWith('grant_type=password'))return overrides.tokenFailure?new Response('{}',{status:400}):response({access_token:'access',refresh_token:'refresh',expires_in:3600});
    if(url.endsWith('/auth/v1/user'))return response({id,email:'erick@bloxlabs.tech',email_confirmed_at:'2026-10-22',...overrides.user});
    if(url.includes('/ech_memberships?'))return response([{user_id:id,display_name:'Erick',active:true,operational_role:'owner',technical_admin:true,application_admin:true,revision:1,...overrides.member}]);
    if(url.endsWith('/ech_register_session'))return response(overrides.register!==false);
    throw Error('Unexpected URL');
  };
  return {calls,fetcher};
}
test('application admin is explicit and active, independent of owner/technical roles',()=>{
  for(const member of [{active:true,technical_admin:true,operational_role:'owner'},{active:false,application_admin:true},{active:true,application_admin:'true'}]){
    assert.throws(()=>requireApplicationAdmin(member));assert(!capabilities(member).includes('users.manage'));
  }
  assert.doesNotThrow(()=>requireApplicationAdmin(current.member));assert(capabilities(current.member).includes('backup.export'));
});
test('password sign-in verifies challenge, provider identity and session before issuing secure cookies',async()=>{
  const {fetcher,calls}=passwordProvider();const result=await handleAdmin('password',post(credentials),env,fetcher);
  assert.equal(result.status,200);assert.deepEqual(await result.json(),{ok:true});
  assert.match(result.headers.get('set-cookie'),/HttpOnly; Secure; SameSite=Strict/);
  assert.equal(calls.filter(c=>c.url.endsWith('/ech_register_session')).length,1);
  assert.deepEqual(JSON.parse(calls.find(c=>c.url.endsWith('grant_type=password')).options.body),{email:'erick@bloxlabs.tech',password:'test-password'});
});
test('password sign-in fails closed for origin, extra fields, challenge, allowlist, identity, confirmation, membership and session',async()=>{
  const cases=[{body:{...credentials,extra:true}},{origin:'https://other.test'},{options:{challenge:{success:false}}},{options:{challenge:{hostname:'other.test'}}},{options:{challenge:{action:'other'}}},{body:{...credentials,email:'other@example.test'}},{options:{tokenFailure:true}},{options:{user:{email:'other@example.test'}}},{options:{user:{email_confirmed_at:null}}},{options:{member:{active:false}}},{options:{register:false}}];
  for(const item of cases){const {fetcher,calls}=passwordProvider(item.options);const result=await handleAdmin('password',post(item.body||credentials,item.origin),env,fetcher);assert(result.status>=400);assert.equal(result.headers.get('set-cookie'),null);assert(!(await result.text()).includes(credentials.password));if(item.body?.email==='other@example.test')assert(!calls.some(c=>c.url.includes('grant_type=password')));if(item.options?.tokenFailure)assert.equal(result.status,401);}
});
test('unauthenticated session advertises password method; OTP still has separate handler',async()=>{
  const result=await handleAdmin('session',new Request(env.ADMIN_ORIGIN+'/api/admin/session'),env,()=>{throw Error('network');});
  assert.deepEqual((await result.json()).login,{method:'email_password',siteKey:null});
});
test('membership parser requires exact fields, canonical email, safe revision and boolean flags',()=>{
  assert.deepEqual(parseMembership(envelope()),envelope());
  for(const mutate of [v=>v.extra=true,v=>v.expectedRevision=1.2,v=>v.command.email='Staff@example.test',v=>v.command.fields.active='true',v=>v.command.fields.role='owner',v=>v.command.fields.operationalRole='admin']){const value=envelope();mutate(value);assert.throws(()=>parseMembership(value));}
});
test('membership and backup guards block before any RPC, including owner and technical administrator',async()=>{
  const blocked={...current,member:{active:true,technical_admin:true,operational_role:'owner'}};
  const fetcher=()=>{throw Error('RPC must not run');};
  await assert.rejects(()=>membershipList(blocked,new URLSearchParams(),fetcher),{status:403});
  await assert.rejects(()=>membershipCommit(blocked,envelope(),fetcher),{status:403});
  await assert.rejects(()=>backup(blocked,new URLSearchParams(),fetcher),{status:403});
});
test('membership save verifies operation, revision and fingerprint receipt',async()=>{
  const value=envelope();const result={member:{userId:id,email:value.command.email,revision:2,...value.command.fields},receipt:{operationId,expectedRevision:1,revision:2,commandFingerprint:await commandFingerprint(value)}};
  assert.equal((await membershipCommit(current,value,async()=>response(result))).member.revision,2);
  await assert.rejects(()=>membershipCommit(current,value,async()=>response({...result,receipt:{...result.receipt,commandFingerprint:'wrong'}})),{status:502});
});
test('backup validates versioned data arrays and rejects filters',async()=>{
  const value={format:'ech-application-snapshot',version:1,records:[],personKeys:[],events:[],commandReceipts:[],memberships:[],membershipReceipts:[]};
  assert.deepEqual(await backup(current,new URLSearchParams(),async()=>response(value)),value);
  await assert.rejects(()=>backup(current,new URLSearchParams('all=true'),()=>{throw Error('network');}),{status:400});
  await assert.rejects(()=>backup(current,new URLSearchParams(),async()=>response({...value,version:2})),{status:502});
});
