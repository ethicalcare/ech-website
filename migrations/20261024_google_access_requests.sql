begin;
-- Retain the existing confirmed main administrator. No Auth identity is created here.
do $$ begin
 if not exists(select 1 from auth.users u join public.ech_memberships m on m.user_id=u.id where u.id='1fbc76c6-8521-4f9e-b0c9-f174ada676aa'::uuid and lower(u.email)='erick@bloxlabs.tech' and u.email_confirmed_at is not null and m.active and m.application_admin and m.operational_role='owner') then
  raise exception 'Confirmed main administrator required before installing access requests';
 end if;
end $$;
alter table public.ech_memberships alter column active set default false;
-- Snapshot existing memberships once; new Google identities cannot inherit legacy grant shortcuts.
create table public.ech_preapproved_members (user_id uuid primary key references public.ech_memberships(user_id));
insert into public.ech_preapproved_members select user_id from public.ech_memberships;
alter table public.ech_preapproved_members enable row level security;
revoke all on public.ech_preapproved_members from public,anon,authenticated;
create table public.ech_access_requests (
 user_id uuid primary key references auth.users(id), email text not null, display_name text not null,
 state text not null default 'pending' check(state in ('pending','approved','denied','revoked')),
 approved_role text check(approved_role in ('staff','manager')), revision bigint not null default 1 check(revision>0),
 requested_at timestamptz not null default now(), decided_at timestamptz, decided_by uuid references public.ech_memberships(user_id),
 check((state='approved' and approved_role is not null) or (state<>'approved' and approved_role is null))
);
create table public.ech_access_decisions (
 actor_id uuid not null references public.ech_memberships(user_id), operation_id uuid not null,
 target_id uuid not null references public.ech_access_requests(user_id), at timestamptz not null default now(),
 action text not null check(action in ('approve','deny','revoke')), previous_state text not null, next_state text not null,
 approved_role text, fingerprint text not null, result jsonb not null, primary key(actor_id,operation_id)
);
alter table public.ech_access_requests enable row level security;
alter table public.ech_access_decisions enable row level security;
revoke all on public.ech_access_requests,public.ech_access_decisions from public,anon,authenticated;

create function public.ech_access_reviewer() returns boolean language sql stable security definer set search_path='' as $$
 select auth.uid()='1fbc76c6-8521-4f9e-b0c9-f174ada676aa'::uuid and public.ech_application_admin()
 and exists(select 1 from auth.users u join public.ech_memberships m on m.user_id=u.id where u.id=auth.uid() and lower(u.email)='erick@bloxlabs.tech' and u.email_confirmed_at is not null and m.active and m.operational_role='owner');
$$;
create function public.ech_access_projection(r public.ech_access_requests) returns jsonb language sql immutable set search_path='' as $$
 select jsonb_build_object('userId',r.user_id,'email',r.email,'displayName',r.display_name,'state',r.state,'role',r.approved_role,'revision',r.revision,'requestedAt',r.requested_at,'decidedAt',r.decided_at);
$$;
create function public.ech_request_access() returns jsonb language plpgsql security definer set search_path='' as $$
declare u auth.users;r public.ech_access_requests;m public.ech_memberships;initial_state text='pending';label text;
begin
 select * into u from auth.users where id=auth.uid();
 if u.id is null or u.email_confirmed_at is null or u.email is null or not exists(select 1 from auth.identities where user_id=u.id and provider='google' and identity_data->>'email_verified'='true' and lower(identity_data->>'email')=lower(u.email)) then raise sqlstate 'PT403' using message='Verified Google identity required';end if;
 perform pg_advisory_xact_lock(617243902117::bigint);
 select * into r from public.ech_access_requests where user_id=u.id;
 if found then return jsonb_build_object('state',r.state);end if;
 select * into m from public.ech_memberships where user_id=u.id;
 if m.active and exists(select 1 from public.ech_preapproved_members where user_id=u.id) then return jsonb_build_object('state','approved');end if;
 if m.user_id is not null then initial_state='revoked';end if;
 label=left(regexp_replace(coalesce(nullif(trim(u.raw_user_meta_data->>'full_name'),''),u.email),'[[:cntrl:]]','','g'),160);
 insert into public.ech_access_requests(user_id,email,display_name,state) values(u.id,lower(u.email),label,initial_state) returning * into r;
 return jsonb_build_object('state',r.state);
