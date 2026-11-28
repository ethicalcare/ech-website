import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {createRequire} from 'node:module';
import {fileURLToPath,pathToFileURL} from 'node:url';
import React from 'react';
import {create,act} from 'react-test-renderer';

const require=createRequire(import.meta.url);
const bundle=await build({entryPoints:[fileURLToPath(new URL('../admin-src/app/shared/ManagerTodayScheduleAttention.tsx',import.meta.url))],bundle:true,write:false,platform:'node',format:'esm',jsx:'automatic',plugins:[{name:'external-react',setup(b){b.onResolve({filter:/^react(?:\/.*)?$/},args=>({path:pathToFileURL(require.resolve(args.path)).href,external:true}));}}]});
const {ManagerTodayScheduleAttention}=await import('data:text/javascript;base64,'+Buffer.from(bundle.outputFiles[0].text).toString('base64'));
const before='2026-11-21T06:59:59.000Z', midnight='2026-11-21T07:00:00.000Z', eight='2026-11-21T08:00:00.000Z';
const windows={
 '2026-11-20':{from:'2026-11-20T07:00:00.000Z',to:'2026-11-21T07:00:00.000Z'},
 '2026-11-21':{from:'2026-11-21T07:00:00.000Z',to:'2026-11-22T07:00:00.000Z'},
};
async function fixture(start,exercise){
 const saved={Date:globalThis.Date,window:globalThis.window,document:globalThis.document,act:globalThis.IS_REACT_ACT_ENVIRONMENT};
 const RealDate=Date;let now=start,tick,root;const requests=[];
 globalThis.Date=class extends RealDate {constructor(...args){super(...(args.length?args:[now]));}static now(){return RealDate.parse(now);}};
 globalThis.window=Object.assign(new EventTarget(),{setInterval(fn,ms){assert.equal(ms,60000);tick=fn;return 1;},clearInterval(){}});
 globalThis.document=Object.assign(new EventTarget(),{visibilityState:'visible'});
 globalThis.IS_REACT_ACT_ENVIRONMENT=true;
 const fetcher=async(url,options)=>{const q=new URL(url,'https://fixture.invalid').searchParams;requests.push({method:options.method,from:q.get('from'),to:q.get('to')});return Response.json({schema:1,mode:'shared',clients:[],staff:[],visits:[]});};
 const view={requests,setTime(value){now=value;},async tick(){await act(async()=>tick());},async focus(){await act(async()=>window.dispatchEvent(new Event('focus')));},async refresh(){await act(async()=>root.root.findAllByType('button').find(b=>b.props.children==='Refresh today’s schedule').props.onClick());},check(day,count){assert.equal(requests.length,count,'request count');assert.deepEqual(requests.at(-1),{method:'GET',...windows[day]});assert.ok(root.root.findAllByType('p').some(p=>p.children.join('')==='No visits scheduled today.'),'rendered empty schedule');}};
 try{await act(async()=>{root=create(React.createElement(ManagerTodayScheduleAttention,{role:'manager',actor:'00000000-0000-4000-8000-000000000001',fetcher,onOpenSchedule(){}}));});await exercise(view);}
 finally{if(root)await act(async()=>root.unmount());globalThis.Date=saved.Date;for(const key of ['window','document']){if(saved[key]===undefined)delete globalThis[key];else globalThis[key]=saved[key];}if(saved.act===undefined)delete globalThis.IS_REACT_ACT_ENVIRONMENT;else globalThis.IS_REACT_ACT_ENVIRONMENT=saved.act;}
}
test('Today mounts on the correct Vancouver day before and at midnight',async()=>{
 await fixture(before,async f=>f.check('2026-11-20',1));
 await fixture(midnight,async f=>f.check('2026-11-21',1));
});
test('an open Today rolls over at 07:00 and does not roll over again at 08:00',async()=>{
 await fixture(before,async f=>{f.check('2026-11-20',1);f.setTime(midnight);await f.tick();f.check('2026-11-21',2);f.setTime(eight);await f.tick();f.check('2026-11-21',2);});
});
test('focus catches a suspended Today at midnight without another rollover at 08:00',async()=>{
 await fixture(before,async f=>{f.setTime(midnight);await f.focus();f.check('2026-11-21',2);f.setTime(eight);await f.focus();f.check('2026-11-21',2);});
});
test('manual refresh selects the current calendar day after midnight',async()=>{
 await fixture(before,async f=>{f.setTime(midnight);await f.refresh();f.check('2026-11-21',2);});
});
