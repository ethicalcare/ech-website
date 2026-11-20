import {fixtureVisitStart} from './calendar-fixture-time.js';
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
const {SharedVisitActions}=await component('SharedVisitActions');
const id='20000000-0000-4000-8000-000000000001',actor='10000000-0000-4000-8000-000000000001';
const visit={id,clientId:id,workerId:actor,service:'Home support',start:'2026-11-01T17:00:00.000Z',end:'2026-11-01T18:00:00.000Z',status:'In progress',revision:3};
const version={revision:1,version:0,sourceRevision:null,actorId:actor,actorRole:'staff',recordedAt:'2026-11-01T18:01:00.000Z',outcome:'completed',summary:'Saved fictional report',issue:'',actualStart:visit.start,actualEnd:visit.end,completedTasks:['Fictional task'],observations:'',reason:null};
async function fixture(completed,run){let root,leave;const requests=[];globalThis.IS_REACT_ACT_ENVIRONMENT=true;
 const report={schema:1,visitId:id,visitRevision:3,reportRevision:completed?1:0,versions:completed?[version]:[],reviews:[]};
 const client={availability:async()=>({schema:1,enabled:true,membershipRevision:7}),reviewEligibility:()=>({allowed:true,reason:''}),commit:async request=>{requests.push(request);throw new Error('Fictional unknown outcome');}};
 const props={visit:{...visit,status:completed?'Completed':'In progress'},active:true,client,loadDetail:async()=>({}),loadReport:async()=>report,loadCurrentVisit:async()=>visit,onConfirmed(){},onReconciled(){},onScopeFailure(){},onLeaveStateChange:value=>{leave=value;}};
 const button=text=>root.root.findAllByType('button').find(b=>b.props.children===text);
 const field=suffix=>root.root.findAll(n=>n.props.id?.endsWith('-'+suffix)&&['input','textarea','select'].includes(n.type))[0];
 const change=async(suffix,value)=>act(async()=>field(suffix).props.onChange({target:{value}}));
 try{await act(async()=>{root=create(React.createElement(SharedVisitActions,props));});await run({get root(){return root;},get leave(){return leave;},button,field,change,requests});}finally{if(root)await act(async()=>root.unmount());}
}
test('staff can discard an unsent report without closing visit or sending a request',async()=>fixture(false,async f=>{
 await f.change('summary','Unsent fictional report');assert.equal(f.leave.dirty,true);
 await act(async()=>f.button("Discard this action's draft").props.onClick());
 assert.equal(f.field('summary').props.value,'');assert.equal(f.leave.dirty,false);assert.equal(f.leave.pending,false);assert.equal(f.requests.length,0);
}));
test('discarding review preserves separate correction draft and its saved values',async()=>fixture(true,async f=>{
 await act(async()=>f.button('Edit latest report').props.onClick());await f.change('summary','Retain correction wording');await f.change('reason','Retain reason');
 await act(async()=>f.button('Approve or return report').props.onClick());await f.change('note','Discard review note');
 await act(async()=>f.button("Discard this action's draft").props.onClick());assert.equal(f.leave.dirty,true);
 await act(async()=>f.button('Edit latest report').props.onClick());assert.equal(f.field('summary').props.value,'Retain correction wording');assert.equal(f.field('reason').props.value,'Retain reason');
 assert.equal(f.requests.length,0);
}));
test('unknown sent report cannot be discarded and exact retry retains the request',async()=>fixture(false,async f=>{
 await f.change('outcome','follow-up');await f.change('summary','No tasks completed');await f.change('start','2026-11-01T10:00');await f.change('end','2026-11-01T11:00');
 await act(async()=>f.root.root.findByType('form').props.onSubmit({preventDefault(){}}));assert.equal(f.requests.length,1);assert.equal(f.leave.pending,true);assert.equal(f.button("Discard this action's draft"),undefined);
 await act(async()=>f.button('Retry exact request').props.onClick());assert.deepEqual(f.requests[1],f.requests[0]);
}));
