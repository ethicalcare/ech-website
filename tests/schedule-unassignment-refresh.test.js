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
test('after an assignment disappears, the manager cannot submit a hidden remove-assignment action',async()=>{
 let root,leave;const calls=[];
 const visit={id:id(1),clientId:id(2),workerId:id(3),service:'Home support',start:'2026-11-20T18:00:00.000Z',end:'2026-11-20T19:00:00.000Z',status:'Assigned',revision:1};
 const props={visit,active:true,role:'manager',staff:[{id:id(3),name:'Worker'}],client:{availability:async()=>({schema:1,enabled:true,membershipRevision:2}),commit:async command=>{calls.push(command);throw Error('unexpected');}},onConfirmed(){},onScopeFailure(){},onLeaveStateChange(state){leave=state;},onStale(){}};
 try{
  await act(async()=>{root=create(React.createElement(SharedScheduleCommands,props));});
  await act(async()=>root.root.findAllByType('select')[0].props.onChange({target:{value:'unassign'}}));
  await act(async()=>{root.root.findByType('textarea').props.onChange({target:{value:'Remove worker'}});root.root.findByType('form').props.onChange();});
  await act(async()=>root.update(React.createElement(SharedScheduleCommands,{...props,visit:{...visit,workerId:null,status:'Open',revision:2}})));
  assert.equal(root.root.findAllByType('select')[0].props.value,'reschedule');
  assert.equal(leave.dirty,true);assert.equal(calls.length,0);
  await act(async()=>root.update(React.createElement(SharedScheduleCommands,{...props,visit:{...visit,revision:3}})));
  await act(async()=>root.root.findAllByType('select')[0].props.onChange({target:{value:'unassign'}}));
  assert.equal(root.root.findByType('textarea').props.value,'Remove worker');
 }finally{if(root)await act(async()=>root.unmount());}
});

test('an unavailable unassignment draft can be selected and discarded without losing another draft',async()=>{
 let root,leave;const calls=[];
 const visit={id:id(1),clientId:id(2),workerId:id(3),service:'Home support',start:'2026-11-20T18:00:00.000Z',end:'2026-11-20T19:00:00.000Z',status:'Assigned',revision:1};
 const props={visit,active:true,role:'manager',staff:[],client:{availability:async()=>({schema:1,enabled:true,membershipRevision:2}),commit:async command=>{calls.push(command);throw Error('unexpected');}},onConfirmed(){},onScopeFailure(){},onLeaveStateChange(state){leave=state;},onStale(){}};
 const action=()=>root.root.findAllByType('select')[0];
 const select=async value=>act(async()=>action().props.onChange({target:{value}}));
 const reason=async value=>act(async()=>{root.root.findByType('textarea').props.onChange({target:{value}});root.root.findByType('form').props.onChange();});
 const discard=async()=>act(async()=>root.root.findAllByType('button').find(b=>b.props.children==="Discard this action's draft").props.onClick());
 try{
  await act(async()=>{root=create(React.createElement(SharedScheduleCommands,props));});
  await reason('Keep reschedule reason');
  await select('unassign');await reason('Remove worker reason');
  await act(async()=>root.update(React.createElement(SharedScheduleCommands,{...props,visit:{...visit,workerId:null,status:'Open',revision:2}})));
  assert.equal(action().props.value,'reschedule');
  assert.ok(action().findAllByType('option').some(o=>o.props.value==='unassign'));
  await select('unassign');assert.equal(root.root.findByType('textarea').props.value,'Remove worker reason');
  assert.equal(root.root.findAllByType('button').find(b=>b.props.type==='submit').props.disabled,true);
  await act(async()=>root.root.findByType('form').props.onSubmit({preventDefault(){}}));assert.equal(calls.length,0);
  await discard();assert.equal(action().props.value,'reschedule');
  assert.equal(action().findAllByType('option').some(o=>o.props.value==='unassign'),false);
  assert.equal(root.root.findByType('textarea').props.value,'Keep reschedule reason');assert.equal(leave.dirty,true);
  await discard();assert.equal(leave.dirty,false);assert.equal(calls.length,0);
 }finally{if(root)await act(async()=>root.unmount());}
});

test('assignment refresh preserves a separately selected replacement worker',async()=>{
 let root,leave;const calls=[];
 const visit={id:id(1),clientId:id(2),workerId:id(3),service:'Home support',start:'2026-11-20T18:00:00.000Z',end:'2026-11-20T19:00:00.000Z',status:'Assigned',revision:1};
 const props={visit,active:true,role:'manager',staff:[{id:id(3),name:'First'},{id:id(4),name:'Second'}],client:{availability:async()=>({schema:1,enabled:true,membershipRevision:2}),commit:async command=>{calls.push(command);}},onConfirmed(){},onScopeFailure(){},onLeaveStateChange(state){leave=state;},onStale(){}};
 try{
  await act(async()=>{root=create(React.createElement(SharedScheduleCommands,props));});
  await act(async()=>root.root.findAllByType('select')[0].props.onChange({target:{value:'assign'}}));
  await act(async()=>{root.root.findAllByType('select')[1].props.onChange({target:{value:id(4)}});root.root.findByType('form').props.onChange();});
  await act(async()=>root.root.findAllByType('select')[0].props.onChange({target:{value:'unassign'}}));
  await act(async()=>{root.root.findByType('textarea').props.onChange({target:{value:'Remove worker'}});root.root.findByType('form').props.onChange();});
  await act(async()=>root.update(React.createElement(SharedScheduleCommands,{...props,visit:{...visit,workerId:null,status:'Open',revision:2}})));
  await act(async()=>root.root.findAllByType('select')[0].props.onChange({target:{value:'unassign'}}));
  await act(async()=>root.root.findAllByType('button').find(b=>b.props.children==="Discard this action's draft").props.onClick());
  await act(async()=>root.root.findAllByType('select')[0].props.onChange({target:{value:'assign'}}));
  assert.equal(root.root.findAllByType('select')[1].props.value,id(4));assert.equal(leave.dirty,true);assert.equal(calls.length,0);
 }finally{if(root)await act(async()=>root.unmount());}
});
