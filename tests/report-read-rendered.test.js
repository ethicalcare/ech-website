import {fixtureVisitStart} from './calendar-fixture-time.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {createRequire} from 'node:module';
import {fileURLToPath,pathToFileURL} from 'node:url';
import React from 'react';
import {create,act} from 'react-test-renderer';
const require=createRequire(import.meta.url);
async function component(name,fixtureSource){
 const entry=fixtureSource ? {stdin:{contents:fixtureSource,resolveDir:fileURLToPath(new URL('../admin-src/app/shared/',import.meta.url))}}
  : {entryPoints:[fileURLToPath(new URL('../admin-src/app/shared/'+name+'.tsx',import.meta.url))]};
 const bundle=await build({...entry,bundle:true,write:false,platform:'node',format:'esm',jsx:'automatic',loader:{'.css':'empty'},plugins:[{name:'external-react',setup(b){b.onResolve({filter:/^react(?:\/.*)?$/},args=>({path:pathToFileURL(require.resolve(args.path)).href,external:true}));}}]});
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
test('manager reopening report history shows the newest saved correction, not the prior historical selection',async()=>{
 globalThis.IS_REACT_ACT_ENVIRONMENT=true;
 const saved={window:globalThis.window,document:globalThis.document};
 globalThis.window=Object.assign(new EventTarget(),{setInterval:()=>1,clearInterval(){}});
 globalThis.document=Object.assign(new EventTarget(),{visibilityState:'visible',hasFocus:()=>true});
 const calls=[];const fetcher=(url,options)=>new Promise(resolve=>calls.push({url,options,resolve}));
 const entry={id:visit,revision:3,clientId:reviewer,workerId:actor,service:'Home support',start:'2026-11-01T17:00:00.000Z',end:'2026-11-01T20:00:00.000Z',status:'Completed'};
 const current=fictionalReport();
 const next=fictionalReport();
 next.reportRevision=6;
 next.versions.push({...next.versions[1],revision:6,version:2,sourceRevision:3,
  recordedAt:'2026-11-04T20:00:00.000Z',summary:'Newest correction wording',reason:'Clarify factual notes'});
 let root;
 const button=label=>root.root.findAllByType('button').find(b=>b.props.children===label);
 const text=()=>JSON.stringify(root.toJSON());
 try{
  await act(async()=>{root=create(React.createElement(SharedVisitRead,{actor:reviewer,role:'manager',visit:entry,fetcher,onClose(){}}));});
  await act(async()=>calls[0].resolve(Response.json({visitId:visit,revision:3,fields:{},contactAuthority:'unknown',allergyStatus:'unknown'})));
  await act(async()=>button('View report history').props.onClick());
  await act(async()=>calls[1].resolve(Response.json(current)));
  await act(async()=>root.root.findAllByType('input')[0].props.onChange());
  assert.match(text(),/Original version reviewed/);
  await act(async()=>button('Reload report').props.onClick());
  await act(async()=>calls[2].resolve(Response.json(current)));
  assert.match(text(),/Original version reviewed/,'manual reload preserves deliberate historical selection while open');
  await act(async()=>button('Hide report history').props.onClick());
  assert.doesNotMatch(text(),/Original version reviewed/);
  await act(async()=>button('View report history').props.onClick());
  await act(async()=>calls[3].resolve(Response.json(next)));
  assert.match(text(),/Newest correction wording/);
  assert.match(text(),/No independent review recorded for this version/);
  assert.doesNotMatch(text(),/Original version reviewed|Exact correction reviewed/);
  assert.ok(calls.every(call=>call.options.method==='GET'));
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
   const from=fixtureVisitStart(calls[0].url);
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

test('manager and owner see exact elapsed time for the selected report separately from schedule and review; staff does not',async()=>{
 globalThis.IS_REACT_ACT_ENVIRONMENT=true;
 const saved={window:globalThis.window,document:globalThis.document};
 globalThis.window=Object.assign(new EventTarget(),{setInterval:()=>1,clearInterval(){}});
 globalThis.document=Object.assign(new EventTarget(),{visibilityState:'visible',hasFocus:()=>true});
 const entry={id:visit,revision:3,clientId:reviewer,workerId:actor,service:'Home support',
   start:'2026-11-01T17:00:00.000Z',end:'2026-11-01T20:00:00.000Z',status:'Completed'};
 const report=fictionalReport();
 report.versions[0].actualEnd='2026-11-02T17:00:00.000Z';
 report.versions[0].recordedAt='2026-11-02T17:01:00.000Z';
 report.versions[1].actualEnd='2026-11-02T16:59:59.999Z';
 try{for(const role of ['manager','owner','staff']){
  let root;
  const id=role==='staff'?actor:reviewer,calls=[];
  const fetcher=async(url,options)=>{
   assert.equal(options.method,'GET');
   assert.equal(options.headers['X-ECH-Schedule-Role'],role);
   calls.push(url);
   if(url.includes('?visit='))return Response.json({visitId:visit,revision:3,fields:{},contactAuthority:'unknown',allergyStatus:'unknown'});
   assert.match(url,/report=.*&revision=3/);
   return Response.json(report);
  };
  try{
   await act(async()=>{root=create(React.createElement(SharedVisitRead,{actor:id,role,visit:entry,fetcher,onClose(){}}));});
   await act(async()=>root.root.findAllByType('button').find(b=>b.props.children==='View report history').props.onClick());
   const rendered=()=>JSON.stringify(root.toJSON());
   assert.match(rendered(),/Scheduled time · Vancouver/);
   assert.match(rendered(),/Exact correction reviewed/);
   if(role==='staff')assert.doesNotMatch(rendered(),/Reported elapsed time|59\.999 sec/);
   else{
    assert.match(rendered(),/Reported elapsed time/);
    assert.match(rendered(),/23 h 59 min 59\.999 sec/);
    assert.match(rendered(),/Not approved or payable time/);
    await act(async()=>root.root.findAllByType('input')[0].props.onChange());
    assert.match(rendered(),/Original version reviewed/);
    assert.match(rendered(),/24 h/);
    assert.match(rendered(),/Not approved or payable time/);
    assert.match(rendered(),/Scheduled time · Vancouver/);
    assert.doesNotMatch(rendered(),/59\.999 sec/);
   }
   assert.equal(calls.length,2,'selecting report versions requires no new fetches or writes');
  }finally{if(root)await act(async()=>root.unmount());}
 }}finally{globalThis.window=saved.window;globalThis.document=saved.document;}
});

test('read-only office visit shows the current worker confirmation after reassignment and revision verification',async()=>{
 globalThis.IS_REACT_ACT_ENVIRONMENT=true;
 const nextWorker='10000000-0000-4000-8000-000000000003';
 const initial={id:visit,revision:3,clientId:reviewer,workerId:actor,service:'Home support',
  start:'2026-11-01T17:00:00.000Z',end:'2026-11-01T20:00:00.000Z',status:'Confirmed'};
 const staff=[{id:actor,name:'Fictional previous worker'},{id:nextWorker,name:'Fictional replacement'}];
 for(const role of ['manager','owner','staff']){
  let root;
  const reads=[];
  const fetcher=(url,options)=>new Promise(resolve=>{
   assert.equal(options.method,'GET');assert.equal(options.headers['X-ECH-Schedule-Role'],role);
   const query=new URL(url,'https://fixture.invalid').searchParams;
   assert.equal(query.get('visit'),visit);
   reads.push({revision:Number(query.get('revision')),signal:options.signal,resolve});
  });
  const element=visit=>React.createElement(SharedVisitRead,{actor:role==='staff'?nextWorker:reviewer,
   role,visit,staff,fetcher,onClose(){}});
  const detail=revision=>Response.json({visitId:visit,revision,fields:{},contactAuthority:'unknown',allergyStatus:'unknown'});
  const assignment=()=>root.root.findAllByProps({'aria-label':'Selected visit assignment'})[0];
  const rendered=()=>JSON.stringify(root.toJSON());
  try{
   await act(async()=>{root=create(element(initial));});
   await act(async()=>reads[0].resolve(detail(3)));
   if(role!=='staff')assert.match(rendered(),/Confirmed by the assigned worker/);
   await act(async()=>root.update(element({...initial,workerId:nextWorker,revision:4,status:'Assigned'})));
   assert.equal(assignment(),undefined,'previous unverified state never remains visible');
   assert.equal(reads[0].signal.aborted,true);
   await act(async()=>reads[1].resolve(detail(4)));
   assert.match(rendered(),/Fictional replacement/);
   assert.doesNotMatch(rendered(),/Confirmed by the assigned worker|Fictional previous worker/);
   if(role!=='staff')assert.match(rendered(),/Waiting for the assigned worker/);
   else assert.doesNotMatch(rendered(),/Worker confirmation|Waiting for the assigned worker/);
   assert.equal(root.root.findAllByType('form').length,0);
   assert.deepEqual(reads.map(r=>r.revision),[3,4]);
  }finally{if(root)await act(async()=>root.unmount());}
 }
});

test('selected visit keeps scheduled, reported and recorded time separate from exact work-hours decisions',async()=>{
 globalThis.IS_REACT_ACT_ENVIRONMENT=true;
 const globals={window:globalThis.window,document:globalThis.document};
 const eventWindow=()=>Object.assign(new EventTarget(),{setInterval:()=>1,clearInterval(){}});
 globalThis.window=eventWindow();
 globalThis.document=Object.assign(new EventTarget(),{visibilityState:'visible',hasFocus:()=>true,documentElement:{dataset:{}}});
 let report=fictionalReport(),root;const reads=[],writes=[],attendanceReads=[];
 let viewer='manager';
 const entry={id:visit,revision:3,clientId:reviewer,workerId:actor,service:'Home support',start:'2026-11-01T17:00:00.000Z',end:'2026-11-01T20:00:00.000Z',status:'Completed'};
 const fetcher=async(path,opts)=>{
  const q=new URL(path,'https://fixture.invalid').searchParams;
  if(q.has('attendance')){
   assert.equal(opts.method,'GET');
   assert.equal(q.get('attendance'),visit);
   assert.equal(q.get('revision'),'3');
   attendanceReads.push(viewer);
   return Response.json({visitId:visit,revision:3,observedAt:'2026-11-01T20:10:00.000Z',
     checkInAt:'2026-11-01T17:11:00.000Z',checkOutAt:null});
  }
  if(q.has('workHours')){
   assert.equal(opts.headers['X-ECH-Schedule-Role'],viewer);
   assert.equal(opts.headers['X-ECH-Schedule-Actor'],viewer==='manager'?reviewer:actor);
   const current={schema:1,visitId:visit,visitRevision:entry.revision,reportRevision:report.reportRevision,contentRevision:report.versions.at(-1).revision,membershipRevision:8};
   if(opts.method==='GET'){
    reads.push(Object.fromEntries(q));assert.equal(Number(q.get('reportRevision')),current.reportRevision);
    return Response.json({...current,enabled:true,canDecide:viewer==='manager',
      receipt:viewer==='manager'?null:{decision:'return'}});
   }
   assert.equal(viewer,'manager');
   const command=JSON.parse(opts.body);writes.push(command);
   if(command.contentRevision!==current.contentRevision)return Response.json({}, {status:409});
   const {reason,...body}=command;return Response.json({...body,recordedAt:'2026-11-05T20:00:00.000Z'});
  }
  if(q.has('visit'))return Response.json({visitId:visit,revision:3,fields:{},contactAuthority:'unknown',allergyStatus:'unknown'});
  if(q.has('report'))return Response.json(report);
  throw Error('Unexpected fixture request '+path);
 };
 const element=()=>React.createElement(SharedVisitRead,{actor:viewer==='manager'?reviewer:actor,role:viewer,visit:entry,attendanceEnabled:true,fetcher,onClose(){}});
 const button=label=>root.root.findAllByType('button').find(b=>b.props.children===label);
 const copy=()=>JSON.stringify(root.toJSON());
 try{
  await act(async()=>{root=create(element());});
  await act(async()=>button('View report history').props.onClick());
  assert.match(copy(),/Exact correction reviewed/);
  assert.doesNotMatch(copy(),/Worked hours decision/);assert.deepEqual(reads,[]);assert.deepEqual(writes,[]);
  await act(async()=>root.unmount());root=null;
  document.documentElement.dataset.echWorkHoursPreview='true';
  await act(async()=>{root=create(element());});
  await act(async()=>button('View report history').props.onClick());
  assert.equal(reads.at(-1).reportRevision,'5');assert.equal(button('Return hours').props.disabled,true);
  const assignment=root.root.findByProps({'aria-label':'Selected visit assignment'});
  assert.deepEqual(assignment.findAllByType('time').map(time=>time.props.dateTime),[entry.start,entry.end]);
  const attendance=root.root.findByProps({'aria-label':'Visit attendance'});
  const clocks=attendance.findAllByType('dt').map((term,i)=>[term.props.children,attendance.findAllByType('dd')[i].props.children]);
  assert.match(clocks[0][1],/10:11:00\.000 Vancouver/);
  assert.deepEqual(clocks[1],['Recorded check-out · Vancouver','Not recorded']);
  assert.match(copy(),/Reported elapsed time/);
  assert.match(copy(),/2 h 59 min.*Not approved or payable time/);
  assert.match(copy(),/Worked hours decision.*Pending/);
  await act(async()=>root.root.findAllByType('input')[0].props.onChange());
  assert.doesNotMatch(copy(),/Worked hours decision/);
  await act(async()=>button('View latest report').props.onClick());
  await act(async()=>root.root.findByType('textarea').props.onChange({currentTarget:{value:'Fictional verify time'}}));
  report={...report,reportRevision:6,versions:[...report.versions,{...report.versions[1],revision:6,version:2,sourceRevision:3,
    recordedAt:'2026-11-04T20:00:00.000Z',summary:'Newest fictional correction',reason:'Clarify work'}]};
  await act(async()=>button('Return hours').props.onClick());
  assert.equal(writes[0].contentRevision,3);assert.equal(writes[0].reportRevision,5);
  assert.match(copy(),/Reload hours status to verify/);assert.doesNotMatch(copy(),/Hours return recorded|Retry same decision/);
  await act(async()=>button('Reload report').props.onClick());
  assert.doesNotMatch(copy(),/Worked hours decision/);
  await act(async()=>button('View latest report').props.onClick());
  assert.match(copy(),/Newest fictional correction/);assert.match(copy(),/No independent review recorded for this version/);
  assert.equal(root.root.findByType('textarea').props.value,'');
  assert.equal(button('Return hours').props.disabled,true);
  await act(async()=>root.root.findByType('textarea').props.onChange({currentTarget:{value:'New fictional reason'}}));
  await act(async()=>button('Return hours').props.onClick());
  assert.equal(writes[1].contentRevision,6);assert.equal(writes[1].reportRevision,6);
  assert.equal(writes[1].reason,'New fictional reason');
  assert.match(copy(),/Hours return recorded/);
  assert.match(copy(),/No independent review recorded for this version/);
  await act(async()=>root.unmount());root=null;
  viewer='staff';
  await act(async()=>{root=create(element());});
  await act(async()=>button('View report history').props.onClick());
  assert.match(copy(),/Worked hours decision.*Returned/);
  assert.equal(button('Approve hours'),undefined);
  assert.equal(button('Return hours'),undefined);
  assert.equal(root.root.findAllByType('textarea').length,0);
  assert.equal(writes.length,2);
  assert.deepEqual([...new Set(attendanceReads)],['manager','staff']);
 }finally{if(root)await act(async()=>root.unmount());globalThis.window=globals.window;globalThis.document=globals.document;}
});

const workHoursFixture=()=>component('SharedVisitWorkHours',`
 export {SharedVisitWorkHours} from './SharedVisitWorkHours';
 export {createWorkHoursClient} from './work-hours-client';
`);

test('work-hours preview refresh cannot replace an unconfirmed return on the same binding',async()=>{
 globalThis.IS_REACT_ACT_ENVIRONMENT=true;
 const {SharedVisitWorkHours,createWorkHoursClient}=await workHoursFixture();
 const binding={visitId:visit,visitRevision:3,reportRevision:5,contentRevision:3};
 const state={schema:1,...binding,enabled:true,canDecide:true,membershipRevision:8,receipt:null};
 const writes=[];let reads=0,root;let readResponse=state;
 const client=createWorkHoursClient(async(_path,opts)=>{
  if(opts.method==='GET'){reads++;return Response.json(readResponse);}
  writes.push(JSON.parse(opts.body));return Response.json({}, {status:503});
 },reviewer,'manager');
 const button=label=>root.root.findAllByType('button').find(b=>b.props.children===label);
 try{
  await act(async()=>{root=create(React.createElement(SharedVisitWorkHours,{binding,client}));});
  await act(async()=>root.root.findByType('textarea').props.onChange({currentTarget:{value:'Fictional return note'}}));
  await act(async()=>button('Return hours').props.onClick());
  assert.equal(writes.length,1);assert.ok(button('Retry same decision'));
  await act(async()=>button('Reload hours status').props.onClick());
  assert.equal(reads,2);assert.equal(writes.length,1);
  assert.ok(button('Retry same decision'),'successful null read must not displace the unresolved exact return');
  assert.equal(button('Approve hours'),undefined,'no replacement approval may be composed');
  await act(async()=>button('Retry same decision').props.onClick());
  assert.deepEqual(writes[1],writes[0]);
  readResponse={...state,canDecide:false,receipt:{decision:'return',recordedAt:'2026-11-05T20:00:00.000Z'}};
  await act(async()=>button('Reload hours status').props.onClick());
  const text=JSON.stringify(root.toJSON());
  assert.match(text,/Returned/);
  assert.match(text,/decision is already recorded for this report version/);
  assert.doesNotMatch(text,/Hours return recorded/,'status-only read must not claim the exact operation was confirmed');
  assert.equal(button('Retry same decision'),undefined);assert.equal(button('Approve hours'),undefined);
  assert.equal(writes.length,2);
 }finally{if(root)await act(async()=>root.unmount());}
});

test('work-hours preview fences unresolved intent when authority changes before a status reload',async()=>{
 globalThis.IS_REACT_ACT_ENVIRONMENT=true;
 const {SharedVisitWorkHours,createWorkHoursClient}=await workHoursFixture();
 const binding={visitId:visit,visitRevision:3,reportRevision:5,contentRevision:3};
 const state={schema:1,...binding,enabled:true,canDecide:true,membershipRevision:8,receipt:null};
 for(const circumstance of ['membership changed','forbidden']){
  let root,readMode='original';const writes=[];
  const client=createWorkHoursClient(async(_path,opts)=>{
   if(opts.method==='GET'){
    if(readMode==='forbidden')return Response.json({}, {status:403});
    return Response.json({...state,membershipRevision:readMode==='membership changed'?9:8});
   }
   writes.push(JSON.parse(opts.body));return Response.json({}, {status:503});
  },reviewer,'manager');
  const button=label=>root.root.findAllByType('button').find(b=>b.props.children===label);
  try{
   await act(async()=>{root=create(React.createElement(SharedVisitWorkHours,{binding,client}));});
   await act(async()=>button('Approve hours').props.onClick());
   assert.ok(button('Retry same decision'));
   readMode=circumstance;
   await act(async()=>button('Reload hours status').props.onClick());
   assert.match(JSON.stringify(root.toJSON()),/Hours access changed/);
   assert.equal(button('Approve hours'),undefined);assert.equal(button('Return hours'),undefined);assert.equal(button('Retry same decision'),undefined);
   if(circumstance==='forbidden'){
    readMode='original';
    await act(async()=>button('Reload hours status').props.onClick());
    assert.equal(button('Approve hours'),undefined);assert.equal(button('Retry same decision'),undefined);
   }
   assert.equal(writes.length,1);
  }finally{if(root)await act(async()=>root.unmount());}
 }
});

test('work-hours requires current authority before retrying an explicit conflict or stale response',async()=>{
 globalThis.IS_REACT_ACT_ENVIRONMENT=true;
 const {SharedVisitWorkHours,createWorkHoursClient}=await workHoursFixture();
 const binding={visitId:visit,visitRevision:3,reportRevision:5,contentRevision:3};
 const state={schema:1,...binding,enabled:true,canDecide:true,membershipRevision:8,receipt:null};
 for(const {status,changed} of [{status:409},{status:412},{status:409,changed:{membershipRevision:9}},
  {status:409,changed:{canDecide:false}},{status:409,changed:{denied:403}},{status:412,changed:{denied:412}}]){
  const writes=[];let root,readStatus=200,readState=state;
  const client=createWorkHoursClient(async(_path,opts)=>{
   if(opts.method==='GET')return Response.json(readState,{status:readStatus});
   writes.push(JSON.parse(opts.body));return Response.json({}, {status});
  },reviewer,'manager');
  const button=label=>root.root.findAllByType('button').find(b=>b.props.children===label);
  const noDecision=()=>{
   assert.ok(!button('Retry same decision'),'an explicit stale/conflict response must not permit retry before a verified read');
   assert.equal(button('Approve hours'),undefined);assert.equal(button('Return hours'),undefined);
   assert.equal(writes.length,1);
  };
  try{
   await act(async()=>{root=create(React.createElement(SharedVisitWorkHours,{binding,client}));});
   await act(async()=>button('Approve hours').props.onClick());
   noDecision();
   readStatus=503;
   await act(async()=>button('Reload hours status').props.onClick());
   noDecision();
   readStatus=changed?.denied??200;readState={...state,...changed};
   await act(async()=>button('Reload hours status').props.onClick());
   if(changed){
    noDecision();
    assert.match(JSON.stringify(root.toJSON()),/Reopen the report/);
   }else{
    assert.equal(button('Approve hours'),undefined);assert.equal(button('Return hours'),undefined);
    await act(async()=>button('Retry same decision').props.onClick());
    assert.deepEqual(writes[1],writes[0]);
    assert.equal(button('Retry same decision'),undefined,'another conflict requires another read');
   }
  }finally{if(root)await act(async()=>root.unmount());}
 }
});

test('an invalid pasted hours note remains editable and cannot create a retry operation',async()=>{
 globalThis.IS_REACT_ACT_ENVIRONMENT=true;
 const {SharedVisitWorkHours,createWorkHoursClient}=await workHoursFixture();
 const binding={visitId:visit,visitRevision:3,reportRevision:5,contentRevision:3};
 const state={schema:1,...binding,enabled:true,canDecide:true,membershipRevision:8,receipt:null};
 const writes=[];let root;
 const client=createWorkHoursClient(async(_path,opts)=>{
  if(opts.method==='GET')return Response.json(state);
  const command=JSON.parse(opts.body);writes.push(command);
  if(command.reason.includes('\x01'))return Response.json({}, {status:400});
  const {reason,...receipt}=command;
  return Response.json({...receipt,recordedAt:'2026-11-05T20:00:00.000Z'});
 },reviewer,'manager');
 const button=label=>root.root.findAllByType('button').find(b=>b.props.children===label);
 const note=()=>root.root.findByType('textarea');
 try{
  await act(async()=>{root=create(React.createElement(SharedVisitWorkHours,{binding,client}));});
  await act(async()=>note().props.onChange({currentTarget:{value:'Copied\x01 fictional reason'}}));
  await act(async()=>button('Return hours').props.onClick());
  assert.deepEqual(writes,[]);
  assert.equal(note().props.readOnly,false);
  assert.equal(button('Retry same decision'),undefined);
  assert.match(JSON.stringify(root.toJSON()),/Edit the note to remove unsupported characters/);
  await act(async()=>note().props.onChange({currentTarget:{value:'Fictional reason\nSecond line'}}));
  await act(async()=>button('Return hours').props.onClick());
  assert.equal(writes.length,1);
  assert.equal(writes[0].reason,'Fictional reason\nSecond line');
  assert.equal(writes[0].contentRevision,3);
  assert.match(JSON.stringify(root.toJSON()),/Hours return recorded/);
 }finally{if(root)await act(async()=>root.unmount());}
});
