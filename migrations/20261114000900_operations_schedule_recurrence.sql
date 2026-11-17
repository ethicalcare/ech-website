-- Local-only canonical recurrence. No application write execution is granted.
begin;
create table public.ech_schedule_series_receipts (
  operation_id uuid primary key,
  actor_id uuid not null references public.ech_memberships(user_id),
  envelope jsonb not null,
  response jsonb not null,
  occurred_at timestamptz not null default clock_timestamp()
);
create table public.ech_schedule_series_occurrences (
  series_id uuid not null references public.ech_schedule_series_receipts(operation_id),
  ordinal smallint not null check (ordinal between 1 and 12),
  operation_id uuid not null unique references public.ech_schedule_events(operation_id),
  visit_id uuid not null unique references public.ech_schedule_visits(id),
  primary key(series_id,ordinal)
);
alter table public.ech_schedule_series_receipts enable row level security;
alter table public.ech_schedule_series_occurrences enable row level security;
create trigger ech_schedule_series_receipts_immutable before update or delete or truncate on public.ech_schedule_series_receipts
  for each statement execute function public.ech_schedule_keep_history();
create trigger ech_schedule_series_occurrences_immutable before update or delete or truncate on public.ech_schedule_series_occurrences
  for each statement execute function public.ech_schedule_keep_history();

-- Every existing canonical writer uses the shared access/dispatch lock. Prevent
-- future single-create and report commands from reusing a series operation ID.
create function public.ech_schedule_reserve_series_identity()
returns trigger language plpgsql set search_path = '' as $$
begin
  if exists(select 1 from public.ech_schedule_series_receipts where operation_id=new.operation_id) then
    raise sqlstate 'PT409' using message='Operation identity conflict';
  end if;
  return new;
end;
$$;
create trigger ech_schedule_events_series_identity before insert on public.ech_schedule_events
  for each row execute function public.ech_schedule_reserve_series_identity();
create trigger ech_visit_report_events_series_identity before insert on public.ech_visit_report_events
  for each row execute function public.ech_schedule_reserve_series_identity();

create function public.ech_schedule_recurrence_instant(p_local timestamp)
returns timestamptz language plpgsql stable set search_path = '' as $$
declare candidate timestamptz; matched timestamptz; matches integer:=0; hours integer;
begin
  if p_local < timestamp '2000-01-01' or p_local >= timestamp '2100-01-01' then
    raise sqlstate 'PT400' using message='Use Vancouver dates between 2000 and 2099';
  end if;
  for hours in 7..8 loop
    candidate := (p_local at time zone 'UTC') + hours * interval '1 hour';
    -- BC retains UTC-7 after the March 2026 transition. The host tzdb may predate it.
    if (case when candidate >= timestamptz '2026-03-08 10:00:00+00'
      then (candidate at time zone 'UTC') - interval '7 hours'
      else candidate at time zone 'America/Vancouver' end) = p_local then
      matched:=candidate; matches:=matches+1;
    end if;
  end loop;
  if matches<>1 then raise sqlstate 'PT400' using message='Ambiguous or nonexistent Vancouver recurrence time'; end if;
  return matched;
end;
$$;

-- Current manager authorization only: successful receipt replay must not
-- depend on eligibility or capacity of any current scheduling-source list.
create function public.ech_schedule_check_series_access(p_role text,p_revision bigint)
returns void language plpgsql volatile set search_path = '' as $$
declare
  actor uuid:=auth.uid(); session_claim text:=auth.jwt()->>'session_id';
  app_session public.ech_sessions; provider_expires timestamptz;
