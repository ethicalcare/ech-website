import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {createRequire} from 'node:module';
import {fileURLToPath,pathToFileURL} from 'node:url';
import React from 'react';
import {create,act} from 'react-test-renderer';
const require=createRequire(import.meta.url);
async function component(name){
 const bundle=await build({entryPoints:[fileURLToPath(new URL('../admin-src/app/shared/'+name+'.tsx',import.meta.url))],bundle:true,write:false,platform:'node',format:'esm',jsx:'automatic',loader:{'.css':'empty'},plugins:[{name:'external-react',setup(b){b.onResolve({filter:/^react(?:\/.*)?$/},args=>({path:pathToFileURL(require.resolve(args.path)).href,external:true}));}}]});
 return import('data:text/javascript;base64,'+Buffer.from(bundle.outputFiles[0].text).toString('base64'));
}
const {SharedScheduleRead}=await component('SharedScheduleRead');
test('selected visit details retain scope, clear on selection/close/reload and reject late responses',async()=>{
 globalThis.IS_REACT_ACT_ENVIRONMENT=true;
 const actor='00000000-0000-4000-8000-000000000001',client='00000000-0000-4000-8000-000000000002',other='00000000-0000-4000-8000-000000000003';
 const session={authenticated:true,principal:{id:actor,operationalRole:'staff'},capabilities:[],operationsFeatures:{reads:true,scheduleCommands:false,scheduleRecurrence:false,visitActions:false}};
 const requests=[];const fetcher=(url,options)=>new Promise(resolve=>requests.push({url,options,resolve}));
 let root;
 const button=text=>root.root.findAllByType('button').find(b=>JSON.stringify(b.props.children).includes(text));
 const detail=(id=actor,revision=1)=>({visitId:id,revision,fields:{address:'Protected fixture address',contact:{name:'Fictional logistics',phone:null,purpose:'visit_logistics'}},contactAuthority:'unknown',allergyStatus:'unknown'});
 try{
  await act(async()=>{root=create(React.createElement(SharedScheduleRead,{session,fetcher}));});
  const from=new URL(requests[0].url,'https://fixture.invalid').searchParams.get('from');
  const visit={id:actor,clientId:client,workerId:other,service:'Home support',start:from,end:new Date(Date.parse(from)+3600000).toISOString(),status:'Assigned',revision:1};
  await act(async()=>requests[0].resolve(Response.json({schema:1,mode:'shared',clients:[{id:client,name:'Fictional client'}],staff:[{id:other,name:'Mapped worker'}],visits:[visit]})));
  assert.equal(requests.length,1);
  await act(async()=>button('View visit details').props.onClick());
  assert.equal(requests[1].options.method,'GET');assert.equal(requests[1].options.headers['X-ECH-Schedule-Role'],'staff');assert.equal(requests[1].options.headers['X-ECH-Schedule-Actor'],actor);
  assert.match(requests[1].url,new RegExp('visit='+actor+'&revision=1'));
  await act(async()=>requests[1].resolve(Response.json(detail())));
  assert.match(JSON.stringify(root.toJSON()),/Protected fixture address/);assert.match(JSON.stringify(root.toJSON()),/Contact authority is unknown/);assert.match(JSON.stringify(root.toJSON()),/Allergy status is unknown/);
  await act(async()=>button('Reload visit details').props.onClick());assert.doesNotMatch(JSON.stringify(root.toJSON()),/Protected fixture address/);
  await act(async()=>button('Close visit details').props.onClick());assert.equal(requests[2].options.signal.aborted,true);
  await act(async()=>requests[2].resolve(Response.json(detail())));assert.doesNotMatch(JSON.stringify(root.toJSON()),/Protected fixture address|Selected visit details/);
  await act(async()=>button('View visit details').props.onClick());
  await act(async()=>requests[3].resolve(Response.json(detail(other))));assert.doesNotMatch(JSON.stringify(root.toJSON()),/Protected fixture address/);assert.match(JSON.stringify(root.toJSON()),/could not be verified/);
  await act(async()=>button('Reload visit details').props.onClick());
  await act(async()=>button('Reload schedule').props.onClick());assert.equal(requests[4].options.signal.aborted,true);assert.doesNotMatch(JSON.stringify(root.toJSON()),/Selected visit details/);
  await act(async()=>requests[4].resolve(Response.json(detail())));assert.doesNotMatch(JSON.stringify(root.toJSON()),/Protected fixture address/);
  await act(async()=>root.update(React.createElement(SharedScheduleRead,{session:null,fetcher})));assert.equal(root.toJSON(),null);
 }finally{if(root)await act(async()=>root.unmount());}
});
