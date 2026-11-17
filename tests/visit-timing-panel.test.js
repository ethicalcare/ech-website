import test from 'node:test';import assert from 'node:assert/strict';import React from 'react';import {create,act} from 'react-test-renderer';import {build} from 'esbuild';import {createRequire} from 'node:module';import {fileURLToPath,pathToFileURL} from 'node:url';
import {readOperations} from '../lib/admin/operations-read-dispatch.js';import {createVisitTaskAvailabilityClient} from '../admin-src/app/shared/visit-task-availability-client.ts';
const require=createRequire(import.meta.url);async function component(name){const bundle=await build({entryPoints:[fileURLToPath(new URL('../admin-src/app/shared/'+name+'.tsx',import.meta.url))],bundle:true,write:false,platform:'node',format:'esm',jsx:'automatic',loader:{'.css':'empty'},plugins:[{name:'react',setup(b){b.onResolve({filter:/^react(?:\/.*)?$/},args=>({path:pathToFileURL(require.resolve(args.path)).href,external:true}));}}]});return import('data:text/javascript;base64,'+Buffer.from(bundle.outputFiles[0].text).toString('base64'));}
const actor='10000000-0000-4000-8000-000000000001',visitId='20000000-0000-4000-8000-000000000001';
const current={principal:{id:actor,operationalRole:'staff'},member:{user_id:actor,active:true,operational_role:'staff',revision:7}};
const env={ECH_HOSTED_OPERATIONS_READS:'true',ECH_HOSTED_OPERATIONS_WRITES:'true',ECH_HOSTED_VISIT_TASKS:'true',ECH_HOSTED_OPERATIONAL_TIMING:'true'};
const request=feature=>new Request('https://staff.invalid/api/admin/operations?visitTaskAvailability=1',{headers:{'X-ECH-Schedule-Actor':actor,'X-ECH-Schedule-Role':'staff',...(feature?{'X-ECH-Task-Features':feature}:{})}});
test('task timing discovery is negotiated, default off and subordinate to existing task admission',async()=>{
 const noFetch=()=>assert.fail('Availability performs no RPC');
 assert.deepEqual(await readOperations(current,request(),noFetch,env),{schema:1,enabled:true,membershipRevision:7});
 assert.equal((await readOperations(current,request('1'),noFetch,env)).timing,true);
 for(const key of Object.keys(env))for(const value of [undefined,true,'TRUE',' true'])assert.equal((await readOperations(current,request('1'),noFetch,{...env,[key]:value})).timing,false);
 for(const value of [{schema:1,enabled:true,membershipRevision:7},{schema:1,enabled:true,membershipRevision:7,timing:true}])assert.deepEqual(await createVisitTaskAvailabilityClient(async(url,options)=>{assert.equal(options.headers['X-ECH-Task-Features'],'1');return Response.json(value);},actor,'staff')(new AbortController().signal),value);
 for(const timing of ['true',null,1])await assert.rejects(createVisitTaskAvailabilityClient(async()=>Response.json({schema:1,enabled:true,membershipRevision:7,timing}),actor,'staff')(new AbortController().signal));
});
const {SharedVisitTiming}=await component('SharedVisitTiming');
const at=hour=>({local:`2026-11-17T${hour}:00:00.000`,zone:'America/Vancouver',instant:`2026-11-17T${Number(hour)+7}:00:00.000Z`,offsetMinutes:-420});
const snapshot={visitId,visitRevision:3,state:'recorded',entries:[{id:'c',label:'Household support',tasks:[{id:'a',text:'Fictional flexible task',timing:{kind:'flexible'}},{id:'b',text:'Fictional walk',timing:{kind:'suggested',target:{kind:'point',at:at('10')}}},{id:'d',text:'Fictional window',timing:{kind:'suggested',target:{kind:'window',start:at('11'),end:at('12')}}}]}]};
test('timing display separates flexible, suggestion, unknown; cancellation discards late protected data',async()=>{
 globalThis.IS_REACT_ACT_ENVIRONMENT=true;const old={window:globalThis.window,document:globalThis.document};globalThis.window=Object.assign(new EventTarget(),{setInterval:()=>1,clearInterval(){}});globalThis.document=Object.assign(new EventTarget(),{visibilityState:'visible',hasFocus:()=>true});let root,resolve,signal;const failure=()=>assert.fail('Unexpected failure');
 try{
  await act(async()=>{root=create(React.createElement(SharedVisitTiming,{visitId,revision:3,load:async()=>snapshot,onFailure:failure}));});
  const text=JSON.stringify(root.toJSON());assert.match(text,/Flexible operational timing/);assert.match(text,/Suggested/);assert.match(text,/Vancouver/);assert.match(text,/not a strict deadline/);assert.equal(root.root.findAllByType('time').length,3);
  await act(async()=>root.update(React.createElement(SharedVisitTiming,{key:'unknown',visitId,revision:4,load:async()=>({visitId,visitRevision:4,state:'unknown',entries:null}),onFailure:failure})));
  assert.match(JSON.stringify(root.toJSON()),/unknown, not flexible by default/);assert.doesNotMatch(JSON.stringify(root.toJSON()),/Fictional walk/);
  await act(async()=>root.update(React.createElement(SharedVisitTiming,{key:'pending',visitId,revision:5,load:(id,rev,s)=>{signal=s;return new Promise(r=>resolve=r);},onFailure:failure})));
  await act(async()=>root.unmount());assert.equal(signal.aborted,true);await act(async()=>resolve(snapshot));
 }finally{if(root)await act(async()=>root.unmount());globalThis.window=old.window;globalThis.document=old.document;}
});
const {VisitTaskWorkflow}=await component('VisitTaskWorkflow');
test('disabled, inactive and terminal visit workflows never request task timing',async()=>{
 globalThis.IS_REACT_ACT_ENVIRONMENT=true;let root;const base={scope:'fictional',actor,role:'staff',visit:{id:visitId,revision:3,status:'In progress'},active:true,enabled:true,blocked:false,onLeave(){},onFailure(){}};
 for(const props of [{enabled:false},{active:false},{visit:{...base.visit,status:'Completed'}},{visit:{...base.visit,status:'Cancelled'}}]){
  let requests=0;await act(async()=>{root=create(React.createElement(VisitTaskWorkflow,{...base,...props,fetcher:async()=>{requests++;throw Error('Unexpected read');}}));});assert.equal(requests,0);await act(async()=>root.unmount());
 }
});
test('mounted timing clears on blur/hidden and rechecks focus; late old reads cannot restore content',async()=>{
 globalThis.IS_REACT_ACT_ENVIRONMENT=true;const old={window:globalThis.window,document:globalThis.document};let focused=true;
 globalThis.window=Object.assign(new EventTarget(),{setInterval:()=>1,clearInterval(){}});globalThis.document=Object.assign(new EventTarget(),{visibilityState:'visible',hasFocus:()=>focused});
 const reads=[];const load=(id,revision,signal)=>new Promise(resolve=>reads.push({resolve,signal}));let root;
 try{
  await act(async()=>{root=create(React.createElement(SharedVisitTiming,{visitId,revision:3,load,onFailure:()=>assert.fail('Unexpected denial')}));});
  await act(async()=>reads[0].resolve(snapshot));assert.match(JSON.stringify(root.toJSON()),/Fictional walk/);
  focused=false;await act(async()=>window.dispatchEvent(new Event('blur')));assert(reads[0].signal.aborted);assert.doesNotMatch(JSON.stringify(root.toJSON()),/Fictional walk/);
  focused=true;await act(async()=>window.dispatchEvent(new Event('focus')));assert.equal(reads.length,2);assert.doesNotMatch(JSON.stringify(root.toJSON()),/Fictional walk/);
  document.visibilityState='hidden';await act(async()=>document.dispatchEvent(new Event('visibilitychange')));assert(reads[1].signal.aborted);
  await act(async()=>reads[1].resolve(snapshot));assert.doesNotMatch(JSON.stringify(root.toJSON()),/Fictional walk/);
  document.visibilityState='visible';await act(async()=>document.dispatchEvent(new Event('visibilitychange')));assert.equal(reads.length,3);
  await act(async()=>reads[2].resolve(snapshot));assert.match(JSON.stringify(root.toJSON()),/Fictional walk/);
 }finally{if(root)await act(async()=>root.unmount());globalThis.window=old.window;globalThis.document=old.document;}
});
test('mounted workflow requires fresh availability before timing reads on revision and identity transitions',async()=>{
 globalThis.IS_REACT_ACT_ENVIRONMENT=true;const old={window:globalThis.window,document:globalThis.document};globalThis.window=Object.assign(new EventTarget(),{setInterval:()=>1,clearInterval(){}});globalThis.document=Object.assign(new EventTarget(),{visibilityState:'visible',hasFocus:()=>true});
 let root;const availability=[],timings=[];
 const fetcher=async(url,options)=>{
  if(url.includes('visitTaskAvailability'))return new Promise(resolve=>availability.push({resolve,signal:options.signal}));
  if(url.includes('visitTiming')){timings.push({url,actor:options.headers['X-ECH-Schedule-Actor']});return Response.json({visitId,visitRevision:Number(new URL(url,'https://fixture.invalid').searchParams.get('revision')),state:'unknown',entries:null});}
  if(url.includes('visitTasks'))return Response.json({visitId,visitRevision:Number(new URL(url,'https://fixture.invalid').searchParams.get('visitRevision')),plan:null,additions:[],results:[],resultVisibility:'limited'});
  assert.fail('Unexpected path');
 };
 const base={scope:'fixture',actor,role:'staff',visit:{id:visitId,revision:3,status:'In progress'},active:true,enabled:true,blocked:false,fetcher,onLeave(){},onFailure:()=>assert.fail('Unexpected scope failure')};
 const allow=index=>availability[index].resolve(Response.json({schema:1,enabled:true,membershipRevision:7,timing:true}));
 try{
  await act(async()=>{root=create(React.createElement(VisitTaskWorkflow,base));});assert.equal(timings.length,0);
  await act(async()=>allow(0));assert.equal(timings.length,1);
  await act(async()=>root.update(React.createElement(VisitTaskWorkflow,{...base,visit:{...base.visit,revision:4}})));assert.equal(timings.length,1);assert.doesNotMatch(JSON.stringify(root.toJSON()),/Operational task timing/);
  await act(async()=>allow(1));assert.equal(timings.length,2);
  const nextActor='10000000-0000-4000-8000-000000000002';await act(async()=>root.update(React.createElement(VisitTaskWorkflow,{...base,actor:nextActor,visit:{...base.visit,revision:4}})));assert.equal(timings.length,2);
  await act(async()=>allow(2));assert.equal(timings.length,3);assert.equal(timings[2].actor,nextActor);
 }finally{if(root)await act(async()=>root.unmount());globalThis.window=old.window;globalThis.document=old.document;}
});
