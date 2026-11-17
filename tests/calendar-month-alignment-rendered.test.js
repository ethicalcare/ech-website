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
test('rendered month aligns weekday columns without duplicated dates or visits',async()=>{
 globalThis.IS_REACT_ACT_ENVIRONMENT=true;const old=globalThis.window;globalThis.window=Object.assign(new EventTarget(),{confirm:()=>true});let root,calls=0;
 const actor='10000000-0000-4000-8000-000000000001',id='20000000-0000-4000-8000-000000000001';const session={authenticated:true,principal:{id:actor,operationalRole:'staff'},capabilities:[],operationsFeatures:{reads:true,scheduleCommands:false,scheduleRecurrence:false,visitActions:false}};
 const fetcher=async url=>{calls++;const from=new URL(url,'https://fixture.invalid').searchParams.get('from');return Response.json({schema:1,mode:'shared',clients:[{id,name:'Fixture'}],staff:[{id:actor,name:'Worker'}],visits:[{id,clientId:id,workerId:actor,service:'Home support',start:from,end:new Date(Date.parse(from)+3600000).toISOString(),status:'Assigned',revision:1}]});};
 const button=name=>root.root.findAllByType('button').find(n=>n.props.children===name);
 try{await act(async()=>{root=create(React.createElement(SharedScheduleRead,{session,fetcher}));});await act(async()=>root.root.findAllByType('input').find(n=>n.props.type==='date').props.onChange({currentTarget:{value:'2024-02-15'}}));const before=calls;await act(async()=>button('Month').props.onClick());assert.equal(calls,before);const headers=root.root.findAll(n=>n.props.className==='shared-schedule-calendar__weekday');assert.equal(headers.length,7);assert.equal(headers[0].props.children,'Sunday');assert.equal(headers[6].props.children,'Saturday');const days=root.root.findAll(n=>n.props.className==='shared-schedule-calendar__day');assert.equal(days.length,29);assert.equal(days[0].props.style.gridColumnStart,5);assert.equal(days[0].props['aria-label'],'2024-02-01');assert.equal(days.at(-1).props['aria-label'],'2024-02-29');assert.equal(root.root.findAllByType('button').filter(n=>JSON.stringify(n.props.children).includes('View visit details')).length,1);assert.match(JSON.stringify(days[0].findByType('h3').props.children),/Thursday/);await act(async()=>button('Week').props.onClick());assert.equal(root.root.findAll(n=>n.props.className==='shared-schedule-calendar__weekday').length,0);assert.equal(calls,before);
 }finally{if(root)await act(async()=>root.unmount());globalThis.window=old;}
});
