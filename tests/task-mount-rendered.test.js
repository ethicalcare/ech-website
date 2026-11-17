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
const {SharedScheduleRead}=await component('SharedScheduleRead');
test('task mount is opt-in; verified tasks propagate draft navigation guards and forbidden reads clear detail',async()=>{
 globalThis.IS_REACT_ACT_ENVIRONMENT=true;const previous=globalThis.window;globalThis.window=Object.assign(new EventTarget(),{confirm:()=>false});
 const actor='10000000-0000-4000-8000-000000000001',id='20000000-0000-4000-8000-000000000001',task='30000000-0000-4000-8000-000000000001',category='40000000-0000-4000-8000-000000000001';
 let root,taskCalls=0,deny=false;
 const session={authenticated:true,principal:{id:actor,operationalRole:'staff'},capabilities:[],operationsFeatures:{reads:true,scheduleCommands:false,scheduleRecurrence:false,visitActions:false,taskResults:false}};
 const fetcher=async(url)=>{
 if(url.includes('visitTaskAvailability')){taskCalls++;return Response.json({schema:1,enabled:true,membershipRevision:3});}
 if(url.includes('visitTasks')){taskCalls++;if(deny)return new Response('',{status:403});return Response.json({visitId:id,visitRevision:1,plan:[{id:category,label:'Household',tasks:[{id:task,text:'Prepare meal'}]}],additions:[],results:[],resultVisibility:'limited'});}
 if(url.includes('commands=1'))return Response.json({schema:1,enabled:true,membershipRevision:3});
 if(url.includes('?report='))return Response.json({schema:1,visitId:id,visitRevision:1,reportRevision:0,reviews:[],versions:[]});
 if(url.includes('?visit='))return Response.json({visitId:id,revision:1,fields:{address:'Protected address'},contactAuthority:'unknown',allergyStatus:'unknown'});
 const from=fixtureVisitStart(url);return Response.json({schema:1,mode:'shared',clients:[{id,name:'Fixture'}],staff:[{id:actor,name:'Worker'}],visits:[{id,clientId:id,workerId:actor,service:'Home support',start:from,end:new Date(Date.parse(from)+3600000).toISOString(),status:'In progress',revision:1}]});
 };
 const button=text=>root.root.findAllByType('button').find(b=>JSON.stringify(b.props.children).includes(text));
 try{
 await act(async()=>{root=create(React.createElement(SharedScheduleRead,{session,fetcher}));});await act(async()=>button('View visit details').props.onClick());assert.equal(taskCalls,0);
 const enabled={...session,operationsFeatures:{...session.operationsFeatures,taskResults:true,visitActions:true}};await act(async()=>root.update(React.createElement(SharedScheduleRead,{session:enabled,fetcher})));await act(async()=>button('View visit details').props.onClick());assert.equal(taskCalls,2);assert.match(JSON.stringify(root.toJSON()),/Prepare meal/);
 const summary=()=>root.root.findAllByType('textarea').find(n=>n.props.id.endsWith('-summary'));assert.ok(summary());await act(async()=>summary().props.onChange({target:{value:'Report draft'}}));assert.equal(button('Record my factual result'),undefined);await act(async()=>summary().props.onChange({target:{value:''}}));
 const edit=root.root.findAllByType('button').find(b=>String(b.props.children).includes('Record my factual result'));assert.ok(edit);await act(async()=>edit.props.onClick());assert.equal(button('Submit report'),undefined,'task draft suppresses concurrent report mutation');
 const unload=new Event('beforeunload',{cancelable:true});window.dispatchEvent(unload);assert.equal(unload.defaultPrevented,true);await act(async()=>button('Close visit details').props.onClick());assert.match(JSON.stringify(root.toJSON()),/Prepare meal/);
 const callsBeforeHide=taskCalls;await act(async()=>root.update(React.createElement(SharedScheduleRead,{session:enabled,fetcher,active:false})));assert.equal(taskCalls,callsBeforeHide);assert.doesNotMatch(JSON.stringify(root.toJSON()),/Prepare meal/);
 await act(async()=>root.update(React.createElement(SharedScheduleRead,{session:enabled,fetcher,active:true})));assert.ok(root.root.findAllByType('form').some(f=>f.props['aria-label']==='Task result editor'),'unsent editor retained across navigation');
 await act(async()=>root.update(React.createElement(SharedScheduleRead,{session:null,fetcher})));deny=true;
 await act(async()=>root.update(React.createElement(SharedScheduleRead,{session:enabled,fetcher})));await act(async()=>button('View visit details').props.onClick());assert.doesNotMatch(JSON.stringify(root.toJSON()),/Protected address/);
 }finally{if(root)await act(async()=>root.unmount());globalThis.window=previous;}
});

