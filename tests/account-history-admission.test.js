import test from 'node:test';
import assert from 'node:assert/strict';
import {handleAdmin} from '../lib/admin/handler.js';
import {accountDecisionHistory} from '../lib/admin/account-decision-history.js';
import {ACCESS_REVIEWER_ID} from '../lib/admin/access-requests.js';
const owner=ACCESS_REVIEWER_ID,partner='20000000-0000-4000-8000-000000000001';
const env={ADMIN_ORIGIN:'https://staff.example.invalid',SUPABASE_URL:'https://abcdefghijklmnopqrst.supabase.co',SUPABASE_PUBLISHABLE_KEY:'fixture',ECH_ACCOUNT_DECISION_HISTORY:'true',ECH_GOOGLE_SIGN_IN_ENABLED:'true'};
const user=(id=owner)=>({principal:{id,email:id===owner?'erick@bloxlabs.tech':'partner@example.invalid'},member:{user_id:id,active:true,revision:1,operational_role:id===owner?'owner':'manager',application_admin:id===owner,technical_admin:false,delegated_user_admin:id===partner}});
const provider=id=>async url=>{
 const u=user(id),p=new URL(url).pathname;
 if(p==='/auth/v1/user')return Response.json(u.principal);
 if(p==='/rest/v1/ech_memberships')return Response.json([u.member]);
 if(p==='/rest/v1/rpc/ech_session_active')return Response.json(true);
 throw Error('Unexpected provider call');
};
const req=header=>new Request(env.ADMIN_ORIGIN+'/api/admin/session',{headers:{cookie:'__Host-ech-access=fictional',...(header?{'x-ech-account-features':header}:{})}});
test('history capability requires explicit negotiation, exact flag and named owner',async()=>{
 for(const [id,header,flag,allowed] of [[owner,'1','true',true],[owner,undefined,'true',false],[owner,'2','true',false],[owner,'1',true,false],[owner,'1','false',false],[partner,'1','true',false]]){
  const response=await handleAdmin('session',req(header),{...env,ECH_ACCOUNT_DECISION_HISTORY:flag},provider(id));
  assert.equal(response.status,200);const value=await response.json();assert.equal(value.capabilities.includes('account.history'),allowed);
  if(id===partner)assert.ok(value.capabilities.includes('access.review'));
 }
});
test('partner account review authority does not expand owner-only history access',async()=>{
 await assert.rejects(accountDecisionHistory(user(partner),new URLSearchParams({userId:partner,revision:'1',offset:'0'}),env,()=>assert.fail('No history RPC for partner')),e=>e.status===403);
});
