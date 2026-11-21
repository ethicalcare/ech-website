import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {createRequire} from 'node:module';
import {fileURLToPath,pathToFileURL} from 'node:url';
import React from 'react';
import {create,act} from 'react-test-renderer';
const require=createRequire(import.meta.url);
const bundle=await build({entryPoints:[fileURLToPath(new URL('../admin-src/app/shared/AccessRequests.tsx',import.meta.url))],bundle:true,write:false,platform:'node',format:'esm',jsx:'automatic',plugins:[{name:'external-react',setup(b){b.onResolve({filter:/^react(?:\/.*)?$/},args=>({path:pathToFileURL(require.resolve(args.path)).href,external:true}));}}]});
const {AccessRequests,fingerprint}=await import('data:text/javascript;base64,'+Buffer.from(bundle.outputFiles[0].text).toString('base64'));
globalThis.IS_REACT_ACT_ENVIRONMENT=true;
const row={userId:'10000000-0000-4000-8000-000000000001',displayName:'Fictional account',email:'fictional@example.test',state:'pending',role:null,revision:1,requestedAt:'2026-11-17T12:00:00Z',decidedAt:null};
for (const unknownFirst of [true,false]) for (const laterStatus of [400,409,422]) test(`${unknownFirst?'unknown':'rejected'} first outcome after later ${laterStatus}`,async()=>{
 let root;const requests=[];const previousDocument=globalThis.document,previousHTMLElement=globalThis.HTMLElement;
 globalThis.document={activeElement:null};globalThis.HTMLElement=class {};
 const button=label=>root.root.findAllByType('button').find(n=>n.props.children===label);
 try {
  await act(async()=>{root=create(React.createElement(AccessRequests,{requests:{status:'ready',rows:[row]},reload:async()=>{},owner:true,fetcher:async(url,options)=>{requests.push(JSON.parse(options.body));if(unknownFirst && requests.length===1)throw Error('Fictional unknown outcome');return new Response(null,{status:laterStatus});}}));});
  await act(async()=>root.root.findByType('select').props.onChange({target:{value:'staff'}}));
  await act(async()=>button('Approve access').props.onClick());await act(async()=>button('Confirm action').props.onClick());
  await act(async()=>button('Retry same decision').props.onClick());
  assert.equal(Boolean(button('Clear rejected decision')),!unknownFirst);
  assert.match(JSON.stringify(root.toJSON()),unknownFirst?/Decision outcome unconfirmed/:/Rejected decision retained/);
  assert.deepEqual(requests[1],requests[0]);
 } finally {if(root)await act(async()=>root.unmount());globalThis.document=previousDocument;globalThis.HTMLElement=previousHTMLElement;}
});

for(const unknownFirst of [false,true]) test(`verified receipt clears uncertainty even if refresh fails (initial unknown=${unknownFirst})`,async()=>{
 let root, calls=0, reloads=0;const requests=[];let refreshed;const refreshReached=new Promise(resolve=>{refreshed=resolve;});
 const previousDocument=globalThis.document,previousHTMLElement=globalThis.HTMLElement;
 globalThis.document={activeElement:null};globalThis.HTMLElement=class {};
 const button=label=>root.root.findAllByType('button').find(n=>n.props.children===label);
 try {
  await act(async()=>{root=create(React.createElement(AccessRequests,{requests:{status:'ready',rows:[row]},reload:async()=>{reloads++;refreshed();if(unknownFirst)throw Error('Fictional refresh failed');return false;},owner:true,fetcher:async(url,options)=>{
   const body=JSON.parse(options.body);requests.push(body);calls++;
   if(unknownFirst&&calls===1)throw Error('Fictional unknown result');
   if(calls===(unknownFirst?2:1))return Response.json({schema:1,request:{...row,state:'approved',role:'staff',revision:2,decidedAt:'2026-11-18T00:00:00Z'},receipt:{operationId:body.operationId,expectedRevision:1,revision:2,commandFingerprint:await fingerprint(body)}});
   return new Response(null,{status:400});
  }}));});
  await act(async()=>root.root.findByType('select').props.onChange({target:{value:'staff'}}));
  await act(async()=>button('Approve access').props.onClick());await act(async()=>button('Confirm action').props.onClick());
  if(unknownFirst)await act(async()=>button('Retry same decision').props.onClick());
  await act(async()=>{await refreshReached;});
  assert.equal(reloads,1);assert.equal(button('Retry same decision'),undefined);
  assert.match(JSON.stringify(root.toJSON()),/decision was recorded, but current account status could not be refreshed/);
  await act(async()=>root.root.findByType('select').props.onChange({target:{value:'staff'}}));
  await act(async()=>button('Approve access').props.onClick());await act(async()=>button('Confirm action').props.onClick());
  assert.equal(Boolean(button('Clear rejected decision')),true);
  assert.notEqual(requests.at(-1).operationId,requests[0].operationId);
 } finally {if(root)await act(async()=>root.unmount());globalThis.document=previousDocument;globalThis.HTMLElement=previousHTMLElement;}
});
