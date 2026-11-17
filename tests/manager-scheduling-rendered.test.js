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
test('manager assigns returned staff with verified readback and retains another unsaved reason across revision refresh',async()=>{
 globalThis.IS_REACT_ACT_ENVIRONMENT=true;
 const saved=globalThis.window;globalThis.window=Object.assign(new EventTarget(),{confirm:()=>true});
 const actor='10000000-0000-4000-8000-000000000001',id='20000000-0000-4000-8000-000000000001',worker='30000000-0000-4000-8000-000000000001';
 const session={authenticated:true,principal:{id:actor,operationalRole:'manager'},capabilities:[],operationsFeatures:{reads:true,scheduleCommands:true,scheduleRecurrence:false,visitActions:true}};
 let visit;const posts=[];const reads=[];let root;
 const fetcher=async(url,options)=>{
  assert.equal(options.headers['X-ECH-Schedule-Actor'],actor);assert.equal(options.headers['X-ECH-Schedule-Role'],'manager');
  if(options.method==='POST'){
   const a=JSON.parse(options.body);posts.push(a);assert.equal(a.visitRevision,visit.revision);assert.equal(a.membershipRevision,9);
   const c=a.command;visit={...visit,revision:visit.revision+1,...(c.type==='assign'?{status:'Assigned',workerId:c.workerId}:c.type==='cancel'?{status:'Cancelled'}:c.type==='unassign'?{status:'Open',workerId:null}:{start:c.start,end:c.end,status:visit.workerId?'Assigned':'Open'})};
   return Response.json({visit,receipt:{operationId:a.operationId,expectedRevision:a.visitRevision,revision:visit.revision}});
  }
  reads.push(url);
  if(url.includes('scheduling=1'))return Response.json({schema:1,enabled:true,membershipRevision:9});
  if(url.includes('scheduleVisit='))return Response.json({schema:1,visit});
  if(url.includes('?visit='))return Response.json({visitId:id,revision:visit.revision,fields:{address:'Fixture address'},contactAuthority:'unknown',allergyStatus:'unknown'});
  const from=fixtureVisitStart(url);visit||={id,clientId:id,workerId:null,service:'Home support',start:from,end:new Date(Date.parse(from)+3600000).toISOString(),status:'Open',revision:1};
  return Response.json({schema:1,mode:'shared',clients:[{id,name:'Fictional client'}],staff:[{id:worker,name:'Returned staff member'}],visits:[visit]});
 };
 const button=text=>root.root.findAllByType('button').find(b=>JSON.stringify(b.props.children).includes(text));
 const field=suffix=>root.root.findAll(node=>node.props.id?.endsWith('-'+suffix)&&['input','select','textarea'].includes(node.type))[0];
 const change=async(suffix,value)=>act(async()=>{field(suffix).props.onChange({target:{value}});root.root.findByType('form').props.onChange();});
 try{
  await act(async()=>{root=create(React.createElement(SharedScheduleRead,{session,fetcher}));});
  await act(async()=>button('View visit details').props.onClick());
  assert.ok(field('action'));assert.equal(reads.some(url=>url.includes('commands=1')),false,'manager write forms do not expose staff start/report actions');
  await change('action','cancel');await change('reason','Future cancellation draft');
  await change('action','assign');assert.match(JSON.stringify(root.toJSON()),/Returned staff member/);
  await change('worker',worker);await change('reason','Assign qualified staff fixture');
  await act(async()=>root.root.findByType('form').props.onSubmit({preventDefault(){}}));
  assert.equal(posts[0].command.type,'assign');assert.equal(posts[0].command.workerId,worker);assert.equal(visit.status,'Assigned');
  assert.ok(reads.some(url=>url.includes('scheduleVisit=')),'receipt was followed by fresh selected-visit readback');
  await change('action','cancel');assert.equal(field('reason').props.value,'Future cancellation draft','other mode draft survives confirmed revision and detail reload');
  await act(async()=>root.root.findByType('form').props.onSubmit({preventDefault(){}}));
  assert.equal(posts[1].command.type,'cancel');assert.equal(posts[1].visitRevision,2);assert.equal(visit.status,'Cancelled');
  assert.match(JSON.stringify(root.toJSON()),/cancelled/i);
  assert.equal(posts.some(p=>p.command.type==='confirm'),false);
  assert.equal(button('Close visit details').props.disabled,false);assert.equal(button('Reload schedule').props.disabled,false);
 }finally{if(root)await act(async()=>root.unmount());globalThis.window=saved;}
});
const {StaffVisitWorkflow}=await component('StaffVisitWorkflow');
test('owner reschedules and removes assignment only with scheduling capability and canonical fresh receipts',async()=>{
 const actor='10000000-0000-4000-8000-000000000001',id='20000000-0000-4000-8000-000000000001',worker='30000000-0000-4000-8000-000000000001';
 let visit={id,clientId:id,workerId:worker,service:'Home support',start:'2026-11-20T17:00:00.000Z',end:'2026-11-20T18:00:00.000Z',status:'Confirmed',revision:4};
 const posts=[],confirmed=[];let calls=0,root;
 const fetcher=async(url,options)=>{
  calls++;assert.equal(options.headers['X-ECH-Schedule-Role'],'owner');
  if(options.method==='POST'){
   const a=JSON.parse(options.body);posts.push(a);const c=a.command;
   visit={...visit,revision:visit.revision+1,...(c.type==='reschedule'?{start:c.start,end:c.end,status:'Assigned'}:{workerId:null,status:'Open'})};
   return Response.json({visit,receipt:{operationId:a.operationId,expectedRevision:a.visitRevision,revision:visit.revision}});
  }
  if(url.includes('scheduling=1'))return Response.json({schema:1,enabled:true,membershipRevision:5});
  if(url.includes('scheduleVisit='))return Response.json({schema:1,visit});
  throw new Error('Unexpected route '+url);
 };
 const props={actor,role:'owner',visit,staff:[{id:worker,name:'Scoped staff'}],fetcher,active:true,schedulingEnabled:false,actionsEnabled:true,onConfirmed:v=>confirmed.push(v),onScopeFailure:()=>assert.fail('Unexpected scope failure'),onLeaveStateChange(){}};
 const field=suffix=>root.root.findAll(node=>node.props.id?.endsWith('-'+suffix)&&['input','select','textarea'].includes(node.type))[0];
 const change=async(suffix,value)=>act(async()=>{field(suffix).props.onChange({target:{value}});root.root.findByType('form').props.onChange();});
 try{
  await act(async()=>{root=create(React.createElement(StaffVisitWorkflow,props));});assert.equal(calls,0);assert.equal(root.root.findAllByType('form').length,0);
  await act(async()=>root.update(React.createElement(StaffVisitWorkflow,{...props,schedulingEnabled:true})));
  await change('start','2026-11-20T11:00');await change('end','2026-11-20T12:00');await change('reason','Move within approved window');
  await act(async()=>root.root.findByType('form').props.onSubmit({preventDefault(){}}));
  assert.equal(posts[0].command.type,'reschedule');assert.equal(posts[0].command.start,'2026-11-20T18:00:00.000Z');assert.equal(confirmed.at(-1).status,'Assigned');
  await change('action','unassign');await change('reason','Release assignment for reassessment');
  await act(async()=>root.root.findByType('form').props.onSubmit({preventDefault(){}}));
  assert.equal(posts[1].command.type,'unassign');assert.equal(posts[1].visitRevision,5);assert.equal(confirmed.at(-1).workerId,null);assert.equal(confirmed.at(-1).status,'Open');
 }finally{if(root)await act(async()=>root.unmount());}
});
test('mounted staff completed report clears terminal leave guard and restores history and navigation controls',async()=>{
 const saved=globalThis.window,savedDocument=globalThis.document;globalThis.window=Object.assign(new EventTarget(),{confirm:()=>true,setInterval:()=>1,clearInterval(){}});globalThis.document=Object.assign(new EventTarget(),{visibilityState:'visible',hasFocus:()=>true});
 const actor='10000000-0000-4000-8000-000000000001',id='20000000-0000-4000-8000-000000000001';
 const session={authenticated:true,principal:{id:actor,operationalRole:'staff'},capabilities:[],operationsFeatures:{reads:true,scheduleCommands:true,scheduleRecurrence:false,visitActions:true}};
 let visit,report={schema:1,visitId:id,visitRevision:1,reportRevision:0,versions:[],reviews:[]},posts=0,root;
 const fetcher=async(url,options)=>{
  if(options.method==='POST'){
   posts++;const a=JSON.parse(options.body),c=a.command;assert.equal(c.type,'submit');visit={...visit,status:'Completed',revision:2};
   const recordedAt='2026-11-01T18:01:00.000Z';
   report={schema:1,visitId:id,visitRevision:2,reportRevision:1,reviews:[],versions:[{revision:1,version:0,sourceRevision:null,actorId:actor,actorRole:'staff',recordedAt,outcome:c.outcome,summary:c.summary,issue:c.issue,actualStart:c.actualStart,actualEnd:c.actualEnd,completedTasks:c.completedTasks,observations:c.observations,reason:null}]};
   return Response.json({schema:1,operationId:a.operationId,visitId:id,visitRevision:2,reportRevision:1,reportVersion:0,action:'submit',recordedAt});
  }
  if(url.includes('commands=1'))return Response.json({schema:1,enabled:true,membershipRevision:1});
  if(url.includes('?visit='))return Response.json({visitId:id,revision:visit.revision,fields:{address:'Verified detail'},contactAuthority:'unknown',allergyStatus:'unknown'});
  if(url.includes('?report='))return Response.json(report);
  const from=fixtureVisitStart(url);visit||={id,clientId:id,workerId:actor,service:'Home support',start:from,end:new Date(Date.parse(from)+3600000).toISOString(),status:'In progress',revision:1};
  return Response.json({schema:1,mode:'shared',clients:[{id,name:'Verified client'}],staff:[{id:actor,name:'Worker'}],visits:[visit]});
 };
 const button=text=>root.root.findAllByType('button').find(b=>JSON.stringify(b.props.children).includes(text));
 const change=async(suffix,value)=>act(async()=>{root.root.findAll(node=>node.props.id?.endsWith('-'+suffix)&&['input','select','textarea'].includes(node.type))[0].props.onChange({target:{value}});});
 try{
  await act(async()=>{root=create(React.createElement(SharedScheduleRead,{session,fetcher}));});
  await act(async()=>button('View visit details').props.onClick());
  await change('outcome','completed');await change('summary','Fictional care completed');await change('tasks','Fictional meal preparation');await change('start','2026-11-01T10:00');await change('end','2026-11-01T11:00');
  await act(async()=>root.root.findByType('form').props.onSubmit({preventDefault(){}}));
  assert.equal(posts,1);assert.equal(visit.status,'Completed');
  assert.equal(button('Close visit details').props.disabled,false);assert.equal(button('Reload schedule').props.disabled,false);
  assert.ok(button('View report history'));await act(async()=>button('View report history').props.onClick());assert.match(JSON.stringify(root.toJSON()),/Fictional care completed/);assert.match(JSON.stringify(root.toJSON()),/Verified detail|Verified client/);
  assert.doesNotMatch(JSON.stringify(root.toJSON()),/A visit request is retained/);
  const event=new Event('beforeunload',{cancelable:true});window.dispatchEvent(event);assert.equal(event.defaultPrevented,false);
  await act(async()=>button('Close visit details').props.onClick());assert.doesNotMatch(JSON.stringify(root.toJSON()),/Selected visit details/);
 }finally{if(root)await act(async()=>root.unmount());globalThis.window=saved;globalThis.document=savedDocument;}
});
