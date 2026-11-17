import {fixtureVisitStart} from './calendar-fixture-time.js';
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
const {SharedScheduleRead}=await component('SharedScheduleRead');
const actor='10000000-0000-4000-8000-000000000001',author='10000000-0000-4000-8000-000000000002',id='20000000-0000-4000-8000-000000000001';
const initialReport=()=>({schema:1,visitId:id,visitRevision:5,reportRevision:1,reviews:[],versions:[{revision:1,version:0,sourceRevision:null,actorId:author,actorRole:'staff',recordedAt:'2026-11-01T18:01:00.000Z',outcome:'completed',summary:'Original fictional report',issue:'',actualStart:'2026-11-01T17:00:00.000Z',actualEnd:'2026-11-01T18:00:00.000Z',completedTasks:['Fictional meal preparation'],observations:'',reason:null}]});
test('independent owner reviews exact latest version with retry, then corrects and cannot self-review new version',async()=>{
 globalThis.IS_REACT_ACT_ENVIRONMENT=true;
 const saved=globalThis.window;globalThis.window=Object.assign(new EventTarget(),{confirm:()=>true});
 const session={authenticated:true,principal:{id:actor,operationalRole:'owner'},capabilities:[],operationsFeatures:{reads:true,scheduleCommands:true,scheduleRecurrence:false,visitActions:true}};
 let report=initialReport(),lost=true,root;const posts=[],receipts=new Map(),calls=[];
 const fetcher=async(url,options)=>{
  calls.push(url);assert.equal(options.headers['X-ECH-Schedule-Actor'],actor);assert.equal(options.headers['X-ECH-Schedule-Role'],'owner');
  if(options.method==='POST'){
   const a=JSON.parse(options.body);posts.push(a);assert.equal(a.visitRevision,5);
   if(receipts.has(a.operationId))return Response.json(receipts.get(a.operationId));
   assert.equal(a.reportRevision,report.reportRevision);const c=a.command,revision=report.reportRevision+1,last=report.versions.at(-1),version=c.type==='review'?last.version:last.version+1,recordedAt=`2026-11-01T18:02:0${revision}.000Z`;
   const event={revision,version,sourceRevision:last.revision,actorId:actor,actorRole:'owner',recordedAt};
   if(c.type==='review'){assert.equal(c.version,last.version);report={...report,reportRevision:revision,reviews:[...report.reviews,{...event,decision:c.decision,note:c.note}]};}
   else {assert.equal(c.type,'correct');report={...report,reportRevision:revision,versions:[...report.versions,{...event,outcome:report.versions[0].outcome,summary:c.summary,issue:c.issue,actualStart:c.actualStart,actualEnd:c.actualEnd,completedTasks:c.completedTasks,observations:c.observations,reason:c.reason}]};}
   const receipt={schema:1,operationId:a.operationId,visitId:id,visitRevision:5,reportRevision:revision,reportVersion:version,action:c.type,recordedAt};receipts.set(a.operationId,receipt);
   if(lost){lost=false;throw new Error('Fictional response lost');}return Response.json(receipt);
  }
  if(url.includes('commands=1'))return Response.json({schema:1,enabled:true,membershipRevision:8});
  if(url.includes('?visit='))return Response.json({visitId:id,revision:5,fields:{address:'Verified detail'},contactAuthority:'unknown',allergyStatus:'unknown'});
  if(url.includes('?report='))return Response.json(report);
  const from=fixtureVisitStart(url);return Response.json({schema:1,mode:'shared',clients:[{id,name:'Verified client'}],staff:[{id:author,name:'Staff author'}],visits:[{id,clientId:id,workerId:author,service:'Home support',start:from,end:new Date(Date.parse(from)+3600000).toISOString(),status:'Completed',revision:5}]});
 };
 const button=text=>root.root.findAllByType('button').find(b=>JSON.stringify(b.props.children).includes(text));
 const change=async(suffix,value)=>act(async()=>root.root.findAll(node=>node.props.id?.endsWith('-'+suffix)&&['input','select','textarea'].includes(node.type))[0].props.onChange({target:{value}}));
 try{
  await act(async()=>{root=create(React.createElement(SharedScheduleRead,{session,fetcher}));});await act(async()=>button('View visit details').props.onClick());
  assert.ok(button('Review latest report'));assert.ok(!calls.some(url=>url.includes('scheduling=1')),'completed manager does not mount competing scheduling workflow');
  await act(async()=>button('Review latest report').props.onClick());await change('note','Independent fictional review');
  await act(async()=>root.root.findByType('form').props.onSubmit({preventDefault(){}}));
  assert.equal(posts[0].command.type,'review');assert.equal(posts[0].command.version,0);assert.equal(button('Close visit details').props.disabled,true);
  await act(async()=>button('Retry exact request').props.onClick());assert.deepEqual(posts[1],posts[0]);assert.equal(report.reviews.length,1);assert.equal(button('Close visit details').props.disabled,false);
  await act(async()=>button('Correct latest report').props.onClick());await change('summary','Corrected fictional wording');await change('reason','Clarify original wording');
  await act(async()=>root.root.findByType('form').props.onSubmit({preventDefault(){}}));
  assert.equal(posts[2].command.type,'correct');assert.equal(posts[2].reportRevision,2);assert.equal(report.versions.length,2);assert.equal(report.versions[1].version,1);assert.equal(report.versions[1].outcome,'completed');
  assert.equal(button('Review latest report'),undefined);assert.match(JSON.stringify(root.toJSON()),/different owner or manager must review/);
  assert.equal(button('Close visit details').props.disabled,false);assert.equal(button('Reload schedule').props.disabled,false);
 }finally{if(root)await act(async()=>root.unmount());globalThis.window=saved;}
});
const {StaffVisitWorkflow}=await component('StaffVisitWorkflow');
test('review drafts remain pinned when a newer report arrives; authors/staff cannot self-review and disabled actions do not fetch',async()=>{
 const visit={id,clientId:id,workerId:author,service:'Home support',start:'2026-11-01T17:00:00.000Z',end:'2026-11-01T18:00:00.000Z',status:'Completed',revision:5};
 let report=initialReport(),posts=0,calls=0,root;
 const fetcher=async(url,options)=>{calls++;if(options.method==='POST'){posts++;throw new Error('No write should be admitted');}if(url.includes('commands=1'))return Response.json({schema:1,enabled:true,membershipRevision:8});if(url.includes('?report='))return Response.json(report);throw new Error('Unexpected read');};
 const base={visit,actor,role:'manager',fetcher,active:true,schedulingEnabled:true,actionsEnabled:false,onConfirmed(){},onScopeFailure(){},onLeaveStateChange(){}};
 const button=text=>root.root.findAllByType('button').find(b=>JSON.stringify(b.props.children).includes(text));
 try{
  await act(async()=>{root=create(React.createElement(StaffVisitWorkflow,base));});assert.equal(calls,0);assert.equal(button('Review latest report'),undefined);
  await act(async()=>root.update(React.createElement(StaffVisitWorkflow,{...base,actionsEnabled:true})));
  await act(async()=>button('Review latest report').props.onClick());
  await act(async()=>root.root.findAllByType('textarea').find(n=>n.props.id.endsWith('-note')).props.onChange({target:{value:'Review version zero only'}}));
  await act(async()=>root.update(React.createElement(StaffVisitWorkflow,{...base,actionsEnabled:true,active:false})));
  const original=report.versions[0];report={...report,reportRevision:2,versions:[original,{...original,revision:2,version:1,sourceRevision:1,actorId:'30000000-0000-4000-8000-000000000001',actorRole:'manager',recordedAt:'2026-11-01T19:00:00.000Z',summary:'New factual correction',reason:'Correct wording'}]};
  await act(async()=>root.update(React.createElement(StaffVisitWorkflow,{...base,actionsEnabled:true})));
  assert.match(JSON.stringify(root.toJSON()),/cannot be retargeted automatically/);assert.equal(root.root.findByType('fieldset').props.disabled,true);
  await act(async()=>root.root.findByType('form').props.onSubmit({preventDefault(){}}));assert.equal(posts,0);
  await act(async()=>root.unmount());root=null;
  for(const role of ['manager','staff']){
   report=initialReport();report.versions[0].actorId=actor;report.versions[0].actorRole=role;
   await act(async()=>{root=create(React.createElement(StaffVisitWorkflow,{...base,role,actionsEnabled:true}));});
   assert.equal(button('Review latest report'),undefined);assert.ok(button('Correct latest report'));
   await act(async()=>root.unmount());root=null;
  }
 }finally{if(root)await act(async()=>root.unmount());}
});
test('completed-report action setup denied or stale clears previously read detail and schedule',async()=>{
 const saved=globalThis.window;globalThis.window=Object.assign(new EventTarget(),{confirm:()=>true});
 for(const status of [403,412]){
  let root,scheduleReads=0;const session={authenticated:true,principal:{id:actor,operationalRole:'manager'},capabilities:[],operationsFeatures:{reads:true,scheduleCommands:false,scheduleRecurrence:false,visitActions:true}};
  const fetcher=async(url)=>{
   if(url.includes('commands=1'))return Response.json({schema:1,enabled:true,membershipRevision:8});
   if(url.includes('?visit='))return Response.json({visitId:id,revision:5,fields:{address:'Sensitive prior detail'},contactAuthority:'unknown',allergyStatus:'unknown'});
   if(url.includes('?report='))return Response.json({error:'refused'},{status});
   scheduleReads++;if(scheduleReads>1)return new Promise(()=>{});
   const from=fixtureVisitStart(url);return Response.json({schema:1,mode:'shared',clients:[{id,name:'Sensitive prior client'}],staff:[{id:author,name:'Fixture author'}],visits:[{id,clientId:id,workerId:author,service:'Home support',start:from,end:new Date(Date.parse(from)+3600000).toISOString(),status:'Completed',revision:5}]});
  };
  try{
   await act(async()=>{root=create(React.createElement(SharedScheduleRead,{session,fetcher}));});
   await act(async()=>root.root.findAllByType('button').find(b=>JSON.stringify(b.props.children).includes('View visit details')).props.onClick());
   assert.equal(scheduleReads,2);assert.doesNotMatch(JSON.stringify(root.toJSON()),/Sensitive prior|Selected visit details/);
  }finally{if(root)await act(async()=>root.unmount());}
 }
 globalThis.window=saved;
});
