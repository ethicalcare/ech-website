import test from 'node:test';import assert from 'node:assert/strict';import React from 'react';import {create,act} from 'react-test-renderer';import {build} from 'esbuild';import {createRequire} from 'node:module';import {fileURLToPath,pathToFileURL} from 'node:url';
import {fictionalReport} from './visit-report.test.js';import {joinedCareLog} from '../admin-src/app/shared/daily-care-log.ts';import {readOperations} from '../lib/admin/operations-read-dispatch.js';
const require=createRequire(import.meta.url);const report=fictionalReport();report.versions[0].noteEventAt='2026-11-01T18:00:00.000Z';
const task={taskId:'30000000-0000-4000-8000-000000000001',taskLabel:'Fictional walk',version:1,outcome:'done',observation:'Original factual note',actualAt:'2026-11-01T17:30:00.000001Z',recordedAt:'2026-11-01T18:01:00.000Z',actorId:report.versions[0].actorId,reason:null};
const history={visitId:report.visitId,visitRevision:3,reportRevision:5,resultVisibility:'limited',results:[task,{...task,version:2,observation:'Corrected factual note',actualAt:'2026-11-01T17:30:00.000002Z',reason:'Clarified timing'}]};
test('joined chronology preserves microseconds, original corrections, day and unknown note times without mutating inputs',()=>{
 const before=JSON.stringify({report,history});const log=joinedCareLog(report,history);assert.deepEqual(log.known.map(e=>e.key),[`task:${task.taskId}:1`,`task:${task.taskId}:2`,'note:1']);assert.equal(log.unknown[0].key,'note:3');assert.equal(log.unknown[0].eventAt,null);assert.equal(log.known[0].recordedAt,task.recordedAt);assert.equal(log.known[1].reason,'Clarified timing');assert.equal(JSON.stringify({report,history}),before);
 for(const change of [{visitId:task.taskId},{visitRevision:4},{reportRevision:6}])assert.throws(()=>joinedCareLog(report,{...history,...change}));
});
test('completed history discovery is default off, negotiated v2 and cannot be injected by report provider',async()=>{
 const actor=task.actorId,current={principal:{id:actor,operationalRole:'staff'},member:{active:true,operational_role:'staff',revision:7},config:{base:'https://fixture.invalid',key:'fixture'},token:'fixture'};
 const request=feature=>new Request(`https://fixture.invalid/api/admin/operations?report=${report.visitId}&revision=3`,{headers:{'X-ECH-Schedule-Actor':actor,'X-ECH-Schedule-Role':'staff','X-ECH-Report-Features':feature}});
 for(const flag of [undefined,false,true,'TRUE','true']){const value=await readOperations(current,request('2'),async()=>Response.json(report),{ECH_HOSTED_OPERATIONS_READS:'true',ECH_HOSTED_COMPLETED_TASK_HISTORY:flag});assert.equal(value.completedTaskHistoryEnabled,flag==='true');}
 assert.equal(Object.hasOwn(await readOperations(current,request('1'),async()=>Response.json(report),{ECH_HOSTED_COMPLETED_TASK_HISTORY:'true'}),'completedTaskHistoryEnabled'),false);
 await assert.rejects(readOperations(current,request('2'),async()=>Response.json({...report,completedTaskHistoryEnabled:true}),{}));
});
async function component(name){const bundle=await build({entryPoints:[fileURLToPath(new URL('../admin-src/app/shared/'+name+'.tsx',import.meta.url))],bundle:true,write:false,platform:'node',format:'esm',jsx:'automatic',loader:{'.css':'empty'},plugins:[{name:'react',setup(b){b.onResolve({filter:/^react(?:\/.*)?$/},args=>({path:pathToFileURL(require.resolve(args.path)).href,external:true}));}}]});return import('data:text/javascript;base64,'+Buffer.from(bundle.outputFiles[0].text).toString('base64'));}
const {SharedDailyCareLog}=await component('SharedDailyCareLog');const {SharedVisitReport}=await component('SharedVisitReport');
test('mounted joined log clears on blur, rejects late response and mismatched report pins',async()=>{
 globalThis.IS_REACT_ACT_ENVIRONMENT=true;const old={window:globalThis.window,document:globalThis.document};let focused=true;globalThis.window=Object.assign(new EventTarget(),{setInterval:()=>1,clearInterval(){}});globalThis.document=Object.assign(new EventTarget(),{visibilityState:'visible',hasFocus:()=>focused});let root;const reads=[];let failures=0;const load=(id,rev,stream,signal)=>new Promise(resolve=>reads.push({id,rev,stream,signal,resolve}));
 try{
  await act(async()=>{root=create(React.createElement(SharedDailyCareLog,{report,load,onFailure:()=>failures++}));});assert.deepEqual([reads[0].id,reads[0].rev,reads[0].stream],[report.visitId,3,5]);await act(async()=>reads[0].resolve(history));assert.match(JSON.stringify(root.toJSON()),/Fictional walk/);assert.match(JSON.stringify(root.toJSON()),/Unknown event time/);assert.match(JSON.stringify(root.toJSON()),/not a complete/);assert.match(JSON.stringify(root.toJSON()),/Latest visible version/);assert.match(JSON.stringify(root.toJSON()),/Earlier visible version/);
  focused=false;await act(async()=>window.dispatchEvent(new Event('blur')));assert.doesNotMatch(JSON.stringify(root.toJSON()),/Fictional walk|Original factual note/);
  focused=true;await act(async()=>window.dispatchEvent(new Event('focus')));focused=false;document.visibilityState='hidden';await act(async()=>document.dispatchEvent(new Event('visibilitychange')));await act(async()=>reads[1].resolve(history));assert(reads[1].signal.aborted);assert.doesNotMatch(JSON.stringify(root.toJSON()),/Fictional walk/);
  focused=true;document.visibilityState='visible';await act(async()=>document.dispatchEvent(new Event('visibilitychange')));await act(async()=>reads[2].resolve({...history,reportRevision:6}));assert.equal(failures,1);assert.doesNotMatch(JSON.stringify(root.toJSON()),/Fictional walk/);
 }finally{if(root)await act(async()=>root.unmount());globalThis.window=old.window;globalThis.document=old.document;}
});
test('actual report mount fetches joined history only with explicit capability and available loader',async()=>{
 globalThis.IS_REACT_ACT_ENVIRONMENT=true;const old={window:globalThis.window,document:globalThis.document};globalThis.window=Object.assign(new EventTarget(),{setInterval:()=>1,clearInterval(){}});globalThis.document=Object.assign(new EventTarget(),{visibilityState:'visible',hasFocus:()=>true});let root;
 try{for(const enabled of [undefined,false,true]){let calls=0;await act(async()=>{root=create(React.createElement(SharedVisitReport,{visitId:report.visitId,visitRevision:3,load:async()=>({...report,...(enabled===undefined?{}:{completedTaskHistoryEnabled:enabled})}),loadCompletedHistory:async()=>{calls++;return history;},onVerificationFailure:()=>assert.fail('Unexpected failure'),selectedVersion:0,onSelectedVersionChange(){}}));});assert.equal(calls,enabled===true?1:0);assert.equal(JSON.stringify(root.toJSON()).includes('Fictional walk'),enabled===true);await act(async()=>root.unmount());}}
 finally{globalThis.window=old.window;globalThis.document=old.document;}
});

