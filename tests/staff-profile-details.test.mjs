import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {createRequire} from 'node:module';
import {pathToFileURL} from 'node:url';
import React from 'react';
import {create,act} from 'react-test-renderer';
const require=createRequire(import.meta.url);
const bundle=await build({entryPoints:[new URL('../admin-src/app/shared/StaffProfileDetails.tsx',import.meta.url).pathname],bundle:true,write:false,platform:'node',format:'esm',jsx:'automatic',plugins:[{name:'react',setup(b){b.onResolve({filter:/^react(?:\/.*)?$/},a=>({path:pathToFileURL(require.resolve(a.path)).href,external:true}));}}]});
const {StaffProfileDetails,StaffProfileReview}=await import('data:text/javascript;base64,'+Buffer.from(bundle.outputFiles[0].text).toString('base64'));
globalThis.IS_REACT_ACT_ENVIRONMENT=true;
test('optional photo and applicable credential verification; no private fields in staff projection',async()=>{
 let root;const verified=[];
 await act(async()=>{root=create(React.createElement(StaffProfileDetails,{credentials:[{id:'first-aid',name:'First aid',expiresOn:'2027-04-01',verifiedBy:'Fictional manager',verifiedAt:'2026-11-18'},{id:'language',name:'Language',expiresOn:null,verifiedBy:null,verifiedAt:null}],onVerify:async id=>verified.push(id)}));});
 try{
  const text=JSON.stringify(root.toJSON());assert.match(text,/No photo recorded/);assert.match(text,/2027-04-01/);assert.match(text,/No expiry applicable/);assert.match(text,/Fictional manager/);assert.doesNotMatch(text,/Management-only information|Hourly rate|Pay grade|Performance/);
  await act(async()=>root.root.findAllByType('button')[0].props.onClick());assert.deepEqual(verified,['first-aid']);
 }finally{await act(async()=>root.unmount());}
});
test('authorized management projection and pending approval queue',async()=>{
 let root;const approvals=[];
 await act(async()=>{root=create(React.createElement(StaffProfileReview,{submissions:[{id:'submission-1',staffName:'Fictional staff',submittedAt:'2026-11-18',changes:{availability:'Monday'}}],onApprove:async id=>approvals.push(id)}));});
 try{assert.match(JSON.stringify(root.toJSON()),/need admin review/);await act(async()=>root.root.findByType('button').props.onClick());assert.deepEqual(approvals,['submission-1']);}finally{await act(async()=>root.unmount());}
 await act(async()=>{root=create(React.createElement(StaffProfileDetails,{credentials:[],management:{payGrade:'Fictional grade',hourlyRate:'Fictional rate',performance:'Fictional notes'}}));});
 try{assert.match(JSON.stringify(root.toJSON()),/Fictional grade/);assert.match(JSON.stringify(root.toJSON()),/Fictional notes/);}finally{await act(async()=>root.unmount());}
});
