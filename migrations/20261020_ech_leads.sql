begin;
create table public.ech_memberships (
 user_id uuid primary key references auth.users(id), display_name text not null check(length(display_name) between 1 and 160),
 technical_admin boolean not null default false, operational_role text check(operational_role in ('owner','manager','staff')),
 active boolean not null default true
);
create table public.ech_sessions (
 session_id uuid primary key, user_id uuid not null references public.ech_memberships(user_id),
 created_at timestamptz not null default now(), expires_at timestamptz not null, revoked_at timestamptz
);
create table public.ech_records (
 kind text not null check(kind in ('inquiry','partner')), id uuid not null, revision bigint not null check(revision > 0),
 owner_id uuid references public.ech_memberships(user_id), data jsonb not null check(jsonb_typeof(data)='object' and pg_column_size(data)<262144),
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(), primary key(kind,id)
);
create table public.ech_person_keys (id uuid primary key, partner_id uuid not null, record_type text not null default 'partner' check(record_type='partner'), foreign key(record_type,partner_id) references public.ech_records(kind,id));
alter table public.ech_person_keys enable row level security;
revoke all on public.ech_person_keys from public,anon,authenticated;
create table public.ech_events (
 id uuid primary key default gen_random_uuid(), operation_id uuid not null, record_type text not null, record_id uuid not null, actor_id uuid not null references public.ech_memberships(user_id),
 actor_label text not null, at timestamptz not null default now(), action text not null, revision bigint not null,
 details jsonb not null, foreign key(record_type,record_id) references public.ech_records(kind,id), unique(record_type,record_id,revision), unique(actor_id,operation_id)
);
create table public.ech_command_receipts (
 actor_id uuid not null references public.ech_memberships(user_id), operation_id uuid not null, fingerprint text not null,
 record_type text not null, record_id uuid not null, result jsonb not null, primary key(actor_id,operation_id),
 foreign key(record_type,record_id) references public.ech_records(kind,id)
);
alter table public.ech_memberships enable row level security;
alter table public.ech_sessions enable row level security;
alter table public.ech_records enable row level security;
alter table public.ech_events enable row level security;
alter table public.ech_command_receipts enable row level security;
revoke all on public.ech_memberships,public.ech_sessions,public.ech_records,public.ech_events,public.ech_command_receipts from public,anon,authenticated;

create function public.ech_session_active() returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.ech_sessions s join public.ech_memberships m on m.user_id=s.user_id
 where s.user_id=auth.uid() and s.session_id=(auth.jwt()->>'session_id')::uuid and s.revoked_at is null and s.expires_at>now()
 and s.created_at+interval '7 days'>now() and m.active);
$$;
create function public.ech_register_session() returns boolean language plpgsql security definer set search_path='' as $$
begin
 if auth.uid() is null or not exists(select 1 from public.ech_memberships where user_id=auth.uid() and active) then return false; end if;
 insert into public.ech_sessions(session_id,user_id,expires_at) values((auth.jwt()->>'session_id')::uuid,auth.uid(),to_timestamp((auth.jwt()->>'exp')::double precision)) on conflict do nothing;
 return public.ech_session_active();
end;$$;
create function public.ech_refresh_session() returns boolean language plpgsql security definer set search_path='' as $$
begin
 if not exists(select 1 from public.ech_memberships where user_id=auth.uid() and active) then return false; end if;
 update public.ech_sessions set expires_at=least(to_timestamp((auth.jwt()->>'exp')::double precision),created_at+interval '7 days')
 where session_id=(auth.jwt()->>'session_id')::uuid and user_id=auth.uid() and revoked_at is null and created_at+interval '7 days'>now();
 return public.ech_session_active();
end;$$;
create function public.ech_logout_session() returns boolean language plpgsql security definer set search_path='' as $$
begin
 update public.ech_sessions set revoked_at=now() where session_id=(auth.jwt()->>'session_id')::uuid and user_id=auth.uid();
 return true;
end;$$;
create function public.ech_role() returns text language sql stable security definer set search_path='' as $$
 select operational_role from public.ech_memberships where user_id=auth.uid() and active and public.ech_session_active();
$$;
create function public.ech_can_read(p_owner uuid) returns boolean language sql stable security definer set search_path='' as $$
 select coalesce(public.ech_role() in ('owner','manager') or (public.ech_role()='staff' and p_owner=auth.uid()),false);
