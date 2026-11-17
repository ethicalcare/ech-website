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
test('Day Week Month switch without replacing selected draft or refetching authorized records',async()=>{
 globalThis.IS_REACT_ACT_ENVIRONMENT=true;const old=globalThis.window;globalThis.window=Object.assign(new EventTarget(),{confirm:()=>false});let root,calls=0;const actor='10000000-0000-4000-8000-000000000001',id='20000000-0000-4000-8000-000000000001',id2='20000000-0000-4000-8000-000000000002';
 const session={authenticated:true,principal:{id:actor,operationalRole:'staff'},capabilities:[],operationsFeatures:{reads:true,scheduleCommands:false,scheduleRecurrence:false,visitActions:true}};
 const fetcher=async(url,options)=>{calls++;assert.equal(options.method,'GET');if(url.includes('commands=1'))return Response.json({schema:1,enabled:true,membershipRevision:3});if(url.includes('?visit='))return Response.json({visitId:new URL(url,'https://fixture.invalid').searchParams.get('visit'),revision:1,fields:{},contactAuthority:'unknown',allergyStatus:'unknown'});if(url.includes('?report='))return Response.json({schema:1,visitId:id,visitRevision:1,reportRevision:0,reviews:[],versions:[]});const start=fixtureVisitStart(url);return Response.json({schema:1,mode:'shared',clients:[{id,name:'Very long permitted client name retained without truncation'}],staff:[{id:actor,name:'Very long worker name retained'}],visits:[id,id2].map(key=>({id:key,clientId:id,workerId:actor,service:'Home support',start,end:new Date(Date.parse(start)+3600000).toISOString(),status:'In progress',revision:1}))});};
 const button=text=>root.root.findAllByType('button').find(b=>b.props.children===text);const visitButtons=()=>root.root.findAllByType('button').filter(b=>JSON.stringify(b.props.children).includes('View visit details'));const summary=()=>root.root.findAllByType('textarea').find(n=>n.props.id.endsWith('-summary'));
 try{await act(async()=>{root=create(React.createElement(SharedScheduleRead,{session,fetcher}));});assert.equal(visitButtons().length,2,'overlaps both selectable');await act(async()=>visitButtons()[0].props.onClick());await act(async()=>summary().props.onChange({target:{value:'Retained across views'}}));const before=calls;const originalDate=root.root.findAllByType('input').find(n=>n.props.type==='date').props.value;
 for(const view of ['Day','Month','Week']){await act(async()=>button(view).props.onClick());assert.equal(summary().props.value,'Retained across views');assert.equal(calls,before);assert.equal(button(view).props['aria-pressed'],true);assert.equal(visitButtons().length,2);assert.match(JSON.stringify(root.toJSON()),/Very long worker name retained/);}
 await act(async()=>root.root.findAllByType('input').find(n=>n.props.type==='date').props.onChange({currentTarget:{value:'2026-10-01'}}));assert.equal(root.root.findAllByType('input').find(n=>n.props.type==='date').props.value,originalDate,'declined date change retains context');
 await act(async()=>button('Clear staff').props.onClick());await act(async()=>button('Month').props.onClick());assert.equal(visitButtons().length,0);assert.equal(summary().props.value,'Retained across views');assert.equal(calls,before);assert.match(JSON.stringify(root.toJSON()),/outside the current staff filter or calendar view/);
 }finally{if(root)await act(async()=>root.unmount());globalThis.window=old;}
});
