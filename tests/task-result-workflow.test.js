import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {createRequire} from 'node:module';
import {fileURLToPath,pathToFileURL} from 'node:url';
import React from 'react';
import {create,act} from 'react-test-renderer';
import {createVisitTaskClient} from '../admin-src/app/shared/visit-task-client.ts';
const require=createRequire(import.meta.url);
const bundle=await build({entryPoints:[fileURLToPath(new URL('../admin-src/app/shared/SharedVisitTaskResults.tsx',import.meta.url))],bundle:true,write:false,platform:'node',format:'esm',jsx:'automatic',loader:{'.css':'empty'},plugins:[{name:'external-react',setup(b){b.onResolve({filter:/^react(?:\/.*)?$/},args=>({path:pathToFileURL(require.resolve(args.path)).href,external:true}));}}]});
const {SharedVisitTaskResults,clearVisitTaskResultEntries}=await import('data:text/javascript;base64,'+Buffer.from(bundle.outputFiles[0].text).toString('base64'));
const actor='11111111-1111-4111-8111-111111111111',visit='22222222-2222-4222-8222-222222222222',task='33333333-3333-4333-8333-333333333333',category='44444444-4444-4444-8444-444444444444';
const operation='55555555-5555-4555-8555-555555555555';
const envelope=()=>({visitId:visit,visitRevision:2,membershipRevision:3,taskId:task,expectedVersion:0,operationId:operation,outcome:'done',observation:'Fictional household task complete',actualAt:'2026-11-16T17:00:00.123456Z',reason:null});
const snapshot=()=>({visitId:visit,visitRevision:2,plan:[{id:category,label:'Fictional household support',tasks:[{id:task,text:'Prepare fictional household items'}]}],additions:[],results:[],resultVisibility:'limited'});
const eventFor=(request,recordedAt='2026-11-16T18:00:00.123456Z')=>({taskId:task,version:request.expectedVersion+1,outcome:request.outcome,observation:request.observation,actualAt:request.actualAt,recordedAt,actorId:actor,reason:request.reason});
const receiptFor=request=>({visitId:visit,taskId:task,version:request.expectedVersion+1,operationId:request.operationId,recordedAt:'2026-11-16T18:00:00.123456Z'});
test('adapter validates identity, exact envelopes, role and correction before transport',async()=>{
 let calls=0;const fetcher=async()=>{calls++;return Response.json({});};
 for(const [who,role,request] of [[actor,'manager',envelope()],['bad','staff',envelope()],[actor,'staff',{...envelope(),extra:'no'}],[actor,'staff',{...envelope(),expectedVersion:1,reason:'x'}],[actor,'staff',{...envelope(),observation:'\u0000'}]]){
  await assert.rejects(createVisitTaskClient(fetcher,who,role).save(request,new AbortController().signal));
 }
 assert.equal(calls,0);
});
test('adapter rejects cross-actor disclosure, unknown tasks, bad versions, oversized and mismatched scope reads',async()=>{
 for(const change of [v=>{v.results=[{...eventFor(envelope()),actorId:operation}];},v=>{v.results=[{...eventFor(envelope()),taskId:operation}];},v=>{v.results=[{...eventFor(envelope()),version:2,reason:null}];},v=>{v.visitRevision++;},v=>{v.resultVisibility='complete';},v=>{v.results=Array(1001).fill(eventFor(envelope()));},v=>{v.extra='no';}]){
  const value=snapshot();change(value);await assert.rejects(createVisitTaskClient(async()=>Response.json(value),actor,'staff').load(visit,2,3,new AbortController().signal),{code:'unavailable'});
 }
 const value=snapshot();value.results=[eventFor(envelope())];assert.deepEqual(await createVisitTaskClient(async()=>Response.json(value),actor,'staff').load(visit,2,3,new AbortController().signal),value);
 const large=createVisitTaskClient(async()=>new Response(JSON.stringify({text:'x'.repeat(500001)}),{headers:{'Content-Type':'application/json'}}),actor,'staff');
 await assert.rejects(large.load(visit,2,3,new AbortController().signal),{code:'unavailable'});
});
test('adapter preserves exact retry request and rejects forged receipt identity',async()=>{
 for(const mismatch of ['operationId','visitId','taskId','version','recordedAt']){
  const bodies=[];const client=createVisitTaskClient(async(_,options)=>{bodies.push(JSON.parse(options.body));const receipt=receiptFor(envelope());receipt[mismatch]=mismatch==='version'?99:'invalid';return Response.json(receipt);},actor,'staff');
  for(let i=0;i<2;i++)await assert.rejects(client.save(envelope(),new AbortController().signal),{code:'write_unconfirmed'});
  assert.deepEqual(bodies,[envelope(),envelope()]);
 }
});
test('adapter handles forbidden, stale read, unavailable and cancellation without accepting data',async()=>{
 for(const [status,code] of [[401,'unauthenticated'],[403,'forbidden'],[409,'scope_changed'],[412,'stale_visit'],[500,'unavailable']])await assert.rejects(createVisitTaskClient(async()=>Response.json({}, {status}),actor,'staff').load(visit,2,3,new AbortController().signal),{code});
 const abort=new AbortController();abort.abort();let calls=0;await assert.rejects(createVisitTaskClient(async()=>{calls++;return Response.json(snapshot());},actor,'staff').load(visit,2,3,abort.signal));assert.equal(calls,0);
});
function harness(client,overrides={}){
 let root;const failures=[];const base={enabled:true,actorId:actor,scopeKey:'fictional-session',visitId:visit,visitRevision:2,visitStatus:'In progress',membershipRevision:3,role:'staff',active:true,client,onScopeFailure:code=>failures.push(code),onStale:()=>failures.push('stale'),...overrides};
 const button=text=>root.root.findAllByType('button').find(b=>JSON.stringify(b.props.children).includes(text));
 return {get root(){return root;},base,failures,button,async mount(){await act(async()=>{root=create(React.createElement(SharedVisitTaskResults,base));});},async update(props){await act(async()=>root.update(React.createElement(SharedVisitTaskResults,{...base,...props})));},async click(text){await act(async()=>button(text).props.onClick());},async change(suffix,value){await act(async()=>root.root.findAll(n=>n.props.id?.endsWith('-'+suffix)&&['input','textarea','select'].includes(n.type))[0].props.onChange({target:{value}}));},async submit(){await act(async()=>root.root.findByType('form').props.onSubmit({preventDefault(){}}));},async stop(){await act(async()=>root.unmount());}};
}
async function withUI(run){globalThis.IS_REACT_ACT_ENVIRONMENT=true;const saved=globalThis.window;globalThis.window=new EventTarget();clearVisitTaskResultEntries();try{await run();}finally{clearVisitTaskResultEntries();globalThis.window=saved;}}
test('default off, inactive, terminal visits and manager views never expose staff mutations',()=>withUI(async()=>{
 let calls=0;const client={load:async()=>{calls++;return snapshot();},save:async()=>{throw Error('Unexpected write');}};
 for(const overrides of [{enabled:undefined},{active:false},{visitStatus:'Completed'},{visitStatus:'Cancelled'}]){const h=harness(client,overrides);await h.mount();assert.equal(calls,0);await h.stop();}
 const h=harness(client,{role:'manager'});await h.mount();assert.equal(h.button('Record my factual result'),undefined);await h.stop();
}));
test('lost receipt retries exact request once, confirms by scoped readback, then appends correction and timeline',()=>withUI(async()=>{
 let data=snapshot(),lost=true;const posts=[];const receipts=new Map();
 const client={load:async()=>structuredClone(data),save:async request=>{posts.push(structuredClone(request));if(!receipts.has(request.operationId)){data.results.push(eventFor(request));receipts.set(request.operationId,receiptFor(request));}if(lost){lost=false;throw Error('Fictional response lost');}return receipts.get(request.operationId);}};
 const h=harness(client);await h.mount();try{
  await h.click('Record my factual result');await h.change('outcome','done');await h.change('observation','Fictional task completed');await h.change('time','2026-11-16T10:00');await h.submit();
  assert.ok(h.button('Retry exact task result'));assert.equal(h.root.root.findByType('fieldset').props.disabled,true);
  await h.click('Retry exact task result');assert.deepEqual(posts[1],posts[0]);assert.equal(data.results.length,1);assert.match(JSON.stringify(h.root.toJSON()),/saved and read back/);
  await h.click('Correct my visible result');await h.change('observation','Clarified fictional observation');await h.change('reason','Correct observation wording');await h.submit();
  assert.equal(posts[2].expectedVersion,1);assert.notEqual(posts[2].operationId,posts[0].operationId);assert.equal(data.results.length,2);assert.match(JSON.stringify(h.root.toJSON()),/Earlier visible version/);assert.match(JSON.stringify(h.root.toJSON()),/not a complete visit history/);
 }finally{await h.stop();}
}));
test('mismatched readback never announces a save and retains exact retry identity',()=>withUI(async()=>{
 for(const mismatch of ['actorId','actualAt','recordedAt','observation']){
  let data=snapshot();const posts=[];const client={load:async()=>structuredClone(data),save:async request=>{posts.push(structuredClone(request));const event=eventFor(request);event[mismatch]=mismatch==='actorId'?operation:mismatch==='observation'?'Different fictional observation':event[mismatch].replace(/(?:123456|000)(?=Z)/,'123457');data.results=[event];return receiptFor(request);}};
  const h=harness(client);await h.mount();try{await h.click('Record my factual result');await h.change('outcome','done');await h.change('time','2026-11-16T10:00');await h.submit();assert.ok(h.button('Retry exact task result'));assert.doesNotMatch(JSON.stringify(h.root.toJSON()),/saved and read back/);await h.click('Retry exact task result');assert.deepEqual(posts[1],posts[0]);}finally{await h.stop();clearVisitTaskResultEntries();}
 }
}));
test('new revision pins retained request and suppresses stale or cross-account responses',()=>withUI(async()=>{
 let resolve,signal;const client={load:async(_,__,___,s)=>{signal=s;return new Promise(r=>resolve=r);},save:async()=>{throw Error('Unexpected');}};
 const h=harness(client);await h.mount();await h.update({visitRevision:3});assert.equal(signal.aborted,false); // this is the new load's signal
 await h.update({active:false});assert.equal(signal.aborted,true);await act(async()=>resolve(snapshot()));assert.equal(h.root.toJSON(),null);await h.stop();
 const posts=[];let data=snapshot();const h2=harness({load:async()=>structuredClone(data),save:async request=>{posts.push(request);throw Error('Unknown fictional result');}});await h2.mount();try{await h2.click('Record my factual result');await h2.change('outcome','done');await h2.change('time','2026-11-16T10:00');await h2.submit();data.visitRevision=3;await h2.update({visitRevision:3});assert.equal(h2.button('Retry exact task result').props.disabled,true);assert.equal(posts.length,1);await h2.update({actorId:operation,scopeKey:'fictional-session-other'});assert.equal(h2.button('Retry exact task result'),undefined);}finally{await h2.stop();}
}));

test('individual saved result details retain microsecond event and recording precision',()=>withUI(async()=>{
 const data=snapshot();data.results=[eventFor(envelope())];const h=harness({load:async()=>structuredClone(data),save:async()=>{throw Error('Unexpected write');}});await h.mount();try{
  const facts=h.root.root.findAllByProps({className:'visit-task-results__facts'});assert.equal(facts.length,1);const times=facts[0].findAllByType('time');assert.equal(times[0].children.join(''),'2026-11-16 10:00:00.123456 Vancouver');assert.equal(times[1].children.join(''),'2026-11-16 11:00:00.123456 Vancouver');
  assert.equal(times[0].props.dateTime,envelope().actualAt);assert.equal(times[1].props.dateTime,'2026-11-16T18:00:00.123456Z');
 }finally{await h.stop();}
}));
