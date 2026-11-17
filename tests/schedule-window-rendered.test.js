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
test('rendered schedule requests Vancouver week and keeps overnight dates after reload',async()=>{
 globalThis.IS_REACT_ACT_ENVIRONMENT=true;const previous=globalThis.window;globalThis.window=Object.assign(new EventTarget(),{confirm:()=>true});let root;const requests=[];
 const actor='10000000-0000-4000-8000-000000000001',id='20000000-0000-4000-8000-000000000001';
 const session={authenticated:true,principal:{id:actor,operationalRole:'staff'},capabilities:[],operationsFeatures:{reads:true,scheduleCommands:false,scheduleRecurrence:false,visitActions:false}};
 const fetcher=async url=>{const params=new URL(url,'https://fixture.invalid').searchParams;requests.push({from:params.get('from'),to:params.get('to')});const visits=params.get('from')==='2026-11-01T07:00:00.000Z'?[{id,clientId:id,workerId:actor,service:'Home support',start:'2026-11-18T06:30:00.000Z',end:'2026-11-18T07:30:00.000Z',status:'Assigned',revision:1}]:[];return Response.json({schema:1,mode:'shared',clients:[{id,name:'Fixture'}],staff:[{id:actor,name:'Worker'}],visits});};
 try{await act(async()=>{root=create(React.createElement(SharedScheduleRead,{session,fetcher}));});await act(async()=>root.root.findAllByType('input').find(node=>node.props.type==='date').props.onChange({currentTarget:{value:'2026-11-17'}}));assert.deepEqual(requests.at(-1),{from:'2026-11-01T07:00:00.000Z',to:'2026-12-13T07:00:00.000Z'});assert.match(JSON.stringify(root.toJSON()),/2026-11-17 23:30 Vancouver/);assert.match(JSON.stringify(root.toJSON()),/2026-11-18 00:30 Vancouver/);await act(async()=>root.root.findAllByType('button').find(b=>b.props.children==='Reload schedule').props.onClick());assert.deepEqual(requests.at(-1),requests.at(-2));assert.equal(root.root.findAllByType('input').find(node=>node.props.type==='date').props.value,'2026-11-17');assert.match(JSON.stringify(root.toJSON()),/2026-11-18 00:30 Vancouver/);
 }finally{if(root)await act(async()=>root.unmount());globalThis.window=previous;}
});
