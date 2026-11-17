-- Local source draft only. No application grants or activation.
-- Existing plan tokens and reservation envelopes are not changed.
begin;

-- One immutable operational timing record may be attached to an already
-- authored plan version. A separate authorized writer and full validator are
-- required before this private table can accept application data.
create table public.ech_operational_timing_versions (
  client_id uuid not null,
  instructions_version bigint not null,
  plan_token text not null check (plan_token ~ '^[0-9a-f]{64}$'),
  entries jsonb not null check (jsonb_typeof(entries)='array' and octet_length(entries::text)<=100000),
  author_id uuid not null references public.ech_memberships(user_id),
  request_id uuid not null,
  membership_revision bigint not null check (membership_revision between 1 and 9007199254740991),
  source_reference text not null check (length(btrim(source_reference)) between 1 and 256),
  authored_at timestamptz not null default clock_timestamp() check (isfinite(authored_at)),
  primary key(client_id,instructions_version),
  unique(author_id,request_id),
  foreign key(client_id,instructions_version) references public.ech_task_plan_versions(client_id,instructions_version)
);

-- Validate every client-supplied civil boundary against the same Vancouver
-- resolver used by recurrence. This deliberately rejects repeated/gap times.
create function public.ech_operational_timing_boundary_valid(p jsonb)
returns boolean language plpgsql stable set search_path='' set timezone='UTC' as $$
declare civil timestamp; instant timestamptz; offset_minutes numeric;
begin
  if jsonb_typeof(p) is distinct from 'object' or not(p ?& array['local','zone','instant','offsetMinutes'])
    or p-array['local','zone','instant','offsetMinutes']<>'{}'::jsonb
    or p->>'zone' is distinct from 'America/Vancouver'
    or jsonb_typeof(p->'local') is distinct from 'string'
    or coalesce(p->>'local','') !~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}$'
    or jsonb_typeof(p->'instant') is distinct from 'string'
    or jsonb_typeof(p->'offsetMinutes') is distinct from 'number' then return false;end if;
  civil:=(p->>'local')::timestamp;
  if to_char(civil,'YYYY-MM-DD"T"HH24:MI:SS.MS') is distinct from p->>'local' then return false;end if;
  instant:=public.ech_schedule_recurrence_instant(civil);
  offset_minutes:=extract(epoch from ((civil at time zone 'UTC')-instant))/60;
  return p->>'instant'=to_char(instant at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
    and (p->>'offsetMinutes')::numeric=offset_minutes;
exception when invalid_datetime_format or datetime_field_overflow or numeric_value_out_of_range then return false;
end;$$;

-- Require exact category/task identity and order from the existing immutable
-- plan. Only flexible and suggested operational timing are accepted.
create function public.ech_operational_timing_entries_valid(p_entries jsonb,p_plan jsonb)
returns boolean language plpgsql stable set search_path='' as $$
declare c jsonb;t jsonb;timing jsonb;target jsonb;plain_categories jsonb:='[]'::jsonb;plain_tasks jsonb;
begin
  if jsonb_typeof(p_entries) is distinct from 'array' or jsonb_typeof(p_plan) is distinct from 'array'
    or octet_length(p_entries::text)>100000 or jsonb_array_length(p_entries)>20 then return false;end if;
  for c in select value from jsonb_array_elements(p_entries) loop
    if jsonb_typeof(c) is distinct from 'object' or not(c ?& array['id','label','tasks'])
      or c-array['id','label','tasks']<>'{}'::jsonb or jsonb_typeof(c->'tasks') is distinct from 'array' then return false;end if;
    plain_tasks:='[]'::jsonb;
    for t in select value from jsonb_array_elements(c->'tasks') loop
      if jsonb_typeof(t) is distinct from 'object' or not(t ?& array['id','text','timing'])
        or t-array['id','text','timing']<>'{}'::jsonb then return false;end if;
      timing:=t->'timing';
      if jsonb_typeof(timing) is distinct from 'object' then return false;end if;
      if timing->>'kind'='flexible' then
        if timing<>'{"kind":"flexible"}'::jsonb then return false;end if;
      elsif timing->>'kind'='suggested' then
        if not(timing ?& array['kind','target']) or timing-array['kind','target']<>'{}'::jsonb then return false;end if;
        target:=timing->'target';
        if jsonb_typeof(target) is distinct from 'object' then return false;end if;
        if target->>'kind'='point' then
          if not(target ?& array['kind','at']) or target-array['kind','at']<>'{}'::jsonb
            or not public.ech_operational_timing_boundary_valid(target->'at') then return false;end if;
        elsif target->>'kind'='window' then
          if not(target ?& array['kind','start','end']) or target-array['kind','start','end']<>'{}'::jsonb
            or not public.ech_operational_timing_boundary_valid(target->'start')
            or not public.ech_operational_timing_boundary_valid(target->'end')
            or (target->'start'->>'instant') >= (target->'end'->>'instant') then return false;end if;
        else return false;end if;
      else return false;end if;
      plain_tasks:=plain_tasks||jsonb_build_array(jsonb_build_object('id',t->'id','text',t->'text'));
    end loop;
    plain_categories:=plain_categories||jsonb_build_array(jsonb_build_object('id',c->'id','label',c->'label','tasks',plain_tasks));
  end loop;
  return plain_categories=p_plan;
end;$$;

-- Only the existing manager author contract can prepare a timing version.
-- Exact request retries return the same immutable row; changed inputs conflict.
create function public.ech_operations_operational_timing_author(p_role text,p_revision bigint,p_client uuid,p_version bigint,
  p_plan_token text,p_request uuid,p_entries jsonb,p_source_reference text)
returns jsonb language plpgsql volatile security definer set search_path='' set timezone='UTC' as $$
declare current_plan jsonb; existing public.ech_operational_timing_versions; saved public.ech_operational_timing_versions;
begin
  perform public.ech_task_plan_manager_enter(p_role,p_revision);
  if p_client is null or p_request is null or p_version is null or p_version not between 1 and 9007199254740991
    or p_plan_token is null or p_plan_token !~ '^[0-9a-f]{64}$'
    or not public.ech_task_plan_text(p_source_reference,256) then raise sqlstate 'PT400' using message='Review operational timing source';end if;
  current_plan:=public.ech_operations_task_plan_read(p_role,p_revision,p_client,p_version);
  if current_plan->>'planToken' is distinct from p_plan_token or current_plan->'plan' is null
    or not public.ech_operational_timing_entries_valid(p_entries,current_plan->'plan'->'categories') then
    raise sqlstate 'PT409' using message='Review the exact task plan and operational timing';end if;
  select * into existing from public.ech_operational_timing_versions where author_id=auth.uid() and request_id=p_request;
  if found then
    if existing.client_id is distinct from p_client or existing.instructions_version is distinct from p_version
      or existing.membership_revision is distinct from p_revision or existing.plan_token is distinct from p_plan_token
      or existing.entries is distinct from p_entries or existing.source_reference is distinct from p_source_reference then
      raise sqlstate 'PT409' using message='Keep the original timing request';end if;
    saved:=existing;
  else
    insert into public.ech_operational_timing_versions(client_id,instructions_version,plan_token,entries,author_id,request_id,membership_revision,source_reference)
      values(p_client,p_version,p_plan_token,p_entries,auth.uid(),p_request,p_revision,p_source_reference) returning * into saved;
  end if;
  perform public.ech_schedule_check_series_access(p_role,p_revision);
  return to_jsonb(saved);
exception when unique_violation then raise sqlstate 'PT409' using message='Timing version or request already exists';
  when lock_not_available then raise sqlstate 'PT503' using message='Timing source access is changing';
end;$$;

-- Every new visit receives either the then-current immutable timing version or
-- explicit legacy unknown. This table never updates an existing visit plan.
create table public.ech_visit_operational_timing_snapshots (
  visit_id uuid primary key references public.ech_visit_task_plan_snapshots(visit_id),
  state text not null check(state in ('recorded','unknown')),
  timing_snapshot jsonb,
  captured_at timestamptz not null default clock_timestamp() check(isfinite(captured_at)),
  check ((state='unknown' and timing_snapshot is null) or
    (state='recorded' and jsonb_typeof(timing_snapshot)='object'))
);

-- Insertion occurs in the existing visit-creation transaction. The existing
-- dispatch advisory lock serializes plan authors and visit creation; this
-- trigger does not infer timing for visits that already exist.
create function public.ech_capture_visit_operational_timing()
returns trigger language plpgsql security definer set search_path='' set timezone='UTC' as $$
declare timing public.ech_operational_timing_versions;
begin
  select * into timing from public.ech_operational_timing_versions
    where client_id=(new.plan_snapshot->>'client_id')::uuid
      and instructions_version=(new.plan_snapshot->>'instructions_version')::bigint
      and plan_token=new.plan_token for share nowait;
  if found then
    insert into public.ech_visit_operational_timing_snapshots(visit_id,state,timing_snapshot)
      values(new.visit_id,'recorded',to_jsonb(timing));
  else
    insert into public.ech_visit_operational_timing_snapshots(visit_id,state,timing_snapshot)
      values(new.visit_id,'unknown',null);
  end if;
  return new;
exception when lock_not_available then raise sqlstate 'PT503' using message='Timing snapshot access is changing';
end;$$;
create trigger ech_capture_visit_operational_timing after insert on public.ech_visit_task_plan_snapshots
  for each row execute function public.ech_capture_visit_operational_timing();

-- Manager readback revalidates the exact current plan and source. Visit reads
-- use the existing current-visit/assignment boundary and omit author metadata.
create function public.ech_operations_operational_timing_read(p_role text,p_revision bigint,p_client uuid,p_version bigint,p_plan_token text)
returns jsonb language plpgsql volatile security definer set search_path='' set timezone='UTC' as $$
declare current_plan jsonb; timing public.ech_operational_timing_versions;
begin
  perform public.ech_task_plan_manager_enter(p_role,p_revision);
  current_plan:=public.ech_operations_task_plan_read(p_role,p_revision,p_client,p_version);
  if p_plan_token is null or current_plan->>'planToken' is distinct from p_plan_token then
    raise sqlstate 'PT409' using message='Review the exact task-plan source';end if;
  select * into timing from public.ech_operational_timing_versions where client_id=p_client and instructions_version=p_version for share nowait;
  if found and timing.plan_token is distinct from p_plan_token then raise sqlstate 'PT409' using message='Review the exact timing source';end if;
  perform public.ech_schedule_check_series_access(p_role,p_revision);
  return jsonb_build_object('clientId',p_client,'instructionsVersion',p_version,'membershipRevision',p_revision,
    'timing',case when timing.client_id is null then null else jsonb_build_object('entries',timing.entries,
      'authorId',timing.author_id,'sourceReference',timing.source_reference,'authoredAt',timing.authored_at) end);
exception when lock_not_available then raise sqlstate 'PT503' using message='Timing source access is changing';end;$$;

create function public.ech_operations_visit_operational_timing_read(p_visit uuid,p_visit_revision bigint,p_role text,p_membership_revision bigint)
returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare snapshot public.ech_visit_operational_timing_snapshots; visit_status text;
begin
  perform public.ech_operations_visit_detail(p_visit,p_visit_revision,p_role,p_membership_revision);
  select status into visit_status from public.ech_schedule_visits where id=p_visit for share nowait;
  if visit_status is null or visit_status in ('Completed','Cancelled') then raise sqlstate 'PT403' using message='Visit timing is unavailable';end if;
  select * into snapshot from public.ech_visit_operational_timing_snapshots where visit_id=p_visit for share nowait;
  perform public.ech_operations_visit_detail(p_visit,p_visit_revision,p_role,p_membership_revision);
  return jsonb_build_object('visitId',p_visit,'visitRevision',p_visit_revision,
    'state',case when snapshot.visit_id is null then 'unknown' else snapshot.state end,
    'entries',case when snapshot.state='recorded' then snapshot.timing_snapshot->'entries' else null end);
exception when lock_not_available then raise sqlstate 'PT503' using message='Visit timing access is changing';end;$$;

do $$declare n text;r record;begin
  foreach n in array array['ech_operational_timing_versions','ech_visit_operational_timing_snapshots'] loop
    execute format('alter table public.%I enable row level security',n);
    execute format('create trigger ech_timing_keep_history before update or delete or truncate on public.%I for each statement execute function public.ech_schedule_keep_history()',n);
    execute format('revoke all on table public.%I from public,anon,authenticated',n);
    for r in select roles.rolname from pg_catalog.pg_class t
      cross join lateral pg_catalog.aclexplode(coalesce(t.relacl,pg_catalog.acldefault('r',t.relowner))) a
      join pg_catalog.pg_roles roles on roles.oid=a.grantee
      where t.oid=format('public.%I',n)::regclass and a.grantee<>t.relowner loop
      execute format('revoke all on table public.%I from %I',n,r.rolname);
    end loop;
  end loop;
  for r in select p.oid::regprocedure sig,roles.rolname from pg_catalog.pg_proc p
    cross join lateral pg_catalog.aclexplode(coalesce(p.proacl,pg_catalog.acldefault('f',p.proowner))) a
    join pg_catalog.pg_roles roles on roles.oid=a.grantee
    where p.oid in ('public.ech_capture_visit_operational_timing()'::regprocedure,
      'public.ech_operational_timing_boundary_valid(jsonb)'::regprocedure,
      'public.ech_operational_timing_entries_valid(jsonb,jsonb)'::regprocedure,
      'public.ech_operations_operational_timing_author(text,bigint,uuid,bigint,text,uuid,jsonb,text)'::regprocedure,
      'public.ech_operations_operational_timing_read(text,bigint,uuid,bigint,text)'::regprocedure,
      'public.ech_operations_visit_operational_timing_read(uuid,bigint,text,bigint)'::regprocedure)
      and a.grantee<>p.proowner loop
    execute format('revoke all on function %s from %I',r.sig,r.rolname);
  end loop;
end;$$;
revoke all on function public.ech_capture_visit_operational_timing() from public,anon,authenticated;
revoke all on function public.ech_operational_timing_boundary_valid(jsonb),public.ech_operational_timing_entries_valid(jsonb,jsonb),
  public.ech_operations_operational_timing_author(text,bigint,uuid,bigint,text,uuid,jsonb,text),
  public.ech_operations_operational_timing_read(text,bigint,uuid,bigint,text),
  public.ech_operations_visit_operational_timing_read(uuid,bigint,text,bigint) from public,anon,authenticated;
commit;