end;$$;
create function public.ech_access_requests() returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
 if not public.ech_access_reviewer() then raise sqlstate 'PT403' using message='Main administrator required';end if;
 return coalesce((select jsonb_agg(public.ech_access_projection(r) order by (r.state='pending') desc,r.requested_at,r.user_id) from public.ech_access_requests r),'[]'::jsonb);
end;$$;
create function public.ech_review_access(p_envelope jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid=auth.uid();op uuid;target uuid;expected bigint;c jsonb;r public.ech_access_requests;prior public.ech_access_decisions;hash text;previous text;next_state text;role_value text;result jsonb;
begin
 if not public.ech_access_reviewer() then raise sqlstate 'PT403' using message='Main administrator required';end if;
 if jsonb_typeof(p_envelope) is distinct from 'object' or not(p_envelope ?& array['schema','operationId','expectedRevision','command']) or (p_envelope-array['schema','operationId','expectedRevision','command'])<>'{}'::jsonb or p_envelope->'schema' is distinct from '1'::jsonb or jsonb_typeof(p_envelope->'operationId') is distinct from 'string' or jsonb_typeof(p_envelope->'expectedRevision') is distinct from 'number' or (p_envelope->>'expectedRevision')!~'^[0-9]+$' then raise sqlstate 'PT400' using message='Invalid review envelope';end if;
 c=p_envelope->'command';
 if jsonb_typeof(c) is distinct from 'object' or not(c ?& array['type','userId','role']) or (c-array['type','userId','role'])<>'{}'::jsonb or jsonb_typeof(c->'type') is distinct from 'string' or c->>'type' not in ('approve','deny','revoke') or jsonb_typeof(c->'userId') is distinct from 'string' then raise sqlstate 'PT400' using message='Invalid review command';end if;
 op=(p_envelope->>'operationId')::uuid;target=(c->>'userId')::uuid;expected=(p_envelope->>'expectedRevision')::bigint;role_value=c->>'role';
 if expected<1 or expected>=9007199254740991 or target=actor or (c->>'type'='approve' and (role_value is null or role_value not in ('staff','manager'))) or (c->>'type'<>'approve' and c->'role'<>'null'::jsonb) then raise sqlstate 'PT400' using message='Choose an explicit access decision and role';end if;
 -- Match the existing membership writer lock so legacy grants cannot race review.
 perform pg_advisory_xact_lock(617243902117::bigint);
 if not public.ech_access_reviewer() then raise sqlstate 'PT403' using message='Main administrator required';end if;
 hash=encode(sha256(convert_to(public.ech_canonical(p_envelope),'UTF8')),'hex');
 select * into prior from public.ech_access_decisions where actor_id=actor and operation_id=op;
 if found then
  if prior.fingerprint<>hash or prior.target_id<>target then raise sqlstate 'PT409' using message='Operation identity conflict';end if;
  return prior.result;
 end if;
 select * into r from public.ech_access_requests where user_id=target for update;
 if not found or r.revision<>expected then raise sqlstate 'PT409' using message='Request changed; reload before reviewing';end if;
 previous=r.state;
 if (c->>'type'='deny' and r.state<>'pending') or (c->>'type'='revoke' and r.state<>'approved') then raise sqlstate 'PT409' using message='Decision does not match current request';end if;
 if not exists(select 1 from auth.users u where u.id=target and u.email_confirmed_at is not null and lower(u.email)=r.email) then raise sqlstate 'PT403' using message='Current verified identity required';end if;
 next_state=case c->>'type' when 'approve' then 'approved' when 'deny' then 'denied' else 'revoked' end;
 -- Every decision invalidates all previous application sessions. Reapproval needs a fresh sign-in.
 update public.ech_sessions set revoked_at=coalesce(revoked_at,now()) where user_id=target;
 if next_state='approved' then
  insert into public.ech_memberships(user_id,display_name,technical_admin,application_admin,operational_role,active,revision)
  values(target,r.display_name,false,false,role_value,true,1)
  on conflict(user_id) do update set display_name=excluded.display_name,technical_admin=false,application_admin=false,operational_role=excluded.operational_role,active=true,revision=public.ech_memberships.revision+1;
 else
  update public.ech_memberships set active=false,operational_role=null,technical_admin=false,application_admin=false,revision=revision+1 where user_id=target;
 end if;
 update public.ech_access_requests set state=next_state,approved_role=case when next_state='approved' then role_value else null end,decided_at=now(),decided_by=actor,revision=revision+1 where user_id=target returning * into r;
 result=jsonb_build_object('request',public.ech_access_projection(r),'receipt',jsonb_build_object('operationId',op,'expectedRevision',expected,'revision',r.revision,'commandFingerprint',hash));
 insert into public.ech_access_decisions(actor_id,operation_id,target_id,action,previous_state,next_state,approved_role,fingerprint,result) values(actor,op,target,c->>'type',previous,next_state,r.approved_role,hash,result);
 return result;
exception when invalid_text_representation or numeric_value_out_of_range then raise sqlstate 'PT400' using message='Invalid review command';
end;$$;

create or replace function public.ech_session_active() returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.ech_sessions s join public.ech_memberships m on m.user_id=s.user_id
 where s.user_id=auth.uid() and s.session_id=(auth.jwt()->>'session_id')::uuid and s.revoked_at is null and s.expires_at>now()
 and s.created_at+interval '7 days'>now() and m.active
 and not exists(select 1 from public.ech_access_requests r where r.user_id=m.user_id and (r.state<>'approved' or r.approved_role is distinct from m.operational_role or m.application_admin or m.technical_admin or not exists(select 1 from auth.users u where u.id=m.user_id and u.email_confirmed_at is not null and lower(u.email)=r.email))));
