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
test('full read failure offers explicit bounded recovery and never presents focused coverage as a complete month',async()=>{
 globalThis.IS_REACT_ACT_ENVIRONMENT=true;const old=globalThis.window;
 const actor='10000000-0000-4000-8000-000000000001',id='20000000-0000-4000-8000-000000000001';
 const session={authenticated:true,principal:{id:actor,operationalRole:'staff'},capabilities:[],operationsFeatures:{reads:true,scheduleCommands:false,scheduleRecurrence:false,visitActions:true}};
 try{for(const range of ['day','week']){let root,allow=false;const calls=[];globalThis.window=Object.assign(new EventTarget(),{confirm:()=>allow});
 const fetcher=async(url,options)=>{assert.equal(options.method,'GET');if(url.includes('commands=1'))return Response.json({schema:1,enabled:true,membershipRevision:3});if(url.includes('?visit='))return Response.json({visitId:id,revision:1,fields:{address:'Verified focused detail'},contactAuthority:'unknown',allergyStatus:'unknown'});if(url.includes('?report='))return Response.json({schema:1,visitId:id,visitRevision:1,reportRevision:0,reviews:[],versions:[]});const p=new URL(url,'https://fixture.invalid').searchParams;const from=p.get('from'),to=p.get('to');calls.push({from,to});if(Date.parse(to)-Date.parse(from)>8*86400000)return new Response(JSON.stringify({error:'Capacity unavailable'}),{status:503});return Response.json({schema:1,mode:'shared',clients:[{id,name:'Permitted fixture'}],staff:[{id:actor,name:'Worker'}],visits:[{id,clientId:id,workerId:actor,service:'Home support',start:from,end:new Date(Date.parse(from)+3600000).toISOString(),status:'In progress',revision:1}]});};
 const button=name=>root.root.findAllByType('button').find(n=>n.props.children===name);const rows=()=>root.root.findAllByType('button').filter(n=>JSON.stringify(n.props.children).includes('View visit details'));
 try{await act(async()=>{root=create(React.createElement(SharedScheduleRead,{session,fetcher}));});assert.equal(calls.length,1,'no automatic retry');assert.equal(rows().length,0);await act(async()=>button('Load selected '+range+' only').props.onClick());assert.equal(calls.length,2);assert.equal(Date.parse(calls[1].to)-Date.parse(calls[1].from),(range==='day'?1:7)*86400000);assert.equal(rows().length,1);assert.match(JSON.stringify(root.toJSON()),/not a complete month calendar/);assert.equal(button('Month').props.disabled,true);if(range==='day')assert.equal(button('Week').props.disabled,true);
 await act(async()=>rows()[0].props.onClick());const summary=()=>root.root.findAllByType('textarea').find(n=>n.props.id.endsWith('-summary'));await act(async()=>summary().props.onChange({target:{value:'Retain focused report draft'}}));await act(async()=>button('Retry full calendar').props.onClick());assert.equal(calls.length,2);assert.equal(summary().props.value,'Retain focused report draft');allow=true;await act(async()=>button('Retry full calendar').props.onClick());assert.equal(calls.length,3);assert.equal(rows().length,0);assert.doesNotMatch(JSON.stringify(root.toJSON()),/Verified focused detail/);assert.match(JSON.stringify(root.toJSON()),/could not be verified/);
 }finally{if(root)await act(async()=>root.unmount());}
 }}finally{globalThis.window=old;}
});