test('care log identifies latest visible versions per task and report without dropping history',()=>{
 const other={...task,taskId:'30000000-0000-4000-8000-000000000002',version:3};
 const log=joinedCareLog(report,{...history,results:[history.results[1],other,task]});
 const entries=[...log.known,...log.unknown];
 assert.equal(entries.find(e=>e.key===`task:${task.taskId}:1`).latestVisible,false);
 assert.equal(entries.find(e=>e.key===`task:${task.taskId}:2`).latestVisible,true);
 assert.equal(entries.find(e=>e.key===`task:${other.taskId}:3`).latestVisible,true,'latest is only among returned versions');
 assert.equal(entries.find(e=>e.key==='note:1').latestVisible,false);
 assert.equal(entries.find(e=>e.key==='note:3').latestVisible,true);
 assert.equal(entries.length,5);
});

test('care-log cached rows clear when the authorization-scoped loader changes and old reads cannot restore them',async()=>{
 globalThis.IS_REACT_ACT_ENVIRONMENT=true;
 const old={window:globalThis.window,document:globalThis.document};
 globalThis.window=Object.assign(new EventTarget(),{setInterval:()=>1,clearInterval(){}});
 globalThis.document=Object.assign(new EventTarget(),{visibilityState:'visible',hasFocus:()=>true});
 let root,failures=0;const reads=[];
 const loader=scope=>(id,revision,reportRevision,signal)=>new Promise((resolve,reject)=>reads.push({scope,signal,resolve,reject}));
 const first=loader('old'),second=loader('new'),third=loader('denied');
 const props={report,load:first,onFailure:()=>failures++};
 const text=()=>JSON.stringify(root.toJSON());
 try{
  await act(async()=>{root=create(React.createElement(SharedDailyCareLog,props));});
  await act(async()=>reads[0].resolve(history));assert.match(text(),/Fictional walk/);
  await act(async()=>{root.update(React.createElement(SharedDailyCareLog,{...props,load:second}));});
  assert.doesNotMatch(text(),/Fictional walk|Original factual note/);
  await act(async()=>reads[1].resolve(history));assert.match(text(),/Fictional walk/);
  await act(async()=>window.dispatchEvent(new Event('focus')));
  const oldRead=reads[2];assert.equal(oldRead.scope,'new');
  await act(async()=>{root.update(React.createElement(SharedDailyCareLog,{...props,load:third}));});
  assert.equal(oldRead.signal.aborted,true);assert.equal(reads[3].scope,'denied');
  assert.doesNotMatch(text(),/Fictional walk|Original factual note/);
  await act(async()=>oldRead.resolve(history));
  assert.doesNotMatch(text(),/Fictional walk|Original factual note/);
  await act(async()=>reads[3].reject(Error('Fictional denied assignment')));
  assert.equal(failures,1);assert.match(text(),/Care log access could not be verified/);
  assert.doesNotMatch(text(),/Fictional walk|Original factual note/);
 }finally{if(root)await act(async()=>root.unmount());globalThis.window=old.window;globalThis.document=old.document;}
});