$$;
create function public.ech_can_read_subject(p_kind text,p_id uuid) returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.ech_records r where r.kind=p_kind and r.id=p_id and public.ech_can_read(r.owner_id));
$$;
create policy ech_membership_self on public.ech_memberships for select to authenticated using(user_id=auth.uid() and active);
create policy ech_record_read on public.ech_records for select to authenticated using(public.ech_can_read(owner_id));
create policy ech_event_read on public.ech_events for select to authenticated using(public.ech_can_read_subject(record_type,record_id));
grant select on public.ech_memberships,public.ech_records,public.ech_events to authenticated;
create view public.ech_inquiries with(security_invoker=true) as select id,revision,owner_id,data,created_at,updated_at from public.ech_records where kind='inquiry';
create view public.ech_partners with(security_invoker=true) as select id,revision,owner_id,data,created_at,updated_at from public.ech_records where kind='partner';
revoke all on public.ech_inquiries,public.ech_partners from public,anon,authenticated;
grant select on public.ech_inquiries,public.ech_partners to authenticated;
create function public.ech_assignees() returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
 if public.ech_role() not in ('owner','manager') or public.ech_role() is null then raise sqlstate 'PT403' using message='Action forbidden'; end if;
 return coalesce((select jsonb_agg(jsonb_build_object('id',user_id,'label',display_name,'operationalRole',operational_role) order by display_name,user_id)
 from public.ech_memberships where active and operational_role in ('owner','manager','staff')),'[]'::jsonb);
end;$$;
create function public.ech_canonical(v jsonb) returns text language plpgsql immutable set search_path='' as $$
declare result text;
begin
 if jsonb_typeof(v)='object' then select '{'||coalesce(string_agg(to_jsonb(key)::text||':'||public.ech_canonical(value),',' order by key collate "C"),'')||'}' into result from jsonb_each(v);return result;
 elsif jsonb_typeof(v)='array' then select '['||coalesce(string_agg(public.ech_canonical(value),',' order by n),'')||']' into result from jsonb_array_elements(v) with ordinality a(value,n);return result;
 else return v::text;end if;