$$;
-- Block the legacy grant form from bypassing an applicant's explicit review decision.
alter function public.ech_membership_commit(jsonb) rename to ech_membership_commit_existing;
revoke all on function public.ech_membership_commit_existing(jsonb) from public,anon,authenticated;
create function public.ech_membership_commit(p_envelope jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
begin
 if not public.ech_application_admin() then raise sqlstate 'PT403' using message='Action forbidden';end if;
 perform pg_advisory_xact_lock(617243902117::bigint);
 if exists(select 1 from auth.users u where lower(u.email)=p_envelope#>>'{command,email}' and (exists(select 1 from public.ech_access_requests r where r.user_id=u.id) or (exists(select 1 from auth.identities i where i.user_id=u.id and i.provider='google') and not exists(select 1 from public.ech_preapproved_members p where p.user_id=u.id)))) then raise sqlstate 'PT403' using message='Use account request review for this account';end if;
 return public.ech_membership_commit_existing(p_envelope);
end;$$;

-- Configure this hook before allowing Google identity creation. Other signup providers stay blocked.
create function public.ech_before_user_created(event jsonb) returns jsonb language plpgsql set search_path='' as $$
begin
 if event#>>'{user,app_metadata,provider}' is distinct from 'google' then return jsonb_build_object('error',jsonb_build_object('http_code',403,'message','Use Google to request ECH access.'));end if;
 return '{}'::jsonb;
end;$$;
revoke all on function public.ech_before_user_created(jsonb) from public,anon,authenticated;
grant usage on schema public to supabase_auth_admin;
grant execute on function public.ech_before_user_created(jsonb) to supabase_auth_admin;
revoke all on function public.ech_access_reviewer(),public.ech_access_projection(public.ech_access_requests),public.ech_request_access(),public.ech_access_requests(),public.ech_review_access(jsonb),public.ech_membership_commit(jsonb) from public,anon,authenticated;
grant execute on function public.ech_access_reviewer(),public.ech_request_access(),public.ech_access_requests(),public.ech_review_access(jsonb),public.ech_membership_commit(jsonb) to authenticated;
commit;
