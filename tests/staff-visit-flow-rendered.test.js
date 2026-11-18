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
const {StaffVisitWorkflow}=await component('StaffVisitWorkflow');
test('staff accepts assigned visit, starts it and submits report with exact retry plus readback',async()=>{
 globalThis.IS_REACT_ACT_ENVIRONMENT=true;
 const actor='10000000-0000-4000-8000-000000000001',id='20000000-0000-4000-8000-000000000001',client='30000000-0000-4000-8000-000000000001';
 let visit={id,clientId:client,workerId:actor,service:'Home support',start:'2026-11-01T17:00:00.000Z',end:'2026-11-01T18:00:00.000Z',status:'Assigned',revision:1};
 let report={schema:1,visitId:id,visitRevision:1,reportRevision:0,versions:[],reviews:[]};
 const posts=[],confirmed=[];let lost=true,leave,staleReportReads=0;
 const receipts=new Map();
 const fetcher=async(url,options)=>{
  assert.equal(options.headers['X-ECH-Schedule-Actor'],actor);assert.equal(options.headers['X-ECH-Schedule-Role'],'staff');
  if(options.method==='POST'){
   const a=JSON.parse(options.body);posts.push(a);
   if(receipts.has(a.operationId))return Response.json(receipts.get(a.operationId));
   if(a.command.type==='confirm'){
    visit={...visit,status:'Confirmed',revision:2};const result={visit,receipt:{operationId:a.operationId,expectedRevision:1,revision:2}};receipts.set(a.operationId,result);return Response.json(result);
   }
   const start=a.command.type==='start';visit={...visit,status:start?'In progress':'Completed',revision:visit.revision+1};
   const receipt={schema:1,operationId:a.operationId,visitId:id,visitRevision:visit.revision,reportRevision:start?null:1,reportVersion:start?null:0,action:a.command.type,recordedAt:start?null:'2026-11-01T18:01:00.000Z'};
   receipts.set(a.operationId,receipt);
   if(!start){const c=a.command;report={schema:1,visitId:id,visitRevision:visit.revision,reportRevision:1,reviews:[],versions:[{revision:1,version:0,sourceRevision:null,actorId:actor,actorRole:'staff',recordedAt:receipt.recordedAt,outcome:c.outcome,summary:c.summary,issue:c.issue,actualStart:c.actualStart,actualEnd:c.actualEnd,completedTasks:c.completedTasks,observations:c.observations,reason:null}]};if(lost){lost=false;throw new Error('Fictional response lost after commit');}}
   return Response.json(receipt);
  }
  if(url.endsWith('?commands=1')||url.endsWith('?scheduling=1'))return Response.json({schema:1,enabled:true,membershipRevision:7});
  if(url.includes('scheduleVisit='))return Response.json({schema:1,visit});
  if(url.includes('?visit='))return Response.json({visitId:id,revision:visit.revision,fields:{},contactAuthority:'unknown',allergyStatus:'unknown'});
  if(url.includes('?report=')){if(Number(new URL(url,'https://fixture.invalid').searchParams.get('revision'))!==visit.revision){staleReportReads++;return Response.json({error:{code:'stale_visit'}},{status:412});}return Response.json({...report,visitRevision:visit.revision});}
  throw new Error('Unexpected URL '+url);
 };
 const props={visit,actor,role:'staff',fetcher,active:true,schedulingEnabled:true,actionsEnabled:true,onConfirmed:value=>confirmed.push(value),onScopeFailure:()=>assert.fail('No scope failure expected'),onLeaveStateChange:value=>{leave=value;}};
 let root;
 const settle=async()=>act(async()=>{await new Promise(r=>setImmediate(r));});
 try{
  await act(async()=>{root=create(React.createElement(StaffVisitWorkflow,props));});await settle();
  await act(async()=>root.root.findByType('form').props.onSubmit({preventDefault(){}}));await settle();
  assert.equal(posts[0].command.type,'confirm');assert.equal(confirmed.at(-1).status,'Confirmed');
  await act(async()=>root.root.findByType('form').props.onSubmit({preventDefault(){}}));await settle();
  assert.equal(posts[1].command.type,'start');assert.equal(confirmed.at(-1).status,'In progress');
  for (const [label,suffix] of [['Jump to visit notes','observations'],['Jump to visit issue','issue']]) {
   const shortcut=root.root.findAllByType('button').find(button=>button.props.children===label);
   const field=root.root.findAllByType('textarea').find(input=>input.props.id.endsWith('-'+suffix));
   assert.equal(shortcut.props.type,'button');
   let focused;
   shortcut.props.onClick({currentTarget:{ownerDocument:{getElementById:id=>({focus(){focused=id;}})}}});
   assert.equal(focused,field.props.id);
  }
  assert.equal(posts.length,2,'shortcuts only focus existing fields');
  const change=async(suffix,value)=>act(async()=>{root.root.findAll(node=>node.props.id?.endsWith('-'+suffix)&&['input','select','textarea'].includes(node.type))[0].props.onChange({target:{value}});});
  await change('outcome','completed');await change('summary','Fictional care provided.');await change('tasks','Fictional meal preparation');await change('start','2026-11-01T10:00');await change('end','2026-11-01T11:00');
  assert.equal(leave.dirty,true);
  await act(async()=>root.root.findByType('form').props.onSubmit({preventDefault(){}}));await settle();
  assert.equal(posts[2].command.type,'submit');assert.equal(confirmed.length,2,'lost response is not a confirmed save');assert.equal(leave.pending,true);
  await act(async()=>root.update(React.createElement(StaffVisitWorkflow,{...props,active:false})));assert.equal(posts.length,3);
  await act(async()=>root.update(React.createElement(StaffVisitWorkflow,props)));await settle();
  const retry=root.root.findAllByType('button').find(button=>JSON.stringify(button.props.children).includes('Retry exact'));
  assert.ok(retry);assert.equal(root.root.findAllByType('button').some(b=>JSON.stringify(b.props.children).includes('Keep draft and reload for editing')),false,'uncertain write cannot be converted into a replacement request');assert.equal(staleReportReads,1,'reopening after committed lost response rejects old report revision but retains request');await act(async()=>retry.props.onClick());await settle();
  assert.deepEqual(posts[3],posts[2],'same operation identity and immutable payload after hidden/reopened view');
  assert.equal(confirmed.at(-1).status,'Completed');assert.equal(confirmed.length,3);
 }finally{if(root)await act(async()=>root.unmount());}
});
const {SharedScheduleRead}=await component('SharedScheduleRead');
test('mounted workflow gates writes and retains pending form while hiding protected rows and blocking leave',async()=>{
 const saved=globalThis.window;globalThis.window=Object.assign(new EventTarget(),{confirm:()=>false});
 const actor='10000000-0000-4000-8000-000000000001',id='20000000-0000-4000-8000-000000000001';
 const session={authenticated:true,principal:{id:actor,operationalRole:'staff'},capabilities:[],operationsFeatures:{reads:true,scheduleCommands:false,scheduleRecurrence:false,visitActions:false}};
 let posted=0,availability=0;let root;const calls=[];
 const fetcher=async(url,options)=>{
  calls.push({url,options});
  if(options.method==='POST'){posted++;return new Promise(()=>{});}
  if(url.includes('?commands=1')){availability++;return Response.json({schema:1,enabled:true,membershipRevision:1});}
  if(url.includes('?visit='))return Response.json({visitId:id,revision:1,fields:{address:'Protected fixture address'},contactAuthority:'unknown',allergyStatus:'unknown'});
  if(url.includes('?report='))return Response.json({schema:1,visitId:id,visitRevision:1,reportRevision:0,versions:[],reviews:[]});
  const from=fixtureVisitStart(url);
  return Response.json({schema:1,mode:'shared',clients:[{id,name:'Protected fixture name'}],staff:[{id:actor,name:'Staff fixture'}],visits:[{id,clientId:id,workerId:actor,service:'Home support',start:from,end:new Date(Date.parse(from)+3600000).toISOString(),status:'Confirmed',revision:1}]});
 };
 const button=text=>root.root.findAllByType('button').find(b=>JSON.stringify(b.props.children).includes(text));
 try{
  await act(async()=>{root=create(React.createElement(SharedScheduleRead,{session,fetcher}));});
  await act(async()=>button('View visit details').props.onClick());
  assert.equal(availability,0);assert.equal(posted,0);assert.equal(root.root.findAllByType('form').length,0);
  const enabled={...session,operationsFeatures:{...session.operationsFeatures,visitActions:true}};
  await act(async()=>root.update(React.createElement(SharedScheduleRead,{session:enabled,fetcher})));
  await act(async()=>button('View visit details').props.onClick());assert.equal(availability,1);
  await act(async()=>root.root.findByType('form').props.onSubmit({preventDefault(){}}));assert.equal(posted,1);
  assert.equal(button('Close visit details').props.disabled,true);assert.equal(button('Reload schedule').props.disabled,true);
  assert.doesNotMatch(JSON.stringify(root.toJSON()),/Protected fixture (name|address)/);
  const event=new Event('beforeunload',{cancelable:true});window.dispatchEvent(event);assert.equal(event.defaultPrevented,true);
  await act(async()=>root.update(React.createElement(SharedScheduleRead,{session:enabled,fetcher,active:false})));
  await act(async()=>root.update(React.createElement(SharedScheduleRead,{session:enabled,fetcher,active:true})));
  assert.equal(posted,1);assert.ok(button('Retry exact'));
  await act(async()=>root.update(React.createElement(SharedScheduleRead,{session:null,fetcher})));assert.equal(root.toJSON(),null);
 }finally{if(root)await act(async()=>root.unmount());globalThis.window=saved;}
});
test('first explicit confirmation rejection can reload; lost/acknowledged outcomes cannot be discarded',async()=>{
 const actor='10000000-0000-4000-8000-000000000001',id='20000000-0000-4000-8000-000000000001';
 const visit={id,clientId:id,workerId:actor,service:'Home support',start:'2026-11-01T17:00:00.000Z',end:'2026-11-01T18:00:00.000Z',status:'Assigned',revision:1};
 for(const scenario of [403,409,412,'lost','receipt']){
  let attempts=0,leave,reloaded;let root;
  const fetcher=async(url,options)=>{
   if(options.method==='POST'){
    const action=JSON.parse(options.body);attempts++;
    if(scenario==='lost'&&attempts===1)throw new Error('Lost transport');
    if(scenario==='receipt')return Response.json({visit:{...visit,status:'Confirmed',revision:2},receipt:{operationId:action.operationId,expectedRevision:1,revision:2}});
    return Response.json({error:{code:'schedule_conflict'}},{status:typeof scenario==='number'?scenario:409});
   }
   if(url.includes('scheduling=1'))return Response.json({schema:1,enabled:true,membershipRevision:7});
   if(url.includes('scheduleVisit='))return Response.json({schema:1,visit:{...visit,revision:scenario==='receipt'?3:2}});
   throw new Error('Unexpected route');
  };
  try{
   await act(async()=>{root=create(React.createElement(StaffVisitWorkflow,{visit,actor,role:'staff',fetcher,active:true,schedulingEnabled:true,actionsEnabled:false,onConfirmed:v=>{reloaded=v;},onScopeFailure:()=>assert.fail('unexpected scope failure'),onLeaveStateChange:value=>{leave=value;}}));});
   await act(async()=>root.root.findByType('form').props.onSubmit({preventDefault(){}}));
   if(scenario==='lost')await act(async()=>root.root.findAllByType('button').find(b=>JSON.stringify(b.props.children).includes('Retry exact')).props.onClick());
   const recovery=root.root.findAllByType('button').find(b=>JSON.stringify(b.props.children).includes('Discard rejected confirmation'));
   if(typeof scenario==='number'){
    assert.ok(recovery);assert.equal(leave.pending,false);assert.equal(leave.retained,true);
    await act(async()=>recovery.props.onClick());assert.equal(reloaded.revision,2);assert.equal(attempts,1);
   }else{assert.equal(recovery,undefined);assert.equal(leave.pending,true);assert.equal(leave.retained,true);assert.equal(reloaded,undefined);}
  }finally{if(root)await act(async()=>root.unmount());}
 }
});
test('acknowledged staff confirmation clears leave protection when visit actions are disabled',async()=>{
 const actor='10000000-0000-4000-8000-000000000001',id='20000000-0000-4000-8000-000000000001';
 const visit={id,clientId:id,workerId:actor,service:'Home support',start:'2026-11-01T17:00:00.000Z',end:'2026-11-01T18:00:00.000Z',status:'Assigned',revision:1};
 const saved={...visit,status:'Confirmed',revision:2};let leave,confirmed,root,posts=0;
 const fetcher=async(url,options)=>{
  if(options.method==='POST'){posts++;const action=JSON.parse(options.body);return Response.json({visit:saved,receipt:{operationId:action.operationId,expectedRevision:1,revision:2}});}
  if(url.includes('scheduling=1'))return Response.json({schema:1,enabled:true,membershipRevision:7});
  if(url.includes('scheduleVisit='))return Response.json({schema:1,visit:saved});
  throw new Error('Unexpected route '+url);
 };
 try{
  await act(async()=>{root=create(React.createElement(StaffVisitWorkflow,{visit,actor,role:'staff',fetcher,active:true,schedulingEnabled:true,actionsEnabled:false,onConfirmed:value=>{confirmed=value;},onScopeFailure:()=>assert.fail('Unexpected failure'),onLeaveStateChange:value=>{leave=value;}}));});
  await act(async()=>root.root.findByType('form').props.onSubmit({preventDefault(){}}));
  assert.equal(posts,1);assert.equal(confirmed.status,'Confirmed');assert.equal(root.root.findAllByType('form').length,0);
  assert.deepEqual(leave,{dirty:false,pending:false,retained:false});
 }finally{if(root)await act(async()=>root.unmount());}
});

