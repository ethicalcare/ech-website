import {fixtureVisitStart} from './calendar-fixture-time.js';
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
const actor='10000000-0000-4000-8000-000000000001',id='20000000-0000-4000-8000-000000000001';
test('retained report draft reloads current same-purpose revision, failed reload clears detail without discarding draft',async()=>{
 globalThis.IS_REACT_ACT_ENVIRONMENT=true;const old=globalThis.window;globalThis.window=Object.assign(new EventTarget(),{confirm:()=>false});let root,revision=1,fail=false,posts=0,currentReads=0,detailReads=0,resolveDetail;
 const session={authenticated:true,principal:{id:actor,operationalRole:'staff'},capabilities:[],operationsFeatures:{reads:true,scheduleCommands:false,scheduleRecurrence:false,visitActions:true}};
 let visit;
 const fetcher=async(url,options)=>{
 if(options.method==='POST'){posts++;throw new Error('No write should be requested by comparison');}
 if(url.includes('commands=1'))return Response.json({schema:1,enabled:true,membershipRevision:3});
 if(url.includes('scheduleVisit=')){currentReads++;if(fail===true)return new Response('',{status:503});return Response.json({schema:1,visit:{...visit,revision,...(fail==='purpose'?{clientId:'30000000-0000-4000-8000-000000000001'}:{})}});}
 if(url.includes('?visit=')){detailReads++;const response=Response.json({visitId:id,revision,fields:{address:'Protected address revision '+revision},contactAuthority:'unknown',allergyStatus:'unknown'});if(detailReads===3)return new Promise(resolve=>{resolveDetail=()=>resolve(response);});return response;}
 if(url.includes('?report='))return Response.json({schema:1,visitId:id,visitRevision:revision,reportRevision:0,reviews:[],versions:[]});
 const from=fixtureVisitStart(url);visit={id,clientId:id,workerId:actor,service:'Home support',start:from,end:new Date(Date.parse(from)+3600000).toISOString(),status:'In progress',revision};return Response.json({schema:1,mode:'shared',clients:[{id,name:'Fixture client'}],staff:[{id:actor,name:'Worker'}],visits:[visit]});
 };
 const button=text=>root.root.findAllByType('button').find(b=>JSON.stringify(b.props.children).includes(text));
 const summary=()=>root.root.findAllByType('textarea').find(n=>n.props.id.endsWith('-summary'));
 try{await act(async()=>{root=create(React.createElement(SharedScheduleRead,{session,fetcher}));});await act(async()=>button('View visit details').props.onClick());await act(async()=>summary().props.onChange({target:{value:'Keep factual wording'}}));
 fail=true;await act(async()=>button('Keep draft and reload for editing').props.onClick());assert.doesNotMatch(JSON.stringify(root.toJSON()),/Protected address revision/);assert.match(JSON.stringify(root.toJSON()),/retained/i);assert.ok(button('Keep draft and reload for editing'));assert.equal(posts,0);
 fail='purpose';await act(async()=>button('Keep draft and reload for editing').props.onClick());assert.equal(button('Use retained draft with current visit'),undefined);assert.doesNotMatch(JSON.stringify(root.toJSON()),/Protected address revision/);assert.match(JSON.stringify(root.toJSON()),/cannot be applied automatically/);
 fail=false;revision=2;const before=currentReads;await act(async()=>button('Keep draft and reload for editing').props.onClick());assert.equal(currentReads-before,2);assert.ok(resolveDetail,'parent detail reload remains pending');fail=true;await act(async()=>button('Keep draft and reload for editing').props.onClick());await act(async()=>resolveDetail());assert.doesNotMatch(JSON.stringify(root.toJSON()),/Protected address revision/,'late detail response cannot repopulate after reconciliation failed');assert.ok(button('Keep draft and reload for editing'));fail=false;await act(async()=>button('Keep draft and reload for editing').props.onClick());assert.match(JSON.stringify(root.toJSON()),/Protected address revision 2/);assert.equal(summary().props.value,'Keep factual wording');assert.ok(button('Use retained draft with current visit'));assert.equal(posts,0);
 await act(async()=>button('Use retained draft with current visit').props.onClick());assert.equal(summary().props.value,'Keep factual wording');assert.equal(posts,0);assert.equal(button('Use retained draft with current visit'),undefined);
 }finally{if(root)await act(async()=>root.unmount());globalThis.window=old;}
});
