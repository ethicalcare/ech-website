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

const {VisitAttendance}=await component('VisitAttendance');
test('assigned staff records arrival and departure, manager sees recorded times or factual follow-up',async()=>{
 globalThis.IS_REACT_ACT_ENVIRONMENT=true;
 let root, role='staff';
 const visit={id:'20000000-0000-4000-8000-000000000001',revision:3,workerId:'worker',
   start:'2026-11-18T17:00:00.000Z',end:'2026-11-18T18:00:00.000Z',status:'Confirmed'};
 const data={visitId:visit.id,revision:3,observedAt:'2026-11-18T18:10:00.000Z',checkInAt:null,checkOutAt:null};
 const fetcher=async(url,options)=>{
   assert.equal(options.headers['X-ECH-Schedule-Role'],role);
   if(options.method==='POST'){
     assert.equal(role,'staff');assert.equal(url,'/api/admin/operations?attendance=1');
     const {action,visitId,revision}=JSON.parse(options.body);
     assert.equal(visitId,visit.id);assert.equal(revision,3);
     if(action==='check_in')data.checkInAt='2026-11-18T17:10:00.000Z';
     else if(action==='check_out')data.checkOutAt='2026-11-18T18:05:00.000Z';
     else throw new Error('Unexpected action');
   } else assert.match(url,/attendance=.*&revision=3/u);
   return Response.json(data);
 };
 const view=()=>React.createElement(VisitAttendance,{visit,actor:'fictional',role,fetcher});
 const buttons=()=>root.root.findAllByType('button');
 const text=()=>JSON.stringify(root.toJSON());
 try {
   await act(async()=>{root=create(view());});assert.equal(buttons()[0].props.children,'Check in');
   await act(async()=>buttons()[0].props.onClick());assert.equal(buttons()[0].props.children,'Check out');
   await act(async()=>buttons()[0].props.onClick());assert.equal(buttons().length,0);
   role='manager';await act(async()=>root.update(view()));
   assert.match(text(),/11:05 Vancouver/u);assert.match(text(),/recorded after the scheduled start/u);assert.equal(buttons().length,0);
   data.checkInAt=null;data.checkOutAt=null;
   await act(async()=>root.unmount());await act(async()=>{root=create(view());});
   assert.match(text(),/scheduled visit ended without a recorded check-in/u);
 } finally {await act(async()=>root?.unmount());delete globalThis.IS_REACT_ACT_ENVIRONMENT;}
});
