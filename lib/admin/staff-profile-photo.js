import {AdminError,UUID} from './shared-commands.js';
import {readStaffProfile} from './staff-profile-service.js';
const types={'image/jpeg':'jpg','image/png':'png','image/webp':'webp'};
export async function staffProfilePhoto(current,request,env,fetcher){
 const id=new URL(request.url).searchParams.get('id');const {profile}=await readStaffProfile(current,id,fetcher);
 const bucket=env.ECH_STAFF_PHOTO_BUCKET;if(!bucket||!/^[a-z0-9][a-z0-9_-]{0,62}$/.test(bucket))throw new AdminError(503,'unavailable','Staff photo storage is not configured.');
 let key=profile.photo?.objectKey;let bytes;let type;
 if(request.method==='POST'){
  type=request.headers.get('content-type')?.split(';')[0];if(!types[type])throw new AdminError(400,'invalid_request','Choose a JPEG, PNG or WebP photo.');
  const reader=request.body?.getReader();if(!reader)throw new AdminError(400,'invalid_request','Choose a photo.');
  const chunks=[];let size=0;try{while(true){const value=await reader.read();if(value.done)break;size+=value.value.length;if(size>5*1024*1024){await reader.cancel();throw new AdminError(400,'invalid_request','Photo must be under 5 MB.');}chunks.push(value.value);}}finally{reader.releaseLock();}
  bytes=new Uint8Array(size);let at=0;for(const chunk of chunks){bytes.set(chunk,at);at+=chunk.length;}
  const valid=type==='image/jpeg'?bytes[0]===255&&bytes[1]===216&&bytes[2]===255:type==='image/png'?[137,80,78,71,13,10,26,10].every((v,i)=>bytes[i]===v):String.fromCharCode(...bytes.slice(0,4))==='RIFF'&&String.fromCharCode(...bytes.slice(8,12))==='WEBP';
  if(!valid)throw new AdminError(400,'invalid_request','Photo format does not match its file type.');
  key=id+'/'+crypto.randomUUID()+'.'+types[type];
 }
 if(!key||!key.startsWith(id+'/')||!/^[-a-zA-Z0-9/_.]+$/.test(key)||key.includes('..'))throw new AdminError(404,'not_found','No staff photo recorded.');
 const path='/storage/v1/object/'+(request.method==='GET'?'authenticated/':'')+bucket+'/'+key;
 const response=await fetcher(current.config.base+path,{method:request.method,redirect:'manual',cache:'no-store',signal:AbortSignal.timeout(15000),headers:{apikey:current.config.key,Authorization:'Bearer '+current.token,...(type?{'Content-Type':type,'x-upsert':'false'}:{})},...(bytes?{body:bytes}:{})});
 if(!response.ok)throw new AdminError(502,'write_unconfirmed','Photo could not be confirmed.');
 if(request.method==='POST')return Response.json({objectKey:key,contentType:type},{headers:{'Cache-Control':'no-store'}});
 const contentType=profile.photo.contentType;if(!types[contentType])throw new AdminError(502,'unavailable','Photo format could not be verified.');
 return new Response(response.body,{headers:{'Content-Type':contentType,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
}