test('staff opens the current in-progress visit from My day and can return to the calendar',async()=>{
 const saved=globalThis.window;globalThis.window=Object.assign(new EventTarget(),{confirm:()=>false});
 const actor='10000000-0000-4000-8000-000000000001',id='20000000-0000-4000-8000-000000000001';
 const other='20000000-0000-4000-8000-000000000002';
 const session={authenticated:true,principal:{id:actor,operationalRole:'staff'},capabilities:[],operationsFeatures:{reads:true,scheduleCommands:false,scheduleRecurrence:false,visitActions:false}};
 let root;
 const fetcher=async(url)=>{
  if(url.includes('visit=')){assert.ok(url.includes(id));return Response.json({visitId:id,revision:1,fields:{address:'Fictional shift location'},contactAuthority:'unknown',allergyStatus:'unknown'});}
  const from=fixtureVisitStart(url);
  const visit={id,clientId:id,workerId:actor,service:'Home support',start:from,end:new Date(Date.parse(from)+3600000).toISOString(),status:'In progress',revision:1};
  return Response.json({schema:1,mode:'shared',clients:[{id,name:'Current client'},{id:other,name:'Other client'}],staff:[{id:actor,name:'Staff fixture'}],visits:[{...visit,id:other,clientId:other,status:'Assigned'},visit]});
 };
 const byLabel=label=>root.root.findAll(node=>node.props['aria-label']===label);
 const button=label=>root.root.findAllByType('button').find(node=>node.props.children===label);
 try{
  await act(async()=>{root=create(React.createElement(SharedScheduleRead,{session,fetcher}));});
  assert.equal(byLabel('My day')[0].findByType('strong').props.children,'Current client');
  await act(async()=>button('Open current visit').props.onClick());
  assert.equal(byLabel('Visit calendar').length,0);
  assert.match(JSON.stringify(root.toJSON()),/Fictional shift location/);
  await act(async()=>button('Close visit details').props.onClick());
  assert.equal(byLabel('Visit calendar').length,1);
 }finally{if(root)await act(async()=>root.unmount());globalThis.window=saved;}
});
