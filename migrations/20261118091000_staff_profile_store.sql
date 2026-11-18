-- Staff Profile Page: storage foundation only. No application route, grants,
-- notification transport, object bucket, rollout, policy selection, or data seed.
begin;

create table public.ech_staff_profiles (
  staff_id uuid primary key,
  revision bigint not null check (revision between 1 and 9007199254740991),
  storage_version bigint not null check (storage_version between revision and 9007199254740991),
  public_fields jsonb not null check (
    jsonb_typeof(public_fields)='object' and
    public_fields - array['workerType','availability','vacationStart','vacationEnd','photo','credentials']::text[]='{}'::jsonb
    and octet_length(public_fields::text)<=50000
  )
);

create table public.ech_staff_profile_management (
  staff_id uuid primary key references public.ech_staff_profiles(staff_id),
  private_fields jsonb not null check (
    jsonb_typeof(private_fields)='object' and
    private_fields - array['payGrade','hourlyRate','performance']::text[]='{}'::jsonb
    and octet_length(private_fields::text)<=20000
  )
);

create table public.ech_staff_profile_pending (
  staff_id uuid primary key references public.ech_staff_profiles(staff_id),
  submission_id uuid unique not null,
  expected_revision bigint not null check (expected_revision between 1 and 9007199254740991),
  submitted_by uuid not null check (submitted_by=staff_id),
  submitted_at timestamptz not null check (isfinite(submitted_at)),
  changes jsonb not null check (
    jsonb_typeof(changes)='object' and changes<>'{}'::jsonb and
    changes - array['workerType','availability','vacationStart','vacationEnd','photo','credentials']::text[]='{}'::jsonb
    and octet_length(changes::text)<=50000
  )
);

create table public.ech_staff_profile_events (
  staff_id uuid not null references public.ech_staff_profiles(staff_id),
  storage_version bigint not null check (storage_version between 1 and 9007199254740991),
  action text not null check (action in ('initialized','submitted','approved','admin_saved','credential_verified')),
  actor_id uuid not null,
  recorded_at timestamptz not null check (isfinite(recorded_at)),
  submission_id uuid,
  credential_id text check (credential_id is null or length(credential_id) between 1 and 100),
  primary key (staff_id,storage_version),
  check ((action in ('submitted','approved'))=(submission_id is not null)),
  check ((action='credential_verified')=(credential_id is not null))
);

alter table public.ech_staff_profiles enable row level security;
alter table public.ech_staff_profile_management enable row level security;
alter table public.ech_staff_profile_pending enable row level security;
alter table public.ech_staff_profile_events enable row level security;

create function public.ech_staff_profile_keep_event_history() returns trigger
language plpgsql set search_path='' as $$
begin
  raise exception 'Staff profile history is append-only';
end;
$$;
create trigger ech_staff_profile_immutable_events before update or delete or truncate
on public.ech_staff_profile_events for each statement execute function public.ech_staff_profile_keep_event_history();

-- Owner-only storage snapshots for a future trusted repository adapter.
-- Never return this snapshot wholesale on a client-facing route.
create function public.ech_staff_profile_store_read(p_staff uuid) returns jsonb
language plpgsql stable set search_path='' as $$
declare
  target public.ech_memberships;
  actor public.ech_memberships;
  can_manage boolean;
begin
  if public.ech_session_active() is not true then raise sqlstate 'PT403';end if;
  select m.* into actor from public.ech_memberships m where m.user_id=auth.uid() and m.active;
  if not found then raise sqlstate 'PT403';end if;
  select m.* into target from public.ech_memberships m where m.user_id=p_staff and m.active and m.operational_role='staff'
    and not m.application_admin and not m.technical_admin and not m.delegated_user_admin;
  if not found then raise sqlstate 'PT403';end if;
  can_manage:=actor.application_admin or (actor.delegated_user_admin and actor.operational_role='manager'
    and not actor.technical_admin and public.ech_managed_account(target));
  if not can_manage and actor.user_id<>p_staff then raise sqlstate 'PT403';end if;
  return (
    select jsonb_build_object('storageVersion',p.storage_version,
     'profile',p.public_fields || jsonb_build_object('id',p.staff_id,'name',target.display_name,'revision',p.revision)
       || case when can_manage then coalesce(m.private_fields,'{}'::jsonb) else '{}'::jsonb end,
     'pending',case when q.staff_id is null then null
       when can_manage then jsonb_build_object('id',q.submission_id,'actor',q.submitted_by,'expectedRevision',q.expected_revision,'submittedAt',q.submitted_at,'changes',q.changes,'stale',q.expected_revision<>p.revision)
       else jsonb_build_object('id',q.submission_id,'submittedAt',q.submitted_at,'status','pending_review','stale',q.expected_revision<>p.revision) end)
    from public.ech_staff_profiles p
    left join public.ech_staff_profile_management m using (staff_id)
    left join public.ech_staff_profile_pending q using (staff_id)
    where p.staff_id=p_staff
  );
