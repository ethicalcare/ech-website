import test from 'node:test';import assert from 'node:assert/strict';
import {fictionalReport} from './visit-report.test.js';
import {readOperations} from '../lib/admin/operations-read-dispatch.js';
import {isVisitReport} from '../lib/operations/visit-report-wire.js';
import {createVisitReportClient} from '../admin-src/app/shared/visit-report-client.ts';
const report=fictionalReport(),actor=report.versions[0].actorId;
const current={principal:{id:actor,operationalRole:'staff'},member:{active:true,operational_role:'staff',revision:7},config:{base:'https://fictional.invalid',key:'fictional'},token:'fictional'};
const env={ECH_HOSTED_OPERATIONS_READS:'true',ECH_HOSTED_REPORT_AUTHOR_LABELS:'true'};
const projection=()=>({visitId:report.visitId,visitRevision:3,reportRevision:5,labels:[{actorId:actor,currentLabel:'Fictional worker'},{actorId:report.reviews[0].actorId,currentLabel:'Fictional manager'}]});
const request=(feature='1')=>new Request(`https://staff.invalid/api/admin/operations?report=${report.visitId}&revision=3`,{headers:{'X-ECH-Schedule-Actor':actor,'X-ECH-Schedule-Role':'staff',...(feature===null?{}:{'X-ECH-Report-Features':feature})}});
function fixture(value=projection(),status=200){const calls=[];return {calls,fetcher:async(url,options)=>{calls.push({url,options});if(url.endsWith('/ech_operations_visit_report'))return Response.json(report);assert(url.endsWith('/ech_operations_report_author_labels'));return value instanceof Response?value:Response.json(value,{status});}};}
test('negotiated author labels use exact existing SQL contract and scoped client validates enrichment',async()=>{
 const f=fixture(),result=await readOperations(current,request(),f.fetcher,env);
 assert.equal(f.calls.length,2);assert.deepEqual(JSON.parse(f.calls[1].options.body),{p_visit_id:report.visitId,p_expected_visit_revision:3,p_expected_role:'staff',p_membership_revision:7,p_expected_report_revision:5});assert.equal(f.calls[1].options.redirect,'manual');assert.equal(f.calls[1].options.headers.Authorization,'Bearer fictional');
 assert.deepEqual(result.authorLabels,projection().labels);
 const client=createVisitReportClient(async(url,options)=>{assert.equal(options.headers['X-ECH-Report-Features'],'2');return Response.json(result);},actor,'staff');assert.deepEqual(await client(report.visitId,3,new AbortController().signal),result);
});
test('strict default off, inherited settings and absent/unknown negotiation never request names',async()=>{
 for(const flag of [undefined,false,true,'TRUE',' true','true ']){const f=fixture();assert.deepEqual(await readOperations(current,request(),f.fetcher,{...env,ECH_HOSTED_REPORT_AUTHOR_LABELS:flag}),report);assert.equal(f.calls.length,1);}
 for(const feature of [null,'3','true']){const f=fixture();assert.deepEqual(await readOperations(current,request(feature),f.fetcher,env),report);assert.equal(f.calls.length,1);}
 const f=fixture();assert.deepEqual(await readOperations(current,request(),f.fetcher,Object.create(env)),report);assert.equal(f.calls.length,1);
});
test('missing, extra, duplicate, mismatched, oversized or unsafe labels fail closed; null remains unknown',async()=>{
 for(const mutate of [v=>v.visitRevision=4,v=>v.reportRevision=6,v=>v.visitId=actor,v=>v.labels.pop(),v=>v.labels.push(v.labels[0]),v=>v.labels[0].actorId=report.visitId,v=>v.labels[0].currentLabel='x'.repeat(161),v=>v.labels[0].currentLabel='SECRET\0',v=>v.labels[0].extra='secret']){
  const value=projection();mutate(value);const f=fixture(value);await assert.rejects(readOperations(current,request(),f.fetcher,env),e=>e.status===503&&!e.message.includes('SECRET'));
 }
 const value=projection();value.labels[0].currentLabel=null;assert(isVisitReport({...report,authorLabels:value.labels},report.visitId,3));
 assert.equal(isVisitReport({...report,versions:[null],authorLabels:[]},report.visitId,3),false);
});
test('second-check denial and transport failure never return the first report or raw provider data',async()=>{
 for(const status of [401,403,409,412,500]){const f=fixture({secret:'PRIVATE'},status);await assert.rejects(readOperations(current,request(),f.fetcher,env),e=>e.status===(status===500?503:status)&&!e.message.includes('PRIVATE'));}
 for(const response of [new Response(new ReadableStream({pull(c){c.error(new Error('PRIVATE'));}}),{headers:{'Content-Type':'application/json'}}),new Response('PRIVATE'),Response.json(projection())]){
  if(response.body&&!response.headers.get('content-type').includes('text'))response.body.getReader();
  const f=fixture(response);await assert.rejects(readOperations(current,request(),f.fetcher,env),e=>e.status===503&&!e.message.includes('PRIVATE'));
 }
 const f=fixture();await assert.rejects(readOperations({...current,principal:{...current.principal,id:report.visitId}},request(),f.fetcher,env),e=>e.status===409);assert.equal(f.calls.length,0);
});
