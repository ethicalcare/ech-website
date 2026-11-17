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

const {SharedVisitNoteTimeline,orderedVisitNotes}=await component('SharedVisitNoteTimeline');
test('visit notes use explicit microsecond event ordering, preserve versions and isolate unknown times',()=>{
 const base=fictionalReport().versions[0];
 const versions=[{...base,revision:1,version:0,noteEventAt:'2026-11-01T18:00:00.000002Z'},{...base,revision:2,version:1,noteEventAt:'2026-11-01T18:00:00.000001Z'},{...base,revision:3,version:2,noteEventAt:null},{...base,revision:4,version:3}];
 const before=JSON.stringify(versions),result=orderedVisitNotes(versions);
 assert.deepEqual(result.known.map(v=>v.revision),[2,1]);assert.deepEqual(result.unknown.map(v=>v.revision),[3,4]);assert.equal(JSON.stringify(versions),before);
 const tied=orderedVisitNotes([{...versions[0],noteEventAt:'2026-11-01T11:00:00-07:00'},{...versions[1],noteEventAt:'2026-11-01T18:00:00Z'}]);assert.deepEqual(tied.known.map(v=>v.revision),[1,2]);
});
test('visit note activity retains correction attribution and limits completeness claims',async()=>{
 globalThis.IS_REACT_ACT_ENVIRONMENT=true;const report=fictionalReport();report.versions[0].noteEventAt='2026-11-01T19:00:00Z';report.versions[1].noteEventAt=null;
 let root;try{
  await act(async()=>{root=create(React.createElement(SharedVisitNoteTimeline,{report}));});
  assert.equal(root.root.findByType('details').props.open,undefined,'collapsed by default');
  assert.equal(root.root.findAllByType('li').length,0);
  await act(async()=>root.root.findByType('details').props.onToggle({currentTarget:{open:true}}));
  const known=root.root.findByProps({'aria-label':'Visit notes with known event times'});assert.equal(known.findAllByType('li').length,1);assert.equal(known.findByType('time').props.dateTime,report.versions[0].noteEventAt);
  const unknown=root.root.findByProps({'aria-label':'Visit notes with unknown event time'});assert.equal(unknown.findAllByType('li').length,1);assert.equal(unknown.findAllByType('time').length,0);
  const text=JSON.stringify(root.toJSON());for(const expected of ['Original wording','Corrected wording','Clarify actual end','Historical version','Latest saved version','not a complete daily care log','Recorded time does not establish']){assert(text.includes(expected),expected);}
  assert(text.includes(actor));assert(!text.includes('Exact correction reviewed'),'review notes are not care events');
  await act(async()=>root.root.findByType('details').props.onToggle({currentTarget:{open:false}}));assert.equal(root.root.findAllByType('li').length,0);
 }finally{if(root)await act(async()=>root.unmount());}
});
