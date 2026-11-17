import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import {create,act} from 'react-test-renderer';
import {build} from 'esbuild';
import {createRequire} from 'node:module';
import {fileURLToPath,pathToFileURL} from 'node:url';
const require=createRequire(import.meta.url);
const bundle=await build({entryPoints:[fileURLToPath(new URL('../admin-src/app/shared/SharedVisitActions.tsx',import.meta.url))],bundle:true,write:false,platform:'node',format:'esm',jsx:'automatic',loader:{'.css':'empty'},plugins:[{name:'external-react',setup(b){b.onResolve({filter:/^react(?:\/.*)?$/},args=>({path:pathToFileURL(require.resolve(args.path)).href,external:true}));}}]});
const {SharedVisitActions}=await import('data:text/javascript;base64,'+Buffer.from(bundle.outputFiles[0].text).toString('base64'));
const id='20000000-0000-4000-8000-000000000001';
test('same-turn report submissions and receipt retries send only one unchanged request at a time',async()=>{
 globalThis.IS_REACT_ACT_ENVIRONMENT=true;
 const visit={id,clientId:id,workerId:id,service:'Home support',status:'In progress',revision:3,start:'2026-11-01T16:00:00.000Z',end:'2026-11-01T17:00:00.000Z'};
 const report={schema:1,visitId:id,visitRevision:3,reportRevision:0,versions:[],reviews:[]};
 const calls=[],resolvers=[],confirmed=[];let root;
 const client={availability:async()=>({schema:1,enabled:true,membershipRevision:7}),reviewEligibility:()=>({allowed:false,reason:'Staff cannot review'}),commit:(action,signal)=>{calls.push({action,signal});return new Promise((resolve,reject)=>resolvers.push({resolve,reject}));}};
 const props={visit,active:true,client,loadDetail:async()=>({}),loadReport:async()=>report,loadCurrentVisit:async()=>visit,onConfirmed:v=>confirmed.push(v),onReconciled(){},onScopeFailure:()=>assert.fail('Unexpected scope failure'),onLeaveStateChange(){}};
 const change=async(suffix,value)=>act(async()=>root.root.findAll(n=>['input','select','textarea'].includes(n.type)&&n.props.id?.endsWith('-'+suffix))[0].props.onChange({target:{value}}));
 try{
  await act(async()=>{root=create(React.createElement(SharedVisitActions,props));});
  await change('outcome','not-completed');await change('summary','Fictional client declined support.');await change('start','2026-11-01T09:00');await change('end','2026-11-01T10:00');
  const submit=root.root.findByType('form').props.onSubmit;
  await act(async()=>{submit({preventDefault(){}});submit({preventDefault(){}});});
  assert.equal(calls.length,1,'one operation identity before React renders pending state');
  const original=calls[0].action;
  await act(async()=>resolvers[0].reject(new Error('Fictional response lost')));
  assert.match(JSON.stringify(root.toJSON()),/exact request are retained/);
  const retry=root.root.findAllByType('button').find(n=>n.props.children==='Retry exact request').props.onClick;
  await act(async()=>{retry();retry();});
  assert.equal(calls.length,2,'one receipt retry before React renders busy state');assert.deepEqual(calls[1].action,original);
  await act(async()=>resolvers[1].resolve({visit:{...visit,status:'Completed',revision:4},report,receipt:{action:'submit',operationId:original.operationId}}));
  assert.equal(confirmed.length,1);assert(!root.root.findAllByType('button').some(n=>n.props.children==='Retry exact request'));
 }finally{if(root)await act(async()=>root.unmount());}
});
