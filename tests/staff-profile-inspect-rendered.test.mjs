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
const profile=(id,revision,availability)=>({id,revision,name:label(id),workerType:'care_aide',availability,vacationStart:'',vacationEnd:'',photo:null,credentials:[],management:{payGrade:'',hourlyRate:'',performance:''}});
const review={id:'10000000-0000-4000-8000-000000000004',submittedAt:'2026-11-21T00:00:00.000Z',changes:{availability:'Fictional pending'}};
const session=(id,role,canManage=false)=>({authenticated:true,principal:{id,operationalRole:role,applicationAdmin:canManage},capabilities:canManage?['users.manage']:[]});
function ui(root){
 const text=node=>typeof node==='string'?node:node.children?.map(text).join('')??'';
 return {button:name=>root.root.findAllByType('button').find(b=>text(b)===name),
   field:()=>root.root.findAllByType('textarea').find(n=>n.props['aria-label']==='Availability'),
   row:name=>root.root.findAllByType('button').find(b=>text(b).startsWith(name)),
   text:()=>JSON.stringify(root.toJSON()),treeText:text};
}

test('inspect after lost save retains draft and original revision',async()=>{
 globalThis.IS_REACT_ACT_ENVIRONMENT=true; let root;let saved=profile(A,1,'Original');const writes=[];
 const fetcher=async(path,opts)=>{
  const url=new URL(path,'https://fixture.invalid');
  if(url.pathname.endsWith('/memberships'))return Response.json({items:[{userId:A,displayName:label(A),active:true,operationalRole:'staff'}]});
  if(opts.method==='POST'){const request=JSON.parse(opts.body);writes.push(request);if(writes.length===1){saved={...profile(A,2,'Draft'),name:'Fictional Updated Name',workerType:'rn',vacationStart:'2027-01-01',vacationEnd:'2027-01-04',credentials:[{id:'credential-1',name:'Fictional training',expiresOn:'2028-02-01',verifiedBy:'Fictional reviewer',verifiedAt:'2026-11-01T12:00:00Z'}],management:{payGrade:'Fictional grade',hourlyRate:'42',performance:'Fictional note'},photo:{objectKey:A+'/fictional.png',contentType:'image/png'}};throw Error('lost response');}return Response.json({error:{message:'Conflict',code:'conflict'}},{status:409});}
  if(url.searchParams.get('view')==='pending')return Response.json({schema:1,pending:false});
  return Response.json({schema:1,profile:saved,pending:null});
 };
 try{await act(async()=>{root=create(React.createElement(StaffProfiles,{session:session(M,'owner',true),fetcher}));});const view=ui(root);
 await act(async()=>view.row(label(A)).props.onClick());await act(async()=>view.field().props.onChange({target:{value:'Draft'}}));
 await act(async()=>root.root.findByType('form').props.onSubmit({preventDefault(){}}));
 assert.ok(view.button('Inspect saved profile'));
 await act(async()=>view.button('Inspect saved profile').props.onClick());
 assert.equal(writes.length,1);assert.equal(view.field().props.value,'Draft');assert.match(view.text(),/Draft/);assert.match(view.text(),/Fictional Updated Name/);for(const expected of ['rn','2027-01-01','2027-01-04','Fictional training','2028-02-01','Fictional reviewer','Fictional grade','42','Fictional note','snapshot','may have changed'])assert.ok(view.text().includes(expected),expected);assert.match(view.text(),/revision-matched preview is unavailable/);assert.match(view.text(),/fictional.png/);assert.equal(root.root.findAllByType('img').length,0);
 await act(async()=>root.root.findByType('form').props.onSubmit({preventDefault(){}}));assert.equal(writes[1].expectedRevision,1);
 }finally{if(root)await act(async()=>root.unmount());}
});

