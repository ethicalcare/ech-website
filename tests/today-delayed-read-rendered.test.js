import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {createRequire} from 'node:module';
import {fileURLToPath,pathToFileURL} from 'node:url';
import React from 'react';
import {create,act} from 'react-test-renderer';
const require=createRequire(import.meta.url);
const bundle=await build({entryPoints:[fileURLToPath(new URL('../admin-src/app/shared/ManagerTodayScheduleAttention.tsx',import.meta.url))],bundle:true,write:false,platform:'node',format:'esm',jsx:'automatic',plugins:[{name:'react',setup(b){b.onResolve({filter:/^react(?:\/.*)?$/},a=>({path:pathToFileURL(require.resolve(a.path)).href,external:true}));}}]});
const {ManagerTodayScheduleAttention}=await import('data:text/javascript;base64,'+Buffer.from(bundle.outputFiles[0].text).toString('base64'));
test('delayed schedule read labels the actual interval at receipt time',async()=>{
 const saved={Date:globalThis.Date,window:globalThis.window,document:globalThis.document,act:globalThis.IS_REACT_ACT_ENVIRONMENT};const RealDate=Date;let now='2025-11-02T08:00:00.000Z',resolve,root;
 globalThis.Date=class extends RealDate{constructor(...args){super(...(args.length?args:[now]));}static now(){return RealDate.parse(now);}};
 globalThis.window=Object.assign(new EventTarget(),{setInterval(){return 1;},clearInterval(){}});globalThis.document=Object.assign(new EventTarget(),{visibilityState:'visible'});globalThis.IS_REACT_ACT_ENVIRONMENT=true;
 const client='20000000-0000-4000-8000-000000000001';const fetcher=()=>new Promise(r=>{resolve=r;});
 try{await act(async()=>{root=create(React.createElement(ManagerTodayScheduleAttention,{actor:'10000000-0000-4000-8000-000000000001',fetcher,onOpenSchedule(){},onMobileOpenSchedule(){}}));});
 now='2025-11-02T08:35:00.000Z';await act(async()=>{resolve(Response.json({schema:1,mode:'shared',clients:[{id:client,name:'Fictional'}],staff:[],visits:[{id:'30000000-0000-4000-8000-000000000001',clientId:client,workerId:null,service:'Home support',start:'2025-11-02T08:30:00.000Z',end:'2025-11-02T09:30:00.000Z',status:'Open',revision:1}]}));});
 const text=JSON.stringify(root.toJSON());assert.match(text,/Active now/);assert.doesNotMatch(text,/Later/);
 }finally{if(root)await act(async()=>root.unmount());globalThis.Date=saved.Date;for(const key of ['window','document']){if(saved[key]===undefined)delete globalThis[key];else globalThis[key]=saved[key];}if(saved.act===undefined)delete globalThis.IS_REACT_ACT_ENVIRONMENT;else globalThis.IS_REACT_ACT_ENVIRONMENT=saved.act;}
});
