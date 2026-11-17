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
test('calendar detail names distinguish repeated client visits using existing times and worker',async()=>{
 globalThis.IS_REACT_ACT_ENVIRONMENT=true;const old=globalThis.window;globalThis.window=new EventTarget();let root;
 const actor='10000000-0000-4000-8000-000000000001',id='20000000-0000-4000-8000-000000000001',id2='20000000-0000-4000-8000-000000000002';
 const session={authenticated:true,principal:{id:actor,operationalRole:'manager'},capabilities:[],operationsFeatures:{reads:true,scheduleCommands:false,scheduleRecurrence:false,visitActions:false}};
 const fetcher=async(url,options)=>{assert.equal(options.method,'GET');const start=fixtureVisitStart(url);return Response.json({schema:1,mode:'shared',clients:[{id,name:'Fictional client'}],staff:[{id:actor,name:'Fictional worker'}],visits:[{id,clientId:id,workerId:actor,service:'Home support',start,end:new Date(Date.parse(start)+3600000).toISOString(),status:'Assigned',revision:1},{id:id2,clientId:id,workerId:null,service:'Home support',start:new Date(Date.parse(start)+7200000).toISOString(),end:new Date(Date.parse(start)+10800000).toISOString(),status:'Open',revision:1}]});};
 try{await act(async()=>{root=create(React.createElement(SharedScheduleRead,{session,fetcher}));});
 for(const mode of ['Day','Week','Month']){await act(async()=>root.root.findAllByType('button').find(b=>b.props.children===mode).props.onClick());
 const buttons=root.root.findAllByType('button').filter(b=>JSON.stringify(b.props.children).includes('View visit details'));
 assert.equal(buttons.length,2);const names=buttons.map(b=>b.props['aria-label']);assert.notEqual(names[0],names[1]);
 for(const button of buttons){const text=button.parent.findAllByType('p').map(p=>p.props.children);assert.match(button.props['aria-label'],/^View visit details for Fictional client, /);assert(button.props['aria-label'].includes(text[1].join('')));}
 assert.match(names[0],/Fictional worker$/);assert.match(names[1],/Unassigned$/);assert(!names.some(name=>name.includes(id)));
 }
 }finally{if(root)await act(async()=>root.unmount());globalThis.window=old;}
});