begin
  if actor is null or auth.jwt()->>'sub' is distinct from actor::text
    or session_claim is null or session_claim !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    or coalesce(auth.jwt()->>'exp','') !~ '^[0-9]{1,15}$' then
    raise sqlstate 'PT403' using message='Current manager schedule access is unavailable';
  end if;
  if (auth.jwt()->>'exp')::bigint<=extract(epoch from clock_timestamp()) or public.ech_session_active() is not true then
    raise sqlstate 'PT403' using message='Current manager schedule access is unavailable';
  end if;
  perform 1 from auth.users u where u.id=actor and u.deleted_at is null and u.is_anonymous is not true
    and (u.banned_until is null or u.banned_until<=clock_timestamp()) for share nowait;
  if not found then raise sqlstate 'PT403' using message='Current manager schedule access is unavailable'; end if;
  select s.not_after into provider_expires from auth.sessions s where s.id=session_claim::uuid and s.user_id=actor for share nowait;
  if not found then raise sqlstate 'PT403' using message='Current manager schedule access is unavailable'; end if;
  select * into app_session from public.ech_sessions s where s.session_id=session_claim::uuid and s.user_id=actor for share nowait;
  if not found or public.ech_schedule_lock_access(actor,null) is distinct from 'manager' then
    raise sqlstate 'PT403' using message='Current manager schedule access is unavailable';
  end if;
  if not exists(select 1 from public.ech_memberships m where m.user_id=actor and m.active
    and m.operational_role=p_role and m.revision=p_revision) then
    raise sqlstate 'PT409' using message='Current manager schedule access changed';
  end if;
  if app_session.revoked_at is not null or app_session.expires_at<=clock_timestamp()
    or app_session.created_at+interval '7 days'<=clock_timestamp() or provider_expires<=clock_timestamp()
    or (auth.jwt()->>'exp')::bigint<=extract(epoch from clock_timestamp()) or public.ech_session_active() is not true then
    raise sqlstate 'PT403' using message='Current manager schedule access is unavailable';
  end if;
end;
$$;

create function public.ech_operations_series_commit(p_envelope jsonb)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare
  actor uuid:=auth.uid(); c jsonb; o jsonb; saved public.ech_schedule_series_receipts; plan_fields text[]:='{}';
  start_local timestamp; end_local timestamp; start_at timestamptz; end_at timestamptz;
  result jsonb; item jsonb; visits jsonb:='[]'::jsonb; i integer; step_days integer;
  uuid_pattern constant text:='^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
  local_pattern constant text:='^20[0-9]{2}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{3}$';
