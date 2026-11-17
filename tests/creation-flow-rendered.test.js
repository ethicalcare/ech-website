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
test('manager creates one reserved visit, recovers lost response after closing, reviews and resolves without duplicate creation',async()=>{
 globalThis.IS_REACT_ACT_ENVIRONMENT=true;
 const saved={window:globalThis.window,document:globalThis.document};
 globalThis.window=Object.assign(new EventTarget(),{confirm:()=>true});globalThis.document=Object.assign(new EventTarget(),{visibilityState:'visible'});
 const actor='10000000-0000-4000-8000-000000000001',client='20000000-0000-4000-8000-000000000001',worker='30000000-0000-4000-8000-000000000001';
 const session={authenticated:true,principal:{id:actor,operationalRole:'manager'},capabilities:[],operationsFeatures:{reads:true,scheduleCommands:true,scheduleRecurrence:false,visitActions:false}};
 const source={clientId:client,clientName:'Fictional reviewed client',service:'Home support',area:'Fixture area',instructionsVersion:1,instructionsSavedAt:'2026-11-01T17:00:00.000000Z',confirmedAt:'2026-11-01T17:00:00.000000Z',inquiryId:null,inquiryRevision:null,sourceToken:'a'.repeat(64)};
 let draft=null,creationCount=0,created=null,root;const calls=[];
 const fetcher=async(url,options)=>{
  calls.push({url,options});assert.equal(options.headers['X-ECH-Schedule-Actor'],actor);assert.equal(options.headers['X-ECH-Schedule-Role'],'manager');
  if(url.includes('creationDraft=1')){
   const body=JSON.parse(options.body);
   if(body.action==='reserve'){assert.equal(creationCount,0);draft={request:body.request,reservedRole:'manager',state:'pending',result:null};}
   if(body.action==='resolve'){assert.equal(draft.state,'committed');assert.deepEqual(body.request,draft.request);draft={...draft,state:'resolved'};}
   return Response.json({schema:1,draft});
  }
  if(url.endsWith('?scheduling=1')&&options.method==='POST'){
   const request=JSON.parse(options.body);assert.deepEqual(request,draft.request,'reserve precedes creation with exact same request');creationCount++;const c=request.command;
   created={id:request.visitId,clientId:client,workerId:c.workerId,service:c.service,start:c.start,end:c.end,status:'Assigned',revision:1};
   draft={...draft,state:'committed',result:{visit:created,receipt:{operationId:request.operationId,expectedRevision:0,revision:1}}};
   throw new Error('Fictional response lost after commit');
  }
  if(url.endsWith('?scheduling=1'))return Response.json({schema:1,enabled:true,membershipRevision:7});
  if(url.includes('scheduleSources=1'))return Response.json({schema:1,membershipRevision:7,sources:[source]});
  if(url.includes('scheduleVisit='))return Response.json({schema:1,visit:created});
  if(url.includes('scheduleRecurrence'))throw new Error('Recurrence must remain off');
  return Response.json({schema:1,mode:'shared',visits:[],clients:[],staff:[{id:worker,name:'Scoped worker'}]});
 };
 const button=text=>root.root.findAllByType('button').find(b=>JSON.stringify(b.props.children).includes(text));
 const field=suffix=>root.root.findAll(node=>node.props.id?.endsWith('-'+suffix)&&['input','select','textarea'].includes(node.type))[0];
 const change=async(suffix,value)=>act(async()=>{field(suffix).props.onChange({target:{value}});root.root.findByType('form').props.onChange();});
 try{
  await act(async()=>{root=create(React.createElement(SharedScheduleRead,{session,fetcher}));});
  await act(async()=>button('New shared visit').props.onClick());
  assert.match(JSON.stringify(root.toJSON()),/Fictional reviewed client/);
  await change('source',client);await change('worker',worker);await change('start','2026-11-20T10:00');await change('end','2026-11-20T11:00');
  const unload=new Event('beforeunload',{cancelable:true});window.dispatchEvent(unload);assert.equal(unload.defaultPrevented,true);
  await act(async()=>root.root.findByType('form').props.onSubmit({preventDefault(){}}));
  assert.equal(creationCount,1);assert.equal(draft.state,'committed');assert.match(JSON.stringify(root.toJSON()),/outcome is still unknown/);
  await act(async()=>button('Close creation form').props.onClick());
  await act(async()=>button('New shared visit').props.onClick());assert.equal(creationCount,1);
  assert.match(JSON.stringify(root.toJSON()),/Recovered the outstanding exact creation request/);
  await act(async()=>button('Review recorded creation').props.onClick());
  assert.match(JSON.stringify(root.toJSON()),/Original receipt and current schedule/);
  await act(async()=>button('Acknowledge current outcomes').props.onClick());
  assert.equal(draft.state,'resolved');assert.equal(creationCount,1);assert.match(JSON.stringify(root.toJSON()),/Creation receipt resolved/);
  assert.ok(calls.every(c=>!c.url.includes('scheduleRecurrence')));
  const after=new Event('beforeunload',{cancelable:true});window.dispatchEvent(after);assert.equal(after.defaultPrevented,false);
 }finally{if(root)await act(async()=>root.unmount());globalThis.window=saved.window;globalThis.document=saved.document;}
});
test('creation controls default off/staff hidden and deferred sources cannot survive hidden or changed scope',async()=>{
 const saved={window:globalThis.window,document:globalThis.document};globalThis.window=Object.assign(new EventTarget(),{confirm:()=>true});globalThis.document=Object.assign(new EventTarget(),{visibilityState:'visible'});
 const actor='10000000-0000-4000-8000-000000000001',id='20000000-0000-4000-8000-000000000001';
 const session=(role,enabled)=>({authenticated:true,principal:{id:actor,operationalRole:role},capabilities:[],operationsFeatures:{reads:true,scheduleCommands:enabled,scheduleRecurrence:false,visitActions:false}});
 const pending=[];const calls=[];let root;
 const fetcher=async(url,options)=>{
  calls.push(url);
  if(url.includes('scheduling=1'))return Response.json({schema:1,enabled:true,membershipRevision:7});
  if(url.includes('creationDraft=1'))return Response.json({schema:1,draft:null});
  if(url.includes('scheduleSources=1'))return new Promise(resolve=>pending.push({resolve,signal:options.signal}));
  const staff=options.headers['X-ECH-Schedule-Role']==='staff'?[{id:actor,name:'Scoped worker'}]:[];
  return Response.json({schema:1,mode:'shared',clients:[],staff,visits:[]});
 };
 const button=text=>root.root.findAllByType('button').find(b=>JSON.stringify(b.props.children).includes(text));
 const source={clientId:id,clientName:'Private reviewed source',service:'Home support',area:'Fixture area',instructionsVersion:1,instructionsSavedAt:'2026-11-01T17:00:00.000000Z',confirmedAt:'2026-11-01T17:00:00.000000Z',inquiryId:null,inquiryRevision:null,sourceToken:'a'.repeat(64)};
 try{
  await act(async()=>{root=create(React.createElement(SharedScheduleRead,{session:session('owner',false),fetcher}));});assert.equal(button('New shared visit'),undefined);
  await act(async()=>root.update(React.createElement(SharedScheduleRead,{session:session('staff',true),fetcher})));assert.equal(button('New shared visit'),undefined);assert.ok(calls.every(url=>!url.includes('creationDraft')));
  const owner=session('owner',true);await act(async()=>root.update(React.createElement(SharedScheduleRead,{session:owner,fetcher})));
  await act(async()=>button('New shared visit').props.onClick());assert.equal(pending.length,1);
  await act(async()=>root.update(React.createElement(SharedScheduleRead,{session:owner,fetcher,active:false})));assert.equal(pending[0].signal.aborted,true);
  await act(async()=>pending[0].resolve(Response.json({schema:1,membershipRevision:7,sources:[source]})));assert.doesNotMatch(JSON.stringify(root.toJSON()),/Private reviewed source/);
  await act(async()=>root.update(React.createElement(SharedScheduleRead,{session:owner,fetcher,active:true})));
  await act(async()=>button('Reload reviewed sources').props.onClick());assert.equal(pending.length,2);
  await act(async()=>root.update(React.createElement(SharedScheduleRead,{session:null,fetcher})));assert.equal(pending[1].signal.aborted,true);
  await act(async()=>pending[1].resolve(Response.json({schema:1,membershipRevision:7,sources:[source]})));assert.equal(root.toJSON(),null);
 }finally{if(root)await act(async()=>root.unmount());globalThis.window=saved.window;globalThis.document=saved.document;}
});
