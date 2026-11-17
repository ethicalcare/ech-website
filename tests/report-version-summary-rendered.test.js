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
test('version choices identify latest/history and each recorded timestamp without retargeting reviews',async()=>{
 globalThis.IS_REACT_ACT_ENVIRONMENT=true;
 const old={window:globalThis.window,document:globalThis.document};
 globalThis.window=Object.assign(new EventTarget(),{setInterval:()=>1,clearInterval(){}});
 globalThis.document=Object.assign(new EventTarget(),{visibilityState:'visible',hasFocus:()=>true});
 const report=fictionalReport();let root,calls=0;
 const fetcher=async(url,options)=>{calls++;assert.equal(options.method,'GET');return Response.json(report);};
 function Harness(){const [selected,setSelected]=React.useState(null);const load=React.useMemo(()=>createVisitReportClient(fetcher,actor,'staff'),[]);return React.createElement(SharedVisitReport,{visitId:visit,visitRevision:3,load,onVerificationFailure:()=>assert.fail('Unexpected failure'),selectedVersion:selected,onSelectedVersionChange:setSelected});}
 try{
  await act(async()=>{root=create(React.createElement(Harness));});
  const radios=root.root.findAllByType('input');assert.equal(radios.length,2);
  for(const [i,radio] of radios.entries()){
   const summary=root.root.findAll(n=>n.type==='small'&&n.props.id===radio.props['aria-describedby']);assert.equal(summary.length,1);
   const copy=summary[0].children.filter(child=>typeof child==='string').join('');assert(copy.includes(companyTime(report.versions[i].recordedAt)));
   assert(copy.includes(i===1?'Latest saved version':'Historical version'));
   assert(copy.includes('Accepted'),'review status belongs to exact version');
   assert.equal(radio.props.checked,i===1);
  }
  await act(async()=>radios[0].props.onChange());assert.equal(root.root.findAllByType('input')[0].props.checked,true);
  assert.match(JSON.stringify(root.toJSON()),/Original version reviewed/);assert.doesNotMatch(JSON.stringify(root.toJSON()),/Exact correction reviewed/);
  assert.equal(calls,1,'choosing an already authorized version adds no privileged lookup');
  await act(async()=>window.dispatchEvent(new Event('blur')));assert.equal(root.root.findAllByType('input').length,0,'timestamps clear with protected version choices');
 }finally{if(root)await act(async()=>root.unmount());globalThis.window=old.window;globalThis.document=old.document;}
});
