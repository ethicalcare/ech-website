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
