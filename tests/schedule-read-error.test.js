import test from 'node:test';
import assert from 'node:assert/strict';
import {schedule} from '../lib/admin/operations.js';
const current={member:{active:true,operational_role:'manager',revision:5},config:{base:'https://abcdefghijklmnopqrst.supabase.co',key:'fictional'},token:'fictional'};
const params=new URLSearchParams({from:'2026-11-01T00:00:00.000Z',to:'2026-11-08T00:00:00.000Z'});
async function unavailable(response){
 await assert.rejects(schedule(current,params,async()=>response),e=>{
  assert.equal(e.status,503);assert.equal(e.code,'unavailable');
  assert.equal(e.message,'The calendar could not be verified.');return true;
 });
}
test('schedule provider stream rejection is normalized and reader lock released',async()=>{
 let pull=0;
 const body=new ReadableStream({pull(controller){
  if(++pull===1)controller.enqueue(new TextEncoder().encode('{"private":"private-provider-marker"'));
  else controller.error(new Error('private-provider-marker'));
 }});
 await unavailable(new Response(body));assert.equal(body.locked,false);
});
test('oversize stream cancellation rejection cannot leak provider error',async()=>{
 let cancelled=0;
 const body=new ReadableStream({start(controller){controller.enqueue(new Uint8Array(2_000_001));},
 cancel(){cancelled++;throw Error('private-cancel-marker');}});
 await unavailable(new Response(body));assert.equal(cancelled,1);assert.equal(body.locked,false);
});
test('absent or already-locked provider body is normalized',async()=>{
 await unavailable(new Response(null));
 const body=new ReadableStream({start(controller){controller.close();}});
 const response=new Response(body),reader=body.getReader();
 try{await unavailable(response);}finally{reader.releaseLock();}
});
test('invalid UTF-8 and JSON remain normalized',async()=>{
 await unavailable(new Response(new Uint8Array([0xff])));
 await unavailable(new Response('{"private":"private-marker"'));
});
