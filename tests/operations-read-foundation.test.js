import test from 'node:test';
import assert from 'node:assert/strict';
import {schedule} from '../lib/admin/operations.js';
import {visitDetail} from '../lib/admin/operations-visit-detail.js';
import {visitReport} from '../lib/admin/operations-visit-report.js';
import {scheduleVisit} from '../lib/admin/operations-schedule-visit.js';

// Direct helper contracts only; canonical authentication remains the caller's job.
// This batch introduces no HTTP route, UI, database or feature activation.
const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const current=(role='staff')=>({member:{active:true,operational_role:role,revision:5},
 config:{base:'https://abcdefghijklmnopqrst.supabase.co',key:'fictional-key'},token:'fictional-token'});
const from='2026-11-01T00:00:00.000Z',to='2026-11-08T00:00:00.000Z';
const visit=()=>({id:id(1),clientId:id(2),workerId:id(3),service:'Home support',
 start:'2026-11-02T17:00:00.000Z',end:'2026-11-02T18:00:00.000Z',status:'Assigned',revision:3});
const cases=[
 {name:'schedule',fn:schedule,rpc:'ech_operations_schedule',params:{from,to},limit:2_000_000,
 payload:()=>({visits:[visit()],clients:[{id:id(2),name:'Fictional client'}],staff:[{id:id(3),name:'Fictional worker'}]}),
 result:p=>({schema:1,mode:'shared',...p}),body:role=>({p_from:from,p_to:to,p_expected_role:role})},
 {name:'detail',fn:visitDetail,rpc:'ech_operations_visit_detail',params:{visit:id(1),revision:'3'},limit:16_384,
 payload:()=>({visitId:id(1),revision:3,fields:{address:'Fictional address'},contactAuthority:'unknown',allergyStatus:'unknown'}),
 result:p=>p,body:role=>({p_visit_id:id(1),p_expected_revision:3,p_expected_role:role,p_membership_revision:5})},
 {name:'report',fn:visitReport,rpc:'ech_operations_visit_report',params:{report:id(1),revision:'3',reportRevision:'0'},limit:1_500_000,
 payload:()=>({schema:1,visitId:id(1),visitRevision:3,reportRevision:0,versions:[],reviews:[]}),
 result:p=>p,body:role=>({p_visit_id:id(1),p_expected_visit_revision:3,p_expected_role:role,p_membership_revision:5,p_expected_report_revision:0})},
 {name:'by-ID visit',fn:scheduleVisit,rpc:'ech_operations_schedule_visit',params:{scheduleVisit:id(1),membershipRevision:'5'},limit:4096,
 payload:visit,result:p=>({schema:1,visit:p}),body:role=>({p_visit_id:id(1),p_expected_role:role,p_membership_revision:5})},
];
for(const c of cases){
 const invoke=(who,provider,params=c.params)=>c.fn(who,new URLSearchParams(params),provider);
 test(c.name+': operational roles forward exact bounded read RPC',async()=>{
  for(const role of ['owner','manager','staff']){
   let calls=0;const payload=c.payload();
   const result=await invoke(current(role),async(url,options)=>{
    calls++;assert.equal(url,current().config.base+'/rest/v1/rpc/'+c.rpc);
    assert.equal(options.method,'POST');assert.equal(options.cache,'no-store');assert.equal(options.redirect,'manual');
    assert.equal(options.headers.Authorization,'Bearer fictional-token');assert.ok(options.signal instanceof AbortSignal);
    assert.deepEqual(JSON.parse(options.body),c.body(role));return Response.json(payload);
   });
   assert.equal(calls,1);assert.deepEqual(result,c.result(payload));
  }
 });
 test(c.name+': inactive or nonoperational members never dispatch',async()=>{
  for(const member of [null,{active:false,operational_role:'owner',revision:5},{active:true,operational_role:null,revision:5},{active:true,operational_role:'admin',revision:5}]){
   let calls=0;await assert.rejects(invoke({...current(),member},()=>{calls++;}),{status:403});assert.equal(calls,0);
  }
 });
 test(c.name+': malformed request rejected before provider',async()=>{
  let calls=0;await assert.rejects(invoke(current(),()=>{calls++;},{...c.params,unexpected:'1'}),{status:400});assert.equal(calls,0);
 });
 test(c.name+': provider denial remains denial, not empty success',async()=>{
  for(const status of [401,403,409]){
   await assert.rejects(invoke(current(),async()=>Response.json({private:'private-marker'},{status})),
    error=>error.status===status&&!error.message.includes('private-marker'));
  }
 });
 test(c.name+': malformed, oversize and excess provider fields fail closed',async()=>{
  for(const response of [new Response('{'),new Response(' '.repeat(c.limit+1),{headers:{'Content-Type':'application/json'}}),Response.json({...c.payload(),private:'private-marker'})]){
   await assert.rejects(invoke(current(),async()=>response),error=>error.status===503&&!error.message.includes('private-marker'));
  }
 });
 test(c.name+': network and redirect failures remain unavailable',async()=>{
  await assert.rejects(invoke(current(),async()=>{throw Error('private-marker');}),{status:503});
  await assert.rejects(invoke(current(),async()=>new Response(null,{status:302})),{status:503});
 });
}
test('exact revisions and staff visit visibility remain bounded',async()=>{
 let calls=0;const provider=async()=>{calls++;return Response.json(visit());};
 await assert.rejects(scheduleVisit(current(),new URLSearchParams({scheduleVisit:id(1),membershipRevision:'4'}),provider),{status:409});
 assert.equal(calls,0);
 for(const payload of [{...visit(),id:id(9)},{...visit(),status:'Cancelled'},{...visit(),status:'Open',workerId:null}]){
  await assert.rejects(scheduleVisit(current(),new URLSearchParams(cases[3].params),async()=>Response.json(payload)),{status:503});
 }
 for(const c of cases.slice(1,3)){
  const payload=c.payload();if(c.name==='detail')payload.revision=2;else payload.reportRevision=1;
  await assert.rejects(c.fn(current(),new URLSearchParams(c.params),async()=>Response.json(payload)),{status:503});
 }
});
test('nonempty report preserves original wording and exact independent review mapping',async()=>{
 const report={schema:1,visitId:id(1),visitRevision:3,reportRevision:2,
  versions:[{revision:1,version:0,sourceRevision:null,actorId:id(4),actorRole:'staff',
   recordedAt:'2026-11-02T18:01:00.000Z',outcome:'completed',summary:' Original fictional wording.\nSecond line. ',
   issue:'',actualStart:visit().start,actualEnd:visit().end,completedTasks:['Fictional task'],observations:'',reason:null}],
  reviews:[{revision:2,version:0,sourceRevision:1,actorId:id(5),actorRole:'manager',
   recordedAt:'2026-11-02T18:02:00.000Z',decision:'accepted',note:'Independent review'}]};
 const params=new URLSearchParams({report:id(1),revision:'3',reportRevision:'2'});
 for(const role of ['owner','manager','staff']){
  assert.deepEqual(await visitReport(current(role),params,async()=>Response.json(report)),report);
 }
 for(const corrupt of [r=>{r.reviews[0].sourceRevision=2;},r=>{r.reviews[0].actorId=id(4);},r=>{r.versions[0].extraPrivate='private-marker';}]){
  const invalid=structuredClone(report);corrupt(invalid);
  await assert.rejects(visitReport(current(),params,async()=>Response.json(invalid)),{status:503});
 }
});
