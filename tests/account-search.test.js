import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {createRequire} from 'node:module';
import {fileURLToPath,pathToFileURL} from 'node:url';
import React from 'react';
import {create,act} from 'react-test-renderer';
const require=createRequire(import.meta.url);
const bundle=await build({entryPoints:[fileURLToPath(new URL('../admin-src/app/shared/AccessRequests.tsx',import.meta.url))],bundle:true,write:false,platform:'node',format:'esm',jsx:'automatic',plugins:[{name:'external-react',setup(b){b.onResolve({filter:/^react(?:\/.*)?$/},args=>({path:pathToFileURL(require.resolve(args.path)).href,external:true}));}}]});
const {AccessRequests}=await import('data:text/javascript;base64,'+Buffer.from(bundle.outputFiles[0].text).toString('base64'));
globalThis.IS_REACT_ACT_ENVIRONMENT=true;
const rows=[
 {userId:'one',displayName:'Sam Chen',email:'sam@example.test',state:'pending',role:null,revision:1,requestedAt:'2026-11-17T12:00:00Z',decidedAt:null},
 {userId:'two',displayName:'SAM Chen',email:'other@example.test',state:'approved',role:'staff',revision:2,requestedAt:'2026-11-17T12:00:00Z',decidedAt:null},
 {userId:'three',displayName:'Leah',email:'leah@example.test',state:'pending',role:null,revision:1,requestedAt:'2026-11-17T12:00:00Z',decidedAt:null},
];
test('account search filters loaded signup and reviewed rows without writes; clearing preserves selected role',async()=>{
 let root,calls=0;
 const props={requests:{status:'ready',rows},reload:async()=>{calls++;},owner:true,fetcher:async()=>{calls++;throw new Error('Search must not fetch');}};
 const cards=()=>root.root.findAllByType('article');
 const text=()=>JSON.stringify(root.toJSON());
 const search=async value=>act(async()=>root.root.findByType('input').props.onChange({target:{value}}));
 try {
  await act(async()=>{root=create(React.createElement(AccessRequests,props));});
  const input=root.root.findByType('input');
  assert.equal(root.root.findAllByType('label').some(n=>n.props.htmlFor===input.props.id),true);
  await act(async()=>cards()[0].findByType('select').props.onChange({target:{value:'staff'}}));
  await search('  sAm  ');assert.equal(cards().length,2);assert.match(text(),/1 of 2 loaded pending/);
  await search('OTHER@EXAMPLE');assert.equal(cards().length,1);assert.match(text(),/No pending signup requests match/);
  await search('absent');assert.equal(cards().length,0);assert.match(text(),/No reviewed accounts match/);
  assert.doesNotMatch(text(),/No requests have been reviewed yet/);
  await act(async()=>root.root.findAllByType('button').find(n=>n.props.children==='Clear account search').props.onClick());
  assert.equal(cards().length,3);assert.equal(cards()[0].findByType('select').props.value,'staff');assert.equal(calls,0);
  await search('sam');
  await act(async()=>root.update(React.createElement(AccessRequests,{...props,requests:{status:'loading'}})));
  assert.equal(cards().length,0);assert.doesNotMatch(text(),/sam@example.test|other@example.test|leah@example.test|loaded reviewed/);assert.match(text(),/Checking signup requests/);
  await act(async()=>root.update(React.createElement(AccessRequests,{...props,requests:{status:'unavailable'}})));
  assert.equal(cards().length,0);assert.doesNotMatch(text(),/loaded reviewed/);assert.match(text(),/Signup requests are unavailable/);
 } finally {if(root)await act(async()=>root.unmount());}
});
