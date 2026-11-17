import test from 'node:test';
import assert from 'node:assert/strict';
import { requestOptions, createSessionClient } from '../admin-src/app/shared/session.ts';
import { sameOrigin } from '../lib/admin/session.js';
const origin='https://admin.ethicalcarehome.ca';
test('session requests preserve browser Origin while excluding page paths and keeping transport guards',()=>{
 const options=requestOptions();
 assert.equal(options.referrerPolicy,'strict-origin');
 assert.equal(options.mode,'same-origin');
 assert.equal(options.credentials,'same-origin');
 assert.equal(options.redirect,'error');
 assert.equal(options.cache,'no-store');
 assert(options.signal instanceof AbortSignal);
});
test('Google initiation uses the origin-preserving policy and still verifies the destination',async()=>{
 const url='https://abcdefghijklmnopqrst.supabase.co/auth/v1/authorize?provider=google';
 const client=createSessionClient(async(path,options)=>{
  assert.equal(path,'/api/admin/google'); assert.equal(options.method,'POST');
  assert.equal(options.referrerPolicy,'strict-origin'); assert.equal(options.mode,'same-origin');
  return Response.json({url});
 });
 assert.equal(await client.google(),url);
 for(const bad of ['https://evil.test/auth/v1/authorize?provider=google','https://abcdefghijklmnopqrst.supabase.co/auth/v1/authorize?provider=other']){
  await assert.rejects(createSessionClient(async()=>Response.json({url:bad})).google());
 }
});
test('server CSRF guard continues rejecting null, missing and foreign origins',()=>{
 for(const value of [null,'null','https://evil.test']){
  const request=new Request(origin+'/api/admin/google',{method:'POST',headers:value===null?{}:{origin:value}});
  assert.throws(()=>sameOrigin(request,{origin}),error=>error.status===403);
 }
 assert.doesNotThrow(()=>sameOrigin(new Request(origin,{method:'POST',headers:{origin}}),{origin}));
});
