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
test('opening focuses details once and accepted close returns focus without losing draft context',async()=>{
 globalThis.IS_REACT_ACT_ENVIRONMENT=true;
 const saved=globalThis.window;
 const actor='10000000-0000-4000-8000-000000000001',author='10000000-0000-4000-8000-000000000002',id='20000000-0000-4000-8000-000000000001';
 try{for(const role of ['staff','manager']){
  let prompts=0,allowDiscard=true,calls=0,root;const focus=[];globalThis.window=Object.assign(new EventTarget(),{confirm:()=>{prompts++;return allowDiscard;}});
  const session={authenticated:true,principal:{id:actor,operationalRole:role},capabilities:[],operationsFeatures:{reads:true,scheduleCommands:false,scheduleRecurrence:false,visitActions:true}};
  const fetcher=async(url,options)=>{
   calls++;assert.equal(options.method,'GET','reselecting never writes');
   if(url.includes('commands=1'))return Response.json({schema:1,enabled:true,membershipRevision:3});
   if(url.includes('?visit='))return Response.json({visitId:id,revision:1,fields:{},contactAuthority:'unknown',allergyStatus:'unknown'});
   if(url.includes('?report='))return Response.json({schema:1,visitId:id,visitRevision:1,reportRevision:role==='staff'?0:1,reviews:[],versions:role==='staff'?[]:[{revision:1,version:0,sourceRevision:null,actorId:author,actorRole:'staff',recordedAt:'2026-11-01T18:01:00.000Z',outcome:'completed',summary:'Original report',issue:'',actualStart:'2026-11-01T17:00:00.000Z',actualEnd:'2026-11-01T18:00:00.000Z',completedTasks:['Meal preparation'],observations:'',reason:null}]});
   const from=fixtureVisitStart(url);return Response.json({schema:1,mode:'shared',clients:[{id,name:'Fixture client'}],staff:[{id:actor,name:'Worker'}],visits:[{id,clientId:id,workerId:actor,service:'Home support',start:from,end:new Date(Date.parse(from)+3600000).toISOString(),status:role==='staff'?'In progress':'Completed',revision:1}]});
  };
  const button=text=>root.root.findAllByType('button').find(b=>JSON.stringify(b.props.children).includes(text));
  const field=()=>root.root.findAllByType('textarea').find(n=>n.props.id.endsWith(role==='staff'?'-summary':'-note'));
  try{
   await act(async()=>{root=create(React.createElement(SharedScheduleRead,{session,fetcher}),{createNodeMock:element=>({disabled:!!element.props.disabled,focus:()=>focus.push(JSON.stringify(element.props.children))})});});const currentDay=root.root.findAll(n=>n.type==='section'&&n.props['aria-current']==='date');assert.equal(currentDay.length,1);assert.match(currentDay[0].props['aria-label'],/1 visible visit/);await act(async()=>button('View visit details').props.onClick());assert.equal(focus.at(-1),'"Selected visit details"');const opened=focus.length;
   if(role==='manager')await act(async()=>button('Review latest report').props.onClick());
   await act(async()=>field().props.onChange({target:{value:'Keep this exact unsaved wording'}}));
   await act(async()=>root.update(React.createElement(SharedScheduleRead,{session,fetcher,active:false})));await act(async()=>root.update(React.createElement(SharedScheduleRead,{session,fetcher,active:true})));assert.equal(focus.length,opened,'background navigation does not steal focus from current context');
   const requests=calls;
   await act(async()=>button('View visit details').props.onClick());
   assert.equal(focus.length,opened,'same selection and draft edits must not steal focus');assert.equal(prompts,0,'same selection is not a discard action');assert.equal(calls,requests,'same selection does not reload or replace scope');assert.equal(field().props.value,'Keep this exact unsaved wording');
   const unload=new Event('beforeunload',{cancelable:true});window.dispatchEvent(unload);assert.equal(unload.defaultPrevented,true,'parent leave protection remains set');
   allowDiscard=false;await act(async()=>button('Close visit details').props.onClick());assert.equal(prompts,1);assert.equal(focus.length,opened,'declined close leaves editor focus alone');assert.equal(field().props.value,'Keep this exact unsaved wording');
   allowDiscard=true;await act(async()=>button('Close visit details').props.onClick());assert.equal(prompts,2);assert.equal(field(),undefined);assert.match(focus.at(-1),/View visit details/,'close returns to original visit button');await act(async()=>button('View visit details').props.onClick());assert.equal(focus.at(-1),'"Selected visit details"');const beforeSignout=focus.length;await act(async()=>root.update(React.createElement(SharedScheduleRead,{session:null,fetcher})));assert.equal(focus.length,beforeSignout,'scope removal does not focus a stale account button');assert.equal(root.toJSON(),null);
  }finally{if(root)await act(async()=>root.unmount());}
 }}finally{globalThis.window=saved;}
});
test('close falls back to schedule heading when origin is filtered out, retaining date and filters',async()=>{
 globalThis.IS_REACT_ACT_ENVIRONMENT=true;const saved=globalThis.window;globalThis.window=Object.assign(new EventTarget(),{confirm:()=>true});let root;const focused=[];
 const actor='10000000-0000-4000-8000-000000000001',id='20000000-0000-4000-8000-000000000001';
 const session={authenticated:true,principal:{id:actor,operationalRole:'manager'},capabilities:[],operationsFeatures:{reads:true,scheduleCommands:false,scheduleRecurrence:false,visitActions:false}};
 const fetcher=async url=>{if(url.includes('?visit='))return Response.json({visitId:id,revision:1,fields:{},contactAuthority:'unknown',allergyStatus:'unknown'});const from=fixtureVisitStart(url);return Response.json({schema:1,mode:'shared',clients:[{id,name:'Fictional client'}],staff:[{id:actor,name:'Fictional worker'}],visits:[{id,clientId:id,workerId:actor,service:'Home support',start:from,end:new Date(Date.parse(from)+3600000).toISOString(),status:'Assigned',revision:1}]});};
 const button=text=>root.root.findAllByType('button').find(b=>JSON.stringify(b.props.children).includes(text));
 try{await act(async()=>{root=create(React.createElement(SharedScheduleRead,{session,fetcher}),{createNodeMock:e=>({disabled:!!e.props.disabled,focus:()=>focused.push(JSON.stringify(e.props.children))})});});const originalDate=root.root.findAllByType('input').find(n=>n.props.type==='date').props.value;
  await act(async()=>button('View visit details').props.onClick());await act(async()=>button('Clear staff').props.onClick());assert.equal(button('View visit details'),undefined);
  await act(async()=>button('Close visit details').props.onClick());assert.equal(focused.at(-1),'"Shared visit schedule"');assert.equal(root.root.findAllByType('input').find(n=>n.props.type==='date').props.value,originalDate);assert.equal(button('View visit details'),undefined,'filter remains applied');
 }finally{if(root)await act(async()=>root.unmount());globalThis.window=saved;}
});
test('calendar marks exactly one selected date, identifies its count and dates empty days across views',async()=>{
 globalThis.IS_REACT_ACT_ENVIRONMENT=true;const saved=globalThis.window;globalThis.window=Object.assign(new EventTarget(),{confirm:()=>true});let root;
 const actor='10000000-0000-4000-8000-000000000001',session={authenticated:true,principal:{id:actor,operationalRole:'manager'},capabilities:[],operationsFeatures:{reads:true,scheduleCommands:false,scheduleRecurrence:false,visitActions:false}};
 try{await act(async()=>{root=create(React.createElement(SharedScheduleRead,{session,fetcher:async()=>Response.json({schema:1,mode:'shared',clients:[],staff:[],visits:[]})}));});
  const day=root.root.findAllByType('input').find(n=>n.props.type==='date').props.value;const button=text=>root.root.findAllByType('button').find(b=>b.props.children===text);
  for(const view of ['Day','Week','Month']){await act(async()=>button(view).props.onClick());const selected=root.root.findAll(n=>n.type==='section'&&n.props['aria-current']==='date');assert.equal(selected.length,1);assert.equal(selected[0].props['aria-label'],`${day} · 0 visible visits`);const heading=selected[0].findByType('h3').children.join(''),empty=selected[0].findByType('p').children.join('');assert(heading.includes('Selected day'));assert(heading.includes(day));assert(empty.includes(`No visible visits on ${day}`));}
 }finally{if(root)await act(async()=>root.unmount());globalThis.window=saved;}
});
