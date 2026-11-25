import {fixtureVisitStart} from './calendar-fixture-time.js';
import {reportUtcTime} from '../admin-src/app/shared/visit-time.ts';
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

test('today intent never clears dirty, pending or retained visit',async()=>{
 globalThis.IS_REACT_ACT_ENVIRONMENT=true;
 const actor='00000000-0000-4000-8000-000000000001', client='00000000-0000-4000-8000-000000000002', visit='00000000-0000-4000-8000-000000000003';
 const session={authenticated:true,principal:{id:actor,email:'fixture@example.invalid',operationalRole:'manager'},capabilities:[],operationsFeatures:{reads:true,scheduleCommands:false,scheduleRecurrence:false,visitActions:false}};
 const requests=[];const fetcher=(url,options)=>new Promise(resolve=>requests.push({url,options,resolve}));
 let root;try{
  await act(async()=>{root=create(React.createElement(SharedScheduleRead,{session,fetcher,todayRequest:0}));});
  const date=()=>root.root.findAllByType('input').find(node=>node.props.type==='date');
  await act(async()=>date().props.onChange({currentTarget:{value:'2020-01-02'}}));const request=requests.at(-1);const start='2020-01-02T20:00:00.000Z';
  await act(async()=>request.resolve(Response.json({schema:1,mode:'shared',clients:[{id:client,name:'Fictional client'}],staff:[],visits:[{id:visit,clientId:client,workerId:null,service:'Home support',start,end:new Date(Date.parse(start)+3600000).toISOString(),status:'Open',revision:1}]})));
  const button=root.root.findAllByType('button').find(node=>String(node.props['aria-label']||'').startsWith('View visit details for'));
  assert.ok(button);await act(async()=>button.props.onClick());
  const visitNode=()=>root.root.findAll(node=>typeof node.type==='function'&&node.type.name==='SharedVisitRead')[0];assert.ok(visitNode());
  let intent=0;for(const hold of [{dirty:true,pending:false},{dirty:false,pending:true},{dirty:false,pending:false,retained:true}]){
   await act(async()=>visitNode().props.onLeaveStateChange(hold));await act(async()=>root.update(React.createElement(SharedScheduleRead,{session,fetcher,todayRequest:++intent})));
   assert.equal(date().props.value,'2020-01-02');assert.ok(visitNode(),'visit remains mounted for held work');
  }
 }finally{if(root)await act(async()=>root.unmount());}
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

test('Admin Today shows only verified manager schedule attention totals and discards old-scope responses',async()=>{
 globalThis.IS_REACT_ACT_ENVIRONMENT=true;
 const keys=['window','document','requestAnimationFrame','cancelAnimationFrame','localStorage'];
 const prior=Object.fromEntries(keys.map(k=>[k,globalThis[k]]));
 const frames=new Map();let next=0;
 const location=new URL('https://fixture.invalid/admin?view=daily');
 const navigate=(state,_unused,target)=>{window.history.state=state;location.href=String(target);};
 globalThis.window=Object.assign(new EventTarget(),{location,history:{state:null,pushState:navigate,replaceState:navigate},setInterval:()=>1,clearInterval(){},scrollTo(){}});
 globalThis.document=Object.assign(new EventTarget(),{visibilityState:'visible',title:''});
 globalThis.localStorage={getItem:()=>null};
 globalThis.requestAnimationFrame=fn=>{frames.set(++next,fn);return next;};globalThis.cancelAnimationFrame=id=>frames.delete(id);
 const drain=async()=>{for(let i=0;i<3;i++)await act(async()=>{for(const [id,fn]of [...frames]){frames.delete(id);fn();}await new Promise(r=>setImmediate(r));});};
 const ids=[1,2,3,4,5,6,7,8,9].map(i=>'10000000-0000-4000-8000-00000000000'+i);
 const session=(id=ids[0],role='manager',reads=true)=>({authenticated:true,principal:{id,email:'fictional@example.invalid',operationalRole:role,technicalAdmin:false,applicationAdmin:false},capabilities:[role==='staff'?'leads.read_assigned':'leads.read_all'],operationsFeatures:{reads,scheduleCommands:false,scheduleRecurrence:false,visitActions:false}});
 let current=session(),root;
 const reads=[];
 const fetcher=async(url,options)=>{
  if(url==='/api/admin/session')return Response.json(current);
  if(['/api/admin/inquiries?limit=20','/api/admin/partners?limit=20'].includes(url))return Response.json({schema:1,mode:'shared',items:[],nextCursor:null});
  assert.match(url,/^\/api\/admin\/operations\?from=/);assert.equal(options.method,'GET');
  return new Promise(resolve=>reads.push({url,options,resolve}));
 };
 const payload=(req,statuses)=>{
  const query=new URL(req.url,location).searchParams,from=query.get('from');
  const begin=new Date(Date.parse(from)+3600000).toISOString(),end=new Date(Date.parse(begin)+3600000).toISOString();
  return {schema:1,mode:'shared',clients:statuses.length?[{id:ids[2],name:'Fictional protected client'}]:[],
   staff:statuses.some(s=>s!=='Open')?[{id:ids[3],name:'Fictional protected worker'}]:[],
   visits:statuses.map((status,i)=>({id:ids[i+4],clientId:ids[2],workerId:status==='Open'?null:ids[3],service:'Home support',start:begin,end,status,revision:1}))};
 };
 const mount=async()=>{await act(async()=>{root=create(React.createElement(AdminWorkspace,{fetcher}));});await drain();};
 const button=text=>root.root.findAllByType('button').find(b=>b.props.children===text);
 const click=async label=>{assert.ok(button(label),label);await act(async()=>button(label).props.onClick());await drain();};
 const card=()=>root.root.findAllByProps({'aria-label':'Today’s visits needing attention'})[0];
 const words=node=>typeof node==='string'?node:node.children.map(words).join(' ');
 const markup=()=>card()?words(card()):'';
 const resolve=async(req,statuses)=>act(async()=>req.resolve(Response.json(payload(req,statuses))));
 try{
  await mount();assert.equal(reads.length,1);
  const req=reads[0];assert.equal(req.options.headers['X-ECH-Schedule-Actor'],ids[0]);assert.equal(req.options.headers['X-ECH-Schedule-Role'],'manager');
  const q=new URL(req.url,location).searchParams;assert.deepEqual([...q.keys()],['from','to']);
  const day=new Intl.DateTimeFormat('en-CA',{timeZone:'America/Vancouver',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
  const next=new Date(Date.parse(day+'T00:00:00.000Z')+86400000).toISOString().slice(0,10);
  assert.deepEqual({from:q.get('from'),to:q.get('to')},{from:reportUtcTime(day+'T00:00'),to:reportUtcTime(next+'T00:00')});
  assert.match(markup(),/Checking the shared schedule/u);
  await resolve(req,['Open','Assigned','Confirmed','Completed','Cancelled']);
  assert.deepEqual(card().findAllByType('dd').map(n=>n.props.children),[1,1]);
  assert.doesNotMatch(markup(),/Fictional protected|report received|reports due/u);
  await click('Refresh today’s schedule');assert.equal(reads.length,2);assert.match(markup(),/Checking the shared schedule/u);assert.equal(card().findAllByType('dd').length,0);
  await act(async()=>reads[1].resolve(new Response(null,{status:403})));
  assert.match(markup(),/could not be verified/u);assert.doesNotMatch(markup(),/No visits are unassigned/u);
  await click('Refresh today’s schedule');await resolve(reads[2],[]);
  assert.match(markup(),/No visits are unassigned/u);
  await click('Refresh today’s schedule');const abandoned=reads[3];
  current=session(ids[1]);await click('Refresh account and records');
  assert.equal(abandoned.options.signal.aborted,true);assert.equal(reads[4].options.headers['X-ECH-Schedule-Actor'],ids[1]);
  await resolve(abandoned,['Open','Assigned']);assert.match(markup(),/Checking the shared schedule/u);
  await resolve(reads[4],[]);assert.match(markup(),/No visits are unassigned/u);
  await click('Open shared schedule');assert.equal(location.searchParams.get('view'),'operations');assert.equal(card(),undefined);
  assert.match(reads[5].url,/from=/u);
  for(const state of [session(ids[0],'owner'),session(ids[0],'manager',false),session(ids[0],'staff',false)]){
   await act(async()=>root.unmount());root=undefined;const count=reads.length;location.searchParams.set('view','daily');current=state;
   await mount();assert.equal(card(),undefined);assert.equal(reads.length,count);
  }
 }finally{
  if(root)await act(async()=>root.unmount());
  for(const [k,v]of Object.entries(prior)){if(v===undefined)delete globalThis[k];else globalThis[k]=v;}
 }
});
