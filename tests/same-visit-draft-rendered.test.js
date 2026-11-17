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
test('reselecting the same staff visit or manager review preserves draft and leave guard without discard prompt',async()=>{
 globalThis.IS_REACT_ACT_ENVIRONMENT=true;
 const saved=globalThis.window;
 const actor='10000000-0000-4000-8000-000000000001',author='10000000-0000-4000-8000-000000000002',id='20000000-0000-4000-8000-000000000001';
 try{for(const role of ['staff','manager']){
  let prompts=0,allowDiscard=true,calls=0,root;globalThis.window=Object.assign(new EventTarget(),{confirm:()=>{prompts++;return allowDiscard;}});
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
   await act(async()=>{root=create(React.createElement(SharedScheduleRead,{session,fetcher}));});await act(async()=>button('View visit details').props.onClick());
   if(role==='manager')await act(async()=>button('Review latest report').props.onClick());
   await act(async()=>field().props.onChange({target:{value:'Keep this exact unsaved wording'}}));
   const requests=calls;
   await act(async()=>button('View visit details').props.onClick());
   assert.equal(prompts,0,'same selection is not a discard action');assert.equal(calls,requests,'same selection does not reload or replace scope');assert.equal(field().props.value,'Keep this exact unsaved wording');
   const unload=new Event('beforeunload',{cancelable:true});window.dispatchEvent(unload);assert.equal(unload.defaultPrevented,true,'parent leave protection remains set');
   allowDiscard=false;await act(async()=>button('Close visit details').props.onClick());assert.equal(prompts,1);assert.equal(field().props.value,'Keep this exact unsaved wording');
   allowDiscard=true;await act(async()=>button('Close visit details').props.onClick());assert.equal(prompts,2);assert.equal(field(),undefined);
  }finally{if(root)await act(async()=>root.unmount());}
 }}finally{globalThis.window=saved;}
});