begin
  if jsonb_typeof(p_envelope) is distinct from 'object'
    or not (p_envelope ?& array['schema','operationId','membershipRevision','expectedRole','command'])
    or p_envelope-array['schema','operationId','membershipRevision','expectedRole','command']<>'{}'::jsonb
    or p_envelope->'schema' is distinct from '1'::jsonb
    or jsonb_typeof(p_envelope->'operationId') is distinct from 'string' or p_envelope->>'operationId' !~ uuid_pattern
    or jsonb_typeof(p_envelope->'membershipRevision') is distinct from 'number' or p_envelope->>'membershipRevision' !~ '^[1-9][0-9]{0,15}$'
    or (p_envelope->>'membershipRevision')::bigint>9007199254740991
    or coalesce(p_envelope->>'expectedRole','') not in ('owner','manager') then
    raise sqlstate 'PT400' using message='Send a pinned manager recurrence';
  end if;
  c:=p_envelope->'command';
  if c ? 'taskPlanToken' then
    if jsonb_typeof(c->'taskPlanToken') is distinct from 'string' or c->>'taskPlanToken' !~ '^[0-9a-f]{64}$'
      or c->>'service' is distinct from 'Home support' then
      raise sqlstate 'PT400' using message='Choose an exact nonclinical task-plan token';end if;
    plan_fields:=array['taskPlanToken'];
  end if;
  if jsonb_typeof(c) is distinct from 'object' or not(c ?& array['type','clientId','workerId','service','source','timeZone','localStart','localEnd','cadence','count','occurrences'])
    or c-(array['type','clientId','workerId','service','source','timeZone','localStart','localEnd','cadence','count','occurrences']||plan_fields)<>'{}'::jsonb
    or c->>'type' is distinct from 'createSeries' or c->>'timeZone' is distinct from 'America/Vancouver'
    or coalesce(c->>'cadence','') not in ('daily','weekly') or jsonb_typeof(c->'count') is distinct from 'number'
    or c->>'count' !~ '^([2-9]|1[0-2])$' or jsonb_typeof(c->'occurrences') is distinct from 'array'
    or jsonb_array_length(c->'occurrences')<>(c->>'count')::integer
    or jsonb_typeof(c->'localStart') is distinct from 'string' or c->>'localStart' !~ local_pattern
    or jsonb_typeof(c->'localEnd') is distinct from 'string' or c->>'localEnd' !~ local_pattern then
    raise sqlstate 'PT400' using message='Choose 2–12 daily or weekly Vancouver occurrences';
  end if;
  start_local:=(c->>'localStart')::timestamp; end_local:=(c->>'localEnd')::timestamp;
  if start_local>=end_local then raise sqlstate 'PT400' using message='Invalid recurrence interval'; end if;
  step_days:=case c->>'cadence' when 'daily' then 1 else 7 end;
  if (select count(distinct x->>'operationId') from jsonb_array_elements(c->'occurrences') x)<>(c->>'count')::integer
    or (select count(distinct x->>'visitId') from jsonb_array_elements(c->'occurrences') x)<>(c->>'count')::integer
    or exists(select 1 from jsonb_array_elements(c->'occurrences') x where x->>'operationId'=p_envelope->>'operationId') then
    raise sqlstate 'PT400' using message='Use distinct recurrence identities';
  end if;
  if actor is null or current_setting('transaction_isolation')<>'read committed' or public.ech_session_active() is not true then
    raise sqlstate 'PT403' using message='Current manager schedule access is unavailable';
  end if;
  perform pg_advisory_xact_lock(617243902117::bigint);
  -- Fresh authentication, approval, role/revision and current grant checks on
  -- every request, including replay. Source eligibility is not replayed.
  perform public.ech_schedule_check_series_access(p_envelope->>'expectedRole',(p_envelope->>'membershipRevision')::bigint);
  select * into saved from public.ech_schedule_series_receipts where operation_id=(p_envelope->>'operationId')::uuid;
  if found then
    if saved.actor_id<>actor or saved.envelope<>p_envelope then raise sqlstate 'PT409' using message='Operation identity conflict'; end if;
    return saved.response;
  end if;
  if exists(select 1 from public.ech_schedule_events where operation_id=(p_envelope->>'operationId')::uuid)
    or exists(select 1 from public.ech_visit_report_events where operation_id=(p_envelope->>'operationId')::uuid) then
    raise sqlstate 'PT409' using message='Operation identity conflict';
  end if;
  for i in 0..(c->>'count')::integer-1 loop
    o:=c->'occurrences'->i;
    if jsonb_typeof(o) is distinct from 'object' or not(o ?& array['operationId','visitId','start','end'])
      or o-array['operationId','visitId','start','end']<>'{}'::jsonb
      or jsonb_typeof(o->'operationId') is distinct from 'string' or o->>'operationId' !~ uuid_pattern
      or jsonb_typeof(o->'visitId') is distinct from 'string' or o->>'visitId' !~ uuid_pattern then
      raise sqlstate 'PT400' using message='Invalid occurrence identity';
    end if;
    -- Existing occurrence receipts must never be adopted into a new series.
    if exists(select 1 from public.ech_schedule_events where operation_id=(o->>'operationId')::uuid)
      or exists(select 1 from public.ech_visit_report_events where operation_id=(o->>'operationId')::uuid)
      or exists(select 1 from public.ech_schedule_series_receipts where operation_id=(o->>'operationId')::uuid) then
      raise sqlstate 'PT409' using message='Operation identity conflict';
    end if;
    start_at:=public.ech_schedule_recurrence_instant(start_local+i*step_days*interval '1 day');
    end_at:=public.ech_schedule_recurrence_instant(end_local+i*step_days*interval '1 day');
    if o->>'start' is distinct from to_char(start_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
      or o->>'end' is distinct from to_char(end_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') then
      raise sqlstate 'PT400' using message='Occurrence does not match Vancouver recurrence';
    end if;
    item:=public.ech_operations_visit_commit(jsonb_build_object('schema',2,'operationId',o->'operationId','expectedRevision',0,
      'expectedRole',p_envelope->'expectedRole','membershipRevision',p_envelope->'membershipRevision',
      'command',jsonb_build_object('type','create','visitId',o->'visitId','clientId',c->'clientId','workerId',c->'workerId',
        'service',c->'service','source',c->'source','start',o->'start','end',o->'end')
        ||case when c ? 'taskPlanToken' then jsonb_build_object('taskPlanToken',c->'taskPlanToken') else '{}'::jsonb end));
    visits:=visits||jsonb_build_array(item->'visit');
  end loop;
  result:=jsonb_build_object('visits',visits,'receipt',jsonb_build_object('operationId',p_envelope->'operationId','count',c->'count'));
  insert into public.ech_schedule_series_receipts(operation_id,actor_id,envelope,response)
    values((p_envelope->>'operationId')::uuid,actor,p_envelope,result);
  for i in 0..(c->>'count')::integer-1 loop
    o:=c->'occurrences'->i;
    insert into public.ech_schedule_series_occurrences(series_id,ordinal,operation_id,visit_id)
      values((p_envelope->>'operationId')::uuid,i+1,(o->>'operationId')::uuid,(o->>'visitId')::uuid);
  end loop;
  -- Recheck all current session and access pins after audit/provenance writes.
  -- Any exception in any occurrence or final check rolls back this entire call.
  perform public.ech_schedule_check_series_access(p_envelope->>'expectedRole',(p_envelope->>'membershipRevision')::bigint);
  return result;
exception when lock_not_available then
  raise sqlstate 'PT409' using message='Current scheduling access is changing';
when invalid_datetime_format or datetime_field_overflow then
  raise sqlstate 'PT400' using message='Invalid Vancouver recurrence time';
end;
$$;

revoke all on public.ech_schedule_series_receipts, public.ech_schedule_series_occurrences from public,anon,authenticated;
revoke all on function public.ech_schedule_reserve_series_identity(), public.ech_schedule_recurrence_instant(timestamp), public.ech_schedule_check_series_access(text,bigint), public.ech_operations_series_commit(jsonb) from public,anon,authenticated;
do $$
declare r record;
begin
  for r in select distinct c.oid::regclass as relation,roles.rolname from pg_catalog.pg_class c
    cross join lateral pg_catalog.aclexplode(coalesce(c.relacl,pg_catalog.acldefault('r',c.relowner))) a
    join pg_catalog.pg_roles roles on roles.oid=a.grantee
    where c.oid in ('public.ech_schedule_series_receipts'::regclass,'public.ech_schedule_series_occurrences'::regclass) and a.grantee<>c.relowner
  loop execute format('revoke all on table %s from %I',r.relation,r.rolname); end loop;
  for r in select distinct p.oid::regprocedure as signature,roles.rolname from pg_catalog.pg_proc p
    cross join lateral pg_catalog.aclexplode(coalesce(p.proacl,pg_catalog.acldefault('f',p.proowner))) a
    join pg_catalog.pg_roles roles on roles.oid=a.grantee
    where p.oid in ('public.ech_operations_series_commit(jsonb)'::regprocedure,'public.ech_schedule_recurrence_instant(timestamp)'::regprocedure,'public.ech_schedule_reserve_series_identity()'::regprocedure,'public.ech_schedule_check_series_access(text,bigint)'::regprocedure) and a.grantee<>p.proowner
  loop execute format('revoke all on function %s from %I',r.signature,r.rolname); end loop;
end;
$$;
commit;
