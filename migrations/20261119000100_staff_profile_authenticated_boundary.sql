-- Enable only the existing Staff Profile text/credential workflow.
-- Separate pending/stored photo linkage and Storage ACLs are not activated here.
begin;

-- Preserve the reviewed storage bodies and their owner-only ACL rather than
-- making their unprojected/less constrained interfaces callable from PostgREST.
do $$
begin
  if exists (
    select from pg_catalog.pg_proc p
    where p.oid in ('public.ech_staff_profile_store_read(uuid)'::regprocedure,
      'public.ech_staff_profile_store_write(uuid,bigint,text,jsonb,uuid,text)'::regprocedure)
      and (p.proowner<>(select r.oid from pg_catalog.pg_roles r where r.rolname=current_user) or p.prosecdef)
  ) then raise exception 'Staff profile backing routine ownership/mode differs'; end if;
end;
$$;

alter function public.ech_staff_profile_store_read(uuid) rename to ech_staff_profile_store_read_private;
alter function public.ech_staff_profile_store_write(uuid,bigint,text,jsonb,uuid,text) rename to ech_staff_profile_store_write_private;

-- Project known scalar values and credential fields only. Photo object keys
-- are intentionally absent from this callable contract.
create function public.ech_staff_profile_project_fields(p_fields jsonb,p_allowed text[]) returns jsonb
language sql immutable set search_path='' as $$
  select coalesce(jsonb_object_agg(f.key,
    case when f.key='credentials' then coalesce((
      select jsonb_agg((
        select coalesce(jsonb_object_agg(k.key,k.value),'{}'::jsonb)
        from jsonb_each(c.value) k
        where k.key in ('id','name','expiresOn','verifiedBy','verifiedAt')
          and jsonb_typeof(k.value) in ('string','null')
      ) order by c.ord)
      from jsonb_array_elements(f.value) with ordinality c(value,ord)
      where jsonb_typeof(c.value)='object'
        and jsonb_typeof(c.value->'id')='string'
        and jsonb_typeof(c.value->'name')='string'
        and jsonb_typeof(c.value->'expiresOn') in ('string','null')
    ),'[]'::jsonb) else f.value end
  ),'{}'::jsonb)
  from jsonb_each(case when jsonb_typeof(p_fields)='object' then p_fields else '{}'::jsonb end) f
  where f.key=any(p_allowed) and
    ((f.key='credentials' and jsonb_typeof(f.value)='array')
       or (f.key<>'credentials' and jsonb_typeof(f.value)='string'));
$$;

create function public.ech_staff_profile_validate_callable_fields(p_fields jsonb,p_approval boolean) returns void
language plpgsql immutable set search_path='' as $$
declare
  credential jsonb;
  ids text[]:='{}'::text[];
  expiry text;
begin
  if jsonb_typeof(p_fields) is distinct from 'object' or p_fields='{}'::jsonb
    or p_fields ? 'photo' then
    raise sqlstate 'PT400' using message='Invalid staff profile fields or photo not enabled';
  end if;
  if not p_fields ? 'credentials' then return; end if;
  if jsonb_typeof(p_fields->'credentials') is distinct from 'array' then raise sqlstate 'PT400'; end if;
  if jsonb_array_length(p_fields->'credentials')>50 then raise sqlstate 'PT400'; end if;
  for credential in select value from jsonb_array_elements(p_fields->'credentials') loop
    if jsonb_typeof(credential) is distinct from 'object'
      or not credential ?& array['id','name','expiresOn']
      or credential - array['id','name','expiresOn','verifiedBy','verifiedAt']::text[] <> '{}'::jsonb
      or jsonb_typeof(credential->'id') is distinct from 'string'
      or length(credential->>'id') not between 1 and 100
      or credential->>'id'=any(ids)
      or jsonb_typeof(credential->'name') is distinct from 'string'
      or length(credential->>'name') not between 1 and 200
      or (credential->>'name') ~ '^[[:space:]]|[[:space:]]$'
      or (not p_approval and (coalesce(credential->'verifiedBy','null'::jsonb)<>'null'::jsonb
        or coalesce(credential->'verifiedAt','null'::jsonb)<>'null'::jsonb))
      or (p_approval and (coalesce(jsonb_typeof(credential->'verifiedBy'),'null') not in ('string','null')
        or coalesce(jsonb_typeof(credential->'verifiedAt'),'null') not in ('string','null')))
    then raise sqlstate 'PT400' using message='Invalid staff credential'; end if;
    ids:=array_append(ids,credential->>'id');
    if credential->'expiresOn'<>'null'::jsonb then
      if jsonb_typeof(credential->'expiresOn') is distinct from 'string' then raise sqlstate 'PT400'; end if;
      expiry:=credential->>'expiresOn';
      if expiry !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then raise sqlstate 'PT400'; end if;
      begin
        perform make_date(substr(expiry,1,4)::integer,substr(expiry,6,2)::integer,substr(expiry,9,2)::integer);
      exception when datetime_field_overflow then raise sqlstate 'PT400';
      end;
    end if;
  end loop;
