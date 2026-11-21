import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {createRequire} from 'node:module';
import {fileURLToPath,pathToFileURL} from 'node:url';
import React from 'react';
import {create,act} from 'react-test-renderer';
const require=createRequire(import.meta.url);
const bundle=await build({entryPoints:[fileURLToPath(new URL('../admin-src/app/shared/StaffProfiles.tsx',import.meta.url))],bundle:true,write:false,platform:'node',format:'esm',jsx:'automatic',loader:{'.css':'empty'},plugins:[{name:'external-react',setup(b){b.onResolve({filter:/^react(?:\/.*)?$/},args=>({path:pathToFileURL(require.resolve(args.path)).href,external:true}));}}]});
const {StaffProfiles}=await import('data:text/javascript;base64,'+Buffer.from(bundle.outputFiles[0].text).toString('base64'));
const A='10000000-0000-4000-8000-000000000001',B='10000000-0000-4000-8000-000000000002',M='10000000-0000-4000-8000-000000000003';
const label=id=>id===A?'Fictional A':'Fictional B';
const profile=(id,revision,availability)=>({id,revision,name:label(id),workerType:'care_aide',availability,vacationStart:'',vacationEnd:'',credentials:[],management:{payGrade:'',hourlyRate:'',performance:''}});
const review={id:'10000000-0000-4000-8000-000000000004',submittedAt:'2026-11-21T00:00:00.000Z',changes:{availability:'Fictional pending'}};
const session=(id,role,canManage=false)=>({authenticated:true,principal:{id,operationalRole:role,applicationAdmin:canManage},capabilities:canManage?['users.manage']:[]});
function ui(root){
 const text=node=>typeof node==='string'?node:node.children?.map(text).join('')??'';
 return {button:name=>root.root.findAllByType('button').find(b=>text(b)===name),
   field:()=>root.root.findAllByType('textarea').find(n=>n.props['aria-label']==='Availability'),
   row:name=>root.root.findAllByType('button').find(b=>text(b).startsWith(name)),
   text:()=>JSON.stringify(root.toJSON()),treeText:text};
}

test('late manager receipt leaves B or newly opened A intact, and rechecks only departed A on the list',async()=>{
 globalThis.IS_REACT_ACT_ENVIRONMENT=true;
 for(const id of [B,A]){
  let root, resolve, release=false, aReads=0;
  const checks=[],writes=[];
  const hold=new Promise(x=>{resolve=x;});
  const fetcher=async(path,opts)=>{
   const url=new URL(path,'https://fixture.invalid'),target=url.searchParams.get('id');
   if(url.pathname.endsWith('/memberships'))return Response.json({items:[A,B].map(userId=>({userId,displayName:label(userId),active:true,operationalRole:'staff'}))});
   assert.match(url.pathname,/\/staff-profile$/);
   if(opts.method==='POST'){writes.push(JSON.parse(opts.body));await hold;return Response.json({status:'saved',schema:1,profile:profile(A,2,'Old save'),pending:null});}
   if(url.searchParams.get('view')==='pending'){if(release)checks.push(target);return Response.json({schema:1,pending:!release&&target===A});}
   const reopened=target===A&&++aReads>1;
   return Response.json({schema:1,profile:profile(target,reopened?3:1,'Fresh '+label(target)),pending:review});
  };
  try{
   await act(async()=>{root=create(React.createElement(StaffProfiles,{session:session(M,'owner',true),fetcher}));});
   const view=ui(root);
   assert.match(view.treeText(view.row(label(A))),/Pending review/);
   await act(async()=>view.row(label(A)).props.onClick());
   await act(async()=>view.field().props.onChange({target:{value:'Old save'}}));
   await act(async()=>{void root.root.findByType('form').props.onSubmit({preventDefault(){}});});
   assert.deepEqual(writes,[{action:'save',id:A,expectedRevision:1,changes:{availability:'Old save'}}]);
   await act(async()=>view.button('Back to staff list').props.onClick());
   await act(async()=>view.row(label(id)).props.onClick());
   assert.equal(view.field()?.props.value,'Fresh '+label(id),'selected profile stays mounted');
   await act(async()=>{release=true;resolve();});
   assert.equal(view.field()?.props.value,'Fresh '+label(id),'selected profile stays mounted');
   assert.match(view.text(),/There is a staff submission awaiting approval/);
   assert.deepEqual(checks,[]);
   if(id===B){
    await act(async()=>view.button('Back to staff list').props.onClick());
    assert.deepEqual(checks,[A]);
    assert.doesNotMatch(view.treeText(view.row(label(A))),/Pending review/);
    assert.match(view.treeText(view.row(label(B))),/Pending review/);
   }
  }finally{resolve();if(root)await act(async()=>root.unmount());}
 }
});

test('staff stays self-scoped and submits for approval, ordinary manager gains no editor',async()=>{
 globalThis.IS_REACT_ACT_ENVIRONMENT=true;
 let root;const requests=[];
 const fetcher=async(path,opts)=>{
  requests.push([path,opts.method,opts.body&&JSON.parse(opts.body)]);
  if(opts.method==='POST')return Response.json({status:'pending_review',submissionId:'fiction-submission'});
  assert.equal(path,'/api/admin/staff-profile?id='+A);
  const {management,...own}=profile(A,1,'Original');
  return Response.json({schema:1,profile:own,pending:null});
 };
 try{
  await act(async()=>{root=create(React.createElement(StaffProfiles,{session:session(A,'staff'),fetcher}));});
  const view=ui(root);
  assert.doesNotMatch(view.text(),/Save profile|Verify credentials|Hourly rate/);
  await act(async()=>view.field().props.onChange({target:{value:'Own new availability'}}));
  await act(async()=>{await root.root.findByType('form').props.onSubmit({preventDefault(){}});});
  assert.match(view.text(),/Submitted for admin approval/);
  assert.deepEqual(requests,[['/api/admin/staff-profile?id='+A,'GET',undefined],
   ['/api/admin/staff-profile','POST',{action:'save',id:A,expectedRevision:1,changes:{availability:'Own new availability'}}]]);
  await act(async()=>root.update(React.createElement(StaffProfiles,{session:session(M,'manager'),fetcher})));
  assert.equal(root.toJSON(),null);assert.equal(requests.length,2);
 }finally{if(root)await act(async()=>root.unmount());}
});