end;
$$;

-- Persist one accepted workflow transition under the exact current storage
-- version. Staff self-submission never updates the canonical profile; approved
-- updates consume exactly the pending changes. All timestamps are server-owned.
-- Submitted profile fields are unverified. Verification/attachment authority
-- is separate; this function exposes no media or direct identity/account edits.
create function public.ech_staff_profile_store_write(
 p_staff uuid,p_expected_version bigint,p_action text,p_changes jsonb,
 p_submission uuid default null,p_credential text default null
) returns jsonb language plpgsql volatile set search_path='' as $$
declare
  actor public.ech_memberships;
  target public.ech_memberships;
  saved public.ech_staff_profiles;
  pending public.ech_staff_profile_pending;
  can_manage boolean;
  next_public jsonb;
  next_private jsonb;
  update_fields jsonb;
  check_credential jsonb;
  profile_field record;
  merged_from date;
  merged_to date;
  next_version bigint;
  found_credential boolean:=false;
  timestamp_now timestamptz:=clock_timestamp();
begin
  if public.ech_session_active() is not true or p_expected_version is null or p_expected_version<0 or
    p_expected_version>=9007199254740991 or p_action is null or
    p_action not in ('initialized','submitted','approved','admin_saved','credential_verified') then
    raise sqlstate 'PT403';
  end if;
  select m.* into actor from public.ech_memberships m where m.user_id=auth.uid() and m.active for share;
  if not found then raise sqlstate 'PT403';end if;
  select m.* into target from public.ech_memberships m where m.user_id=p_staff and m.active and m.operational_role='staff'
    and not m.application_admin and not m.technical_admin and not m.delegated_user_admin for share;
  if not found then raise sqlstate 'PT403';end if;
  can_manage:=actor.application_admin or (actor.delegated_user_admin and actor.operational_role='manager'
    and not actor.technical_admin and public.ech_managed_account(target));
  if p_action='submitted' then
    if actor.user_id<>p_staff or can_manage then raise sqlstate 'PT403';end if;
  elsif not can_manage then raise sqlstate 'PT403';
  end if;
  if (p_action in ('submitted','approved')) is distinct from (p_submission is not null)
   or (p_action='credential_verified') is distinct from (p_credential is not null) then raise sqlstate 'PT400';end if;
  if p_action in ('submitted','admin_saved') and (
    jsonb_typeof(p_changes) is distinct from 'object' or p_changes='{}'::jsonb
    or octet_length(p_changes::text)>70000
    or p_changes - array['workerType','availability','vacationStart','vacationEnd','photo','credentials','payGrade','hourlyRate','performance']::text[] <> '{}'::jsonb
    or (p_action='submitted' and p_changes ?| array['payGrade','hourlyRate','performance'])
  ) then raise sqlstate 'PT400';end if;
  if p_action not in ('submitted','admin_saved') and p_changes is not null then raise sqlstate 'PT400';end if;

  select p.* into saved from public.ech_staff_profiles p where p.staff_id=p_staff for update;
  if p_action='initialized' then
    if found or p_expected_version<>0 then raise sqlstate 'PT409';end if;
    insert into public.ech_staff_profiles(staff_id,revision,storage_version,public_fields) values(p_staff,1,1,'{}')
    on conflict do nothing;
    if not found then raise sqlstate 'PT409';end if;
    next_version:=1;
  else
    if not found or saved.storage_version<>p_expected_version then raise sqlstate 'PT409';end if;
    next_version:=saved.storage_version+1;
    select q.* into pending from public.ech_staff_profile_pending q where q.staff_id=p_staff;
    if p_action='approved' then
      if not found or pending.submission_id<>p_submission or pending.expected_revision<>saved.revision then raise sqlstate 'PT409';end if;
      update_fields:=pending.changes;
    else
      if found and p_action in ('submitted','credential_verified') then raise sqlstate 'PT409';end if;
      update_fields:=coalesce(p_changes,'{}'::jsonb);
    end if;
    for profile_field in select key,value from jsonb_each(update_fields)
      where key not in ('photo','credentials')
    loop
      if jsonb_typeof(profile_field.value) is distinct from 'string' or length(profile_field.value #>> '{}')>2000 then
        raise sqlstate 'PT400';end if;
    end loop;
    if update_fields ? 'workerType' and update_fields->>'workerType' not in ('','care_aide','lpn','rn') then raise sqlstate 'PT400';end if;
    if update_fields ? 'photo' and update_fields->'photo'<>'null'::jsonb then
      if jsonb_typeof(update_fields->'photo') is distinct from 'object'
         or not ((update_fields->'photo') ?& array['objectKey','contentType'])
         or (update_fields->'photo') - array['objectKey','contentType']::text[] <> '{}'::jsonb
         or jsonb_typeof(update_fields#>'{photo,objectKey}') is distinct from 'string'
         or length(update_fields#>>'{photo,objectKey}') not between 1 and 300
         or (update_fields#>>'{photo,objectKey}') ~ '(^//|:|[[:cntrl:]])'
         or not coalesce(update_fields#>>'{photo,contentType}' in ('image/jpeg','image/png','image/webp'),false)
      then raise sqlstate 'PT400';end if;
    end if;
    next_public:=saved.public_fields || (update_fields - array['payGrade','hourlyRate','performance']::text[]);
    if coalesce(next_public->>'vacationStart','')<>'' or coalesce(next_public->>'vacationEnd','')<>'' then
      if not coalesce((next_public->>'vacationStart') ~ '^\d{4}-\d{2}-\d{2}$'
          and (next_public->>'vacationEnd') ~ '^\d{4}-\d{2}-\d{2}$',false)
        then raise sqlstate 'PT400';end if;
      begin
        merged_from:=(next_public->>'vacationStart')::date;
        merged_to:=(next_public->>'vacationEnd')::date;
      exception when invalid_datetime_format or datetime_field_overflow then raise sqlstate 'PT400';end;
      if merged_from>merged_to then raise sqlstate 'PT400';end if;
    end if;
    if update_fields ? 'credentials' then
      if jsonb_typeof(update_fields->'credentials') is distinct from 'array' then raise sqlstate 'PT400';end if;
      if jsonb_array_length(update_fields->'credentials')>50 then raise sqlstate 'PT400';end if;
      for check_credential in select value from jsonb_array_elements(update_fields->'credentials') loop
        if jsonb_typeof(check_credential) is distinct from 'object'
           or (p_action<>'approved' and (coalesce(check_credential->'verifiedBy','null'::jsonb)<>'null'::jsonb
           or coalesce(check_credential->'verifiedAt','null'::jsonb)<>'null'::jsonb)) then raise sqlstate 'PT400';end if;
      end loop;
    end if;
    -- Adding one credential must not erase verification of unchanged ones.
    if update_fields ? 'credentials' then
      select coalesce(jsonb_agg(c.value || jsonb_build_object(
        'verifiedBy',old.value->'verifiedBy','verifiedAt',old.value->'verifiedAt') order by c.ordinality),'[]'::jsonb)
      into check_credential
      from jsonb_array_elements(update_fields->'credentials') with ordinality c(value,ordinality)
      left join lateral (select value from jsonb_array_elements(coalesce(saved.public_fields->'credentials','[]'::jsonb))
        where value->>'id'=c.value->>'id' and value->>'name'=c.value->>'name'
          and value->'expiresOn'=c.value->'expiresOn' limit 1) old on true;
      update_fields:=jsonb_set(update_fields,'{credentials}',check_credential);
      next_public:=jsonb_set(next_public,'{credentials}',check_credential);
    end if;
    if p_action='submitted' then
      insert into public.ech_staff_profile_pending(staff_id,submission_id,expected_revision,submitted_by,submitted_at,changes)
        values(p_staff,p_submission,saved.revision,actor.user_id,timestamp_now,update_fields);
      update public.ech_staff_profiles set storage_version=next_version where staff_id=p_staff;
    else
      if p_action='credential_verified' then
        select jsonb_agg(case when e.value->>'id'=p_credential then e.value ||
           jsonb_build_object('verifiedBy',actor.user_id,'verifiedAt',timestamp_now) else e.value end order by e.ordinality),
           coalesce(bool_or(e.value->>'id'=p_credential),false)
        into check_credential,found_credential
        from jsonb_array_elements(coalesce(next_public->'credentials','[]'::jsonb)) with ordinality e(value,ordinality);
        if not found_credential then raise sqlstate 'PT409';end if;
        next_public:=jsonb_set(next_public,'{credentials}',check_credential);
      end if;
      select coalesce(jsonb_object_agg(key,value),'{}'::jsonb) into next_private
        from jsonb_each(update_fields) where key in ('payGrade','hourlyRate','performance');
      if next_private<>'{}'::jsonb then
        insert into public.ech_staff_profile_management as m(staff_id,private_fields) values(p_staff,next_private)
        on conflict(staff_id) do update set private_fields=m.private_fields || excluded.private_fields;
      end if;
      update public.ech_staff_profiles set public_fields=next_public,revision=saved.revision+1,storage_version=next_version where staff_id=p_staff;
      if p_action='approved' then delete from public.ech_staff_profile_pending where staff_id=p_staff and submission_id=p_submission;
      elsif p_action='admin_saved' then delete from public.ech_staff_profile_pending where staff_id=p_staff;end if;
    end if;
  end if;
  if public.ech_session_active() is not true then raise sqlstate 'PT403';end if;
  insert into public.ech_staff_profile_events(staff_id,storage_version,action,actor_id,recorded_at,submission_id,credential_id)
   values(p_staff,next_version,p_action,actor.user_id,timestamp_now,p_submission,p_credential);
  return jsonb_build_object('storageVersion',next_version,
    'status',case when p_action='submitted' then 'pending_review' else 'saved' end,'submissionId',p_submission);
end;
$$;

revoke all on table public.ech_staff_profiles,public.ech_staff_profile_management,
  public.ech_staff_profile_pending,public.ech_staff_profile_events from public,anon,authenticated,service_role;
revoke all on function public.ech_staff_profile_keep_event_history(),public.ech_staff_profile_store_read(uuid),
  public.ech_staff_profile_store_write(uuid,bigint,text,jsonb,uuid,text) from public,anon,authenticated,service_role;

-- Explicit hosted defaults may grant other roles; remove every non-owner ACL.
do $$
declare entry record;
begin
 for entry in
  select distinct c.oid::regclass as relation,r.rolname
  from pg_catalog.pg_class c cross join lateral pg_catalog.aclexplode(coalesce(c.relacl,pg_catalog.acldefault('r',c.relowner))) a
  join pg_catalog.pg_roles r on r.oid=a.grantee
  where c.oid in ('public.ech_staff_profiles'::regclass,'public.ech_staff_profile_management'::regclass,'public.ech_staff_profile_pending'::regclass,'public.ech_staff_profile_events'::regclass)
    and a.grantee<>c.relowner
 loop execute format('revoke all on table %s from %I',entry.relation,entry.rolname);end loop;
 for entry in
  select distinct p.oid::regprocedure as function_name,r.rolname
  from pg_catalog.pg_proc p cross join lateral pg_catalog.aclexplode(coalesce(p.proacl,pg_catalog.acldefault('f',p.proowner))) a
  join pg_catalog.pg_roles r on r.oid=a.grantee
  where p.oid in ('public.ech_staff_profile_keep_event_history()'::regprocedure,'public.ech_staff_profile_store_read(uuid)'::regprocedure,'public.ech_staff_profile_store_write(uuid,bigint,text,jsonb,uuid,text)'::regprocedure)
    and a.grantee<>p.proowner
 loop execute format('revoke all on function %s from %I',entry.function_name,entry.rolname);end loop;
end;
$$;
commit;
