import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {dirname} from 'node:path';
import {build} from 'esbuild';
import {createRequire} from 'node:module';
import {fileURLToPath,pathToFileURL} from 'node:url';
import React,{act} from 'react';
import {create} from 'react-test-renderer';
const require=createRequire(import.meta.url);
const entryPath=fileURLToPath(new URL('../admin-src/app/shared/SharedVisitRead.tsx',import.meta.url));
const fixturePath=fileURLToPath(new URL('./fixtures/visit-incidents/SharedVisitIncidents.tsx',import.meta.url));

function injectOnce(text,needle,replacement){
 const index=text.indexOf(needle);
 assert(index>=0 && text.indexOf(needle,index+needle.length)===-1,`Expected a single Selected Visit fixture hook: ${needle}`);
 return text.slice(0,index)+replacement+text.slice(index+needle.length);
}
const bundle=await build({
 entryPoints:[entryPath],bundle:true,write:false,platform:'node',format:'esm',jsx:'automatic',loader:{'.css':'empty'},
 plugins:[
  {name:'renderer-react',setup(b){b.onResolve({filter:/^react(?:\/.*)?$/},x=>({path:pathToFileURL(require.resolve(x.path)).href,external:true}));}},
  {name:'fictional-incident-preview-only',setup(b){
    b.onLoad({filter:/SharedVisitRead\.tsx$/},async x=>{
      if(x.path!==entryPath)return;
      let source=await readFile(x.path,'utf8');
      source=injectOnce(source,"import {SharedVisitReport} from './SharedVisitReport';",
       `import {SharedVisitReport} from './SharedVisitReport';\nimport {SharedVisitIncidents} from ${JSON.stringify(fixturePath)};`);
      source=injectOnce(source,'scope=""}:','scope="",incidentFixtureFetcher}:');
      source=injectOnce(source,'scope?:string;actor:string;','scope?:string;incidentFixtureFetcher?:typeof fetch;actor:string;');
      source=injectOnce(source,'   <button type="button" aria-expanded={reportOpen}',
       '   {incidentFixtureFetcher&&<SharedVisitIncidents key={JSON.stringify([key,scope])} visit={visit.id} revision={visit.revision} actor={actor} role={role} fetcher={incidentFixtureFetcher}/>}\n   <button type="button" aria-expanded={reportOpen}');
      return {contents:source,loader:'tsx',resolveDir:dirname(x.path)};
    });
  }},
 ],
});
const {SharedVisitRead}=await import('data:text/javascript;base64,'+Buffer.from(bundle.outputFiles[0].text).toString('base64'));

test('test-only incident fixture mounts inside selected visit and is isolated by role and visibility',async()=>{
 globalThis.IS_REACT_ACT_ENVIRONMENT=true;
 const actor='10000000-0000-4000-8000-000000000001',worker='10000000-0000-4000-8000-000000000002';
 const entry={id:'20000000-0000-4000-8000-000000000001',revision:3,clientId:actor,workerId:worker,
  service:'Home support',start:'2026-11-17T07:00:00.000Z',end:'2026-11-17T08:00:00.000Z',status:'Assigned'};
 const reads=[];
 let root;
 const fetcher=async(url,options)=>{
  const u=new URL(url,'https://fictional.invalid');
  assert.equal(u.pathname,'/api/admin/operations','normal visit client never carries fixture traffic');
  assert.equal(u.searchParams.get('visit'),entry.id);
  return Response.json({visitId:entry.id,revision:3,fields:{},contactAuthority:'unknown',allergyStatus:'unknown'});
 };
 const incidentFixtureFetcher=async(url,options)=>{
  const u=new URL(url,'https://fictional.invalid');
  assert.equal(u.pathname,'/__ech_fictional__/visit-incidents');
  assert.equal(options.method??'GET','GET');
  assert.equal(u.searchParams.get('visit'),entry.id);
  assert.equal(u.searchParams.get('revision'),'3');
  assert.equal(u.searchParams.get('incidents'),'1');
  const headers=new Headers(options.headers),role=headers.get('x-ech-schedule-role'),id=headers.get('x-ech-schedule-actor');
  assert.equal(id,role==='staff'?worker:actor);
  reads.push(role);
  return Response.json({schema:1,visit:entry.id,revision:3,actor:id,membershipRevision:8,mayFile:role==='staff',items:[]});
 };
 const render=(role,includeFixture,active=true)=>React.createElement(SharedVisitRead,{
  actor:role==='staff'?worker:actor,role,active,visit:entry,fetcher,onClose(){},
  ...(includeFixture&&{incidentFixtureFetcher})
 });
 const region=name=>root.root.findAllByProps({'aria-label':name}).length;
 try{
  await act(async()=>{root=create(render('manager',false));});
  assert.equal(region('Selected visit details'),1);
  assert.equal(region('Visit incidents'),0);
  assert.deepEqual(reads,[],'no fixture transport is called unless explicitly injected');
  await act(async()=>root.update(render('manager',true)));
  assert.equal(region('Visit incidents'),1);
  assert.equal(region('File an incident'),0);
  assert.match(JSON.stringify(root.toJSON()),/No incidents for this visit/);
  await act(async()=>root.update(render('staff',true)));
  assert.equal(region('Visit incidents'),0);
  assert.equal(region('File an incident'),1);
  assert.deepEqual(reads,['manager','staff']);
  await act(async()=>root.update(render('staff',true,false)));
  assert.equal(region('File an incident'),0);
  assert.deepEqual(reads,['manager','staff']);
 }finally{if(root)await act(async()=>root.unmount());delete globalThis.IS_REACT_ACT_ENVIRONMENT;}
});
