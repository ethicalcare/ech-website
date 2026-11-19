import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {createRequire} from 'node:module';
import {pathToFileURL} from 'node:url';
import React from 'react';
import {create,act} from 'react-test-renderer';
const require=createRequire(import.meta.url);
const bundle=await build({entryPoints:[new URL('../admin-src/app/shared/StaffProfilePage.tsx',import.meta.url).pathname],bundle:true,write:false,platform:'node',format:'esm',jsx:'automatic',plugins:[{name:'react',setup(b){b.onResolve({filter:/^react(?:\/.*)?$/},a=>({path:pathToFileURL(require.resolve(a.path)).href,external:true}));}}]});
const {StaffProfilePage}=await import('data:text/javascript;base64,'+Buffer.from(bundle.outputFiles[0].text).toString('base64'));
globalThis.IS_REACT_ACT_ENVIRONMENT=true;
const profile={id:'fictional-worker',revision:1,name:'Fictional staff member',workerType:'care_aide',availability:'Weekdays',vacationStart:'',vacationEnd:''};
test('profile view, permitted edit, saved readback, later edit and cancel',async()=>{
 let root;const calls=[];
 const onSave=async request=>{calls.push(request);return {status:'saved',profile:{...profile,...request.changes,revision:2}};};
 const button=label=>root.root.findAllByType('button').find(b=>b.props.children===label);
 await act(async()=>{root=create(React.createElement(StaffProfilePage,{profile,mode:'admin_direct',editableFields:['availability','vacationStart','vacationEnd'],onSave}));});
 try{
  assert.match(JSON.stringify(root.toJSON()),/Weekdays/);
  await act(async()=>button('Edit profile').props.onClick());
  assert.equal(root.root.findByType('select').props.disabled,true);
  await act(async()=>root.root.findByType('textarea').props.onChange({target:{value:'Monday mornings'}}));
  await act(async()=>root.root.findByType('form').props.onSubmit({preventDefault(){}}));
  assert.deepEqual(calls,[{id:profile.id,expectedRevision:1,changes:{availability:'Monday mornings'}}]);
  assert.match(JSON.stringify(root.toJSON()),/Profile saved/);
  assert.match(JSON.stringify(root.toJSON()),/Monday mornings/);
  await act(async()=>button('Edit profile').props.onClick());
  await act(async()=>root.root.findByType('textarea').props.onChange({target:{value:'Unsaved'}}));
  await act(async()=>button('Cancel').props.onClick());
  assert.doesNotMatch(JSON.stringify(root.toJSON()),/Unsaved/);
  assert.match(JSON.stringify(root.toJSON()),/Monday mornings/);
 }finally{await act(async()=>root.unmount());}
});
test('view-only has no edit control and no private management fields',async()=>{
 let root;await act(async()=>{root=create(React.createElement(StaffProfilePage,{mode:'admin_direct',profile:{...profile,payGrade:'PRIVATE',performance:'SECRET'},editableFields:[],onSave:async()=>{throw Error('must not call')}}));});
 try{assert.equal(root.root.findAllByType('button').length,0);assert.doesNotMatch(JSON.stringify(root.toJSON()),/PRIVATE|SECRET/);}finally{await act(async()=>root.unmount());}
});

test('staff submission remains pending without replacing approved readback',async()=>{
 let root;const calls=[];
 await act(async()=>{root=create(React.createElement(StaffProfilePage,{profile,mode:'staff_submission',editableFields:['availability'],onSave:async request=>{calls.push(request);return {status:'pending_review',submissionId:'fictional-submission'};}}));});
 try{
  await act(async()=>root.root.findByType('button').props.onClick());
  await act(async()=>root.root.findByType('textarea').props.onChange({target:{value:'Requested availability'}}));
  assert.match(JSON.stringify(root.toJSON()),/Submit for approval/);
  await act(async()=>root.root.findByType('form').props.onSubmit({preventDefault(){}}));
  assert.equal(calls.length,1);assert.match(JSON.stringify(root.toJSON()),/Submitted for admin review/);
  assert.match(JSON.stringify(root.toJSON()),/Weekdays/);assert.doesNotMatch(JSON.stringify(root.toJSON()),/Profile saved|Requested availability/);
 }finally{await act(async()=>root.unmount());}
});

