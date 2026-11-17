begin;

alter table public.ech_memberships
 add column delegated_user_admin boolean not null default false,
 add column sessions_valid_after timestamptz,
 add constraint ech_delegation_requires_manager check (
  not delegated_user_admin or (operational_role is not distinct from 'manager' and not application_admin and not technical_admin)
 );
alter table public.ech_access_requests
 add column approved_delegated_user_admin boolean not null default false,
 add constraint ech_delegation_requires_approval check (
  not approved_delegated_user_admin or (state='approved' and approved_role is not distinct from 'manager')
 );
alter table public.ech_membership_receipts add column before_security jsonb, add column after_security jsonb;
alter table public.ech_access_decisions add column before_security jsonb, add column after_security jsonb;

create function public.ech_user_security(m public.ech_memberships) returns jsonb
language sql immutable set search_path='' as $$
 select case when m.user_id is not null then jsonb_build_object(
  'active',m.active,'role',m.operational_role,'applicationAdmin',m.application_admin,
  'technicalAdmin',m.technical_admin,'delegatedUserAdmin',m.delegated_user_admin) end;
$$;

-- Both command routes share this session fence. A provider session created
-- before a grant change cannot register again, even with a refreshed JWT.
create function public.ech_membership_security_change() returns trigger
language plpgsql set search_path='' as $$
begin
 if tg_op='UPDATE' and new.user_id is distinct from old.user_id then
  raise sqlstate 'PT403' using message='Membership identity cannot change';
 end if;
 if tg_op <> 'INSERT' and old.user_id='1fbc76c6-8521-4f9e-b0c9-f174ada676aa'::uuid then
  raise sqlstate 'PT403' using message='The main administrator is protected';
 end if;
 if tg_op='DELETE' then return old; end if;
 if tg_op='INSERT' or public.ech_user_security(old) is distinct from public.ech_user_security(new)
  or new.sessions_valid_after is distinct from old.sessions_valid_after then
  new.sessions_valid_after=clock_timestamp();
  update public.ech_sessions set revoked_at=new.sessions_valid_after
   where user_id=new.user_id and revoked_at is null;
 end if;
 return new;
end;$$;
create trigger ech_membership_security_change before insert or update or delete on public.ech_memberships
 for each row execute function public.ech_membership_security_change();

create function public.ech_verified_google(target uuid, email_value text) returns boolean
language sql stable set search_path='' as $$
 select exists(select 1 from auth.identities
  where user_id=target and provider='google' and identity_data->>'email_verified'='true'
   and lower(identity_data->>'email')=email_value);
$$;

create or replace function public.ech_session_active() returns boolean language sql stable security definer set search_path='' as $$
 select exists(
  select 1 from public.ech_sessions s
  join public.ech_memberships m on m.user_id=s.user_id
  join auth.users u on u.id=m.user_id
  where s.user_id=auth.uid() and s.session_id=(auth.jwt()->>'session_id')::uuid
   and s.revoked_at is null and s.expires_at>now() and s.created_at+interval '7 days'>now() and m.active
   and (m.user_id<>'1fbc76c6-8521-4f9e-b0c9-f174ada676aa'::uuid or (lower(u.email)='erick@bloxlabs.tech' and u.email_confirmed_at is not null))
   and not exists(select 1 from public.ech_access_requests r where r.user_id=m.user_id and (
    r.state<>'approved' or r.approved_role is distinct from m.operational_role
    or r.approved_delegated_user_admin is distinct from m.delegated_user_admin
    or m.application_admin or m.technical_admin or u.email_confirmed_at is null or lower(u.email) is distinct from r.email
    or not public.ech_verified_google(u.id,r.email)
   ))
 );
$$;

create or replace function public.ech_register_session() returns boolean language plpgsql security definer set search_path='' as $$
declare sid uuid=(auth.jwt()->>'session_id')::uuid;
begin
 perform pg_advisory_xact_lock(617243902117::bigint);
 if sid is null or not exists(
  select 1 from public.ech_memberships m
  join auth.sessions s on s.user_id=m.user_id and s.id=sid
  where m.user_id=auth.uid() and m.active and (m.sessions_valid_after is null or s.created_at>m.sessions_valid_after)
 ) then return false; end if;
 insert into public.ech_sessions(session_id,user_id,expires_at)
 values(sid,auth.uid(),to_timestamp((auth.jwt()->>'exp')::double precision)) on conflict do nothing;
 return public.ech_session_active();
