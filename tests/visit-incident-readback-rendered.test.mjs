import assert from 'node:assert/strict';
import test from 'node:test';
import React,{act} from 'react';
import {create} from 'react-test-renderer';
import {build} from 'esbuild';
import {createRequire} from 'node:module';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {operationsIncidents} from './fixtures/visit-incidents/operations-incidents.js';

const require=createRequire(import.meta.url);
const bundle=await build({
 entryPoints:[fileURLToPath(new URL('./fixtures/visit-incidents/SharedVisitIncidents.tsx',import.meta.url))],
 bundle:true,write:false,platform:'node',format:'esm',jsx:'automatic',
 plugins:[{name:'renderer-react',setup(b){
   b.onResolve({filter:/^react(?:\/.*)?$/},x=>({path:pathToFileURL(require.resolve(x.path)).href,external:true}));
 }}],
});
const {SharedVisitIncidents}=await import('data:text/javascript;base64,'+Buffer.from(bundle.outputFiles[0].text).toString('base64'));
globalThis.IS_REACT_ACT_ENVIRONMENT=true;
const uuid=n=>'10000000-0000-4000-8000-'+String(n).padStart(12,'0');

for(const outcome of ['denial','changed membership'])test(`confirmed pickup masks pending readback then fails closed on ${outcome}`,async()=>{
 const visit=uuid(1),actor=uuid(2),id=uuid(3),revision=1,role='manager';
 const summary='Fictional incident private summary';
 let row={id,visit,summary,owner:null,state:'open',followUpRecorded:false};
 let membershipRevision=8,denyNextRead=false;
 const trace=[],commits=[];
 let finishDeniedRead,finishVerifiedRead;
 let deferVerifiedRead=false;
 const port={async withVisitTransaction(_account,visitId,body){
  assert.equal(visitId,visit);
  return body({
   current:{actor,role,visit,revision,membershipRevision},
   list:async()=>[row],
   async commit({actor:reviewer,command:c}){
    assert.equal(reviewer,actor);
    commits.push(c);
    if(c.action==='pickup'&&row.owner===null){
     row={...row,owner:reviewer};denyNextRead=true;
    }else if(c.action==='follow-up'&&row.owner===reviewer&&!row.followUpRecorded){
     assert.equal(c.membershipRevision,9);
     row={...row,followUpRecorded:true};
    } else return null;
    return {status:'recorded',id:c.id,operation:c.operation,action:c.action,visit};
   },
  });
 }};
 const fetcher=async(path,init)=>{
  const method=init.method??'GET';trace.push(method);
  const interrupted=method==='GET'&&denyNextRead;
  if(interrupted){denyNextRead=false;membershipRevision=9;}
  const account={principal:{id:actor,operationalRole:role},
   member:{user_id:actor,operational_role:role,revision:membershipRevision,active:true}};
  const req=new Request(new URL(path,'https://fixture.invalid'),{method,headers:init.headers});
  const reply=Response.json(await operationsIncidents(account,req,init.body?JSON.parse(init.body):null,port));
  if(interrupted)return new Promise(resolve=>{
   finishDeniedRead=()=>resolve(outcome==='denial'?Response.json({}, {status:403}):reply);
  });
  if(method==='GET'&&deferVerifiedRead){
   deferVerifiedRead=false;
   return new Promise(resolve=>{finishVerifiedRead=()=>resolve(reply);});
  }
  return reply;
 };
 let ui;
 const button=label=>ui.root.findAllByType('button').find(node=>node.children.join('')===label);
 const click=label=>act(async()=>{button(label).props.onClick();});
 const markup=()=>JSON.stringify(ui.toJSON());
 try{
  await act(async()=>{ui=create(React.createElement(SharedVisitIncidents,{visit,revision,actor,role,fetcher}));});
  await click('Incident '+id+' · New');
  assert.match(markup(),/Fictional incident private summary/u);
  await click('Pick up incident');
  assert.deepEqual(trace,['GET','POST','GET']);
  assert.equal(commits.length,1);
  assert.ok(finishDeniedRead,'scope readback waiting');
  assert.doesNotMatch(markup(),/Fictional incident private summary|Selected incident|Picked up|Unassigned/u,'pending readback masks prior rows and selection');
  await act(async()=>finishDeniedRead());
  assert.match(markup(),/Action saved. Current incident access could not be verified/u);
  assert.doesNotMatch(markup(),/Fictional incident private summary|Selected incident|Picked up/u);
  await click('Retry incident access');
  assert.deepEqual(trace,['GET','POST','GET','GET']);
  assert.equal(commits.length,1);
  assert.doesNotMatch(markup(),/Fictional incident private summary/u,'fresh list does not restore stale selection');
  await click('Incident '+id+' · Picked up');
  assert.match(markup(),/Fictional incident private summary/u);
  await act(async()=>{ui.root.findByType('textarea').props.onChange({currentTarget:{value:'Fictional note'}});});
  deferVerifiedRead=true;
  await act(async()=>{ui.root.findByType('form').props.onSubmit({preventDefault(){}});});
  assert.ok(finishVerifiedRead,'valid same-membership readback waiting');
  assert.doesNotMatch(markup(),/Fictional incident private summary|Selected incident|Picked up/u,'same-scope readback also masks protected context until resolved');
  await act(async()=>finishVerifiedRead());
  assert.match(markup(),/Fictional incident private summary/u,'verified same scope restores existing selection');
  assert.deepEqual(trace,['GET','POST','GET','GET','POST','GET']);
  assert.deepEqual(commits.map(c=>[c.action,c.membershipRevision]),[['pickup',8],['follow-up',9]]);
  assert.match(markup(),/Follow-up recorded/u);
 } finally {if(ui)await act(async()=>{ui.unmount();});}
});