test('unknown task save survives reopen, blocks changed membership, and retries the exact request',async()=>{
 globalThis.IS_REACT_ACT_ENVIRONMENT=true;const previous=globalThis.window;globalThis.window=Object.assign(new EventTarget(),{confirm:()=>false});
 const actor='10000000-0000-4000-8000-000000000001',id='20000000-0000-4000-8000-000000000001',task='30000000-0000-4000-8000-000000000001',category='40000000-0000-4000-8000-000000000001';
 let root,taskCalls=0,deny=false,membership=3,saved=null;const writes=[];
 const session={authenticated:true,principal:{id:actor,operationalRole:'staff'},capabilities:[],operationsFeatures:{reads:true,scheduleCommands:false,scheduleRecurrence:false,visitActions:false,taskResults:false}};
 const fetcher=async(url,options)=>{
 if(url.includes('visitTaskAvailability')){taskCalls++;return Response.json({schema:1,enabled:true,membershipRevision:membership});}
 if(url.includes('visitTasks')){taskCalls++;if(options.method==='POST'){const request=JSON.parse(options.body);writes.push(request);saved={taskId:request.taskId,version:1,outcome:request.outcome,observation:request.observation,actualAt:request.actualAt,recordedAt:'2026-11-17T19:00:00.000Z',actorId:actor,reason:null};if(writes.length===1)throw new Error('Lost response');return Response.json({visitId:id,taskId:task,version:1,operationId:request.operationId,recordedAt:saved.recordedAt});}if(deny)return new Response('',{status:403});return Response.json({visitId:id,visitRevision:1,plan:[{id:category,label:'Household',tasks:[{id:task,text:'Prepare meal'}]}],additions:[],results:saved?[saved]:[],resultVisibility:'limited'});}
 if(url.includes('?visit='))return Response.json({visitId:id,revision:1,fields:{address:'Protected address'},contactAuthority:'unknown',allergyStatus:'unknown'});
 const from=fixtureVisitStart(url);return Response.json({schema:1,mode:'shared',clients:[{id,name:'Fixture'}],staff:[{id:actor,name:'Worker'}],visits:[{id,clientId:id,workerId:actor,service:'Home support',start:from,end:new Date(Date.parse(from)+3600000).toISOString(),status:'In progress',revision:1}]});
 };
 const button=text=>root.root.findAllByType('button').find(b=>JSON.stringify(b.props.children).includes(text));
 try{
 await act(async()=>{root=create(React.createElement(SharedScheduleRead,{session,fetcher}));});await act(async()=>button('View visit details').props.onClick());assert.equal(taskCalls,0);
 const enabled={...session,operationsFeatures:{...session.operationsFeatures,taskResults:true}};await act(async()=>root.update(React.createElement(SharedScheduleRead,{session:enabled,fetcher})));await act(async()=>button('View visit details').props.onClick());assert.equal(taskCalls,2);assert.match(JSON.stringify(root.toJSON()),/Prepare meal/);
 const edit=root.root.findAllByType('button').find(b=>String(b.props.children).includes('Record my factual result'));assert.ok(edit);await act(async()=>edit.props.onClick());
 const form=()=>root.root.findAllByType('form').find(f=>f.props['aria-label']==='Task result editor');
 await act(async()=>form().findByType('select').props.onChange({target:{value:'done'}}));await act(async()=>form().findByType('input').props.onChange({target:{value:'2026-11-17T10:00'}}));await act(async()=>form().props.onSubmit({preventDefault(){}}));assert.equal(writes.length,1);assert.equal(button('Close visit details').props.disabled,true);
 await act(async()=>root.update(React.createElement(SharedScheduleRead,{session:enabled,fetcher,active:false})));await act(async()=>root.update(React.createElement(SharedScheduleRead,{session:enabled,fetcher,active:true})));assert.ok(button('Retry exact task result'));assert.equal(button('Close visit details').props.disabled,true);
 await act(async()=>root.update(React.createElement(SharedScheduleRead,{session:enabled,fetcher,active:false})));membership=4;await act(async()=>root.update(React.createElement(SharedScheduleRead,{session:enabled,fetcher,active:true})));assert.match(JSON.stringify(root.toJSON()),/different membership revision/);assert.equal(button('Record my factual result'),undefined);assert.equal(button('Close visit details').props.disabled,true);assert.equal(writes.length,1);
 await act(async()=>root.update(React.createElement(SharedScheduleRead,{session:enabled,fetcher,active:false})));membership=3;await act(async()=>root.update(React.createElement(SharedScheduleRead,{session:enabled,fetcher,active:true})));await act(async()=>button('Retry exact task result').props.onClick());assert.equal(writes.length,2);assert.deepEqual(writes[1],writes[0]);assert.equal(button('Close visit details').props.disabled,false);assert.match(JSON.stringify(root.toJSON()),/saved and read back/);
 }finally{if(root)await act(async()=>root.unmount());globalThis.window=previous;}
});