end;$$;

create function public.ech_delegated_user_admin() returns boolean language sql stable security definer set search_path='' as $$
 select public.ech_session_active() and exists(
  select 1 from public.ech_memberships where user_id=auth.uid() and active and delegated_user_admin
 );
$$;
create function public.ech_managed_account(m public.ech_memberships) returns boolean language sql immutable set search_path='' as $$
 select m.user_id is not null and m.user_id<>'1fbc76c6-8521-4f9e-b0c9-f174ada676aa'::uuid
  and coalesce(m.operational_role in ('staff','manager'),false) and not m.application_admin and not m.technical_admin;
$$;
-- The original request writer cleared the role on denial and revocation.
-- These rows may re-enter request review, but never the general membership route.
create function public.ech_legacy_closed_request(m public.ech_memberships,r public.ech_access_requests) returns boolean
language sql immutable set search_path='' as $$
 select coalesce(m.user_id=r.user_id and r.state in ('denied','revoked')
  and m.operational_role is null and not m.active
  and not m.technical_admin and not m.application_admin and not m.delegated_user_admin,false);
$$;
create or replace function public.ech_membership_projection(m public.ech_memberships,p_email text) returns jsonb
language sql immutable set search_path='' as $$
 select jsonb_build_object('userId',m.user_id,'email',p_email,'displayName',m.display_name,
  'technicalAdmin',m.technical_admin,'operationalRole',m.operational_role,'applicationAdmin',m.application_admin,
  'active',m.active,'revision',m.revision)
  || case when m.delegated_user_admin then '{"delegatedUserAdmin":true}'::jsonb else '{}'::jsonb end;
$$;
create or replace function public.ech_membership_list() returns jsonb language plpgsql stable security definer set search_path='' as $$
declare main_admin boolean=public.ech_application_admin();
begin
 if not main_admin and not public.ech_delegated_user_admin() then raise sqlstate 'PT403' using message='Action forbidden';end if;
 return coalesce((select jsonb_agg(public.ech_membership_projection(m,lower(u.email)) order by lower(u.email),m.user_id)
  from public.ech_memberships m join auth.users u on u.id=m.user_id
  where main_admin or (m.user_id<>auth.uid() and public.ech_managed_account(m))),'[]'::jsonb);
end;$$;
create or replace function public.ech_access_projection(r public.ech_access_requests) returns jsonb
language sql immutable set search_path='' as $$
 select jsonb_build_object('userId',r.user_id,'email',r.email,'displayName',r.display_name,'state',r.state,
  'role',r.approved_role,'revision',r.revision,'requestedAt',r.requested_at,'decidedAt',r.decided_at)
  || case when r.approved_delegated_user_admin then '{"delegatedUserAdmin":true}'::jsonb else '{}'::jsonb end;
$$;
create or replace function public.ech_access_requests() returns jsonb language plpgsql stable security definer set search_path='' as $$
declare main_admin boolean=coalesce(public.ech_access_reviewer(),false);
begin
 if not main_admin and not public.ech_delegated_user_admin() then raise sqlstate 'PT403' using message='Action forbidden';end if;
 return coalesce((select jsonb_agg(public.ech_access_projection(r) order by (r.state='pending') desc,r.requested_at,r.user_id)
  from public.ech_access_requests r left join public.ech_memberships m on m.user_id=r.user_id
  where main_admin or (r.user_id<>'1fbc76c6-8521-4f9e-b0c9-f174ada676aa'::uuid
   and r.user_id<>auth.uid() and (m.user_id is null or public.ech_managed_account(m) or public.ech_legacy_closed_request(m,r)))),'[]'::jsonb);
end;$$;

