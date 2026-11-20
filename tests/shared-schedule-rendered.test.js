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
test('rendered shared schedule fences requests and protected rows across session transitions',async()=>{
 globalThis.IS_REACT_ACT_ENVIRONMENT=true;
const id='00000000-0000-4000-8000-000000000001',other='00000000-0000-4000-8000-000000000002';
const session=(actor=id,role='manager',reads=true)=>({authenticated:true,principal:{id:actor,email:'fixture@example.invalid',operationalRole:role,technicalAdmin:false,applicationAdmin:false},capabilities:[],operationsFeatures:{reads,scheduleCommands:false,scheduleRecurrence:false,visitActions:false}});
const pending=[];
const fetcher=(url,options)=>new Promise(resolve=>pending.push({url,options,resolve}));
const element=s=>React.createElement(SharedScheduleRead,{session:s,fetcher});
const payload=request=>{const from=fixtureVisitStart(request.url);return {schema:1,mode:'shared',clients:[{id:other,name:'Protected fixture name'}],staff:[],visits:[{id,clientId:other,workerId:null,service:'Home support',start:from,end:new Date(Date.parse(from)+3600000).toISOString(),status:'Open',revision:1}]};};
let root;await act(async()=>{root=create(element(null));});
assert.equal(pending.length,0);assert.equal(root.toJSON(),null);
await act(async()=>root.update(element(session(id,'manager',false))));assert.equal(pending.length,0);
await act(async()=>root.update(element(session())));assert.equal(pending.length,1);
assert.equal(pending[0].options.headers['X-ECH-Schedule-Actor'],id);
await act(async()=>pending[0].resolve(Response.json(payload(pending[0]))));assert.match(JSON.stringify(root.toJSON()),/Protected fixture name/);
await act(async()=>root.update(element(session(other))));assert.equal(pending.length,2);assert.doesNotMatch(JSON.stringify(root.toJSON()),/Protected fixture name/);assert.equal(pending[0].options.signal.aborted,true);
const old=pending[1];await act(async()=>root.update(element(session(other,'owner'))));assert.equal(pending.length,3);assert.equal(old.options.signal.aborted,true);
await act(async()=>old.resolve(Response.json(payload(old))));assert.doesNotMatch(JSON.stringify(root.toJSON()),/Protected fixture name/);
await act(async()=>root.update(element(session(other,'owner',false))));assert.equal(root.toJSON(),null);assert.equal(pending[2].options.signal.aborted,true);
await act(async()=>pending[2].resolve(Response.json(payload(pending[2]))));assert.equal(root.toJSON(),null);
await act(async()=>root.update(element(session())));const last=pending.at(-1);
await act(async()=>root.unmount());assert.equal(last.options.signal.aborted,true);
await act(async()=>last.resolve(Response.json(payload(last))));assert.equal(root.toJSON(),null);

});