const {SharedVisitRead}=await component('SharedVisitRead');
test('selected-visit identity binds actual history clients and rejects late previous-identity history',async()=>{
 globalThis.IS_REACT_ACT_ENVIRONMENT=true;
 const old={window:globalThis.window,document:globalThis.document};
 globalThis.window=Object.assign(new EventTarget(),{setInterval:()=>1,clearInterval(){}});
 globalThis.document=Object.assign(new EventTarget(),{visibilityState:'visible',hasFocus:()=>true});
 const historyReads=[];let root;
 const fetcher=async(url,options)=>{
  const params=new URL(url,'https://fictional.invalid').searchParams;
  if(params.has('completedTaskHistory'))return new Promise(resolve=>historyReads.push({options,resolve}));
  if(params.has('report'))return Response.json({...report,completedTaskHistoryEnabled:true});
  if(params.has('visit'))return Response.json({visitId:report.visitId,revision:report.visitRevision,fields:{address:'Fictional protected address'},contactAuthority:'unknown',allergyStatus:'unknown'});
  throw Error('Unexpected fictional route');
 };
 const visit={id:report.visitId,clientId:'40000000-0000-4000-8000-000000000001',workerId:task.actorId,service:'Home support',start:'2026-11-01T17:00:00.000Z',end:'2026-11-01T19:00:00.000Z',status:'Completed',revision:report.visitRevision};
 const props={visit,actor:task.actorId,role:'manager',fetcher,onClose(){}};
 const text=()=>JSON.stringify(root.toJSON());
 const historyButton=()=>root.root.findAllByType('button').find(b=>b.props.children==='View report history');
 try{
  await act(async()=>{root=create(React.createElement(SharedVisitRead,props));});
  await act(async()=>historyButton().props.onClick());assert.equal(historyReads.length,1);
  assert.equal(historyReads[0].options.headers['X-ECH-Schedule-Actor'],props.actor);
  assert.equal(historyReads[0].options.headers['X-ECH-Schedule-Role'],'manager');
  const nextActor='50000000-0000-4000-8000-000000000001';
  await act(async()=>root.update(React.createElement(SharedVisitRead,{...props,actor:nextActor,role:'owner'})));
  assert.equal(historyReads[0].options.signal.aborted,true);
  assert.equal(historyReads.length,2);
  assert.equal(historyReads[1].options.headers['X-ECH-Schedule-Actor'],nextActor);
  assert.equal(historyReads[1].options.headers['X-ECH-Schedule-Role'],'owner');
  await act(async()=>historyReads[0].resolve(Response.json({...history,resultVisibility:'complete'})));
  assert.doesNotMatch(text(),/Fictional walk|Original factual note/);
  await act(async()=>historyReads[1].resolve(new Response(null,{status:403})));
  assert.doesNotMatch(text(),/Fictional walk|Original factual note/);assert.match(text(),/Visit access could not be verified/);
 }finally{if(root)await act(async()=>root.unmount());globalThis.window=old.window;globalThis.document=old.document;}
});