end;$$;
create function public.ech_validate_fields(p_kind text,p_action text,f jsonb) returns void language plpgsql immutable set search_path='' as $$
declare allowed text[];k text;v jsonb;p jsonb;m jsonb;ids text[];
begin
 if jsonb_typeof(f)<>'object' or f='{}'::jsonb then raise sqlstate 'PT400' using message='Invalid fields';end if;
 if p_action in ('create','update') then
  if p_kind='inquiry' then allowed=array['name','phone','email','city','relationship','careRecipient','careRecipientPhone','careRecipientEmail','preferredContact','need','source','status','next','followUpAt','details'];
  elsif p_kind='partner' then allowed=array['organization','category','geography','contactRoute','stage','nextAction','nextDate','notes','openingAsk','materials','lastTouch','callScript','contacted','sprint'];end if;
 elsif p_action='assign' then allowed=array['ownerId'];
 elsif p_kind='inquiry' and p_action='attribute_referral' then allowed=array['referralPartnerId','referringPersonId','referralContext'];
 elsif p_kind='inquiry' and p_action='record_note' then allowed=array['note'];
 elsif p_kind='inquiry' and p_action='follow_up' then allowed=array['outcome','note','next','followUpAt','status'];
 elsif p_kind='partner' and p_action='record_activity' then allowed=array['outcome','note','nextAction','nextDate','stage','date','channel','madeContact'];
 elsif p_kind='partner' and p_action='save_person' then allowed=array['person'];end if;
 if p_action='record_note' and (jsonb_typeof(f->'note') is distinct from 'string' or trim(f->>'note')='') then raise sqlstate 'PT400' using message='Note required';end if;
 if allowed is null then raise sqlstate 'PT400' using message='Invalid command';end if;
 for k,v in select key,value from jsonb_each(f) loop
  if not(k=any(allowed)) then raise sqlstate 'PT400' using message='Unknown field';end if;
  if k in ('ownerId','referralPartnerId','referringPersonId') then if v<>'null'::jsonb then if jsonb_typeof(v)<>'string' then raise sqlstate 'PT400' using message='Invalid identifier type';end if;perform (v#>>'{}')::uuid;end if;
  elsif k in ('contacted','madeContact') then if jsonb_typeof(v)<>'boolean' then raise sqlstate 'PT400' using message='Invalid flag';end if;
  elsif k='followUpAt' then if v<>'null'::jsonb then if (v#>>'{}')!~'^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$' then raise sqlstate 'PT400' using message='Invalid timestamp';end if;perform (v#>>'{}')::timestamptz;end if;
  elsif k='person' then
   p=v;if jsonb_typeof(p)<>'object' or not(p ?& array['id','name','role','methods']) or (p-array['id','name','role','methods'])<>'{}'::jsonb then raise sqlstate 'PT400' using message='Invalid person';end if;
   perform (p->>'id')::uuid;
   if jsonb_typeof(p->'name')<>'string' or length(trim(p->>'name')) not between 1 and 160 or jsonb_typeof(p->'role')<>'string' or length(p->>'role')>160 or jsonb_typeof(p->'methods')<>'array' or jsonb_array_length(p->'methods')>20 then raise sqlstate 'PT400' using message='Invalid person';end if;
   ids=array[]::text[];
   for m in select value from jsonb_array_elements(p->'methods') loop
    if not(m ?& array['id','kind','value','label']) or (m-array['id','kind','value','label'])<>'{}'::jsonb then raise sqlstate 'PT400' using message='Invalid contact method';end if;
    perform (m->>'id')::uuid;
    if (m->>'id')=any(ids) or m->>'kind' not in ('phone','email') or jsonb_typeof(m->'value')<>'string' or length(trim(m->>'value')) not between 1 and 300 or jsonb_typeof(m->'label')<>'string' or length(m->>'label')>160 then raise sqlstate 'PT400' using message='Invalid contact method';end if;
    if m->>'kind'='email' and m->>'value'!~'^[^\s@]+@[^\s@]+\.[^\s@]+$' then raise sqlstate 'PT400' using message='Invalid contact email';end if;
    ids=array_append(ids,m->>'id');
   end loop;
  else
   if jsonb_typeof(v)<>'string' or length(v#>>'{}')>(case when k in ('note','outcome','notes','details') then case when k in ('note','outcome') then 3000 when p_kind='partner' then 12000 else 3000 end else case when p_kind='partner' then 12000 else 3000 end end) then raise sqlstate 'PT400' using message='Invalid text';end if;
   if k in ('nextDate','lastTouch','date') and (v#>>'{}')<>'' then if (v#>>'{}')!~'^\d{4}-\d{2}-\d{2}$' then raise sqlstate 'PT400' using message='Invalid date';end if;perform (v#>>'{}')::date;end if;
   if k='status' and (v#>>'{}') not in ('New','Contacted','Assessment booked','On hold','Closed') then raise sqlstate 'PT400' using message='Invalid status';end if;
   if k='stage' and (v#>>'{}') not in ('New','Not contacted','Contacted','Conversation underway','Ongoing relationship','On hold','Closed') then raise sqlstate 'PT400' using message='Invalid stage';end if;
   if k='preferredContact' and (v#>>'{}') not in ('Phone','Email','Either') then raise sqlstate 'PT400' using message='Invalid contact preference';end if;
   if k in ('phone','careRecipientPhone') and (v#>>'{}')<>'' and ((v#>>'{}')!~'^\+?[0-9 .()\-]+( *(x|ext\.?) *[0-9]{1,6})?$' or length(regexp_replace(v#>>'{}','[^0-9]','','g')) not between 10 and 21) then raise sqlstate 'PT400' using message='Invalid phone';end if;
   if k='channel' and (v#>>'{}') not in ('Call','Meeting','Appointment','Other touchpoint') then raise sqlstate 'PT400' using message='Invalid channel';end if;
   if k in ('email','careRecipientEmail') and (v#>>'{}')<>'' and (v#>>'{}')!~'^[^\s@]+@[^\s@]+\.[^\s@]+$' then raise sqlstate 'PT400' using message='Invalid email';end if;
  end if;
 end loop;
end;$$;
create function public.ech_commit(p_kind text,p_envelope jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid=auth.uid();op uuid;rid uuid;expected bigint;action text;f jsonb;role_name text;rec public.ech_records;prior public.ech_command_receipts;hash text;updated jsonb;result jsonb;details jsonb;changes jsonb='[]';k text;label text;is_call boolean;
begin
 role_name=public.ech_role();
 if role_name is null or role_name not in ('owner','manager','staff') then raise sqlstate 'PT403' using message='Action forbidden';end if;
 if p_kind not in ('inquiry','partner') or jsonb_typeof(p_envelope)<>'object' or not(p_envelope ?& array['schema','operationId','expectedRevision','command']) or (p_envelope-array['schema','operationId','expectedRevision','command'])<>'{}'::jsonb or p_envelope->'schema' is distinct from '1'::jsonb or jsonb_typeof(p_envelope->'command') is distinct from 'object' or jsonb_typeof(p_envelope->'operationId') is distinct from 'string' then raise sqlstate 'PT400' using message='Invalid envelope';end if;
 op=(p_envelope->>'operationId')::uuid;expected=(p_envelope->>'expectedRevision')::bigint;
 if expected<0 or expected>=9007199254740991 or jsonb_typeof(p_envelope->'expectedRevision')<>'number' then raise sqlstate 'PT400' using message='Invalid revision';end if;
 if not((p_envelope->'command') ?& array['type','id','fields']) or ((p_envelope->'command')-array['type','id','fields'])<>'{}'::jsonb then raise sqlstate 'PT400' using message='Invalid command';end if;
 rid=(p_envelope#>>'{command,id}')::uuid;action=p_envelope#>>'{command,type}';f=p_envelope#>'{command,fields}';
 perform public.ech_validate_fields(p_kind,action,f);
 is_call=action='record_activity' and f ?| array['date','channel','madeContact'];
 perform pg_advisory_xact_lock(hashtextextended(actor::text||':'||op::text,0));
 select * into rec from public.ech_records where kind=p_kind and id=rid for update;
 -- Check CURRENT permission before returning any prior receipt or snapshot.
 if action='create' then if role_name not in ('owner','manager') then raise sqlstate 'PT403' using message='Action forbidden';end if;
 elsif rec.id is null or not public.ech_can_read(rec.owner_id) then raise sqlstate 'PT403' using message='Record unavailable';end if;
 if action='assign' and role_name not in ('owner','manager') then raise sqlstate 'PT403' using message='Action forbidden';end if;
 hash=encode(sha256(convert_to(public.ech_canonical(p_envelope),'UTF8')),'hex');
 select * into prior from public.ech_command_receipts where actor_id=actor and operation_id=op;
 if found then
  if prior.fingerprint<>hash or prior.record_type<>p_kind or prior.record_id<>rid then raise sqlstate 'PT409' using message='Operation identity conflict';end if;
  if not public.ech_can_read(rec.owner_id) then raise sqlstate 'PT403' using message='Record unavailable';end if;
  return prior.result;
 end if;
 if action='create' then
  if rec.id is not null or expected<>0 then raise sqlstate 'PT409' using message='Record already exists';end if;
  rec.kind=p_kind;rec.id=rid;rec.owner_id=null;rec.revision=0;rec.created_at=now();
  if p_kind='inquiry' then rec.data='{"name":"","phone":"","email":"","city":"","relationship":"","careRecipient":"","careRecipientPhone":"","careRecipientEmail":"","preferredContact":"","need":"","source":"","status":"New","next":"","followUpAt":null,"referralPartnerId":null,"referringPersonId":null,"referralContext":"","details":""}';
  else rec.data=jsonb_build_object('organization','','category','','geography','','contactRoute','','stage','Not contacted','nextAction','','nextDate','','notes','','openingAsk','','materials','None','lastTouch','','callScript','','contacted',false,'sprint','Later list','people','[]'::jsonb,'source',jsonb_build_object('origin','manual','createdAt',now(),'createdBy',actor));end if;
 elsif rec.revision<>expected then raise sqlstate 'PT409' using message='Revision conflict';end if;
 updated=rec.data;
 if action='assign' then
  if not(f ? 'ownerId') then raise sqlstate 'PT400' using message='Owner required';end if;
  if f->>'ownerId' is not null and not exists(select 1 from public.ech_memberships where user_id=(f->>'ownerId')::uuid and active and operational_role in ('owner','manager','staff')) then raise sqlstate 'PT400' using message='Invalid assignee';end if;
  changes=jsonb_build_array(jsonb_build_object('field','ownerId','before',rec.owner_id,'after',f->>'ownerId'));rec.owner_id=(f->>'ownerId')::uuid;
 elsif action='save_person' then
  insert into public.ech_person_keys(id,partner_id) values((f#>>'{person,id}')::uuid,rid) on conflict do nothing;
  if not exists(select 1 from public.ech_person_keys where id=(f#>>'{person,id}')::uuid and partner_id=rid) then raise sqlstate 'PT409' using message='Person belongs to another partner';end if;
  updated=jsonb_set(updated,'{people}',coalesce((select jsonb_agg(value) from jsonb_array_elements(updated->'people') where value->>'id'<>f#>>'{person,id}'),'[]')||jsonb_build_array(f->'person'));
 elsif action='attribute_referral' then
  if f->>'referralPartnerId' is not null then
   if not public.ech_can_read_subject('partner',(f->>'referralPartnerId')::uuid) then raise sqlstate 'PT403' using message='Referral unavailable';end if;
   if f->>'referringPersonId' is not null and not exists(select 1 from public.ech_records p,jsonb_array_elements(p.data->'people') x where p.kind='partner' and p.id=(f->>'referralPartnerId')::uuid and x->>'id'=f->>'referringPersonId') then raise sqlstate 'PT400' using message='Person does not belong to partner';end if;
  elsif f->>'referringPersonId' is not null then raise sqlstate 'PT400' using message='Partner required';end if;
  updated=updated||f;
 else
  updated=updated||(f-array['outcome','note','date','channel','madeContact']);
  if is_call then
   if rec.owner_id is null or trim(coalesce(f->>'nextAction',''))='' or not(f ?& array['date','madeContact','outcome']) then raise sqlstate 'PT400' using message='Assigned call owner, date, outcome and next action required';end if;
   updated=jsonb_set(updated,'{lastTouch}',to_jsonb(greatest(coalesce(rec.data->>'lastTouch',''),f->>'date')));
   updated=jsonb_set(updated,'{stage}',rec.data->'stage');
  end if;
  if is_call and f->>'madeContact'='true' then updated=jsonb_set(updated,'{contacted}','true');if rec.data->>'stage' in ('New','Not contacted') then updated=jsonb_set(updated,'{stage}','"Contacted"');else updated=jsonb_set(updated,'{stage}',rec.data->'stage');end if;end if;
 end if;
 if p_kind='inquiry' then
  if length(trim(updated->>'name'))=0 or (length(trim(updated->>'phone'))=0 and length(trim(updated->>'email'))=0) then raise sqlstate 'PT400' using message='Contact required';end if;
 elsif length(trim(updated->>'organization'))=0 or length(trim(updated->>'geography'))=0 then raise sqlstate 'PT400' using message='Partner identity required';end if;
 for k in select jsonb_object_keys(f) loop
  if k=any(array['status','stage','next','followUpAt','nextAction','nextDate','source','referralPartnerId','referringPersonId','materials','contacted','lastTouch','sprint']) and (rec.data->k) is distinct from (updated->k) then changes=changes||jsonb_build_array(jsonb_build_object('field',k,'before',rec.data->k,'after',updated->k));end if;
 end loop;
 rec.revision=rec.revision+1;rec.updated_at=now();
 insert into public.ech_records values(p_kind,rid,rec.revision,rec.owner_id,updated,rec.created_at,rec.updated_at)
 on conflict(kind,id) do update set revision=excluded.revision,owner_id=excluded.owner_id,data=excluded.data,updated_at=excluded.updated_at;
 select display_name into label from public.ech_memberships where user_id=actor;
 details=jsonb_build_object('outcome',coalesce(f->>'outcome',''),'note',coalesce(f->>'note',''),'changedFields',(select coalesce(jsonb_agg(field),'[]') from jsonb_object_keys(f) as keys(field)),'changes',changes);
 if is_call then details=details||jsonb_build_object('call',jsonb_build_object('date',f->'date','channel',coalesce(f->'channel','"Call"'::jsonb),'madeContact',f->'madeContact'));end if;
 insert into public.ech_events(operation_id,record_type,record_id,actor_id,actor_label,action,revision,details) values(op,p_kind,rid,actor,label,action,rec.revision,details);
 result=jsonb_build_object('record',updated||jsonb_build_object('id',rid,'revision',rec.revision,'ownerId',rec.owner_id,'createdAt',to_char(rec.created_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),'updatedAt',to_char(rec.updated_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')),'receipt',jsonb_build_object('operationId',op,'expectedRevision',expected,'revision',rec.revision,'commandFingerprint',hash));
 insert into public.ech_command_receipts values(actor,op,hash,p_kind,rid,result);
 return result;
end;$$;
-- Explicitly remove default PUBLIC/anon execute and all direct write grants.
revoke all on function public.ech_session_active(),public.ech_register_session(),public.ech_refresh_session(),public.ech_logout_session(),public.ech_role(),public.ech_can_read(uuid),public.ech_can_read_subject(text,uuid),public.ech_assignees(),public.ech_canonical(jsonb),public.ech_validate_fields(text,text,jsonb),public.ech_commit(text,jsonb) from public,anon,authenticated;
grant execute on function public.ech_session_active(),public.ech_register_session(),public.ech_refresh_session(),public.ech_logout_session(),public.ech_role(),public.ech_can_read(uuid),public.ech_can_read_subject(text,uuid),public.ech_assignees(),public.ech_commit(text,jsonb) to authenticated;
comment on table public.ech_memberships is 'Application capabilities are separate from infrastructure ownership. No initial grants are created by this migration.';
commit;
