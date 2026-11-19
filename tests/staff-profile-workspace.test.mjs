import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {createRequire} from 'node:module';
import {pathToFileURL} from 'node:url';
import React from 'react';
import {create,act} from 'react-test-renderer';
const require=createRequire(import.meta.url);
const bundle=await build({entryPoints:[new URL('../admin-src/app/shared/StaffProfileWorkspace.tsx',import.meta.url).pathname],bundle:true,write:false,platform:'node',format:'esm',jsx:'automatic',plugins:[{name:'react',setup(b){b.onResolve({filter:/^react(?:\/.*)?$/},a=>({path:pathToFileURL(require.resolve(a.path)).href,external:true}));}}]});
const {StaffProfileWorkspace}=await import('data:text/javascript;base64,'+Buffer.from(bundle.outputFiles[0].text).toString('base64'));
globalThis.IS_REACT_ACT_ENVIRONMENT=true;
const base={id:'fictional-staff',name:'Test Staff',revision:1,workerType:'rn',availability:'Weekdays',vacationStart:'',vacationEnd:'',credentials:[],management:{payGrade:'Private grade',hourlyRate:'Private rate',performance:'Private notes'}};
for(const mode of ['staff_submission','admin_direct'])test(`${mode}: add credential in combined profile and retain approval semantics`,async()=>{
 let saved=structuredClone(base);let root;const calls=[];
 const api={read:async()=>saved,submissions:async()=>[],uploadPhoto:async()=>assert.fail('Photo upload must not run'),verify:async()=>{},approve:async()=>{},save:async request=>{calls.push(request);if(mode==='staff_submission')return {status:'pending_review',submissionId:'proposal'};saved={...saved,...request.changes,revision:saved.revision+1};return {status:'saved',profile:saved};}};
 await act(async()=>{root=create(React.createElement(StaffProfileWorkspace,{mode,initialProfile:base,api,photoEnabled:false}));});
 try{
 if(mode==='staff_submission')assert.doesNotMatch(JSON.stringify(root.toJSON()),/Private grade|Private rate|Private notes|Profile submissions awaiting/);
 const form=root.root.findByProps({'aria-label':'Staff profile form'});
 assert.equal(form.findAllByProps({type:'file'}).length,0);assert.match(JSON.stringify(root.toJSON()),/photos are not available yet/);
 await act(async()=>form.findByProps({maxLength:200}).props.onChange({target:{value:'First aid'}}));
 await act(async()=>form.findByProps({'aria-label':'Availability'}).props.onChange({target:{value:'Monday only'}}));
 await act(async()=>form.findAllByType('button').find(b=>b.props.children==='Add credential to form').props.onClick());
 assert.equal(calls.length,0);
 await act(async()=>form.props.onSubmit({preventDefault(){}}));
 assert.equal(calls[0].changes.availability,'Monday only');assert.equal(Object.hasOwn(calls[0].changes,'photo'),false);
 assert.equal(calls.length,1);assert.equal(calls[0].changes.credentials[0].name,'First aid');assert.equal(calls[0].changes.credentials[0].expiresOn,null);
 if(mode==='staff_submission'){assert.equal(saved.revision,1);assert.match(JSON.stringify(root.toJSON()),/Submitted for admin approval/);}else{assert.equal(saved.revision,2);assert.match(JSON.stringify(root.toJSON()),/First aid/);assert.match(JSON.stringify(root.toJSON()),/Profile saved/);}
 }finally{await act(async()=>root.unmount());}
});
test('reopened staff submission stays pending instead of offering another submit',async()=>{
 let root;await act(async()=>{root=create(React.createElement(StaffProfileWorkspace,{mode:'staff_submission',initialProfile:base,pendingReview:true,api:{}}));});
 try{assert.match(JSON.stringify(root.toJSON()),/awaiting admin approval/);assert.equal(root.root.findByType('fieldset').props.disabled,true);assert.equal(root.root.findAllByProps({type:'file'}).length,1);}finally{await act(async()=>root.unmount());}
});
