import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {createRequire} from 'node:module';
import {fileURLToPath,pathToFileURL} from 'node:url';
import React from 'react';
import {create,act} from 'react-test-renderer';
const require=createRequire(import.meta.url);
async function component(name){
 const bundle=await build({entryPoints:[fileURLToPath(new URL('../admin-src/app/shared/'+name+'.tsx',import.meta.url))],bundle:true,write:false,platform:'node',format:'esm',jsx:'automatic',loader:{'.css':'empty'},plugins:[{name:'external-react',setup(b){b.onResolve({filter:/^react(?:\/.*)?$/},args=>({path:pathToFileURL(require.resolve(args.path)).href,external:true}));}}]});
 return import('data:text/javascript;base64,'+Buffer.from(bundle.outputFiles[0].text).toString('base64'));
}
const {StaffVisitWorkflow}=await component('StaffVisitWorkflow');

const {SharedVisitReport}=await component('SharedVisitReport');
// Fictional shared component/provider fixture, not hosted database acceptance.
for(const outcome of ['follow-up','not-completed'])test(`shared no-task ${outcome}: validation, save and truthful readback`,async()=>{
 globalThis.IS_REACT_ACT_ENVIRONMENT=true;
 const old={window:globalThis.window,document:globalThis.document};
 globalThis.window=Object.assign(new EventTarget(),{setInterval:()=>1,clearInterval(){}});
 globalThis.document=Object.assign(new EventTarget(),{visibilityState:'visible',hasFocus:()=>true});
 const actor='10000000-0000-4000-8000-000000000001',id='20000000-0000-4000-8000-000000000001';
 let visit={id,clientId:actor,workerId:actor,service:'Home support',start:'2026-11-01T17:00:00.000Z',end:'2026-11-01T18:00:00.000Z',status:'In progress',revision:3};
 let report={schema:1,visitId:id,visitRevision:3,reportRevision:0,versions:[],reviews:[]};
 const posts=[],confirmed=[];let reads=0,root,history;
 const summary='Fictional visit: no tasks performed because the client declined support.';
 const fetcher=async(url,options)=>{
  assert.equal(options.headers['X-ECH-Schedule-Actor'],actor);assert.equal(options.headers['X-ECH-Schedule-Role'],'staff');
  if(options.method==='POST'){
   const a=JSON.parse(options.body);posts.push(a);const c=a.command;assert.equal(c.type,'submit');assert.equal(c.outcome,outcome);assert.deepEqual(c.completedTasks,[]);
   visit={...visit,status:'Completed',revision:4};
   report={schema:1,visitId:id,visitRevision:4,reportRevision:1,reviews:[],versions:[{revision:1,version:0,sourceRevision:null,actorId:actor,actorRole:'staff',recordedAt:'2026-11-01T18:01:00.000Z',outcome:c.outcome,summary:c.summary,issue:c.issue,actualStart:c.actualStart,actualEnd:c.actualEnd,completedTasks:c.completedTasks,observations:c.observations,reason:null}]};
   return Response.json({schema:1,operationId:a.operationId,visitId:id,visitRevision:4,reportRevision:1,reportVersion:0,action:'submit',recordedAt:'2026-11-01T18:01:00.000Z'});
  }
  if(url.includes('?commands=1'))return Response.json({schema:1,enabled:true,membershipRevision:7});
  if(url.includes('scheduleVisit='))return Response.json({schema:1,visit});
  if(url.includes('?visit='))return Response.json({visitId:id,revision:visit.revision,fields:{},contactAuthority:'unknown',allergyStatus:'unknown'});
  if(url.includes('?report=')){reads++;return Response.json(report);}
  throw Error('Unexpected request '+url);
 };
 const settle=async()=>act(async()=>{await new Promise(r=>setImmediate(r));});
 const change=async(suffix,value)=>act(async()=>root.root.findAll(n=>n.props.id?.endsWith('-'+suffix)&&['input','select','textarea'].includes(n.type))[0].props.onChange({target:{value}}));
 const submit=async()=>{await act(async()=>root.root.findByType('form').props.onSubmit({preventDefault(){}}));await settle();};
 try{
  await act(async()=>{root=create(React.createElement(StaffVisitWorkflow,{visit,actor,role:'staff',fetcher,active:true,schedulingEnabled:false,actionsEnabled:true,onConfirmed:v=>confirmed.push(v),onScopeFailure:()=>assert.fail('scope failure'),onLeaveStateChange(){}}));});await settle();
  assert.match(JSON.stringify(root.toJSON()),/what happened and why no tasks were completed/);
  await change('outcome','completed');await change('summary',summary);await change('start','2026-11-01T09:00');await change('end','2026-11-01T10:00');await submit();assert.equal(posts.length,0);assert.match(JSON.stringify(root.toJSON()),/Do not invent a completed task/);
  await change('outcome',outcome);await change('summary','');await submit();assert.equal(posts.length,0,'missing explanation is never sent');
  await change('summary',summary);await change('end','2026-11-01T08:00');await submit();assert.equal(posts.length,0,'invalid interval is never sent');
  await change('end','2026-11-01T10:00');await submit();assert.equal(posts.length,1);assert.equal(confirmed.length,1);
  assert.equal(posts[0].command.actualStart,'2026-11-01T16:00:00.000Z');assert.equal(posts[0].command.actualEnd,'2026-11-01T17:00:00.000Z');
  assert.equal(report.versions[0].summary,summary);assert.deepEqual(report.versions[0].completedTasks,[]);assert.equal(report.versions[0].version,0);assert.equal(report.versions[0].reason,null);
  const {createVisitReportClient}=await import('../admin-src/app/shared/visit-report-client.ts');
  await act(async()=>{history=create(React.createElement(SharedVisitReport,{visitId:id,visitRevision:4,load:createVisitReportClient(fetcher,actor,'staff'),onVerificationFailure:()=>assert.fail('read failure'),selectedVersion:null,onSelectedVersionChange(){}}));});await settle();
  const rendered=JSON.stringify(history.toJSON());assert.match(rendered,/No completed tasks were recorded in this version/);assert.match(rendered,/Original report/);assert(rendered.includes(summary));assert(rendered.includes(outcome==='follow-up'?'Follow-up needed':'Not completed'));assert(reads>=2);
 }finally{if(history)await act(async()=>history.unmount());if(root)await act(async()=>root.unmount());globalThis.window=old.window;globalThis.document=old.document;}
});
