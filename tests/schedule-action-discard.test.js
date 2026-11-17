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
 try{await act(async()=>{root=create(React.createElement(SharedScheduleCommands,props));});await run({get root(){return root;},get leave(){return leave;},get confirmed(){return confirmed;},requests,mode,edit,save,submitHold:async()=>act(async()=>root.root.findByType('form').props.onSubmit({preventDefault(){}})),discard:async()=>act(async()=>root.root.findAllByType('button').find(n=>n.props.children==="Discard this action's draft").props.onClick())});}
 finally{if(root)await act(async()=>root.unmount());}
}
test('discarding assignment keeps reschedule times and reason without sending a request',async()=>fixture(async f=>{
 await f.edit(f.root.root.findAllByType('input')[0],'2026-11-20T13:00:00.000');await f.edit(f.root.root.findByType('textarea'),'Retain time reason');
 await f.mode('assign');await f.edit(f.root.root.findAllByType('select')[1],id(4));await f.edit(f.root.root.findByType('textarea'),'Discard assignment reason');await f.discard();
 assert.equal(f.root.root.findAllByType('select')[1].props.value,id(3));assert.equal(f.root.root.findByType('textarea').props.value,'');
 await f.mode('reschedule');assert.equal(f.root.root.findAllByType('input')[0].props.value,'2026-11-20T13:00:00.000');assert.equal(f.root.root.findByType('textarea').props.value,'Retain time reason');
 assert.equal(f.leave.dirty,true);assert.equal(f.requests.length,0);
}));
test('discarding reschedule keeps the separate worker selection and reason',async()=>fixture(async f=>{
 await f.mode('assign');await f.edit(f.root.root.findAllByType('select')[1],id(4));await f.edit(f.root.root.findByType('textarea'),'Retain assignment');
 await f.mode('reschedule');await f.edit(f.root.root.findAllByType('input')[0],'2026-11-20T13:00:00.000');await f.edit(f.root.root.findByType('textarea'),'Discard time reason');await f.discard();
 assert.equal(f.root.root.findByType('textarea').props.value,'');
 await f.mode('assign');assert.equal(f.root.root.findAllByType('select')[1].props.value,id(4));assert.equal(f.root.root.findByType('textarea').props.value,'Retain assignment');
 assert.equal(f.leave.dirty,true);assert.equal(f.requests.length,0);
}));
test('discarding the only cancellation draft clears leave protection without cancelling visit',async()=>fixture(async f=>{
 await f.mode('cancel');await f.edit(f.root.root.findByType('textarea'),'Do not send cancellation');await f.discard();
 assert.equal(f.root.root.findByType('textarea').props.value,'');assert.equal(f.leave.dirty,false);assert.equal(f.requests.length,0);
}));
test('an in-flight exact request cannot be discarded by the action draft control',async()=>fixture(async f=>{
 await f.edit(f.root.root.findByType('textarea'),'Keep exact request');await f.submitHold();
 const before=JSON.stringify(f.requests[0]);await f.discard();
 assert.equal(JSON.stringify(f.requests[0]),before);assert.equal(f.requests.length,1);
 assert.equal(f.root.root.findByType('textarea').props.value,'Keep exact request');assert.equal(f.leave.pending,true);
 assert.equal(f.root.root.findByType('fieldset').props.disabled,true);
}));

test('switching action alone does not mark a draft dirty; real edits still do',async()=>fixture(async f=>{
 const form=f.root.root.findByType('form'),selector=f.root.root.findAllByType('select')[0];
 await act(async()=>{selector.props.onChange({target:{value:'cancel'}});form.props.onChange({target:{id:selector.props.id}});});
 assert.equal(f.leave.dirty,false);assert.equal(f.requests.length,0);
 await f.edit(f.root.root.findByType('textarea'),'Fictional reason');assert.equal(f.leave.dirty,true);
 await act(async()=>{const select=f.root.root.findAllByType('select')[0];select.props.onChange({target:{value:'reschedule'}});form.props.onChange({target:{id:select.props.id}});});
 assert.equal(f.leave.dirty,true,'selector navigation must not clear a sibling draft');assert.equal(f.requests.length,0);
}));

test('invalid local schedule fields remain editable and do not create a retained request',async()=>fixture(async f=>{
 await f.edit(f.root.root.findAllByType('input')[0],'2026-11-20T13:00:00.000');
 await f.edit(f.root.root.findByType('textarea'),'Adjust fictional time');
 await f.submitHold();
 assert.equal(f.requests.length,0,'end before start must not reach the command client');
 assert.equal(f.leave.pending,false);assert.equal(!!f.leave.retained,false);assert.equal(f.leave.dirty,true);
 assert.equal(f.root.root.findByType('fieldset').props.disabled,false);
 assert.equal(f.root.root.findByType('textarea').props.value,'Adjust fictional time');
 assert.equal(f.root.root.findAllByType('button').some(b=>b.props.children==='Retry exact schedule request'),false);
 await f.edit(f.root.root.findAllByType('input')[1],'2026-11-20T14:00:00.000');
 await f.submitHold();assert.equal(f.requests.length,1);assert.equal(f.leave.pending,true);
}));