test('inspection rejects older revision without changing draft or save revision',async()=>{
 globalThis.IS_REACT_ACT_ENVIRONMENT=true;let root,reads=0;const writes=[];
 const fetcher=async(path,opts)=>{const u=new URL(path,'https://fixture.invalid');if(u.pathname.endsWith('/memberships'))return Response.json({items:[{userId:A,displayName:label(A),active:true,operationalRole:'staff'}]});if(opts.method==='POST'){writes.push(JSON.parse(opts.body));throw Error('lost');}if(u.searchParams.has('view'))return Response.json({schema:1,pending:false});return Response.json({schema:1,profile:profile(A,++reads===1?3:2,'Original'),pending:null});};
 try{await act(async()=>{root=create(React.createElement(StaffProfiles,{session:session(M,'owner',true),fetcher}));});const v=ui(root);await act(async()=>v.row(label(A)).props.onClick());await act(async()=>v.field().props.onChange({target:{value:'Preserved draft'}}));await act(async()=>root.root.findByType('form').props.onSubmit({preventDefault(){}}));await act(async()=>v.button('Inspect saved profile').props.onClick());assert.match(v.text(),/Saved profile could not be inspected/);assert.equal(v.field().props.value,'Preserved draft');await act(async()=>root.root.findByType('form').props.onSubmit({preventDefault(){}}));assert.equal(writes[1].expectedRevision,3);}finally{if(root)await act(async()=>root.unmount());}
});

test('invalid inspection envelope fails closed and retains draft; staff cannot inspect',async()=>{
 globalThis.IS_REACT_ACT_ENVIRONMENT=true;let root,reads=0,writes=0;let staff=false;
 const fetcher=async(path,opts)=>{const u=new URL(path,'https://fixture.invalid');if(u.pathname.endsWith('/memberships'))return Response.json({items:[{userId:A,displayName:label(A),active:true,operationalRole:'staff'}]});if(opts.method==='POST'){writes++;throw Error('lost');}if(u.searchParams.get('view')==='pending')return Response.json({schema:1,pending:false});reads++;return Response.json({schema:reads>1?2:1,profile:profile(A,1,'Original'),pending:null});};
 try{await act(async()=>{root=create(React.createElement(StaffProfiles,{session:session(M,'owner',true),fetcher}));});const view=ui(root);await act(async()=>view.row(label(A)).props.onClick());await act(async()=>view.field().props.onChange({target:{value:'Retained'}}));await act(async()=>root.root.findByType('form').props.onSubmit({preventDefault(){}}));await act(async()=>view.button('Inspect saved profile').props.onClick());assert.match(view.text(),/Saved profile could not be inspected/);assert.equal(view.field().props.value,'Retained');assert.equal(writes,1);
 await act(async()=>root.update(React.createElement(StaffProfiles,{session:session(A,'staff'),fetcher})));await act(async()=>view.field().props.onChange({target:{value:'Staff draft'}}));await act(async()=>root.root.findByType('form').props.onSubmit({preventDefault(){}}));assert.equal(view.button('Inspect saved profile'),undefined);
 }finally{if(root)await act(async()=>root.unmount());}
});

test('malformed saved projections are rejected',async()=>{
 globalThis.IS_REACT_ACT_ENVIRONMENT=true;
 for(const invalid of [{profile:{...profile(A,2,'bad'),photo:undefined}}, {profile:{...profile(A,2,'bad'),photo:{objectKey:B+'/photo.png',contentType:'image/png'}}}, {profile:{...profile(A,2,'bad'),photo:{objectKey:A+'/../x',contentType:'image/png'}}}, {profile:{...profile(A,2,'bad'),photo:{objectKey:'',contentType:'image/png'}}}, {profile:{...profile(A,2,'bad'),photo:{objectKey:'key',contentType:'text/html'}}}, ...[{id:'',name:'X',expiresOn:null,verifiedBy:null,verifiedAt:null},{id:'a',name:' ',expiresOn:null,verifiedBy:null,verifiedAt:null},{id:'a',name:'X',expiresOn:null,verifiedBy:'user',verifiedAt:'bad'},{id:'a',name:'X',expiresOn:null,verifiedBy:'user',verifiedAt:null}].map(c=>({profile:{...profile(A,2,'bad'),credentials:[c]}})), {profile:{...profile(A,2,'bad'),credentials:[{id:'a',name:'X',expiresOn:null,verifiedBy:null,verifiedAt:null},{id:'a',name:'Y',expiresOn:null,verifiedBy:null,verifiedAt:null}]}}, {pending:'bad'}, {profile:{...profile(A,2,'bad'),management:undefined}}, {profile:{...profile(A,2,'bad'),workerType:'wrong'}}, {profile:{...profile(A,2,'bad'),vacationStart:'2026-02-30'}}, {profile:{...profile(A,2,'bad'),vacationStart:'2026-02-01'}}, {profile:{...profile(A,2,'bad'),vacationStart:'2026-03-01',vacationEnd:'2026-02-01'}}, {profile:{...profile(A,2,'bad'),credentials:[{id:'x',name:'Training',expiresOn:'2026-02-30',verifiedBy:null,verifiedAt:null}]}}]){
 let root,reads=0;const fetcher=async(path,opts)=>{const u=new URL(path,'https://fixture.invalid');if(u.pathname.endsWith('/memberships'))return Response.json({items:[{userId:A,displayName:label(A),active:true,operationalRole:'staff'}]});if(opts.method==='POST')throw Error('lost');if(u.searchParams.has('view'))return Response.json({schema:1,pending:false});return Response.json({schema:1,profile:profile(A,1,'original'),pending:null,...(++reads>1?invalid:{})});};
 try{await act(async()=>{root=create(React.createElement(StaffProfiles,{session:session(M,'owner',true),fetcher}));});const v=ui(root);await act(async()=>v.row(label(A)).props.onClick());await act(async()=>v.field().props.onChange({target:{value:'Draft'}}));await act(async()=>root.root.findByType('form').props.onSubmit({preventDefault(){}}));await act(async()=>v.button('Inspect saved profile').props.onClick());assert.match(v.text(),/Saved profile could not be inspected/);assert.equal(v.field().props.value,'Draft');}finally{if(root)await act(async()=>root.unmount());}
 }
});

