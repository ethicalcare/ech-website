import test from 'node:test';import assert from 'node:assert/strict';import {build} from 'esbuild';import {createRequire} from 'node:module';import {fileURLToPath,pathToFileURL} from 'node:url';import React from 'react';import {create,act} from 'react-test-renderer';
const require=createRequire(import.meta.url),bundle=await build({entryPoints:[fileURLToPath(new URL('../admin-src/app/shared/RecordEditor.tsx',import.meta.url))],bundle:true,write:false,platform:'node',format:'esm',jsx:'automatic',plugins:[{name:'react',setup(b){b.onResolve({filter:/^react(?:\/.*)?$/},a=>({path:pathToFileURL(require.resolve(a.path)).href,external:true}));}}]});const {RecordEditor}=await import('data:text/javascript;base64,'+Buffer.from(bundle.outputFiles[0].text).toString('base64'));globalThis.IS_REACT_ACT_ENVIRONMENT=true;

test('record history stays loading until confirmed and rejects old initial and pagination responses',async()=>{
 const old={raf:globalThis.requestAnimationFrame,caf:globalThis.cancelAnimationFrame};let id=0;const frames=new Map();globalThis.requestAnimationFrame=fn=>{frames.set(++id,fn);return id;};globalThis.cancelAnimationFrame=id=>frames.delete(id);
 const flush=async()=>act(async()=>{const jobs=[...frames.values()];frames.clear();jobs.forEach(fn=>fn());});
 const pending=[];const repository={history:(id,cursor)=>new Promise((resolve,reject)=>pending.push({id,cursor,resolve,reject}))};
 const record=id=>({id,revision:1,name:'Fictional '+id,ownerId:null,updatedAt:'2026-11-01T12:00:00Z'});
 const session={authenticated:true,principal:{id:'viewer'},capabilities:[]};
 const props={kind:'inquiry',createId:'new',session,assignees:[],partners:[],partnerRepository:repository,onPartnerSaved(){},onCreatePartner:async()=>null,repository,drafts:new Map(),onSaved(){},onReload:async()=>undefined,onClose(){}};
 const entry=(id,note)=>({id,action:'record_note',at:'2026-11-01T12:00:00Z',actorLabel:'Fictional author',details:{note}});
 let root;const text=()=>JSON.stringify(root.toJSON());
 try{
  await act(async()=>{root=create(React.createElement(RecordEditor,{...props,record:record('A')}));});
  assert(text().includes('Checking saved activity history'));assert(!text().includes('No activity returned'));
  await flush();
  await act(async()=>root.update(React.createElement(RecordEditor,{...props,record:record('B')})));await flush();
  await act(async()=>pending[0].resolve({items:[entry('a','OLD A')],nextCursor:null}));assert(!text().includes('OLD A'));assert(!text().includes('No activity returned'));
  await act(async()=>pending[1].resolve({items:[entry('b','CURRENT B')],nextCursor:2}));assert(text().includes('CURRENT B'));
  const more=root.root.findAllByType('button').find(n=>n.props.children==='Load more saved history');
  let page;await act(async()=>{page=more.props.onClick();more.props.onClick();});assert.equal(pending.length,3);
  await act(async()=>root.update(React.createElement(RecordEditor,{...props,record:record('C')})));assert(!text().includes('CURRENT B'));await flush();
  await act(async()=>pending[3].resolve({items:[],nextCursor:null}));assert(text().includes('No activity returned'));
  await act(async()=>{pending[2].resolve({items:[entry('b2','OLD PAGE B')],nextCursor:null});await page;});assert(!text().includes('OLD PAGE B'));assert(text().includes('No activity returned'));
  await act(async()=>root.update(React.createElement(RecordEditor,{...props,record:record('D')})));await flush();await act(async()=>pending[4].reject(new Error('unavailable')));assert(text().includes('Saved history could not be verified'));assert(!text().includes('No activity returned'));assert(!text().includes('Checking saved activity history'));
 }finally{if(root)await act(async()=>root.unmount());globalThis.requestAnimationFrame=old.raf;globalThis.cancelAnimationFrame=old.caf;}
});
