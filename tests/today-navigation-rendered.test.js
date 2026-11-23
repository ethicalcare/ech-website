import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {createRequire} from 'node:module';
import {fileURLToPath,pathToFileURL} from 'node:url';
import React from 'react';
import {create,act} from 'react-test-renderer';
const require=createRequire(import.meta.url);
const bundle=await build({entryPoints:[fileURLToPath(new URL('../admin-src/app/shared/AdminWorkspace.tsx',import.meta.url))],bundle:true,write:false,platform:'node',format:'esm',jsx:'automatic',loader:{'.css':'empty'},plugins:[{name:'external-react',setup(b){b.onResolve({filter:/^react(?:\/.*)?$/},args=>({path:pathToFileURL(require.resolve(args.path)).href,external:true}));}}]});
const {AdminWorkspace}=await import('data:text/javascript;base64,'+Buffer.from(bundle.outputFiles[0].text).toString('base64'));
test('rendered shortcut from Today and Schedule consumes intended UUID and invalidation fences pending frame',async()=>{
 globalThis.IS_REACT_ACT_ENVIRONMENT=true;
 const keys=['window','document','requestAnimationFrame','cancelAnimationFrame','localStorage','crypto'];const saved=Object.fromEntries(keys.map(k=>[k,globalThis[k]]));
 const frames=new Map();let next=0;const location=new URL('https://fixture.invalid/admin?view=daily');const id='70000000-0000-4000-8000-000000000001';
 const nav=(state,unused,target)=>{window.history.state=state;location.href=String(target);};
 globalThis.window=Object.assign(new EventTarget(),{location,history:{state:null,pushState:nav,replaceState:nav},setInterval:()=>1,clearInterval(){},scrollTo(){},matchMedia:()=>Object.assign(new EventTarget(),{matches:false})});
 globalThis.document=Object.assign(new EventTarget(),{visibilityState:'visible',title:'',body:{style:{overflow:''}},getElementById:()=>null});globalThis.localStorage={getItem:()=>null};
 Object.defineProperty(globalThis,'crypto',{configurable:true,value:{randomUUID:()=>id}});
 globalThis.requestAnimationFrame=fn=>{frames.set(++next,fn);return next;};globalThis.cancelAnimationFrame=n=>frames.delete(n);
 const drain=async()=>{for(let n=0;n<4;n++)await act(async()=>{for(const [i,fn]of [...frames]){frames.delete(i);fn();}await new Promise(r=>setImmediate(r));});};
 const manager={authenticated:true,principal:{id:'10000000-0000-4000-8000-000000000001',email:'fictional@example.invalid',operationalRole:'manager',technicalAdmin:false,applicationAdmin:false},capabilities:['leads.read_all','leads.create'],operationsFeatures:{reads:true,scheduleCommands:false,scheduleRecurrence:false,visitActions:false}};
 let deny=false,root;const fetcher=async url=>{if(url==='/api/admin/session')return deny?new Response(null,{status:403}):Response.json(manager);if(url.startsWith('/api/admin/inquiries?')||url.startsWith('/api/admin/partners?'))return Response.json({schema:1,mode:'shared',items:[],nextCursor:null});if(url.startsWith('/api/admin/operations?'))return Response.json({schema:1,mode:'shared',visits:[],clients:[],staff:[]});throw Error('unexpected '+url);};
 const shortcut=()=>root.root.findByProps({className:'mobile-add-button'});const choose=()=>root.root.findByProps({id:'mobile-add-menu'}).findAllByType('button').find(b=>b.props.children==='Record New Inquiry');const editor=()=>root.root.findAll(n=>typeof n.type==='function'&&n.type.name==='RecordEditor')[0];
 try{for(const view of ['daily','operations']){
  location.searchParams.set('view',view);await act(async()=>{root=create(React.createElement(AdminWorkspace,{fetcher}));});await drain();
  await act(async()=>shortcut().props.onClick());await act(async()=>choose().props.onClick());await drain();assert.ok(editor());assert.equal(editor().props.createId,id);
  await act(async()=>root.unmount());root=undefined;
 }
 location.searchParams.set('view','daily');await act(async()=>{root=create(React.createElement(AdminWorkspace,{fetcher}));});await drain();
 await act(async()=>shortcut().props.onClick());await act(async()=>choose().props.onClick());assert.equal(location.searchParams.get('view'),'leads');deny=true;
 const refresh=root.root.findAllByType('button').find(b=>b.props.children==='Refresh account and records');await act(async()=>{refresh.props.onClick();await new Promise(r=>setImmediate(r));});await drain();assert.equal(editor(),undefined);assert.match(JSON.stringify(root.toJSON()),/Session or record access is unverified/);
 deny=false;const reload=root.root.findAllByType('button').find(b=>b.props.children==='Reload account status');await act(async()=>{reload.props.onClick();await new Promise(r=>setImmediate(r));});await drain();assert.equal(editor(),undefined,'reauthentication must not consume the abandoned pending ID');
 }finally{if(root)await act(async()=>root.unmount());for(const [k,v] of Object.entries(saved)){if(v===undefined)delete globalThis[k];else Object.defineProperty(globalThis,k,{configurable:true,writable:true,value:v});}}
});