end;
$$;

-- Same route contract: the private routine checks authenticated identity,
-- session, current membership, and exact subject before reading any data.
create function public.ech_staff_profile_store_read(p_staff uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare
  snapshot jsonb;
  details jsonb;
  pending jsonb;
  exposed_pending jsonb;
  profile_fields text[]:=array['workerType','availability','vacationStart','vacationEnd','credentials'];
begin
  snapshot:=public.ech_staff_profile_store_read_private(p_staff);
  if snapshot is null then return null; end if;
  details:=snapshot->'profile';
  pending:=snapshot->'pending';
  if jsonb_typeof(pending)='object' then
    exposed_pending:=jsonb_build_object('id',pending->'id','submittedAt',pending->'submittedAt',
      'status','pending_review','stale',pending->'stale');
    -- Only the existing management branch in the private scoped read emits
    -- this key; the staff branch never does.
    if pending ? 'changes' then exposed_pending:=exposed_pending || jsonb_build_object(
      'changes',public.ech_staff_profile_project_fields(pending->'changes',profile_fields));
    end if;
  end if;
  -- Private fields only exist in the backing routine's management projection.
  return jsonb_build_object('storageVersion',snapshot->'storageVersion',
    'profile',jsonb_build_object('id',details->'id','name',details->'name','revision',details->'revision')
      || public.ech_staff_profile_project_fields(details,profile_fields || array['payGrade','hourlyRate','performance']),
    'pending',exposed_pending);
end;
$$;

create function public.ech_staff_profile_store_write(
 p_staff uuid,p_expected_version bigint,p_action text,p_changes jsonb,
 p_submission uuid default null,p_credential text default null
) returns jsonb
language plpgsql volatile security definer set search_path='' as $$
declare
  actor public.ech_memberships;
  target public.ech_memberships;
  saved public.ech_staff_profiles;
  pending public.ech_staff_profile_pending;
  can_manage boolean;
begin
  if public.ech_session_active() is not true or p_staff is null or p_expected_version is null
    or p_expected_version<0 or p_expected_version>=9007199254740991 or p_action is null
    or p_action not in ('initialized','submitted','approved','admin_saved','credential_verified')
  then raise sqlstate 'PT403'; end if;
  -- Same lock order and authority as the backing routine. The private write
  -- repeats these checks, including before committing its event receipt.
  select m.* into actor from public.ech_memberships m where m.user_id=auth.uid() and m.active for share;
  if not found then raise sqlstate 'PT403'; end if;
  select m.* into target from public.ech_memberships m where m.user_id=p_staff and m.active and m.operational_role='staff'
    and not m.application_admin and not m.technical_admin and not m.delegated_user_admin for share;
  if not found then raise sqlstate 'PT403'; end if;
  can_manage:=actor.application_admin or (actor.delegated_user_admin and actor.operational_role='manager'
    and not actor.technical_admin and public.ech_managed_account(target));
  if p_action='submitted' then
    if actor.user_id is distinct from p_staff or can_manage is not false then raise sqlstate 'PT403'; end if;
  elsif can_manage is not true then raise sqlstate 'PT403';
  end if;
  if (p_action in ('submitted','approved')) is distinct from (p_submission is not null)
    or (p_action='credential_verified') is distinct from (p_credential is not null)
    or (p_credential is not null and length(p_credential) not between 1 and 100)
    or (p_action not in ('submitted','admin_saved') and p_changes is not null)
  then raise sqlstate 'PT400'; end if;
  if p_action in ('submitted','admin_saved') then
    perform public.ech_staff_profile_validate_callable_fields(p_changes,false);
  elsif p_action='approved' then
    -- Hold this exact profile and pending payload until the backing operation
    -- has consumed it. Never validate one payload and approve another.
    select p.* into saved from public.ech_staff_profiles p where p.staff_id=p_staff for update;
    if not found or saved.storage_version<>p_expected_version then raise sqlstate 'PT409'; end if;
    select q.* into pending from public.ech_staff_profile_pending q where q.staff_id=p_staff for update;
    if not found or pending.submission_id is distinct from p_submission
      or pending.expected_revision<>saved.revision then raise sqlstate 'PT409'; end if;
    perform public.ech_staff_profile_validate_callable_fields(pending.changes,true);
  end if;
  return public.ech_staff_profile_store_write_private(
    p_staff,p_expected_version,p_action,p_changes,p_submission,p_credential);
end;
$$;

revoke all on function public.ech_staff_profile_project_fields(jsonb,text[]),
  public.ech_staff_profile_validate_callable_fields(jsonb,boolean),
  public.ech_staff_profile_store_read_private(uuid),
  public.ech_staff_profile_store_write_private(uuid,bigint,text,jsonb,uuid,text),
  public.ech_staff_profile_store_read(uuid),
  public.ech_staff_profile_store_write(uuid,bigint,text,jsonb,uuid,text)
  from public,anon,authenticated,service_role;

-- Remove any additional non-owner grants from hosted default ACLs, just as
-- the foundation migration does. Do not write table ACLs or broaden roles.
do $$
declare item record;
begin
  for item in
    select distinct p.oid::regprocedure as routine,r.rolname
    from pg_catalog.pg_proc p cross join lateral pg_catalog.aclexplode(p.proacl) a
    join pg_catalog.pg_roles r on r.oid=a.grantee
    where p.oid in ('public.ech_staff_profile_project_fields(jsonb,text[])'::regprocedure,
      'public.ech_staff_profile_validate_callable_fields(jsonb,boolean)'::regprocedure,
      'public.ech_staff_profile_store_read_private(uuid)'::regprocedure,
      'public.ech_staff_profile_store_write_private(uuid,bigint,text,jsonb,uuid,text)'::regprocedure,
      'public.ech_staff_profile_store_read(uuid)'::regprocedure,
      'public.ech_staff_profile_store_write(uuid,bigint,text,jsonb,uuid,text)'::regprocedure)
      and a.grantee<>p.proowner
  loop execute format('revoke all on function %s from %I',item.routine,item.rolname); end loop;
end;
$$;

grant execute on function public.ech_staff_profile_store_read(uuid),
  public.ech_staff_profile_store_write(uuid,bigint,text,jsonb,uuid,text) to authenticated;

-- Fail closed if inherited effective permissions differ from the contract.
do $$
declare
  role_name text;
  routine_name text;
  table_name text;
begin
  foreach role_name in array array['anon','authenticated','service_role'] loop
    foreach routine_name in array array['public.ech_staff_profile_store_read_private(uuid)',
      'public.ech_staff_profile_store_write_private(uuid,bigint,text,jsonb,uuid,text)',
      'public.ech_staff_profile_project_fields(jsonb,text[])',
      'public.ech_staff_profile_validate_callable_fields(jsonb,boolean)'] loop
      if has_function_privilege(role_name,routine_name,'EXECUTE') then
        raise exception 'Unexpected inherited private staff profile execute'; end if;
    end loop;
    foreach routine_name in array array['public.ech_staff_profile_store_read(uuid)',
      'public.ech_staff_profile_store_write(uuid,bigint,text,jsonb,uuid,text)'] loop
      if has_function_privilege(role_name,routine_name,'EXECUTE') is distinct from (role_name='authenticated') then
        raise exception 'Unexpected callable staff profile execute boundary'; end if;
    end loop;
    foreach table_name in array array['public.ech_staff_profiles','public.ech_staff_profile_management',
      'public.ech_staff_profile_pending','public.ech_staff_profile_events'] loop
      if has_table_privilege(role_name,table_name,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') then
        raise exception 'Unexpected inherited staff profile table privilege'; end if;
    end loop;
  end loop;
end;
$$;

commit;
