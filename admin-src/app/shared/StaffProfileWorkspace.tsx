'use client';
import {useState} from 'react';
import {type StaffProfile} from './StaffProfilePage';
import {StaffProfileReview, type ProfileCredential, type ManagementProfileDetails, type ProfileSubmission} from './StaffProfileDetails';
export type CompleteProfile = StaffProfile & {credentials:ProfileCredential[];photo?:{objectKey:string;contentType:string}|null;photoUrl?:string;management?:ManagementProfileDetails};
export type ProfileWorkspaceApi = {
 read:()=>Promise<CompleteProfile>;
 save:(request:{id:string;expectedRevision:number;changes:Record<string,unknown>})=>Promise<{status:'saved';profile:CompleteProfile;savedSubmissions?:ProfileSubmission[]}|{status:'pending_review';submissionId:string}>;
 uploadPhoto:(file:File)=>Promise<{objectKey:string;contentType:string}>;
 verify:(credentialId:string)=>Promise<void>;
 approve:(submissionId:string)=>Promise<void>;
 submissions:()=>Promise<ProfileSubmission[]>;
};
// The host supplies a filtered authenticated snapshot. All staff fields share
// one submission, so onboarding never requires approval between form sections.
export function StaffProfileWorkspace({initialProfile,mode,api,initialSubmissions=[],pendingReview=false,photoEnabled=true}:{initialProfile:CompleteProfile;mode:'staff_submission'|'admin_direct';api:ProfileWorkspaceApi;initialSubmissions?:ProfileSubmission[];pendingReview?:boolean;photoEnabled?:boolean}){
 return <Workspace key={initialProfile.id+':'+mode} initialProfile={initialProfile} mode={mode} api={api} initialSubmissions={initialSubmissions} pendingReview={pendingReview} photoEnabled={photoEnabled}/>;
}
function Workspace({initialProfile,mode,api,initialSubmissions,pendingReview,photoEnabled}:{initialProfile:CompleteProfile;mode:'staff_submission'|'admin_direct';api:ProfileWorkspaceApi;initialSubmissions:ProfileSubmission[];pendingReview:boolean;photoEnabled:boolean}){
 const [profile,setProfile]=useState(initialProfile);const [draft,setDraft]=useState(initialProfile);const [submissions,setSubmissions]=useState(initialSubmissions);
 const [credentialName,setCredentialName]=useState('');const [expires,setExpires]=useState('');const [hasExpiry,setHasExpiry]=useState(false);
 const [photo,setPhoto]=useState<File|null>();const [busy,setBusy]=useState(false);const [notice,setNotice]=useState('');const [submitted,setSubmitted]=useState(mode==='staff_submission'&&pendingReview);
 const admin=mode==='admin_direct';
 async function refresh(){const next=await api.read();if(next.id!==profile.id)throw Error('Profile did not match');setProfile(next);setDraft(next);if(admin)setSubmissions(await api.submissions());return next;}
 function addCredential(){if(!credentialName.trim()||(hasExpiry&&!expires))return;setDraft({...draft,credentials:[...draft.credentials,{id:crypto.randomUUID(),name:credentialName.trim(),expiresOn:hasExpiry?expires:null,verifiedBy:null,verifiedAt:null}]});setCredentialName('');setExpires('');setHasExpiry(false);}
 async function save(event:React.FormEvent){event.preventDefault();if(busy||submitted)return;
  if((draft.vacationStart||draft.vacationEnd)&&(!draft.vacationStart||!draft.vacationEnd||draft.vacationStart>draft.vacationEnd)){setNotice('Enter both vacation dates, with end on or after start.');return;}
  const changes:Record<string,unknown>={};for(const key of ['workerType','availability','vacationStart','vacationEnd'] as const)if(draft[key]!==profile[key])changes[key]=draft[key];
  const clean=(rows:ProfileCredential[])=>rows.map(({id,name,expiresOn})=>({id,name,expiresOn}));if(JSON.stringify(clean(draft.credentials))!==JSON.stringify(clean(profile.credentials)))changes.credentials=clean(draft.credentials);
  if(admin&&draft.management)for(const key of ['payGrade','hourlyRate','performance'] as const)if(draft.management[key]!==profile.management?.[key])changes[key]=draft.management[key];
  const savePhoto=photoEnabled?photo:undefined;
  if(!Object.keys(changes).length&&savePhoto===undefined){setNotice('No changes to save.');return;}
  setBusy(true);setNotice('');try{
   if(savePhoto!==undefined)changes.photo=savePhoto===null?null:await api.uploadPhoto(savePhoto);
   const result=await api.save({id:profile.id,expectedRevision:profile.revision,changes});
   if(admin){if(result.status!=='saved')throw Error('Unconfirmed save');if(result.savedSubmissions){setProfile(result.profile);setDraft(result.profile);setSubmissions(result.savedSubmissions);}else await refresh();setPhoto(undefined);setNotice('Profile saved.');}
   else{if(result.status!=='pending_review'||!result.submissionId)throw Error('Unconfirmed submission');setSubmitted(true);setNotice('Submitted for admin approval. Your approved information has not changed.');}
  }catch{setNotice('Could not confirm the change. Your entered details are still here.');}finally{setBusy(false);}
 }
 return <section className="staff-profile-workspace" aria-label="Staff profile"><h1>Staff Profile Page</h1><h2>{profile.name}</h2>
 {submitted&&<p role="status">Your profile submission is awaiting admin approval.</p>}
 {admin&&pendingReview&&<p>There is a staff submission awaiting approval. Saving this form directly replaces that pending submission with your edits. Review the submitted details below first.</p>}
 <form className="staff-profile-form" onSubmit={save} aria-label="Staff profile form"><fieldset className="staff-profile-form-fields" disabled={busy||submitted}>
  <legend>Profile details</legend>
  <label className="staff-profile-short">Worker type<select aria-label="Worker type" value={draft.workerType} onChange={e=>setDraft({...draft,workerType:e.target.value as StaffProfile['workerType']})}><option value="">Not recorded</option><option value="care_aide">Care aide</option><option value="lpn">LPN</option><option value="rn">RN</option></select></label>
  <label className="staff-profile-long">Availability<textarea aria-label="Availability" maxLength={2000} value={draft.availability} onChange={e=>setDraft({...draft,availability:e.target.value})}/></label>
  <div className="staff-profile-pair" role="group" aria-label="Vacation dates">
   <label>Vacation start<input aria-label="Vacation start" type="date" value={draft.vacationStart} onChange={e=>setDraft({...draft,vacationStart:e.target.value})}/></label>
   <label>Vacation end<input aria-label="Vacation end" type="date" value={draft.vacationEnd} onChange={e=>setDraft({...draft,vacationEnd:e.target.value})}/></label>
  </div>
  {photoEnabled?<><h3>Photo (optional)</h3>{profile.photoUrl&&photo!==null&&<img src={profile.photoUrl} alt="Staff profile" width="128" height="128" referrerPolicy="no-referrer"/>}
  <label>Choose photo<input type="file" accept="image/jpeg,image/png,image/webp" onChange={e=>{const file=e.target.files?.[0];if(!file)return;if(!['image/jpeg','image/png','image/webp'].includes(file.type)||file.size>5*1024*1024){setNotice('Choose a JPEG, PNG or WebP photo under 5 MB.');return;}setPhoto(file);}}/></label>{photo&&<p>Selected: {photo.name}</p>}{(profile.photo||photo)&&<button type="button" onClick={()=>setPhoto(null)}>Remove photo</button>}</>:<p>Staff profile photos are not available yet.</p>}
  <section className="staff-profile-group" aria-label="Credentials">
   <h3>Credentials</h3>
   {draft.credentials.length>0&&<ul className="staff-profile-credential-list">{draft.credentials.map(c=><li className="staff-profile-pair staff-profile-credential" key={c.id}>
    <div><strong>{c.name}</strong><p>{c.verifiedBy&&c.verifiedAt?`Verified by ${c.verifiedBy} on ${c.verifiedAt}`:'Not verified'}</p></div>
    <label>Credential expiry<input type="date" value={c.expiresOn||''} onChange={e=>setDraft({...draft,credentials:draft.credentials.map(row=>row.id===c.id?{...row,expiresOn:e.target.value||null}:row)})}/></label>
   </li>)}</ul>}
   <div className="staff-profile-pair">
    <label>Credential name<input aria-label="Credential name" maxLength={200} value={credentialName} onChange={e=>setCredentialName(e.target.value)}/></label>
    <div className="staff-profile-expiry">
     <label className="staff-profile-check"><input type="checkbox" checked={hasExpiry} onChange={e=>setHasExpiry(e.target.checked)}/>This credential expires</label>
     {hasExpiry&&<label>New credential expiry<input aria-label="New credential expiry" type="date" value={expires} onChange={e=>setExpires(e.target.value)}/></label>}
    </div>
   </div>
   <button type="button" onClick={addCredential}>Add credential to form</button>
  </section>
  {admin&&draft.management&&<section className="staff-profile-group" aria-label="Management-only information">
   <h3>Management-only information</h3>
   <div className="staff-profile-pair">
    <label>Pay grade<input aria-label="payGrade" value={draft.management.payGrade} onChange={e=>setDraft({...draft,management:{...draft.management!,payGrade:e.target.value}})}/></label>
    <label>Hourly rate<input aria-label="hourlyRate" value={draft.management.hourlyRate} onChange={e=>setDraft({...draft,management:{...draft.management!,hourlyRate:e.target.value}})}/></label>
   </div>
   <label className="staff-profile-long">Performance notes<textarea aria-label="performance" maxLength={2000} value={draft.management.performance} onChange={e=>setDraft({...draft,management:{...draft.management!,performance:e.target.value}})}/></label>
  </section>}
  <div className="staff-profile-actions">
   <button type="submit">{busy?'Saving…':admin?'Save profile':'Submit profile for approval'}</button>
   <button type="button" onClick={()=>{setDraft(profile);setPhoto(undefined);setNotice('');}}>Cancel changes</button>
  </div>
 </fieldset></form>
 {notice&&<p role="status">{notice}</p>}
 {admin&&<><section aria-label="Verify credentials"><h3>Verify saved credentials</h3>{submissions.length>0&&<p>Approve the pending profile submission or save your edits before verifying credentials.</p>}{profile.credentials.filter(c=>!c.verifiedAt).map(c=><button key={c.id} disabled={busy||submissions.length>0} onClick={async()=>{setBusy(true);try{await api.verify(c.id);await refresh();setNotice('Credential verified.');}catch{setNotice('Verification could not be confirmed.');}finally{setBusy(false);}}}>Verify {c.name}</button>)}</section><StaffProfileReview submissions={submissions} onApprove={async id=>{await api.approve(id);await refresh();}}/></>}
 </section>;
}
