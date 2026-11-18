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
const row={userId:'10000000-0000-4000-8000-000000000001',displayName:'Fictional account',email:'fictional@example.test',state:'pending',role:null,revision:1,requestedAt:'2026-11-17T12:00:00Z',decidedAt:null};
for (const choice of ['partner','manager','staff']) test(`retained ${choice} decision faithfully describes delegation and retries exact request`,async()=>{
 let root;const requests=[];const previousDocument=globalThis.document,previousHTMLElement=globalThis.HTMLElement;
 globalThis.document={activeElement:null};globalThis.HTMLElement=class {};
 const button=label=>root.root.findAllByType('button').find(n=>n.props.children===label);
 try {
  await act(async()=>{root=create(React.createElement(AccessRequests,{requests:{status:'ready',rows:[row]},reload:async()=>{},owner:true,fetcher:async(url,options)=>{requests.push(JSON.parse(options.body));throw Error('Fictional unknown outcome');}}));});
  await act(async()=>root.root.findByType('select').props.onChange({target:{value:choice}}));
  await act(async()=>button('Approve access').props.onClick());
  await act(async()=>button('Confirm action').props.onClick());
  assert.equal(requests.length,1);
  const retained=root.root.findByType('aside').findAllByType('p').map(p=>p.props.children).flat(Infinity).filter(x=>typeof x==='string').join(' ');
  assert.equal(retained.includes('can manage staff and managers'),choice==='partner');
  assert.equal(requests[0].command.role,choice==='staff'?'staff':'manager');
  assert.equal(requests[0].command.delegatedUserAdmin,choice==='staff'?undefined:choice==='partner');
  await act(async()=>button('Retry same decision').props.onClick());
  assert.equal(requests.length,2);assert.deepEqual(requests[1],requests[0]);
 } finally {if(root)await act(async()=>root.unmount());globalThis.document=previousDocument;globalThis.HTMLElement=previousHTMLElement;}
});
