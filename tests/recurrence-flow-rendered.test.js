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
test('bounded recurring creation reserves and retries identical series; all current visits verified before acknowledgment',async()=>{
 globalThis.IS_REACT_ACT_ENVIRONMENT=true;
 const saved={window:globalThis.window,document:globalThis.document};globalThis.window=Object.assign(new EventTarget(),{confirm:()=>true});globalThis.document=Object.assign(new EventTarget(),{visibilityState:'visible'});
 const actor='10000000-0000-4000-8000-000000000001',client='20000000-0000-4000-8000-000000000001';
 const session={authenticated:true,principal:{id:actor,operationalRole:'owner'},capabilities:[],operationsFeatures:{reads:true,scheduleCommands:true,scheduleRecurrence:true,visitActions:false}};
 const source={clientId:client,clientName:'Fictional series source',service:'Home support',area:'Fixture area',instructionsVersion:1,instructionsSavedAt:'2026-11-01T17:00:00.000000Z',confirmedAt:'2026-11-01T17:00:00.000000Z',inquiryId:null,inquiryRevision:null,sourceToken:'a'.repeat(64)};
 let draft=null,created=[],creationCount=0,partial=true,root;const posts=[],currentReads=[];
 const fetcher=async(url,options)=>{
  assert.equal(options.headers['X-ECH-Schedule-Role'],'owner');
  if(url.includes('creationDraft=1')){
   const a=JSON.parse(options.body);
   if(a.action==='reserve'){if(!draft)draft={request:a.request,result:null,state:'pending',reservedRole:'owner'};else assert.deepEqual(a.request,draft.request);}
   if(a.action==='resolve')draft={...draft,state:'resolved'};
   return Response.json({schema:1,draft});
  }
  if(url.includes('scheduleRecurrence=1')&&options.method==='POST'){
   const a=JSON.parse(options.body);posts.push(a);assert.deepEqual(a,draft.request);
   if(!created.length){creationCount++;created=a.command.occurrences.map(o=>({id:o.visitId,clientId:client,workerId:null,service:'Home support',start:o.start,end:o.end,status:'Open',revision:1}));draft={...draft,state:'committed',result:{visits:created,receipt:{operationId:a.operationId,count:created.length}}};}
   if(partial){partial=false;return Response.json({...draft.result,visits:created.slice(0,1)});}
   return Response.json(draft.result);
  }
  if(url.endsWith('?scheduling=1')||url.endsWith('?scheduleRecurrence=1'))return Response.json({schema:1,enabled:true,membershipRevision:7});
  if(url.includes('scheduleSources=1'))return Response.json({schema:1,membershipRevision:7,sources:[source]});
  if(url.includes('scheduleVisit=')){const id=new URL(url,'https://fixture.invalid').searchParams.get('scheduleVisit');currentReads.push(id);return Response.json({schema:1,visit:created.find(v=>v.id===id)});}
  return Response.json({schema:1,mode:'shared',visits:[],clients:[],staff:[]});
 };
 const button=text=>root.root.findAllByType('button').find(b=>JSON.stringify(b.props.children).includes(text));
 const field=suffix=>root.root.findAll(node=>node.props.id?.endsWith('-'+suffix)&&['input','select','textarea'].includes(node.type))[0];
 const change=async(suffix,value)=>act(async()=>{field(suffix).props.onChange({target:{value}});root.root.findByType('form').props.onChange();});
 try{
  await act(async()=>{root=create(React.createElement(SharedScheduleRead,{session,fetcher}));});await act(async()=>button('New shared visit').props.onClick());
  await change('source',client);await change('start','2026-11-20T10:00');await change('end','2026-11-20T11:00');await change('repeat','weekly');await change('count','13');
  assert.equal(root.root.findAllByType('button').find(b=>b.props.type==='submit').props.disabled,true);
  await act(async()=>root.root.findByType('form').props.onSubmit({preventDefault(){}}));assert.equal(posts.length,0);assert.equal(draft,null);
  await change('count','2');assert.match(JSON.stringify(root.toJSON()),/Recurring visit review/);
  await act(async()=>root.root.findByType('form').props.onSubmit({preventDefault(){}}));
  assert.equal(posts.length,1);assert.equal(posts[0].command.count,2);assert.equal(posts[0].command.cadence,'weekly');
  assert.equal(Date.parse(posts[0].command.occurrences[1].start)-Date.parse(posts[0].command.occurrences[0].start),7*86400000);
  assert.doesNotMatch(JSON.stringify(root.toJSON()),/Confirmed 2 recurring visits saved/,'partial receipt cannot be confirmed');
  await act(async()=>button('Retry exact creation request').props.onClick());
  assert.deepEqual(posts[1],posts[0]);assert.equal(creationCount,1);assert.equal(new Set(currentReads).size,2);
  assert.match(JSON.stringify(root.toJSON()),/Confirmed 2 recurring visits saved/);
  await act(async()=>button('Acknowledge current outcomes').props.onClick());assert.equal(draft.state,'resolved');assert.equal(creationCount,1);
 }finally{if(root)await act(async()=>root.unmount());globalThis.window=saved.window;globalThis.document=saved.document;}
});
