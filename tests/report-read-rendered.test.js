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
const actor='10000000-0000-4000-8000-000000000001',reviewer='10000000-0000-4000-8000-000000000002',visit='20000000-0000-4000-8000-000000000001';
const fictionalReport = () => ({
  schema: 1, visitId: visit, visitRevision: 3, reportRevision: 5,
  versions: [{ revision: 1, version: 0, sourceRevision: null, actorId: actor, actorRole: 'staff',
    recordedAt: '2026-11-01T20:00:01.000Z', outcome: 'completed', summary: ' Original wording.\nSecond line. ', issue: 'Original issue',
    actualStart: '2026-11-01T17:00:00.000Z', actualEnd: '2026-11-01T20:00:00.000Z', completedTasks: ['Actual nonclinical task'], observations: '', reason: null },
  { revision: 3, version: 1, sourceRevision: 1, actorId: actor, actorRole: 'staff',
    recordedAt: '2026-11-02T20:00:01.000Z', outcome: 'completed', summary: 'Corrected wording', issue: 'Corrected issue',
    actualStart: '2026-11-01T17:00:00.000Z', actualEnd: '2026-11-01T19:59:00.000Z', completedTasks: ['Corrected nonclinical task'], observations: 'Factual observation', reason: 'Clarify actual end' }],
  reviews: [{ revision: 2, version: 0, sourceRevision: 1, actorId: reviewer, actorRole: 'manager', recordedAt: '2026-11-02T19:00:00.000Z', decision: 'accepted', note: 'Original version reviewed' },
    { revision: 4, version: 1, sourceRevision: 3, actorId: reviewer, actorRole: 'manager', recordedAt: '2026-11-03T19:00:00.000Z', decision: 'returned', note: 'Clarification requested' },
    { revision: 5, version: 1, sourceRevision: 3, actorId: reviewer, actorRole: 'manager', recordedAt: '2026-11-03T20:00:00.000Z', decision: 'accepted', note: 'Exact correction reviewed' }],
});
const {SharedVisitRead}=await component('SharedVisitRead');
test('rendered report history scopes versions/reviews and clears on blur, retry, close and late replies',async()=>{
 globalThis.IS_REACT_ACT_ENVIRONMENT=true;
 const saved={window:globalThis.window,document:globalThis.document};let focused=true;
 globalThis.window=Object.assign(new EventTarget(),{setInterval:()=>1,clearInterval(){}});
 globalThis.document=Object.assign(new EventTarget(),{visibilityState:'visible',hasFocus:()=>focused});
 const calls=[];const fetcher=(url,options)=>new Promise(resolve=>calls.push({url,options,resolve}));
 const entry={id:visit,revision:3,clientId:reviewer,workerId:actor,service:'Home support',start:'2026-11-01T17:00:00.000Z',end:'2026-11-01T20:00:00.000Z',status:'Completed'};
 let root;const button=text=>root.root.findAllByType('button').find(b=>JSON.stringify(b.props.children).includes(text));
 try{
  await act(async()=>{root=create(React.createElement(SharedVisitRead,{actor,role:'staff',visit:entry,fetcher,onClose(){}}));});
  await act(async()=>calls[0].resolve(Response.json({visitId:visit,revision:3,fields:{},contactAuthority:'unknown',allergyStatus:'unknown'})));
  assert.equal(calls.length,1);
  await act(async()=>button('View report history').props.onClick());
  assert.equal(calls[1].options.headers['X-ECH-Schedule-Actor'],actor);assert.equal(calls[1].options.headers['X-ECH-Schedule-Role'],'staff');assert.match(calls[1].url,/report=.*&revision=3/);
  await act(async()=>calls[1].resolve(Response.json(fictionalReport())));
  assert.match(JSON.stringify(root.toJSON()),/Corrected wording/);assert.match(JSON.stringify(root.toJSON()),/Exact correction reviewed/);assert.doesNotMatch(JSON.stringify(root.toJSON()),/Original version reviewed/);
  await act(async()=>root.root.findAllByType('input')[0].props.onChange());
  assert.match(JSON.stringify(root.toJSON()),/Original wording/);assert.match(JSON.stringify(root.toJSON()),/Original version reviewed/);assert.match(JSON.stringify(root.toJSON()),/historical report version/);assert.doesNotMatch(JSON.stringify(root.toJSON()),/Exact correction reviewed/);
  await act(async()=>button('View latest report').props.onClick());assert.match(JSON.stringify(root.toJSON()),/Corrected wording/);
  await act(async()=>{focused=false;window.dispatchEvent(new Event('blur'));});assert.doesNotMatch(JSON.stringify(root.toJSON()),/Corrected wording|Original wording/);assert.equal(calls[1].options.signal.aborted,true);
  await act(async()=>{focused=true;window.dispatchEvent(new Event('focus'));});assert.equal(calls.length,3);
  await act(async()=>button('Hide report history').props.onClick());assert.equal(calls[2].options.signal.aborted,true);
  await act(async()=>calls[2].resolve(Response.json(fictionalReport())));assert.doesNotMatch(JSON.stringify(root.toJSON()),/Corrected wording/);
  await act(async()=>button('View report history').props.onClick());
  const bad=fictionalReport();bad.visitId=actor;
  await act(async()=>calls[3].resolve(Response.json(bad)));assert.match(JSON.stringify(root.toJSON()),/Visit access could not be verified/);assert.doesNotMatch(JSON.stringify(root.toJSON()),/Corrected wording/);
  await act(async()=>button('Reload visit details').props.onClick());assert.doesNotMatch(JSON.stringify(root.toJSON()),/Visit report and review history/);
  assert.ok(calls.every(call=>call.options.method==='GET'));
  assert.ok(calls.every(call=>!call.url.includes('reportAuthors')));
 }finally{if(root)await act(async()=>root.unmount());globalThis.window=saved.window;globalThis.document=saved.document;}
});
const {SharedScheduleRead}=await component('SharedScheduleRead');
test('report access/stale failures clear sensitive detail AND schedule before revalidation',async()=>{
 const saved={window:globalThis.window,document:globalThis.document};
 globalThis.window=Object.assign(new EventTarget(),{setInterval:()=>1,clearInterval(){}});
 globalThis.document=Object.assign(new EventTarget(),{visibilityState:'visible',hasFocus:()=>true});
 try{for(const status of [401,403,409,412]){
  const calls=[];const fetcher=(url,options)=>new Promise(resolve=>calls.push({url,options,resolve}));
  const session={authenticated:true,principal:{id:actor,operationalRole:'staff'},capabilities:[],operationsFeatures:{reads:true,scheduleCommands:false,scheduleRecurrence:false,visitActions:false}};
  let root;const button=text=>root.root.findAllByType('button').find(b=>JSON.stringify(b.props.children).includes(text));
  try{
   await act(async()=>{root=create(React.createElement(SharedScheduleRead,{session,fetcher}));});
   const from=new URL(calls[0].url,'https://fixture.invalid').searchParams.get('from');
   await act(async()=>calls[0].resolve(Response.json({schema:1,mode:'shared',clients:[{id:reviewer,name:'Sensitive client name'}],staff:[{id:actor,name:'Fixture worker'}],visits:[{id:visit,revision:3,clientId:reviewer,workerId:actor,service:'Home support',start:from,end:new Date(Date.parse(from)+3600000).toISOString(),status:'Assigned'}]})));
   await act(async()=>button('View visit details').props.onClick());
   await act(async()=>calls[1].resolve(Response.json({visitId:visit,revision:3,fields:{address:'Sensitive address',entry:'Sensitive entry',contact:{name:'Sensitive contact',phone:'+16045550199',purpose:'visit_logistics'}},contactAuthority:'unknown',allergyStatus:'unknown'})));
   assert.match(JSON.stringify(root.toJSON()),/Sensitive address/);
   await act(async()=>button('View report history').props.onClick());
   await act(async()=>calls[2].resolve(Response.json({error:'denied'},{status})));
   assert.equal(calls.length,4,'fresh schedule verification started');
   assert.match(calls[3].url,/from=/);
   assert.doesNotMatch(JSON.stringify(root.toJSON()),/Sensitive|6045550199|Selected visit details/);
   assert.equal(calls[1].options.signal.aborted,true);assert.equal(calls[2].options.signal.aborted,true);
  }finally{if(root)await act(async()=>root.unmount());}
 }}finally{globalThis.window=saved.window;globalThis.document=saved.document;}
});
