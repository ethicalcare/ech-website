import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {createRequire} from 'node:module';
import {fileURLToPath,pathToFileURL} from 'node:url';
import React from 'react';
import {create,act} from 'react-test-renderer';
const require=createRequire(import.meta.url);
const bundle=await build({entryPoints:[fileURLToPath(new URL('../admin-src/app/shared/SharedScheduleCreate.tsx',import.meta.url))],bundle:true,write:false,platform:'node',format:'esm',jsx:'automatic',loader:{'.css':'empty'},plugins:[{name:'external-react',setup(b){b.onResolve({filter:/^react(?:\/.*)?$/},args=>({path:pathToFileURL(require.resolve(args.path)).href,external:true}));}}]});
const {SharedScheduleCreate}=await import('data:text/javascript;base64,'+Buffer.from(bundle.outputFiles[0].text).toString('base64'));
globalThis.IS_REACT_ACT_ENVIRONMENT=true;
const id='20000000-0000-4000-8000-000000000001';
const source={clientId:id,clientName:'Fictional client',service:'Home support',area:'Fixture area',instructionsVersion:1,instructionsSavedAt:'2026-11-01T17:00:00.000000Z',confirmedAt:'2026-11-01T17:00:00.000000Z',inquiryId:null,inquiryRevision:null,sourceToken:'a'.repeat(64)};
for(const recurring of [false,true])test(`${recurring?'recurring':'single'} creation keeps first exact request across repeated submit before render`,async()=>{
 const saved={window:globalThis.window,document:globalThis.document};globalThis.window=new EventTarget();globalThis.document=Object.assign(new EventTarget(),{visibilityState:'visible'});
 const calls=[];let root;
 const commit=(command,signal)=>new Promise((resolve,reject)=>calls.push({command,signal,reject}));
 const availability=async()=>({schema:1,enabled:true,membershipRevision:1});
 const client={availability,sources:async()=>[source],drafts:{recover:async()=>null},commit,recurrence:{availability,commit}};
 const field=suffix=>root.root.findAll(n=>n.props.id?.endsWith('-'+suffix)&&['input','select'].includes(n.type))[0];
 const change=async(suffix,value)=>act(async()=>field(suffix).props.onChange({target:{value}}));
 try{
  await act(async()=>{root=create(React.createElement(SharedScheduleCreate,{client,staff:[],active:true,allowRecurrence:recurring,onScopeFailure:()=>assert.fail('Unexpected scope change'),onConfirmed:()=>assert.fail('Unexpected completion'),onPendingChange(){}}));});
  await change('source',id);await change('start','2026-11-20T10:00');await change('end','2026-11-20T11:00');if(recurring)await change('repeat','daily');
  const submit=root.root.findByType('form').props.onSubmit;
  await act(async()=>{submit({preventDefault(){}});submit({preventDefault(){}});});
  assert.equal(calls.length,1);assert.equal(calls[0].signal.aborted,false);
  assert.equal(calls[0].command.command.type,recurring?'createSeries':'create');
  await act(async()=>calls[0].reject(new Error('Unconfirmed transport')));
  const retry=root.root.findAllByType('button').find(n=>n.props.children==='Retry exact creation request');
  await act(async()=>retry.props.onClick());
  assert.equal(calls.length,2);assert.deepEqual(calls[1].command,calls[0].command,'retry keeps the first operation and occurrence IDs');
 }finally{if(root)await act(async()=>root.unmount());globalThis.window=saved.window;globalThis.document=saved.document;}
});