test('management sees a pending profile before opening it and approval clears the flag',async()=>{
 const pendingBundle=await build({entryPoints:[new URL('../admin-src/app/shared/StaffProfiles.tsx',import.meta.url).pathname],bundle:true,write:false,platform:'node',format:'esm',jsx:'automatic',plugins:[{name:'react',setup(b){b.onResolve({filter:/^react(?:\/.*)?$/},a=>({path:pathToFileURL(require.resolve(a.path)).href,external:true}));}}]});
 const {StaffProfiles}=await import('data:text/javascript;base64,'+Buffer.from(pendingBundle.outputFiles[0].text).toString('base64'));
 const worker='11111111-1111-4111-8111-111111111111',privileged='22222222-2222-4222-8222-222222222222',submission='33333333-3333-4333-8333-333333333333';
 const session={authenticated:true,principal:{id:'44444444-4444-4444-8444-444444444444',operationalRole:'manager',applicationAdmin:true,technicalAdmin:false},capabilities:['users.manage']};
 let pending={id:submission,submittedAt:'2026-11-19T10:00:00Z',changes:{availability:'Tuesday'}};let root;
 const summaryReads=[],posts=[];
 const fetcher=async(url,options)=>{
  const path=new URL(url,'https://fixture.invalid');
  if(path.pathname.endsWith('/memberships'))return Response.json({schema:1,items:[
   {userId:privileged,displayName:'Protected account',active:true,operationalRole:'staff',applicationAdmin:true},
   {userId:worker,displayName:'Fictional worker',active:true,operationalRole:'staff',applicationAdmin:false,technicalAdmin:false}
  ]});
  assert.equal(path.pathname,'/api/admin/staff-profile');
  if(options.method==='POST'){
   posts.push(JSON.parse(options.body));pending=null;return Response.json({status:'saved'});
  }
  assert.equal(path.searchParams.get('id'),worker);
  if(path.searchParams.get('view')==='pending'){summaryReads.push(worker);return Response.json({schema:1,pending:Boolean(pending)});}
  return Response.json({schema:1,profile:{id:worker,name:'Fictional worker',revision:pending?1:2,workerType:'care_aide',availability:pending?'Weekdays':'Tuesday',vacationStart:'',vacationEnd:'',credentials:[]},pending});
 };
 const button=text=>root.root.findAllByType('button').find(item=>item.props.children===text);
 const option=()=>root.root.findAllByType('option').find(item=>item.props.value===worker).children.join('');
 const settle=async()=>act(async()=>{await new Promise(resolve=>setImmediate(resolve));});
 await act(async()=>{root=create(React.createElement(StaffProfiles,{session,fetcher}));});
 try{
  await act(async()=>button('Staff Profiles').props.onClick());await settle();
  assert.equal(option(),'Fictional worker · Pending review');
  assert.match(JSON.stringify(root.toJSON()),/1 staff profile submission needs review/);
  assert.deepEqual(summaryReads,[worker]);assert.deepEqual(posts,[]);
  await act(async()=>root.root.findByType('select').props.onChange({target:{value:worker}}));await settle();
  await act(async()=>button('Approve profile changes').props.onClick());await settle();
  assert.deepEqual(posts,[{action:'approve',id:worker,submissionId:submission}]);
  assert.equal(option(),'Fictional worker');
  assert.match(JSON.stringify(root.toJSON()),/No staff profile submissions need review/);
  assert.deepEqual(summaryReads,[worker]);
 }finally{await act(async()=>root.unmount());}
});
