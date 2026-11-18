import test from 'node:test';import assert from 'node:assert/strict';
import {staffProfilePhoto} from '../lib/admin/staff-profile-photo.js';
const id='11111111-1111-4111-8111-111111111111';
const current={member:{active:true,user_id:id,operational_role:'staff'},config:{base:'https://example.test',key:'fixture'},token:'fixture'};
test('profile photo upload returns owned object metadata and saved photo is readable',async()=>{
 let uploaded;let profile={id,name:'Fictional staff',revision:1};
 const fetcher=async(url,options)=>{if(url.includes('/rpc/'))return Response.json({storageVersion:1,profile});if(options.method==='POST'){uploaded={url,options};return Response.json({Key:'stored'});}return new Response(new Uint8Array([137,80,78,71,13,10,26,10]));};
 const request=new Request('https://example.test/api/admin/staff-profile-photo?id='+id,{method:'POST',headers:{'content-type':'image/png'},body:new Uint8Array([137,80,78,71,13,10,26,10])});
 const response=await staffProfilePhoto(current,request,{ECH_STAFF_PHOTO_BUCKET:'staff-photos'},fetcher);const metadata=await response.json();
 assert.ok(metadata.objectKey.startsWith(id+'/'));assert.equal(metadata.contentType,'image/png');assert.equal(uploaded.options.headers['x-upsert'],'false');
 profile={...profile,photo:metadata};const view=await staffProfilePhoto(current,new Request(request.url),{ECH_STAFF_PHOTO_BUCKET:'staff-photos'},fetcher);
 assert.equal(view.headers.get('content-type'),'image/png');assert.equal((await view.arrayBuffer()).byteLength,8);
});
