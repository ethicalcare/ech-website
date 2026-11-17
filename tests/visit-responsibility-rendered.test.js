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
import {companyTime} from '../admin-src/app/shared/time.ts';
test('selected assignment uses only authorized roster and clears on revision change, denied access and inactivity',async()=>{
 globalThis.IS_REACT_ACT_ENVIRONMENT=true;let root;const calls=[];
 const entry={id:visit,revision:3,clientId:reviewer,workerId:actor,service:'Home support',start:'2026-11-01T17:00:00.000Z',end:'2026-11-01T18:00:00.000Z',status:'Assigned'};
 const fetcher=(url,options)=>new Promise(resolve=>{assert.equal(options.method,'GET');assert(url.includes('?visit='));calls.push({resolve,options});});
 const props={actor,role:'manager',visit:entry,staff:[{id:actor,name:'Fictional assigned worker'},{id:reviewer,name:'Unrelated worker'}],fetcher,onClose(){}};
 const text=()=>JSON.stringify(root.toJSON());
 try{
  await act(async()=>{root=create(React.createElement(SharedVisitRead,props));});assert(!text().includes('Fictional assigned worker'));
  await act(async()=>calls[0].resolve(Response.json({visitId:visit,revision:3,fields:{},contactAuthority:'unknown',allergyStatus:'unknown'})));
  assert(text().includes('Fictional assigned worker'));assert(!text().includes('Unrelated worker'));assert(text().includes(companyTime(entry.start)));assert.match(text(),/not report authorship/);
  await act(async()=>root.update(React.createElement(SharedVisitRead,{...props,active:false})));assert(!text().includes('Fictional assigned worker'));
  await act(async()=>root.update(React.createElement(SharedVisitRead,{...props,staff:[]})));assert.match(text(),/Assigned worker name unavailable/);assert.doesNotMatch(text(),/Unassigned/);
  await act(async()=>root.update(React.createElement(SharedVisitRead,{...props,visit:{...entry,workerId:null,revision:4}})));assert(!text().includes('Fictional assigned worker'));assert.equal(calls.length,2);
  await act(async()=>calls[1].resolve(Response.json({visitId:visit,revision:4,fields:{},contactAuthority:'unknown',allergyStatus:'unknown'})));assert.match(text(),/Unassigned/);
  await act(async()=>root.update(React.createElement(SharedVisitRead,{...props,visit:{...entry,revision:5}})));assert(!text().includes('Scheduled visit responsibility'));
  await act(async()=>calls[2].resolve(Response.json({error:{code:'forbidden'}},{status:403})));assert(!text().includes('Scheduled visit responsibility'));assert.equal(calls.length,3,'no extra name/profile endpoint');
 }finally{if(root)await act(async()=>root.unmount());}
});