const {AdminWorkspace}=await component('AdminWorkspace');
test('rendered workspace removes prior schedule before awaiting changed-account records',async()=>{
 const saved=Object.fromEntries(['window','document','requestAnimationFrame','cancelAnimationFrame','localStorage'].map(k=>[k,globalThis[k]]));
 const callbacks=new Map();let nextFrame=0;
 globalThis.window=Object.assign(new EventTarget(),{location:new URL('https://fixture.invalid/admin?view=operations'),setInterval:()=>1,clearInterval(){},scrollTo(){}});
 globalThis.document=Object.assign(new EventTarget(),{visibilityState:'visible',title:''});
 globalThis.localStorage={getItem:()=>null};
 globalThis.requestAnimationFrame=fn=>{const id=++nextFrame;callbacks.set(id,fn);return id;};globalThis.cancelAnimationFrame=id=>callbacks.delete(id);
 const drain=async()=>{await act(async()=>{for(const [id,fn] of [...callbacks]){callbacks.delete(id);fn();}await new Promise(r=>setImmediate(r));});};
 const id='00000000-0000-4000-8000-000000000001',other='00000000-0000-4000-8000-000000000002';
 const session=actor=>({authenticated:true,principal:{id:actor,email:'fixture@example.invalid',technicalAdmin:false,applicationAdmin:false,operationalRole:'manager'},capabilities:['leads.read_all'],operationsFeatures:{reads:true,scheduleCommands:false,scheduleRecurrence:false,visitActions:false}});
 let current=session(id),hold=false;const pending=[];const schedule=[];
 const fetcher=async(url,options)=>{
  if(url==='/api/admin/session')return Response.json(current);
  if(url.startsWith('/api/admin/operations?'))return new Promise(resolve=>schedule.push({url,options,resolve}));
  if(url.startsWith('/api/admin/inquiries?')||url.startsWith('/api/admin/partners?')){
   if(hold)return new Promise(resolve=>pending.push(resolve));
   return Response.json({schema:1,mode:'shared',items:[],nextCursor:null});
  }
  throw new Error('Unexpected request '+url);
 };
 let root;
 try{
  await act(async()=>{root=create(React.createElement(AdminWorkspace,{fetcher}));});await drain();await drain();
  assert.equal(schedule.length,1);
  await act(async()=>schedule[0].resolve(Response.json({schema:1,mode:'shared',clients:[],staff:[],visits:[]})));
  assert.match(JSON.stringify(root.toJSON()),/No visits returned/);
  current=session(other);hold=true;
  const button=root.root.findAllByType('button').find(b=>b.props.children==='Refresh account and records');
  await act(async()=>{button.props.onClick();await new Promise(r=>setImmediate(r));});
  assert.equal(pending.length,2);
  assert.doesNotMatch(JSON.stringify(root.toJSON()),/Shared visit schedule|No visits returned/);
  assert.equal(schedule[0].options.signal.aborted,true);
  await act(async()=>pending.forEach(resolve=>resolve(Response.json({schema:1,mode:'shared',items:[],nextCursor:null}))));await drain();
  assert.equal(schedule.length,2);assert.equal(schedule[1].options.headers['X-ECH-Schedule-Actor'],other);
  assert.doesNotMatch(JSON.stringify(root.toJSON()),/No visits returned/);
 }finally{
  if(root)await act(async()=>root.unmount());
  for(const [key,value]of Object.entries(saved)){if(value===undefined)delete globalThis[key];else globalThis[key]=value;}
 }
});

test('rendered schedule clears rows on reload/date change and never renders malformed/error replies',async()=>{
 const actor='00000000-0000-4000-8000-000000000001';
 const session={authenticated:true,principal:{id:actor,email:'fixture@example.invalid',operationalRole:'owner'},capabilities:[],operationsFeatures:{reads:true,scheduleCommands:false,scheduleRecurrence:false,visitActions:false}};
 const requests=[];const fetcher=(url,options)=>new Promise(resolve=>requests.push({url,options,resolve}));
 let root;
 try{
  await act(async()=>{root=create(React.createElement(SharedScheduleRead,{session,fetcher}));});
  await act(async()=>requests[0].resolve(Response.json({schema:1,mode:'shared',clients:[],staff:[],visits:[]})));
  assert.match(JSON.stringify(root.toJSON()),/No visits returned/);
  await act(async()=>root.root.findAllByType('button').find(node=>node.props.children==='Reload schedule').props.onClick());
  assert.doesNotMatch(JSON.stringify(root.toJSON()),/No visits returned/);
  assert.equal(requests[0].options.signal.aborted,true);
  const dateInput=root.root.findAllByType('input').find(node=>node.props.type==='date');
  const differentDate=dateInput.props.value==='2026-11-20'?'2026-11-21':'2026-11-20';
  await act(async()=>dateInput.props.onChange({currentTarget:{value:differentDate}}));
  assert.equal(requests[1].options.signal.aborted,true);
  await act(async()=>requests[1].resolve(Response.json({schema:1,mode:'shared',clients:[],staff:[],visits:[]})));
  assert.doesNotMatch(JSON.stringify(root.toJSON()),/No visits returned/);
  assert.match(requests[2].url,/from=2026-11-01/);
  await act(async()=>requests[2].resolve(Response.json({schema:1,mode:'shared',clients:[],staff:[],visits:[],untrusted:'provider secret'})));
  assert.match(JSON.stringify(root.toJSON()),/could not be verified/);assert.doesNotMatch(JSON.stringify(root.toJSON()),/provider secret/);
  await act(async()=>root.root.findAllByType('button').find(node=>node.props.children==='Reload schedule').props.onClick());
  await act(async()=>requests[3].resolve(Response.json({error:'provider secret'},{status:403})));
  assert.match(JSON.stringify(root.toJSON()),/could not be verified/);assert.doesNotMatch(JSON.stringify(root.toJSON()),/provider secret/);
  await act(async()=>root.root.findAllByType('input').find(node=>node.props.type==='date').props.onChange({currentTarget:{value:''}}));
  assert.equal(requests.length,4);assert.match(JSON.stringify(root.toJSON()),/Choose a valid date/);
 }finally{if(root)await act(async()=>root.unmount());}
});
