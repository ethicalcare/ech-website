import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {createRequire} from 'node:module';
import {fileURLToPath,pathToFileURL} from 'node:url';
import React from 'react';
import {create,act} from 'react-test-renderer';
const require=createRequire(import.meta.url);
const bundle=await build({entryPoints:[fileURLToPath(new URL('../admin-src/app/shared/SharedScheduleCommands.tsx',import.meta.url))],bundle:true,write:false,platform:'node',format:'esm',jsx:'automatic',loader:{'.css':'empty'},plugins:[{name:'external-react',setup(b){b.onResolve({filter:/^react(?:\/.*)?$/},args=>({path:pathToFileURL(require.resolve(args.path)).href,external:true}));}}]});
const {SharedScheduleCommands}=await import('data:text/javascript;base64,'+Buffer.from(bundle.outputFiles[0].text).toString('base64'));
globalThis.IS_REACT_ACT_ENVIRONMENT=true;
const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const initial={id:id(1),clientId:id(2),workerId:id(3),service:'Home support',start:'2026-11-20T18:00:00.000Z',end:'2026-11-20T19:00:00.000Z',status:'Assigned',revision:1};
for(const action of ['assign','reschedule'])test(`${action} keeps one exact request when submit or retry repeats before render`,async()=>{
 let root;const calls=[];
 const props={visit:initial,active:true,role:'manager',staff:[{id:id(3),name:'First worker'},{id:id(4),name:'Second worker'}],
 client:{availability:async()=>({schema:1,enabled:true,membershipRevision:2}),commit:(command,signal)=>new Promise((resolve,reject)=>calls.push({command,signal,reject}))},
 onConfirmed:()=>assert.fail('Unexpected confirmation'),onScopeFailure:()=>assert.fail('Unexpected access failure'),onLeaveStateChange(){},onStale(){}};
 const change=async(node,value)=>act(async()=>{node.props.onChange({target:{value}});root.root.findByType('form').props.onChange();});
 try{
  await act(async()=>{root=create(React.createElement(SharedScheduleCommands,props));});
  await act(async()=>root.root.findAllByType('select')[0].props.onChange({target:{value:action}}));
  if(action==='assign')await change(root.root.findAllByType('select')[1],id(4));
  else await change(root.root.findAllByType('input')[0],'2026-11-20T09:00:00.000');
  await change(root.root.findByType('textarea'),'Fictional schedule reason');
  const submit=root.root.findByType('form').props.onSubmit;
  await act(async()=>{submit({preventDefault(){}});submit({preventDefault(){}});});
  assert.equal(calls.length,1);assert.equal(calls[0].signal.aborted,false);
  await act(async()=>calls[0].reject(new Error('Unknown outcome')));
  const retry=root.root.findAllByType('button').find(n=>n.props.children==='Retry exact schedule request').props.onClick;
  await act(async()=>{retry();retry();});
  assert.equal(calls.length,2);assert.equal(calls[1].signal.aborted,false);assert.deepEqual(calls[1].command,calls[0].command);
  await act(async()=>root.update(React.createElement(SharedScheduleCommands,{...props,active:false})));
  assert.equal(calls[1].signal.aborted,true);
  await act(async()=>root.update(React.createElement(SharedScheduleCommands,props)));
  const resumed=root.root.findAllByType('button').find(n=>n.props.children==='Retry exact schedule request').props.onClick;
  await act(async()=>resumed());assert.equal(calls.length,3);
  await act(async()=>calls[1].reject(new Error('Late cancelled failure')));
  await act(async()=>resumed());assert.equal(calls.length,3,'late cleanup cannot release the newer request owner');
  assert.deepEqual(calls[2].command,calls[0].command);
 }finally{if(root)await act(async()=>root.unmount());}
});
