'use client';
import {useEffect,useState} from 'react';
import {can,type Session} from './live-model';
import {StaffProfileWorkspace,type CompleteProfile,type ProfileWorkspaceApi} from './StaffProfileWorkspace';
type StaffOption={userId:string;displayName:string;active:boolean;operationalRole:string;applicationAdmin?:boolean;technicalAdmin?:boolean;delegatedUserAdmin?:boolean};
type PendingResult={actor:string;loading:boolean;rows:StaffOption[];statuses:Map<string,boolean>;incomplete:boolean};
const pendingCheckLimit=24, pendingCheckConcurrency=4;
const mayCheckPending=(person:StaffOption)=>!person.applicationAdmin&&!person.technicalAdmin&&!person.delegatedUserAdmin;
type Snapshot={profile:CompleteProfile;pending:null|{id:string;submittedAt:string;changes?:Record<string,unknown>}};
export function StaffProfiles({session,fetcher=fetch}:{session:Session;fetcher?:typeof fetch}){
 const manager=can(session,'users.manage');const ownId=session.authenticated?session.principal.id:'';
 const scope=session.authenticated?JSON.stringify([ownId,session.principal.operationalRole,session.principal.applicationAdmin,session.principal.technicalAdmin,session.principal.delegatedUserAdmin]):'';
 const [open,setOpen]=useState(false);const [discovery,setDiscovery]=useState<PendingResult>();const [discoveryRefresh,refreshDiscovery]=useState(0);
 const discoveryKey=JSON.stringify([scope,discoveryRefresh]);
 const [readbacks,setReadbacks]=useState<{scope:string;statuses:Map<string,boolean>}>();
 function resetDiscovery(){setDiscovery(undefined);setReadbacks(undefined);}
 function reloadDiscovery(){resetDiscovery();refreshDiscovery(value=>value+1);}
 const [selected,setSelected]=useState(manager?'':ownId);
 const [snapshot,setSnapshot]=useState<Snapshot>();const [error,setError]=useState('');const [missing,setMissing]=useState(false);const [busy,setBusy]=useState(false);
 async function call(action:string,body?:unknown,signal?:AbortSignal){const response=await fetcher('/api/admin/'+action,{method:body===undefined?'GET':'POST',credentials:'same-origin',cache:'no-store',signal,headers:body===undefined?{}:{'Content-Type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)})});const data=await response.json();if(!response.ok)throw Object.assign(new Error(data.error?.message||'Profile could not be loaded.'),{code:data.error?.code});return data;}
 function profile(data:Snapshot){if(data.profile.id!==selected)throw Error('Profile did not match');return {...data.profile,...(data.profile.photo?{photoUrl:'/api/admin/staff-profile-photo?id='+selected+'&revision='+data.profile.revision}:{})};}
 useEffect(()=>{
  if(!open||!manager||!ownId)return;
  const controller=new AbortController();let active=true;
  const timer=setTimeout(()=>controller.abort(),10000);
  setDiscovery({actor:discoveryKey,loading:true,rows:[],statuses:new Map(),incomplete:false});
  void (async()=>{
   let rows:StaffOption[]=[];const statuses=new Map<string,boolean>();let incomplete=false;
   try{
    const data=await call('memberships',undefined,controller.signal);
    rows=data.items.filter((person:StaffOption)=>person.active&&person.operationalRole==='staff');
    const eligible=rows.filter(mayCheckPending);
    const targets=eligible.slice(0,pendingCheckLimit);incomplete=eligible.length>targets.length;
    if(active)setDiscovery({actor:discoveryKey,loading:true,rows,statuses:new Map(),incomplete});
    let next=0;
    await Promise.all(Array.from({length:Math.min(pendingCheckConcurrency,targets.length)},async()=>{
     while(active&&!controller.signal.aborted&&next<targets.length){
      const person=targets[next++];
      try{
       const result=await call('staff-profile?id='+encodeURIComponent(person.userId)+'&view=pending',undefined,controller.signal);
       if(result.schema!==1||typeof result.pending!=='boolean')throw Error('Unconfirmed status');
       statuses.set(person.userId,result.pending);
      }catch{incomplete=true;}
     }
    }));
    if(next<targets.length||controller.signal.aborted)incomplete=true;
   }catch{incomplete=true;}
   finally{clearTimeout(timer);if(active)setDiscovery({actor:discoveryKey,loading:false,rows,statuses,incomplete});}
  })();
  return()=>{active=false;controller.abort();clearTimeout(timer);};
 },[open,manager,ownId,discoveryKey,fetcher]);
 const discoveryView=discovery?.actor===discoveryKey?discovery:undefined;
 const people=discoveryView?.rows??[];
 const pendingFor=(person:StaffOption)=>mayCheckPending(person)&&
  (readbacks?.scope===discoveryKey&&readbacks.statuses.has(person.userId)?readbacks.statuses.get(person.userId):discoveryView?.statuses.get(person.userId))===true;
 const pendingCount=people.filter(pendingFor).length;
 useEffect(()=>{if(!open||!selected)return;let active=true;setSnapshot(undefined);setMissing(false);setError('');void call('staff-profile?id='+selected).then(data=>{if(active)setSnapshot(data);}).catch(e=>{if(active){setMissing(e.code==='not_found');setError(e.message);}});return()=>{active=false;};},[open,selected,fetcher]);
 if(!manager&&(!session.authenticated||session.principal.operationalRole!=='staff'))return null;
 const pending=()=>snapshot?.pending?.changes?[{id:snapshot.pending.id,staffName:snapshot.profile.name,submittedAt:snapshot.pending.submittedAt,changes:Object.fromEntries(Object.entries(snapshot.pending.changes).map(([key,value])=>[key,typeof value==='string'?value:JSON.stringify(value)]))}]:[];
 const api:ProfileWorkspaceApi={
  read:async()=>{const data=await call('staff-profile?id='+selected);setSnapshot(data);return profile(data);},
  save:request=>call('staff-profile',{action:'save',...request}),
  uploadPhoto:async file=>{const response=await fetcher('/api/admin/staff-profile-photo?id='+selected,{method:'POST',credentials:'same-origin',headers:{'Content-Type':file.type},body:file});if(!response.ok)throw Error('Photo upload failed.');return response.json();},
  verify:credentialId=>call('staff-profile',{action:'verify',id:selected,credentialId}),
  approve:submissionId=>call('staff-profile',{action:'approve',id:selected,submissionId}),
  submissions:async()=>{const data=await call('staff-profile?id='+selected);if(manager&&data.schema===1&&data.profile?.id===selected&&Object.hasOwn(data,'pending'))setReadbacks(previous=>({scope:discoveryKey,statuses:new Map<string,boolean>([...(previous?.scope===discoveryKey?previous.statuses:[]),[selected,Boolean(data.pending)] as const])}));return data.pending?.changes?[{id:data.pending.id,staffName:data.profile.name,submittedAt:data.pending.submittedAt,changes:Object.fromEntries(Object.entries(data.pending.changes).map(([key,value])=>[key,typeof value==='string'?value:JSON.stringify(value)]))}]:[];}
 };
 return <section className="panel dashboard-card"><button type="button" onClick={()=>{reloadDiscovery();setOpen(!open);}} aria-expanded={open}>{manager?'Staff Profiles':'My Staff Profile'}</button>{open&&<>
 {manager&&<>
  <p role="status">{!discoveryView||discoveryView.loading?'Checking for pending profile submissions…':
   discoveryView.incomplete?`${pendingCount} found. Some staff statuses could not be checked. Open a staff profile or try Refresh.`:
   pendingCount?`${pendingCount} staff profile ${pendingCount===1?'submission needs':'submissions need'} review.`:'No staff profile submissions need review.'}</p>
  <button type="button" disabled={!discoveryView||discoveryView.loading} onClick={reloadDiscovery}>Refresh pending status</button>
  <label>Choose staff<select value={selected} onChange={e=>setSelected(e.target.value)}><option value="">Select staff member</option>{people.map(person=><option key={person.userId} value={person.userId}>{person.displayName}{pendingFor(person)?' · Pending review':''}</option>)}</select></label>
 </>}
 {error&&<p role="status">{error}</p>}{missing&&manager&&<button disabled={busy} onClick={async()=>{setBusy(true);try{const result=await call('staff-profile',{action:'initialize',id:selected});setSnapshot(result);setMissing(false);setError('');}catch(e){setError(e instanceof Error?e.message:'Profile could not be created.');}finally{setBusy(false);}}}>Create staff profile</button>}
 {snapshot&&snapshot.profile.id===selected&&<StaffProfileWorkspace key={selected} initialProfile={profile(snapshot)} mode={manager?'admin_direct':'staff_submission'} api={api} initialSubmissions={pending()} pendingReview={Boolean(snapshot.pending)}/>}
 </>}</section>;
}