test('late inspection cannot enter another profile',async()=>{
 globalThis.IS_REACT_ACT_ENVIRONMENT=true;let root,reads=0,release;const hold=new Promise(r=>{release=r;});
 const fetcher=async(path,opts)=>{const u=new URL(path,'https://fixture.invalid'),id=u.searchParams.get('id');if(u.pathname.endsWith('/memberships'))return Response.json({items:[A,B].map(userId=>({userId,displayName:label(userId),active:true,operationalRole:'staff'}))});if(opts.method==='POST')throw Error('lost');if(u.searchParams.has('view'))return Response.json({schema:1,pending:false});if(id===A&&++reads===2){await hold;return Response.json({schema:1,profile:profile(A,2,'Stale A secret'),pending:null});}return Response.json({schema:1,profile:profile(id,1,'Original '+label(id)),pending:null});};
 try{await act(async()=>{root=create(React.createElement(StaffProfiles,{session:session(M,'owner',true),fetcher}));});const v=ui(root);await act(async()=>v.row(label(A)).props.onClick());await act(async()=>v.field().props.onChange({target:{value:'Draft A'}}));await act(async()=>root.root.findByType('form').props.onSubmit({preventDefault(){}}));await act(async()=>{void v.button('Inspect saved profile').props.onClick();});await act(async()=>v.button('Back to staff list').props.onClick());await act(async()=>v.row(label(B)).props.onClick());await act(async()=>release());assert.equal(v.field().props.value,'Original Fictional B');assert.doesNotMatch(v.text(),/Stale A secret/);}finally{release();if(root)await act(async()=>root.unmount());}
});

test('approval failure feedback survives and disables inspection during pending mutation',async()=>{
 globalThis.IS_REACT_ACT_ENVIRONMENT=true;let root,release;const held=new Promise(r=>{release=r;});
 const fetcher=async(path,opts)=>{const u=new URL(path,'https://fixture.invalid');if(u.pathname.endsWith('/memberships'))return Response.json({items:[{userId:A,displayName:label(A),active:true,operationalRole:'staff'}]});if(opts.method==='POST'){await held;throw Error('lost approval');}if(u.searchParams.get('view')==='pending')return Response.json({schema:1,pending:true});return Response.json({schema:1,profile:profile(A,1,'Original'),pending:review});};
 try{await act(async()=>{root=create(React.createElement(StaffProfiles,{session:session(M,'owner',true),fetcher}));});const view=ui(root);await act(async()=>view.row(label(A)).props.onClick());await act(async()=>{void view.button('Approve profile changes').props.onClick();});assert.equal(view.button('Inspect saved profile'),undefined);assert.equal(root.root.findByProps({'aria-label':'Staff profile form'}).findByType('fieldset').props.disabled,true);await act(async()=>release());assert.match(view.text(),/Approval could not be confirmed/);
 }finally{release();if(root)await act(async()=>root.unmount());}
});

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
