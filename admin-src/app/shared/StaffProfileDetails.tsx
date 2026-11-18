'use client';
import {useState} from 'react';
export type ProfileCredential={id:string;name:string;expiresOn:string|null;verifiedBy:string|null;verifiedAt:string|null};
export type ManagementProfileDetails={payGrade:string;hourlyRate:string;performance:string};
// These components receive only the already-authorized projection. Photo storage,
// verification identity and policy are supplied by the authenticated host, not UI.
export function StaffProfileDetails({credentials,photoUrl,onPhoto,onRenew,onVerify,management,onManagementSave}:{
 credentials:readonly ProfileCredential[];photoUrl?:string;
 onPhoto?:(photo:File|null)=>Promise<void>;
 onRenew?:(id:string,expiresOn:string|null)=>Promise<void>;
 onVerify?:(id:string)=>Promise<void>;
 management?:ManagementProfileDetails;
 onManagementSave?:(value:ManagementProfileDetails)=>Promise<void>;
}){
 const [message,setMessage]=useState('');const [busy,setBusy]=useState(false);
 const [privateDraft,setPrivateDraft]=useState(management);
 async function run(action:()=>Promise<void>){if(busy)return;setBusy(true);setMessage('');try{await action();setMessage('Change received. Review the current profile status for approval or saved confirmation.');}catch{setMessage('Change could not be confirmed. Refresh before trying again.');}finally{setBusy(false);}}
 return <section aria-label="Staff profile details">
  <h2>Staff photo (optional)</h2>
  {photoUrl?<img src={photoUrl} alt="Staff profile" width="128" height="128" referrerPolicy="no-referrer"/>:<p>No photo recorded.</p>}
  {onPhoto&&<><label>Choose staff photo<input type="file" accept="image/jpeg,image/png,image/webp" disabled={busy} onChange={event=>{const photo=event.target.files?.[0];if(!photo)return;if(!['image/jpeg','image/png','image/webp'].includes(photo.type)){setMessage('Choose a JPEG, PNG or WebP photo.');return;}void run(()=>onPhoto(photo));event.target.value='';}}/></label>{photoUrl&&<button disabled={busy} type="button" onClick={()=>void run(()=>onPhoto(null))}>Remove photo</button>}</>}
  <h2>Credentials</h2>{credentials.length===0&&<p>No credentials recorded.</p>}
  {credentials.map(credential=><article key={credential.id}><h3>{credential.name}</h3><p>{credential.expiresOn?`Expiry: ${credential.expiresOn}`:'No expiry applicable'}</p><p>{credential.verifiedBy&&credential.verifiedAt?`Verified by ${credential.verifiedBy} on ${credential.verifiedAt}`:'Not verified'}</p>
   {onRenew&&<form onSubmit={event=>{event.preventDefault();const data=new FormData(event.currentTarget);void run(()=>onRenew(credential.id,credential.expiresOn===null?null:String(data.get('expiresOn')||'')));}}>
    {credential.expiresOn!==null&&<label>Renewal expiry<input name="expiresOn" type="date" required defaultValue={credential.expiresOn} disabled={busy}/></label>}
    <button disabled={busy} type="submit">{credential.expiresOn===null?'Submit updated credential':'Submit renewal'}</button>
   </form>}{onVerify&&<button disabled={busy} type="button" onClick={()=>void run(()=>onVerify(credential.id))}>Verify credential</button>}
  </article>)}
  {management&&<section aria-label="Management-only information"><h2>Management-only information</h2>{onManagementSave&&privateDraft?<form onSubmit={event=>{event.preventDefault();void run(()=>onManagementSave(privateDraft));}}>{(['payGrade','hourlyRate','performance'] as const).map(field=><label key={field}>{({payGrade:'Pay grade',hourlyRate:'Hourly rate',performance:'Performance'})[field]}<input disabled={busy} value={privateDraft[field]} onChange={event=>setPrivateDraft({...privateDraft,[field]:event.target.value})}/></label>)}<button disabled={busy}>Save management information</button></form>:<dl><dt>Pay grade</dt><dd>{management.payGrade}</dd><dt>Hourly rate</dt><dd>{management.hourlyRate}</dd><dt>Performance</dt><dd>{management.performance}</dd></dl>}</section>}
  {message&&<p role="status">{message}</p>}
 </section>;
}
export type ProfileSubmission={id:string;staffName:string;submittedAt:string;changes:Readonly<Record<string,string>>};
export function StaffProfileReview({submissions,onApprove}:{submissions:readonly ProfileSubmission[];onApprove:(id:string)=>Promise<void>}){
 const [busy,setBusy]=useState<string|null>(null);const [message,setMessage]=useState('');
 return <section aria-label="Staff profile submissions"><h2>Profile submissions awaiting approval ({submissions.length})</h2><p role="status">{submissions.length?'Staff profile changes need admin review.':'No profile submissions awaiting approval.'}</p>{submissions.map(item=><article key={item.id}><h3>{item.staffName}</h3><p>Submitted {item.submittedAt}</p><dl>{Object.entries(item.changes).map(([field,value])=><div key={field}><dt>{field}</dt><dd>{value}</dd></div>)}</dl><button disabled={busy!==null} onClick={async()=>{if(busy)return;setBusy(item.id);setMessage('');try{await onApprove(item.id);setMessage('Approval received. Refresh the profile and queue to verify the saved result.');}catch{setMessage('Approval could not be confirmed. Refresh before trying again.');}finally{setBusy(null);}}}>Approve profile changes</button></article>)}{message&&<p role="status">{message}</p>}</section>;
}