-- Private shared writer. Both callers hold the same transaction lock and check
-- the current actor, target, revision and request state before writing.
create function public.ech_write_user_membership(
 target uuid, label text, role_value text, technical boolean, application boolean, delegated boolean, enabled boolean, invalidate boolean
) returns public.ech_memberships language plpgsql set search_path='' as $$
declare saved public.ech_memberships;
begin
 update public.ech_memberships set display_name=label,operational_role=role_value,
  technical_admin=technical,application_admin=application,delegated_user_admin=delegated,active=enabled,
  revision=revision+1,sessions_valid_after=case when invalidate then clock_timestamp() else sessions_valid_after end
 where user_id=target returning * into saved;
 if not found then
  insert into public.ech_memberships(user_id,display_name,operational_role,technical_admin,application_admin,delegated_user_admin,active)
  values(target,label,role_value,technical,application,delegated,enabled) returning * into saved;
 end if;
 return saved;
end;$$;

create or replace function public.ech_membership_commit(p_envelope jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid=auth.uid();op uuid;expected bigint;email_value text;target uuid;f jsonb;m public.ech_memberships;prior public.ech_membership_receipts;hash text;result jsonb;user_count integer;
 main_admin boolean; prior_member public.ech_memberships; r public.ech_access_requests;
 delegated boolean; enabled boolean; target_user auth.users; stable_target boolean;
begin
 main_admin=public.ech_application_admin();
 if not main_admin and not public.ech_delegated_user_admin() then raise sqlstate 'PT403' using message='Action forbidden';end if;
 if jsonb_typeof(p_envelope) is distinct from 'object' or not(p_envelope ?& array['schema','operationId','expectedRevision','command']) or (p_envelope-array['schema','operationId','expectedRevision','command'])<>'{}'::jsonb or p_envelope->'schema' is distinct from '1'::jsonb or jsonb_typeof(p_envelope->'command') is distinct from 'object' or jsonb_typeof(p_envelope->'operationId') is distinct from 'string' or jsonb_typeof(p_envelope->'expectedRevision') is distinct from 'number' or (p_envelope->>'expectedRevision')!~'^[0-9]+$' then raise sqlstate 'PT400' using message='Invalid envelope';end if;
 if not((p_envelope->'command') ?& array['type','email','fields']) or ((p_envelope->'command')-array['type','email','fields','userId'])<>'{}'::jsonb or p_envelope#>>'{command,type}' is distinct from 'upsert' or jsonb_typeof(p_envelope#>'{command,email}') is distinct from 'string' then raise sqlstate 'PT400' using message='Invalid command';end if;
 op=(p_envelope->>'operationId')::uuid;expected=(p_envelope->>'expectedRevision')::bigint;email_value=p_envelope#>>'{command,email}';f=p_envelope#>'{command,fields}';
 if expected<0 or expected>=9007199254740991 or email_value<>lower(trim(email_value)) or length(email_value)>254 or email_value!~'^[^\s@]+@[^\s@]+\.[^\s@]+$' then raise sqlstate 'PT400' using message='Invalid membership identity';end if;
 if jsonb_typeof(f) is distinct from 'object' or not(f ?& array['displayName','technicalAdmin','operationalRole','applicationAdmin','active']) or (f-array['displayName','technicalAdmin','operationalRole','applicationAdmin','active','delegatedUserAdmin'])<>'{}'::jsonb then raise sqlstate 'PT400' using message='Invalid fields';end if;
 if jsonb_typeof(f->'displayName') is distinct from 'string' or length(trim(f->>'displayName')) not between 1 and 160 or (f->>'displayName')~'[[:cntrl:]]' or jsonb_typeof(f->'technicalAdmin') is distinct from 'boolean' or jsonb_typeof(f->'applicationAdmin') is distinct from 'boolean' or jsonb_typeof(f->'active') is distinct from 'boolean' or (f->'operationalRole'<>'null'::jsonb and (jsonb_typeof(f->'operationalRole') is distinct from 'string' or f->>'operationalRole' not in ('owner','manager','staff'))) then raise sqlstate 'PT400' using message='Invalid fields';end if;
 if f ? 'delegatedUserAdmin' and jsonb_typeof(f->'delegatedUserAdmin') is distinct from 'boolean' then
  raise sqlstate 'PT400' using message='Invalid delegated administrator flag';
 end if;
 enabled=(f->>'active')::boolean;
 if ((p_envelope->'command') ? 'userId') and
  (expected=0 or jsonb_typeof(p_envelope#>'{command,userId}') is distinct from 'string') then
  raise sqlstate 'PT400' using message='Account ID requires an existing membership';
 end if;
 stable_target=(p_envelope->'command') ? 'userId' and not enabled;
 -- Serialize all membership changes so concurrent demotions cannot remove the last admin.
 perform pg_advisory_xact_lock(617243902117::bigint);
 main_admin=public.ech_application_admin();
 if not main_admin and not public.ech_delegated_user_admin() then raise sqlstate 'PT403' using message='Action forbidden';end if;
 if stable_target then
  target=(p_envelope#>>'{command,userId}')::uuid;
 else
  select count(*),min(id::text)::uuid into user_count,target from auth.users where lower(email)=email_value;
  if user_count<>1 then raise sqlstate 'PT400' using message='Existing account required';end if;
 end if;
 if (p_envelope->'command') ? 'userId' and target is distinct from (p_envelope#>>'{command,userId}')::uuid then
  raise sqlstate 'PT409' using message='Account identity changed';
 end if;
 if target=actor or target='1fbc76c6-8521-4f9e-b0c9-f174ada676aa'::uuid then
  raise sqlstate 'PT403' using message='Protected membership';
 end if;
 select * into target_user from auth.users where id=target for share;
 if not found or (not stable_target and
  (target_user.email_confirmed_at is null or lower(target_user.email) is distinct from email_value)) then
  raise sqlstate 'PT403' using message='Current verified identity required';
 end if;
 select * into r from public.ech_access_requests where user_id=target for update;
 if stable_target and lower(target_user.email) is distinct from email_value and
  (r.user_id is null or r.email is distinct from email_value) then
  raise sqlstate 'PT403' using message='Request identity does not match';
 end if;
 if not stable_target and not enabled and r.user_id is not null then
  raise sqlstate 'PT403' using message='Deactivate request-backed accounts using the account ID';
 end if;
 select * into prior_member from public.ech_memberships where user_id=target for update;
 if not main_admin and (not public.ech_managed_account(prior_member)
  or not ((p_envelope->'command') ? 'userId') or coalesce(f->>'operationalRole','') not in ('staff','manager') or (f->>'technicalAdmin')::boolean
  or (f->>'applicationAdmin')::boolean) then
  raise sqlstate 'PT403' using message='Only staff and management accounts are in scope';
 end if;
 hash=encode(sha256(convert_to(public.ech_canonical(p_envelope),'UTF8')),'hex');
 select * into prior from public.ech_membership_receipts where actor_id=actor and operation_id=op;
 if found then
  if prior.fingerprint<>hash or prior.target_id<>target then raise sqlstate 'PT409' using message='Operation identity conflict';end if;
  return prior.result;
 end if;
 if coalesce(prior_member.revision,0)<>expected then raise sqlstate 'PT409' using message='Revision conflict';end if;
 delegated=case when f->>'operationalRole'='manager'
  then coalesce((f->>'delegatedUserAdmin')::boolean,
   case when enabled and not prior_member.active then false else prior_member.delegated_user_admin end,false)
  else false end;
 if f ? 'delegatedUserAdmin' and not coalesce(public.ech_access_reviewer(),false)
  and (f->>'operationalRole'='manager' or (f->>'delegatedUserAdmin')::boolean) then
  raise sqlstate 'PT403' using message='Only the main administrator can set partner delegation';
 end if;
 if stable_target and r.user_id is not null and (prior_member.user_id is null or
  f->>'displayName' is distinct from prior_member.display_name or
  f->>'operationalRole' is distinct from prior_member.operational_role or
  (f->>'technicalAdmin')::boolean is distinct from prior_member.technical_admin or
  (f->>'applicationAdmin')::boolean is distinct from prior_member.application_admin or
  delegated is distinct from prior_member.delegated_user_admin) then
  raise sqlstate 'PT403' using message='Deactivation cannot change account details or grants';
 end if;
 if delegated and (f->>'operationalRole' is distinct from 'manager' or (f->>'technicalAdmin')::boolean
  or (f->>'applicationAdmin')::boolean) then raise sqlstate 'PT400' using message='Invalid delegated administrator grant';end if;

 if r.user_id is not null then
  if r.state not in ('approved','revoked') or prior_member.user_id is null
   or (enabled and (r.email is distinct from email_value or not public.ech_verified_google(target,email_value)))
   or coalesce(f->>'operationalRole','') not in ('staff','manager')
   or (f->>'technicalAdmin')::boolean or (f->>'applicationAdmin')::boolean then
   raise sqlstate 'PT403' using message='Use account request review for this account';
  end if;
  update public.ech_access_requests set state=case when enabled then 'approved' else 'revoked' end,
   approved_role=case when enabled then f->>'operationalRole' end,approved_delegated_user_admin=enabled and delegated,
   revision=revision+1,decided_at=now(),decided_by=actor where user_id=target;
 elsif exists(select 1 from auth.identities where user_id=target and provider='google')
   and not exists(select 1 from public.ech_preapproved_members where user_id=target) then
  raise sqlstate 'PT403' using message='Use account request review for this account';
 end if;
 m=public.ech_write_user_membership(target,f->>'displayName',f->>'operationalRole',
  (f->>'technicalAdmin')::boolean,(f->>'applicationAdmin')::boolean,delegated,enabled,stable_target);
 result=jsonb_build_object('member',public.ech_membership_projection(m,email_value),'receipt',jsonb_build_object('operationId',op,'expectedRevision',expected,'revision',m.revision,'commandFingerprint',hash));
 insert into public.ech_membership_receipts(actor_id,operation_id,fingerprint,target_id,result,before_security,after_security)
 values(actor,op,hash,target,result,public.ech_user_security(prior_member),public.ech_user_security(m));
 return result;
exception when invalid_text_representation or numeric_value_out_of_range then raise sqlstate 'PT400' using message='Invalid membership command';
end;$$;

create or replace function public.ech_review_access(p_envelope jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid=auth.uid();op uuid;target uuid;expected bigint;c jsonb;r public.ech_access_requests;prior public.ech_access_decisions;hash text;previous text;next_state text;role_value text;result jsonb;
 main_admin boolean; prior_member public.ech_memberships; saved public.ech_memberships;
 delegated boolean; target_user auth.users;
begin
 main_admin=coalesce(public.ech_access_reviewer(),false);
 if not main_admin and not public.ech_delegated_user_admin() then raise sqlstate 'PT403' using message='Action forbidden';end if;
 if jsonb_typeof(p_envelope) is distinct from 'object' or not(p_envelope ?& array['schema','operationId','expectedRevision','command']) or (p_envelope-array['schema','operationId','expectedRevision','command'])<>'{}'::jsonb or p_envelope->'schema' is distinct from '1'::jsonb or jsonb_typeof(p_envelope->'operationId') is distinct from 'string' or jsonb_typeof(p_envelope->'expectedRevision') is distinct from 'number' or (p_envelope->>'expectedRevision')!~'^[0-9]+$' then raise sqlstate 'PT400' using message='Invalid review envelope';end if;
 c=p_envelope->'command';
 if jsonb_typeof(c) is distinct from 'object' or not(c ?& array['type','userId','role']) or (c-array['type','userId','role','delegatedUserAdmin'])<>'{}'::jsonb or jsonb_typeof(c->'type') is distinct from 'string' or c->>'type' not in ('approve','deny','revoke') or jsonb_typeof(c->'userId') is distinct from 'string' then raise sqlstate 'PT400' using message='Invalid review command';end if;
 op=(p_envelope->>'operationId')::uuid;target=(c->>'userId')::uuid;expected=(p_envelope->>'expectedRevision')::bigint;role_value=c->>'role';
 if expected<1 or expected>=9007199254740991 or (c->>'type'='approve' and (role_value is null or role_value not in ('staff','manager'))) or (c->>'type'<>'approve' and c->'role'<>'null'::jsonb) then raise sqlstate 'PT400' using message='Choose an explicit access decision and role';end if;
 if c ? 'delegatedUserAdmin' and (c->>'type'<>'approve' or jsonb_typeof(c->'delegatedUserAdmin') is distinct from 'boolean'
  or ((c->>'delegatedUserAdmin')::boolean and role_value is distinct from 'manager')) then
  raise sqlstate 'PT400' using message='Invalid delegated administrator flag';
 end if;
 if target=actor or target='1fbc76c6-8521-4f9e-b0c9-f174ada676aa'::uuid then
  raise sqlstate 'PT403' using message='Protected membership';
 end if;
 -- Match the existing membership writer lock so legacy grants cannot race review.
 perform pg_advisory_xact_lock(617243902117::bigint);
 main_admin=coalesce(public.ech_access_reviewer(),false);
 if not main_admin and not public.ech_delegated_user_admin() then raise sqlstate 'PT403' using message='Action forbidden';end if;
 select * into prior_member from public.ech_memberships where user_id=target for update;
 select * into r from public.ech_access_requests where user_id=target for update;
 if prior_member.user_id is not null and not public.ech_managed_account(prior_member)
  and not (c->>'type'='approve' and public.ech_legacy_closed_request(prior_member,r)) then
  raise sqlstate 'PT403' using message='Protected membership';
 end if;
 if not main_admin and c ? 'delegatedUserAdmin' then
  raise sqlstate 'PT403' using message='Only the main administrator can set partner delegation';
 end if;
 hash=encode(sha256(convert_to(public.ech_canonical(p_envelope),'UTF8')),'hex');
 select * into prior from public.ech_access_decisions where actor_id=actor and operation_id=op;
 if found then
  if prior.fingerprint<>hash or prior.target_id<>target then raise sqlstate 'PT409' using message='Operation identity conflict';end if;
  return prior.result;
 end if;
 if r.user_id is null or r.revision<>expected then raise sqlstate 'PT409' using message='Request changed; reload before reviewing';end if;
 previous=r.state;
 if (c->>'type'='deny' and r.state<>'pending') or (c->>'type'='revoke' and r.state<>'approved') then raise sqlstate 'PT409' using message='Decision does not match current request';end if;
 next_state=case c->>'type' when 'approve' then 'approved' when 'deny' then 'denied' else 'revoked' end;
 -- An existing grant can be revoked by the recorded subject after identity drift.
 if next_state<>'revoked' then
  select * into target_user from auth.users where id=target for share;
  if not found or target_user.email_confirmed_at is null or lower(target_user.email) is distinct from r.email
   or not public.ech_verified_google(target,r.email) then
   raise sqlstate 'PT403' using message='Current verified identity required';
  end if;
 end if;
 delegated=case
  when next_state='approved' and role_value='staff' then false
  when next_state='approved' and previous<>'approved' then coalesce((c->>'delegatedUserAdmin')::boolean,false)
  else coalesce((c->>'delegatedUserAdmin')::boolean,prior_member.delegated_user_admin,false)
 end;
 if next_state='approved' then
  saved=public.ech_write_user_membership(target,coalesce(prior_member.display_name,r.display_name),role_value,false,false,delegated,true,true);
 elsif prior_member.user_id is not null then
  -- Retain the inactive account's prior role for a later explicit review.
  saved=public.ech_write_user_membership(target,prior_member.display_name,prior_member.operational_role,
   prior_member.technical_admin,prior_member.application_admin,delegated,false,true);
 end if;
 update public.ech_access_requests set state=next_state,approved_role=case when next_state='approved' then role_value end,
  approved_delegated_user_admin=next_state='approved' and delegated,decided_at=now(),decided_by=actor,revision=revision+1
 where user_id=target returning * into r;
 result=jsonb_build_object('request',public.ech_access_projection(r),'receipt',jsonb_build_object('operationId',op,'expectedRevision',expected,'revision',r.revision,'commandFingerprint',hash));
 insert into public.ech_access_decisions(actor_id,operation_id,target_id,action,previous_state,next_state,approved_role,fingerprint,result,before_security,after_security)
 values(actor,op,target,c->>'type',previous,next_state,r.approved_role,hash,result,
  public.ech_user_security(prior_member),public.ech_user_security(saved));
 return result;
exception when invalid_text_representation or numeric_value_out_of_range then raise sqlstate 'PT400' using message='Invalid review command';
end;$$;


revoke all on function public.ech_user_security(public.ech_memberships),
 public.ech_membership_security_change(),public.ech_verified_google(uuid,text),
 public.ech_delegated_user_admin(),public.ech_managed_account(public.ech_memberships),
 public.ech_legacy_closed_request(public.ech_memberships,public.ech_access_requests),
 public.ech_write_user_membership(uuid,text,text,boolean,boolean,boolean,boolean,boolean)
 from public,anon,authenticated;
revoke all on function public.ech_membership_commit_existing(jsonb) from public,anon,authenticated;
commit;
