'use client';
import {useState} from 'react';

// Presentation foundation only. The host must obtain permitted fields from its
// authorized data layer; this component does not derive permissions from roles.
export type StaffProfileFields = {
  workerType: '' | 'care_aide' | 'lpn' | 'rn';
  availability: string;
  vacationStart: string;
  vacationEnd: string;
};
export type StaffProfile = StaffProfileFields & {id:string; revision:number; name:string};
export type StaffProfileField = keyof StaffProfileFields;
const labels:Record<StaffProfileField,string>={workerType:'Worker type',availability:'Availability',vacationStart:'Vacation start',vacationEnd:'Vacation end'};
const fields=Object.keys(labels) as StaffProfileField[];
export type StaffProfilePageProps={
  profile:StaffProfile;
  editableFields:readonly StaffProfileField[];
  mode:'staff_submission'|'admin_direct';
  onSave:(request:{id:string;expectedRevision:number;changes:Partial<StaffProfileFields>})=>Promise<{status:'saved';profile:StaffProfile}|{status:'pending_review';submissionId:string}>;
};
export function StaffProfilePage(props:StaffProfilePageProps){
  // Reset the draft when the host switches identity, scope or saved revision.
  const key=JSON.stringify([props.profile.id,props.profile.revision,props.editableFields,props.mode]);
  return <ProfileForm key={key} {...props}/>;
}
function ProfileForm({profile,editableFields,onSave,mode}:StaffProfilePageProps){
  const [saved,setSaved]=useState(profile);
  const [draft,setDraft]=useState<StaffProfileFields>({...profile});
  const [editing,setEditing]=useState(false);
  const [pending,setPending]=useState(false);
  const [message,setMessage]=useState('');
  const [submitted,setSubmitted]=useState(false);
  const permitted=fields.filter(field=>editableFields.includes(field));
  function change(field:StaffProfileField,value:string){setDraft(current=>({...current,[field]:value}));setMessage('');}
  async function save(event:React.FormEvent){
    event.preventDefault();if(pending)return;
    const changes:Partial<StaffProfileFields>={};
    for(const field of permitted)if(draft[field]!==saved[field])Object.assign(changes,{[field]:draft[field]});
    if(!Object.keys(changes).length){setMessage('No changes to save.');return;}
    if((draft.vacationStart||draft.vacationEnd)&&(!draft.vacationStart||!draft.vacationEnd||draft.vacationStart>draft.vacationEnd)){setMessage('Enter a vacation start and end, with the end on or after the start.');return;}
    setPending(true);setMessage('');
    try{
      const result=await onSave({id:saved.id,expectedRevision:saved.revision,changes});
      if(mode==='staff_submission'){
        if(result.status!=='pending_review'||!result.submissionId)throw new Error('Unconfirmed submission');
        setSubmitted(true);setEditing(false);setMessage('Submitted for admin review and approval. Your approved profile is unchanged.');
      }else{
        if(result.status!=='saved'||result.profile.id!==saved.id||!Number.isSafeInteger(result.profile.revision)||result.profile.revision<=saved.revision)throw new Error('Unconfirmed save');
        setSaved(result.profile);setDraft({...result.profile});setEditing(false);setMessage('Profile saved.');
      }
    }catch{setMessage('Save could not be confirmed. Your entered fields remain here; refresh the saved profile before trying again.');}
    finally{setPending(false);}
  }
  return <section aria-labelledby="staff-profile-title">
    <h1 id="staff-profile-title">Staff Profile Page</h1><h2>{saved.name}</h2>
    <p>Onboarding details and later profile updates.</p>
    <p>Vacation dates are declarations, not approval or a change to scheduled visits. Worker type is not credential verification.</p>
    {editing?<form onSubmit={save}>
      {fields.map(field=><label key={field} style={{display:'block'}}>{labels[field]}
        {field==='workerType'?<select aria-label={labels[field]} disabled={pending||!permitted.includes(field)} value={draft[field]} onChange={e=>change(field,e.target.value)}>
          <option value="">Not recorded</option><option value="care_aide">Care aide</option><option value="lpn">LPN</option><option value="rn">RN</option>
        </select>:field==='availability'?<textarea aria-label={labels[field]} maxLength={2000} disabled={pending||!permitted.includes(field)} value={draft[field]} onChange={e=>change(field,e.target.value)}/>:<input aria-label={labels[field]} type="date" disabled={pending||!permitted.includes(field)} value={draft[field]} onChange={e=>change(field,e.target.value)}/>}
      </label>)}
      <button type="submit" disabled={pending}>{pending?'Sending…':mode==='staff_submission'?'Submit for approval':'Save profile'}</button>
      <button type="button" disabled={pending} onClick={()=>{setDraft({...saved});setEditing(false);setMessage('');}}>Cancel</button>
    </form>:<><dl>{fields.map(field=><div key={field}><dt>{labels[field]}</dt><dd>{field==='workerType'?({care_aide:'Care aide',lpn:'LPN',rn:'RN','':'Not recorded'}[saved.workerType]):saved[field]||'Not recorded'}</dd></div>)}</dl>{permitted.length>0&&!submitted&&<button type="button" onClick={()=>{setEditing(true);setMessage('');}}>Edit profile</button>}</>}
    {message&&<p role="status">{message}</p>}
  </section>;
}
