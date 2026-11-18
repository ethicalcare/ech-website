'use client';
import {useEffect,useState} from 'react';
import {can,type Session} from './live-model';
import {StaffProfileWorkspace,type CompleteProfile,type ProfileWorkspaceApi} from './StaffProfileWorkspace';
type Snapshot={profile:CompleteProfile;pending:null|{id:string;submittedAt:string;changes?:Record<string,unknown>}};
export function StaffProfiles({session,fetcher=fetch}:{session:Session;fetcher?:typeof fetch}){
 const manager=can(session,'users.manage');const ownId=session.authenticated?session.principal.id:'';
 const [open,setOpen]=useState(false);const [people,setPeople]=useState<{userId:string;displayName:string}[]>([]);const [selected,setSelected]=useState(manager?'':ownId);
 const [snapshot,setSnapshot]=useState<Snapshot>();const [error,setError]=useState('');const [missing,setMissing]=useState(false);const [busy,setBusy]=useState(false);
 async function call(action:string,body?:unknown){const response=await fetcher('/api/admin/'+action,{method:body===undefined?'GET':'POST',credentials:'same-origin',cache:'no-store',headers:body===undefined?{}:{'Content-Type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)})});const data=await response.json();if(!response.ok)throw Object.assign(new Error(data.error?.message||'Profile could not be loaded.'),{code:data.error?.code});return data;}
 function profile(data:Snapshot){if(data.profile.id!==selected)throw Error('Profile did not match');return {...data.profile,...(data.profile.photo?{photoUrl:'/api/admin/staff-profile-photo?id='+selected+'&revision='+data.profile.revision}:{})};}
 useEffect(()=>{if(!open||!manager)return;let active=true;void call('memberships').then(data=>{if(active)setPeople(data.items.filter((p:{active:boolean;operationalRole:string})=>p.active&&p.operationalRole==='staff'));}).catch(()=>{if(active)setError('Staff list could not be loaded.');});return()=>{active=false;};},[open,manager,fetcher]);
 useEffect(()=>{if(!open||!selected)return;let active=true;setSnapshot(undefined);setMissing(false);setError('');void call('staff-profile?id='+selected).then(data=>{if(active)setSnapshot(data);}).catch(e=>{if(active){setMissing(e.code==='not_found');setError(e.message);}});return()=>{active=false;};},[open,selected,fetcher]);
 if(!manager&&(!session.authenticated||session.principal.operationalRole!=='staff'))return null;
 const pending=()=>snapshot?.pending?.changes?[{id:snapshot.pending.id,staffName:snapshot.profile.name,submittedAt:snapshot.pending.submittedAt,changes:Object.fromEntries(Object.entries(snapshot.pending.changes).map(([key,value])=>[key,typeof value==='string'?value:JSON.stringify(value)]))}]:[];
 const api:ProfileWorkspaceApi={
  read:async()=>{const data=await call('staff-profile?id='+selected);setSnapshot(data);return profile(data);},
  save:request=>call('staff-profile',{action:'save',...request}),
  uploadPhoto:async file=>{const response=await fetcher('/api/admin/staff-profile-photo?id='+selected,{method:'POST',credentials:'same-origin',headers:{'Content-Type':file.type},body:file});if(!response.ok)throw Error('Photo upload failed.');return response.json();},
  verify:credentialId=>call('staff-profile',{action:'verify',id:selected,credentialId}),
  approve:submissionId=>call('staff-profile',{action:'approve',id:selected,submissionId}),
  submissions:async()=>{const data=await call('staff-profile?id='+selected);return data.pending?.changes?[{id:data.pending.id,staffName:data.profile.name,submittedAt:data.pending.submittedAt,changes:Object.fromEntries(Object.entries(data.pending.changes).map(([key,value])=>[key,typeof value==='string'?value:JSON.stringify(value)]))}]:[];}
 };
 return <section className="panel dashboard-card"><button type="button" onClick={()=>setOpen(!open)} aria-expanded={open}>{manager?'Staff Profiles':'My Staff Profile'}</button>{open&&<>
 {manager&&<label>Choose staff<select value={selected} onChange={e=>setSelected(e.target.value)}><option value="">Select staff member</option>{people.map(person=><option key={person.userId} value={person.userId}>{person.displayName}</option>)}</select></label>}
 {error&&<p role="status">{error}</p>}{missing&&manager&&<button disabled={busy} onClick={async()=>{setBusy(true);try{const result=await call('staff-profile',{action:'initialize',id:selected});setSnapshot(result);setMissing(false);setError('');}catch(e){setError(e instanceof Error?e.message:'Profile could not be created.');}finally{setBusy(false);}}}>Create staff profile</button>}
 {snapshot&&snapshot.profile.id===selected&&<StaffProfileWorkspace key={selected} initialProfile={profile(snapshot)} mode={manager?'admin_direct':'staff_submission'} api={api} initialSubmissions={pending()} pendingReview={Boolean(snapshot.pending)}/>}
 </>}</section>;
}
