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
const {ManagerTodayScheduleAttention}=await component('ManagerTodayScheduleAttention');
test('Today replaces yesterday’s verified schedule counts at Vancouver date rollover',async()=>{
 const NativeDate=globalThis.Date;
 const old={Date:NativeDate,window:globalThis.window,document:globalThis.document,IS_REACT_ACT_ENVIRONMENT:globalThis.IS_REACT_ACT_ENVIRONMENT};
 let now=NativeDate.parse('2026-07-22T06:59:30.000Z'),tick,cleared,root;
 globalThis.Date=class extends NativeDate{constructor(...args){super(...(args.length?args:[now]));}static now(){return now;}};
 globalThis.window=Object.assign(new EventTarget(),{setInterval(fn){tick=fn;return 4;},clearInterval(id){cleared=id;}});
 globalThis.document=Object.assign(new EventTarget(),{visibilityState:'visible'});globalThis.IS_REACT_ACT_ENVIRONMENT=true;
 const reads=[],fixture={schema:1,mode:'shared',staff:[],clients:[],visits:[]};
 const actor='10000000-0000-4000-8000-000000000001';
 const fetcher=(url,init)=>new Promise(resolve=>reads.push({url,init,resolve}));
 const markup=()=>JSON.stringify(root.toJSON());
 const from=i=>new URL(reads[i].url,'https://fictional.invalid').searchParams.get('from');
 try{
  await act(async()=>{root=create(React.createElement(ManagerTodayScheduleAttention,{actor,fetcher,onOpenSchedule(){}}));});
  assert.equal(from(0),'2026-07-21T07:00:00.000Z');
  await act(async()=>reads[0].resolve(Response.json(fixture)));
  assert.match(markup(),/No visits are unassigned/u);
  await act(async()=>window.dispatchEvent(new Event('focus')));
  assert.equal(reads.length,1);
  now=NativeDate.parse('2026-07-22T07:00:05.000Z');
  document.visibilityState='hidden';await act(async()=>tick?.());assert.equal(reads.length,1);
  document.visibilityState='visible';await act(async()=>document.dispatchEvent(new Event('visibilitychange')));
  assert.equal(reads.length,2);
  assert.equal(from(1),'2026-07-22T07:00:00.000Z');
  assert.match(markup(),/Checking the shared schedule/u);
  assert.doesNotMatch(markup(),/No visits are unassigned/u);
  await act(async()=>reads[1].resolve(Response.json(fixture)));
  assert.match(markup(),/No visits are unassigned/u);
  await act(async()=>tick?.());assert.equal(reads.length,2);
  now=NativeDate.parse('2026-07-23T07:00:05.000Z');
  await act(async()=>tick?.());assert.equal(from(2),'2026-07-23T07:00:00.000Z');
  assert.doesNotMatch(markup(),/No visits are unassigned/u);
  await act(async()=>root.unmount());root=undefined;
  assert.equal(cleared,4);assert.equal(reads[2].init.signal.aborted,true);
 }finally{
  if(root)await act(async()=>root.unmount());
  for(const [key,value] of Object.entries(old)){if(value===undefined)delete globalThis[key];else globalThis[key]=value;}
 }
});
