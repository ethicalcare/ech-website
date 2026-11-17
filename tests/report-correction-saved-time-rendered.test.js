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
test('wording-only correction preserves saved repeated-hour actual instants; edited ambiguous times remain rejected',async()=>{
 globalThis.IS_REACT_ACT_ENVIRONMENT=true;
 const id='20000000-0000-4000-8000-000000000001',actor='10000000-0000-4000-8000-000000000001';
 const visit={id,clientId:id,workerId:actor,service:'Home support',start:'2025-11-02T08:15:00.123Z',end:'2025-11-02T09:45:00.456Z',status:'Completed',revision:3};
 const original={revision:1,version:0,sourceRevision:null,actorId:actor,actorRole:'staff',recordedAt:'2025-11-02T10:00:00.000Z',outcome:'completed',summary:'Original fictional wording',issue:'',actualStart:visit.start,actualEnd:visit.end,completedTasks:['Fictional task'],observations:'',reason:null};
 const report={schema:1,visitId:id,visitRevision:3,reportRevision:1,versions:[original],reviews:[]};
 for(const edit of [false,true]){let root;const requests=[];const client={availability:async()=>({schema:1,enabled:true,membershipRevision:7}),reviewEligibility:()=>({allowed:false,reason:'Staff cannot review'}),commit:async action=>{requests.push(action);throw new Error('Fictional unconfirmed request');}};
 try{await act(async()=>{root=create(React.createElement(SharedVisitActions,{visit,active:true,client,loadDetail:async()=>({}),loadReport:async()=>report,loadCurrentVisit:async()=>visit,onConfirmed(){},onReconciled(){},onScopeFailure(){},onLeaveStateChange(){}}));});
 await act(async()=>root.root.findAllByType('button').find(b=>b.props.children==='Correct latest report').props.onClick());
 const change=async(suffix,value)=>act(async()=>root.root.findAll(n=>n.props.id?.endsWith('-'+suffix)&&['input','textarea'].includes(n.type))[0].props.onChange({target:{value}}));
 await change('summary','Corrected fictional wording');await change('reason','Clarify wording only');if(edit)await change('start','2025-11-02T01:20');
 await act(async()=>root.root.findByType('form').props.onSubmit({preventDefault(){}}));
 if(edit){assert.equal(requests.length,0);assert.match(JSON.stringify(root.toJSON()),/occurs twice/);}else{assert.equal(requests.length,1);assert.equal(requests[0].command.actualStart,original.actualStart);assert.equal(requests[0].command.actualEnd,original.actualEnd);assert.equal(requests[0].command.summary,'Corrected fictional wording');await act(async()=>root.root.findAllByType('button').find(b=>b.props.children==='Retry exact request').props.onClick());assert.deepEqual(requests[1],requests[0]);}
 }finally{if(root)await act(async()=>root.unmount());}}
});