test('inactive selected visit conceals details, aborts old reads and freshly verifies on return',async()=>{
 globalThis.IS_REACT_ACT_ENVIRONMENT=true;
 const old={window:globalThis.window,document:globalThis.document};
 globalThis.window=Object.assign(new EventTarget(),{setInterval:()=>1,clearInterval(){}});
 globalThis.document=Object.assign(new EventTarget(),{visibilityState:'visible',hasFocus:()=>true});
 const reads=[];let root;
 const fetcher=(url,options)=>new Promise(resolve=>reads.push({options,resolve}));
 const visit={id:report.visitId,clientId:'40000000-0000-4000-8000-000000000001',workerId:task.actorId,service:'Home support',start:'2026-11-01T17:00:00.000Z',end:'2026-11-01T19:00:00.000Z',status:'Completed',revision:report.visitRevision};
 const props={visit,actor:task.actorId,role:'manager',fetcher,onClose(){}};
 const detail={visitId:visit.id,revision:visit.revision,fields:{address:'Fictional protected address'},contactAuthority:'unknown',allergyStatus:'unknown'};
 const text=()=>JSON.stringify(root.toJSON());
 try{
  await act(async()=>{root=create(React.createElement(SharedVisitRead,{...props,active:false}));});assert.equal(reads.length,0);
  await act(async()=>root.update(React.createElement(SharedVisitRead,props)));assert.equal(reads.length,1);
  await act(async()=>reads[0].resolve(Response.json(detail)));assert.match(text(),/Fictional protected address/);
  await act(async()=>root.update(React.createElement(SharedVisitRead,{...props,active:false})));
  assert.doesNotMatch(text(),/Fictional protected address/);assert.equal(reads[0].options.signal.aborted,true);
  await act(async()=>root.update(React.createElement(SharedVisitRead,props)));assert.equal(reads.length,2);
  assert.doesNotMatch(text(),/Fictional protected address/);
  await act(async()=>root.update(React.createElement(SharedVisitRead,{...props,active:false})));
  await act(async()=>reads[1].resolve(Response.json(detail)));assert.doesNotMatch(text(),/Fictional protected address/);
  await act(async()=>root.update(React.createElement(SharedVisitRead,props)));assert.equal(reads.length,3);
  await act(async()=>reads[2].resolve(Response.json({error:'Denied'},{status:403})));
  assert.doesNotMatch(text(),/Fictional protected address/);assert.match(text(),/Visit details could not be verified/);
 }finally{if(root)await act(async()=>root.unmount());globalThis.window=old.window;globalThis.document=old.document;}
});

test('selected-visit deactivation retains a dirty scheduling draft without sending it',async()=>{
 globalThis.IS_REACT_ACT_ENVIRONMENT=true;
 let root,leave;const reads=[];
 const visit={id:report.visitId,clientId:'40000000-0000-4000-8000-000000000001',workerId:task.actorId,service:'Home support',start:'2026-11-01T17:00:00.000Z',end:'2026-11-01T19:00:00.000Z',status:'Assigned',revision:report.visitRevision};
 const fetcher=async(url,options)=>{
  assert.equal(options.method,'GET','unsent drafts must not mutate the server');reads.push(url);
  if(url.includes('scheduling=1'))return Response.json({schema:1,enabled:true,membershipRevision:7});
  assert(url.includes('?visit='));return Response.json({visitId:visit.id,revision:visit.revision,fields:{address:'Fictional protected address'},contactAuthority:'unknown',allergyStatus:'unknown'});
 };
 const props={visit,actor:task.actorId,role:'manager',fetcher,schedulingEnabled:true,onClose(){},onLeaveStateChange:value=>{leave=value;}};
 const text=()=>JSON.stringify(root.toJSON());
 try{
  await act(async()=>{root=create(React.createElement(SharedVisitRead,props));});
  await act(async()=>{root.root.findAllByType('input')[0].props.onChange({target:{value:'2026-11-01T10:15:00.000'}});root.root.findByType('textarea').props.onChange({target:{value:'Fictional travel adjustment'}});root.root.findByType('form').props.onChange();});
  assert.equal(leave.dirty,true);const priorReads=reads.length;
  await act(async()=>root.update(React.createElement(SharedVisitRead,{...props,active:false})));
  assert.equal(leave.dirty,true);assert.equal(reads.length,priorReads);
  assert.match(text(),/schedule draft is retained/);assert.doesNotMatch(text(),/Fictional protected address|Fictional travel adjustment/);
  assert.equal(root.root.findAllByType('textarea').length,0);
  await act(async()=>root.update(React.createElement(SharedVisitRead,props)));
  assert.equal(leave.dirty,true);assert.equal(reads.length,priorReads+2,'detail and command access are freshly checked');
  assert.equal(root.root.findAllByType('input')[0].props.value,'2026-11-01T10:15:00.000');
  assert.equal(root.root.findByType('textarea').props.value,'Fictional travel adjustment');
 }finally{if(root)await act(async()=>root.unmount());}
});
