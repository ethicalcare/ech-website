import test from 'node:test';import assert from 'node:assert/strict';import {build} from 'esbuild';import {createRequire} from 'node:module';import {fileURLToPath,pathToFileURL} from 'node:url';import React from 'react';import {create,act} from 'react-test-renderer';
const require=createRequire(import.meta.url),bundle=await build({entryPoints:[fileURLToPath(new URL('../admin-src/app/shared/SharedRecordCounts.tsx',import.meta.url))],bundle:true,write:false,platform:'node',format:'esm',jsx:'automatic',plugins:[{name:'react',setup(b){b.onResolve({filter:/^react(?:\/.*)?$/},a=>({path:pathToFileURL(require.resolve(a.path)).href,external:true}));}}]});const {SharedRecordCounts}=await import('data:text/javascript;base64,'+Buffer.from(bundle.outputFiles[0].text).toString('base64'));globalThis.IS_REACT_ACT_ENVIRONMENT=true;
test('filtered metric counts identify incomplete loaded pages without asserting unseen matches',async()=>{let root;const inquiries=[{status:'New',followUpAt:'x'},{status:'Closed',followUpAt:'x'},{status:'New',followUpAt:null}],partners=[{ownerId:null},{ownerId:'assigned'}];try{await act(async()=>{root=create(React.createElement(SharedRecordCounts,{inquiries,partners,moreInquiries:true,morePartners:true,inquiryRead:'verified'}));});let cards=root.root.findAllByType('article');assert.deepEqual(cards.map(x=>x.findByType('strong').children.join('')),['2 in loaded records','2','1','1']);let text=JSON.stringify(root.toJSON());for(const t of ['More care inquiries available','More referral partners available','Among loaded inquiries only','Among loaded partners only'])assert(text.includes(t),t);await act(async()=>root.update(React.createElement(SharedRecordCounts,{inquiries,partners,moreInquiries:false,morePartners:false,inquiryRead:'verified'})));text=JSON.stringify(root.toJSON());assert(!text.includes('only'));assert(!text.includes('More care inquiries available'));}finally{await act(async()=>root.unmount());}});


test('New inquiry metric follows the latest saved status and never shows a false zero or stale count',async()=>{
 let root; let opened=0;
 const render=(inquiries,inquiryRead,moreInquiries=false)=>React.createElement(SharedRecordCounts,{inquiries,partners:[],inquiryRead,moreInquiries,morePartners:false,onOpenInquiries:()=>{opened++;}});
 const metric=()=>root.root.findAllByType('article')[0].findAllByType('strong').map(count=>count.children.join(''));
 try{
  await act(async()=>{root=create(render([],'checking'));});
  assert.deepEqual(metric(),[]);
  assert.match(JSON.stringify(root.toJSON()),/Checking care inquiries/);
  await act(async()=>root.update(render([],'verified')));
  assert.deepEqual(metric(),['0']);
  await act(async()=>root.update(render([],'verified',true)));
  assert.deepEqual(metric(),['0 in loaded records']);
  assert.match(JSON.stringify(root.toJSON()),/New among loaded inquiries only/);
  await act(async()=>root.root.findByType('button').props.onClick());
  assert.equal(opened,1);
  const newRecord={id:'fictional-inquiry',status:'New',followUpAt:null};
  await act(async()=>root.update(render([newRecord],'verified')));
  assert.deepEqual(metric(),['1']);
  await act(async()=>root.update(render([{...newRecord,status:'Contacted'}],'verified')));
  assert.deepEqual(metric(),['0']);
  await act(async()=>root.update(render([newRecord],'unavailable')));
  assert.deepEqual(metric(),[]);
  assert.match(JSON.stringify(root.toJSON()),/Care inquiries could not be verified/);
 }finally{await act(async()=>root.unmount());}
});
