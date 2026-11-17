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
async function fixture(run){
 let root,leave,confirmed,resolveCommit;const requests=[];
 const props={visit:initial,active:true,role:'manager',staff:[{id:id(3),name:'First worker'},{id:id(4),name:'Second worker'}],
 client:{availability:async()=>({schema:1,enabled:true,membershipRevision:2}),commit:command=>{requests.push(command);const c=command.command;return new Promise(resolve=>{resolveCommit=()=>resolve({visit:{...initial,...(c.type==='assign'?{workerId:c.workerId}:c.type==='reschedule'?{start:c.start,end:c.end}:{}),revision:2},operationId:command.operationId});});}},
 onConfirmed:value=>{confirmed=value;},onScopeFailure:()=>assert.fail('Unexpected access failure'),onLeaveStateChange:value=>{leave=value;},onStale:()=>assert.fail('Unexpected stale state')};
 const select=()=>root.root.findAllByType('select')[0];
 const mode=async value=>act(async()=>select().props.onChange({target:{value}}));
 const edit=async(node,value)=>act(async()=>{node.props.onChange({target:{value}});root.root.findByType('form').props.onChange();});
 const save=async()=>{await act(async()=>root.root.findByType('form').props.onSubmit({preventDefault(){}}));await act(async()=>resolveCommit());};
 try{await act(async()=>{root=create(React.createElement(SharedScheduleCommands,props));});await run({get root(){return root;},get leave(){return leave;},get confirmed(){return confirmed;},requests,mode,edit,save});}
 finally{if(root)await act(async()=>root.unmount());}
}
test('saving assignment retains unsent reschedule fields and leave protection without a reason',async()=>fixture(async f=>{
 await f.edit(f.root.root.findAllByType('input')[0],'2026-11-20T13:00:00.000');
 await f.mode('assign');await f.edit(f.root.root.findAllByType('select')[1],id(4));await f.edit(f.root.root.findByType('textarea'),'Change worker');await f.save();
 assert.equal(f.requests.length,1);assert.equal(f.requests[0].command.type,'assign');
 assert.equal(f.root.root.findAllByType('input')[0].props.value,'2026-11-20T13:00:00.000');
 assert.deepEqual(f.leave,{dirty:true,pending:false,retained:false});
}));
test('saving reschedule retains a separate unsubmitted worker selection and leave protection',async()=>fixture(async f=>{
 await f.mode('assign');await f.edit(f.root.root.findAllByType('select')[1],id(4));await f.mode('reschedule');
 await f.edit(f.root.root.findAllByType('input')[0],'2026-11-20T09:00:00.000');await f.edit(f.root.root.findByType('textarea'),'Adjust start');await f.save();
 assert.equal(f.requests.length,1);assert.equal(f.requests[0].command.type,'reschedule');
 assert.deepEqual(f.leave,{dirty:true,pending:false,retained:false});await f.mode('assign');
 assert.equal(f.root.root.findAllByType('select')[1].props.value,id(4));
}));
test('saving only the active action clears leave protection once its verified fields match',async()=>fixture(async f=>{
 await f.mode('assign');await f.edit(f.root.root.findAllByType('select')[1],id(4));await f.edit(f.root.root.findByType('textarea'),'Change worker');await f.save();
 assert.deepEqual(f.leave,{dirty:false,pending:false,retained:false});assert.equal(f.confirmed.workerId,id(4));
}));
