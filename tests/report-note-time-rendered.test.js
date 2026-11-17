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

const {SharedVisitReport}=await component('SharedVisitReport');
import {companyTime} from '../admin-src/app/shared/time.ts';
import {createVisitReportClient} from '../admin-src/app/shared/visit-report-client.ts';
test('saved report history shows each version’s explicit note event time, separately from recorded time',async()=>{
 globalThis.IS_REACT_ACT_ENVIRONMENT=true;
 const old={window:globalThis.window,document:globalThis.document};
 globalThis.window=Object.assign(new EventTarget(),{setInterval:()=>1,clearInterval(){}});
 globalThis.document=Object.assign(new EventTarget(),{visibilityState:'visible',hasFocus:()=>true});
 const report=fictionalReport();report.versions[0].noteEventAt='2026-11-01T18:14:00.000Z';report.versions[1].noteEventAt='2026-11-01T19:23:00.000Z';
 let root;
 const fetcher=async(url,options)=>{assert.equal(options.method,'GET');return Response.json(report);};
 function Harness(){const [selected,setSelected]=React.useState(null);return React.createElement(SharedVisitReport,{visitId:visit,visitRevision:3,load:React.useMemo(()=>createVisitReportClient(fetcher,actor,'staff'),[]),onVerificationFailure:()=>assert.fail('Unexpected verification failure'),selectedVersion:selected,onSelectedVersionChange:setSelected});}
 const values=()=>root.root.findAllByType('dd').map(n=>n.children.map(c=>typeof c==='string'?c:c.children?.join('')).join(''));
 try{
  await act(async()=>{root=create(React.createElement(Harness));});
  assert.equal(root.root.findAllByType('time')[0].props.dateTime,report.versions[1].noteEventAt);
  assert(values().includes(companyTime(report.versions[1].noteEventAt)));assert(values().includes(companyTime(report.versions[1].recordedAt)));
  await act(async()=>root.root.findAllByType('input')[0].props.onChange());
  assert.equal(root.root.findAllByType('time')[0].props.dateTime,report.versions[0].noteEventAt);
  assert(values().includes(companyTime(report.versions[0].recordedAt)));assert(!values().includes(companyTime(report.versions[1].noteEventAt)));
  await act(async()=>window.dispatchEvent(new Event('blur')));assert.equal(root.root.findAllByType('time').length,0,'event time clears with protected report');
 }finally{if(root)await act(async()=>root.unmount());globalThis.window=old.window;globalThis.document=old.document;}
});
for(const missing of ['omitted','null'])test(`legacy ${missing} note time is unknown, never inferred from visit or recording time`,async()=>{
 globalThis.IS_REACT_ACT_ENVIRONMENT=true;const old={window:globalThis.window,document:globalThis.document};
 globalThis.window=Object.assign(new EventTarget(),{setInterval:()=>1,clearInterval(){}});globalThis.document=Object.assign(new EventTarget(),{visibilityState:'visible',hasFocus:()=>true});
 const report=fictionalReport();if(missing==='null')for(const row of report.versions)row.noteEventAt=null;
 let root;try{
  await act(async()=>{root=create(React.createElement(SharedVisitReport,{visitId:visit,visitRevision:3,load:createVisitReportClient(async()=>Response.json(report),actor,'staff'),onVerificationFailure:()=>assert.fail('Unexpected failure'),selectedVersion:null,onSelectedVersionChange(){}}));});
  assert.match(JSON.stringify(root.toJSON()),/Not recorded · unknown/);assert.equal(root.root.findAllByType('time').length,0);
  assert.match(JSON.stringify(root.toJSON()),/Recorded at · Vancouver/);
 }finally{if(root)await act(async()=>root.unmount());globalThis.window=old.window;globalThis.document=old.document;}
});
