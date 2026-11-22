import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {createRequire} from 'node:module';
import {fileURLToPath,pathToFileURL} from 'node:url';
import React from 'react';
import {create,act} from 'react-test-renderer';

const require=createRequire(import.meta.url);
const bundle=await build({
 entryPoints:[fileURLToPath(new URL('../admin-src/app/shared/SharedVisitRead.tsx',import.meta.url))],
 bundle:true,write:false,platform:'node',format:'esm',jsx:'automatic',loader:{'.css':'empty'},
 plugins:[{name:'external-react',setup(b){b.onResolve({filter:/^react(?:\/.*)?$/},args=>({path:pathToFileURL(require.resolve(args.path)).href,external:true}));}}],
});
const {SharedVisitRead}=await import('data:text/javascript;base64,'+Buffer.from(bundle.outputFiles[0].text).toString('base64'));

test('selected visit retains attendance while report history opens and reloads both when the visit revision changes',async()=>{
 const saved={window:globalThis.window,document:globalThis.document,act:globalThis.IS_REACT_ACT_ENVIRONMENT,error:console.error};
 globalThis.IS_REACT_ACT_ENVIRONMENT=true;
 globalThis.window=Object.assign(new EventTarget(),{setInterval:()=>1,clearInterval(){}});
 globalThis.document=Object.assign(new EventTarget(),{visibilityState:'visible',hasFocus:()=>true});
 const duplicateKeys=[];
 console.error=(...parts)=>{
  if(typeof parts[0]==='string'&&parts[0].includes('two children with the same key')) duplicateKeys.push(parts);
  else saved.error(...parts);
 };
 const visitId='20000000-0000-4000-8000-000000000001';
 const actor='10000000-0000-4000-8000-000000000001';
 const client='10000000-0000-4000-8000-000000000002';
 const entry={id:visitId,clientId:client,workerId:actor,service:'Home support',start:'2026-11-01T17:00:00.000Z',end:'2026-11-01T20:00:00.000Z',status:'Completed'};
 const calls=[];
 const options=revision=>({actor,role:'manager',visit:{...entry,revision},fetcher,attendanceEnabled:true,onClose(){}});
 async function fetcher(url,init){
  const params=new URL(url,'https://fixture.invalid').searchParams;
  const kind=['visit','attendance','report'].find(name=>params.has(name));
  assert.ok(kind,'only the selected detail and visible panel reads are expected');
  assert.equal(init.method,'GET');
  assert.equal(params.get(kind),visitId);
  const revision=Number(params.get('revision'));
  calls.push({kind,revision});
  if(kind==='visit')return Response.json({visitId,revision,fields:{},contactAuthority:'unknown',allergyStatus:'unknown'});
  if(kind==='attendance')return Response.json({visitId,revision,observedAt:'2026-11-01T20:00:00.000Z',checkInAt:null,checkOutAt:null});
  return Response.json({schema:1,visitId,visitRevision:revision,reportRevision:0,versions:[],reviews:[]});
 }
 let root;
 const button=label=>root.root.findAllByType('button').find(item=>item.props.children===label);
 const count=(kind,revision)=>calls.filter(call=>call.kind===kind&&call.revision===revision).length;
 try{
  await act(async()=>{root=create(React.createElement(SharedVisitRead,options(3)));});
  assert.equal(count('attendance',3),1);
  await act(async()=>button('View report history').props.onClick());
  assert.equal(count('report',3),1);
  assert.equal(count('attendance',3),1);
  assert.equal(duplicateKeys.length,0,'coexisting visit panels must have distinct keys');
  await act(async()=>button('Hide report history').props.onClick());
  assert.equal(count('attendance',3),1);
  await act(async()=>button('View report history').props.onClick());
  assert.equal(count('report',3),2);
  assert.equal(count('attendance',3),1);
  await act(async()=>root.update(React.createElement(SharedVisitRead,options(4))));
  assert.equal(count('visit',4),1);
  assert.equal(count('attendance',4),1);
  assert.equal(count('report',4),1);
  assert.equal(duplicateKeys.length,0);
 } finally {
  if(root) await act(async()=>root.unmount());
  console.error=saved.error;
  globalThis.window=saved.window;globalThis.document=saved.document;globalThis.IS_REACT_ACT_ENVIRONMENT=saved.act;
 }
});
