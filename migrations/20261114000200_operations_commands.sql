-- Draft scheduling commands. Install after the draft schedule migration.
begin;

create table public.ech_schedule_events (
  operation_id uuid primary key,
  actor_id uuid not null references public.ech_memberships(user_id),
  visit_id uuid not null references public.ech_schedule_visits(id),
  revision bigint not null check (revision between 1 and 9007199254740991),
  action text not null check (action in ('create', 'assign', 'unassign', 'reschedule', 'cancel', 'confirm', 'start', 'complete')),
  reason text check (reason is null or (length(reason) <= 500 and length(btrim(reason)) >= 3 and reason !~ '[[:cntrl:]]')),
  occurred_at timestamptz not null default clock_timestamp(),
  previous_visit jsonb,
  next_visit jsonb not null,
  unique (visit_id, revision),
  unique (operation_id, actor_id)
);

create table public.ech_schedule_operation_receipts (
  operation_id uuid primary key,
  actor_id uuid not null,
  envelope jsonb not null,
  response jsonb not null,
  foreign key (operation_id, actor_id) references public.ech_schedule_events(operation_id, actor_id)
);

alter table public.ech_schedule_events enable row level security;
alter table public.ech_schedule_operation_receipts enable row level security;
revoke all on public.ech_schedule_events, public.ech_schedule_operation_receipts from public, anon, authenticated;

create function public.ech_schedule_keep_history()
returns trigger language plpgsql set search_path = ''
as $$
begin
  raise sqlstate 'PT409' using message = 'Schedule history is immutable';
end;
$$;

create trigger ech_schedule_events_immutable
  before update or delete or truncate on public.ech_schedule_events
  for each statement execute function public.ech_schedule_keep_history();
create trigger ech_schedule_receipts_immutable
  before update or delete or truncate on public.ech_schedule_operation_receipts
  for each statement execute function public.ech_schedule_keep_history();

-- The caller holds the canonical access writer lock before acquiring row locks.
-- The row locks also cover grant administration, worker linkage changes, Auth
-- identity updates, and canonical session logout or refresh.
create function public.ech_schedule_lock_access(p_actor uuid, p_worker uuid)
returns text language plpgsql volatile set search_path = ''
as $$
declare
  identity_email text;
  identity_confirmed boolean;
  request public.ech_access_requests;
  member public.ech_memberships;
  permission public.ech_operations_grants;
begin
  select lower(u.email), u.email_confirmed_at is not null into identity_email, identity_confirmed
  from auth.users u where u.id=p_actor and (u.banned_until is null or u.banned_until<=clock_timestamp())
    and u.deleted_at is null and u.is_anonymous is not true for share nowait;
  if not found then return null; end if;
  select * into request from public.ech_access_requests r where r.user_id = p_actor for share;
  select * into member from public.ech_memberships m where m.user_id = p_actor for share;
  if not found or not member.active then return null; end if;
  if request.user_id is not null and (
    request.state <> 'approved' or request.approved_role is distinct from member.operational_role
    or member.application_admin or member.technical_admin or identity_confirmed is not true
    or identity_email is distinct from request.email
  ) then
    return null;
  end if;
  select * into permission from public.ech_operations_grants g where g.user_id = p_actor for share;
  if not found or not permission.active or permission.membership_revision <> member.revision
    or (p_worker is not null and permission.worker_id is distinct from p_worker) then
    return null;
  end if;

  if permission.worker_id is not null then
    perform 1 from public.ech_schedule_workers w
    where w.id = permission.worker_id and w.user_id = p_actor for share;
    if not found then return null; end if;
  end if;

  if (permission.access_level = 'manager' and member.operational_role in ('owner', 'manager'))
    or (permission.access_level = 'staff' and member.operational_role = 'staff' and permission.worker_id is not null) then
    return permission.access_level;
  end if;
  return null;
end;
$$;

create function public.ech_schedule_visit_snapshot(v public.ech_schedule_visits)
returns jsonb language sql stable set search_path = ''
as $$
  select jsonb_build_object(
    'id', v.id, 'clientId', v.client_id, 'workerId', v.worker_id, 'service', v.service,
    'start', to_char(v.starts_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'end', to_char(v.ends_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'status', v.status, 'revision', v.revision
  )
$$;

-- Treat the rules migration as a required write dependency. This validator is
-- replaced once the review records and eligibility checks are installed.
create function public.ech_schedule_validate_dispatch(p_visit public.ech_schedule_visits, p_pin_source boolean)
returns void language plpgsql volatile set search_path = ''
as $$
begin
  raise sqlstate 'PT409' using message = 'Scheduling rules are unavailable';
end;
$$;

create function public.ech_schedule_serialize_dispatch()
returns trigger language plpgsql volatile set search_path = ''
as $$
begin
  if current_setting('transaction_isolation') <> 'read committed' then
    raise sqlstate 'PT409' using message = 'Schedule commands require read committed isolation';
  end if;
  perform pg_advisory_xact_lock(617243902117::bigint);
  return null;
end;
$$;

create function public.ech_schedule_guard_dispatch()
returns trigger language plpgsql volatile set search_path = ''
as $$
begin
  -- Removing an assignment remains possible after the review becomes stale.
  if tg_op = 'UPDATE' and new.id = old.id and new.client_id = old.client_id
    and new.service = old.service and new.starts_at = old.starts_at and new.ends_at = old.ends_at
    and ((new.status = 'Open' and old.worker_id is not null and new.worker_id is null)
      or (new.status = 'Cancelled' and new.worker_id is not distinct from old.worker_id)
      -- Reporting completed work is not a new dispatch authorization. A scope
      -- or readiness change must not prevent recording what actually happened.
      or (old.status = 'In progress' and new.status = 'Completed'
        and new.worker_id = old.worker_id and new.revision = old.revision + 1)) then
    return new;
  end if;
  perform public.ech_schedule_validate_dispatch(new, tg_op = 'INSERT');
  return new;
end;
$$;

create trigger ech_schedule_visits_serialize_dispatch
  before insert or update or delete or truncate on public.ech_schedule_visits
  for each statement execute function public.ech_schedule_serialize_dispatch();

create trigger ech_schedule_visits_guard_dispatch
  after insert or update on public.ech_schedule_visits
  for each row execute function public.ech_schedule_guard_dispatch();

-- The rules migration replaces this fail-closed source metadata helper.
create function public.ech_schedule_creation_source(p_client uuid, p_service text)
returns jsonb language sql volatile set search_path = '' as $$ select null::jsonb $$;
revoke all on function public.ech_schedule_creation_source(uuid,text) from public, anon, authenticated;

-- Create starts at expectedRevision 0. Every other action targets one existing
-- visit and must carry the revision the caller observed in the schedule.
create function public.ech_operations_visit_commit(p_envelope jsonb)
returns jsonb language plpgsql volatile security definer set search_path = ''
as $$
declare
  actor uuid := auth.uid();
  session public.ech_sessions;
  session_claim text;
  access text;
  actor_worker uuid;
  command jsonb;
  action text;
  operation uuid;
  visit_id uuid;
  expected bigint;
  fields text[];
  field text;
  target public.ech_schedule_visits;
  before_visit jsonb;
  after_visit jsonb;
  saved public.ech_schedule_operation_receipts;
  result jsonb;
  operation_used boolean;
  pinned boolean;
  uuid_pattern constant text := '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
  time_pattern constant text := '^[0-9]{4}-[0-9]{2}-[0-9]{2}T([01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9](\.[0-9]{1,3})?(Z|[+-]((0[0-9]|1[0-3]):[0-5][0-9]|14:00))$';
begin
  if actor is null then
    raise sqlstate 'PT403' using message = 'Operations command access denied';
  end if;
  pinned := p_envelope->'schema' = '2'::jsonb;
  if jsonb_typeof(p_envelope) is distinct from 'object'
    or not (p_envelope ?& array['schema', 'operationId', 'expectedRevision', 'command'])
    or (p_envelope - case when pinned then array['schema', 'operationId', 'expectedRevision', 'command', 'expectedRole', 'membershipRevision']
      else array['schema', 'operationId', 'expectedRevision', 'command'] end) <> '{}'::jsonb
    or coalesce(p_envelope->'schema', 'null'::jsonb) not in ('1'::jsonb, '2'::jsonb)
    or jsonb_typeof(p_envelope->'operationId') is distinct from 'string'
    or p_envelope->>'operationId' !~ uuid_pattern
    or jsonb_typeof(p_envelope->'expectedRevision') is distinct from 'number'
    or p_envelope->>'expectedRevision' !~ '^[0-9]{1,16}$' then
    raise sqlstate 'PT400' using message = 'Invalid schedule command envelope';
  end if;

  operation := (p_envelope->>'operationId')::uuid;
  expected := (p_envelope->>'expectedRevision')::bigint;
  command := p_envelope->'command';
  action := command->>'type';
  -- Schema 1 is retained only for the existing explicitly pinned worker start.
  -- All dispatch changes, including confirmation, require the schema-2 access pin.
  if (not coalesce(pinned,false) and action is distinct from 'start')
    or (pinned and action not in ('create','assign','unassign','reschedule','cancel','confirm')) then
    raise sqlstate 'PT400' using message = 'Send a pinned schedule command';
  end if;
  if pinned and (coalesce(p_envelope->>'expectedRole','') not in ('owner','manager','staff')
    or jsonb_typeof(p_envelope->'membershipRevision') is distinct from 'number'
    or p_envelope->>'membershipRevision' !~ '^[1-9][0-9]{0,15}$'
    or (p_envelope->>'membershipRevision')::bigint > 9007199254740991) then
    raise sqlstate 'PT400' using message = 'Send the current schedule access revision';
  end if;
  fields := case action
    when 'create' then array['type', 'visitId', 'clientId', 'workerId', 'service', 'start', 'end', 'source']
    when 'assign' then array['type', 'visitId', 'workerId', 'reason']
    when 'reschedule' then array['type', 'visitId', 'start', 'end', 'reason']
    when 'unassign' then array['type', 'visitId', 'reason']
    when 'cancel' then array['type', 'visitId', 'reason']
    when 'confirm' then array['type', 'visitId']
    when 'start' then array['type', 'visitId', 'expectedRole', 'membershipRevision']
  end;
  -- The optional plan token is accepted only for an explicitly planned create.
  -- Absent tokens retain the original exact command shape and retry identity.
  if action='create' and command ? 'taskPlanToken' then
    if jsonb_typeof(command->'taskPlanToken') is distinct from 'string'
      or command->>'taskPlanToken' !~ '^[0-9a-f]{64}$' or command->>'service' is distinct from 'Home support' then
      raise sqlstate 'PT400' using message='Choose an exact nonclinical task-plan token';
    end if;
    fields:=array_append(fields,'taskPlanToken');
  end if;
  if jsonb_typeof(command) is distinct from 'object' or fields is null
    or not (command ?& fields) or command - fields <> '{}'::jsonb
    or jsonb_typeof(command->'visitId') is distinct from 'string'
    or command->>'visitId' !~ uuid_pattern
    or expected >= 9007199254740991
    or (action = 'create') <> (expected = 0) then
    raise sqlstate 'PT400' using message = 'Invalid schedule command';
  end if;
  visit_id := (command->>'visitId')::uuid;
  -- Starting is an explicit assigned-worker action, never inferred from travel,
  -- schedule time or attendance. Pin the role/revision seen by its caller.
  if action = 'start' and (
    coalesce(command->>'expectedRole', '') not in ('owner','manager','staff')
    or jsonb_typeof(command->'membershipRevision') is distinct from 'number'
    or command->>'membershipRevision' !~ '^[1-9][0-9]{0,15}$'
    or (command->>'membershipRevision')::bigint > 9007199254740991
  ) then
    raise sqlstate 'PT400' using message = 'Send the current worker access revision';
  end if;
  if action = 'start' or pinned then
    if coalesce(auth.jwt()->>'exp','') !~ '^[0-9]{1,15}$' then
      raise sqlstate 'PT403' using message = 'Operations command access denied';
    end if;
    if (auth.jwt()->>'exp')::bigint <= extract(epoch from clock_timestamp()) then
      raise sqlstate 'PT403' using message = 'Operations command access denied';
    end if;
  end if;
  if action in ('assign','unassign','reschedule','cancel') and (
    jsonb_typeof(command->'reason') is distinct from 'string' or length(command->>'reason') > 500
    or length(btrim(command->>'reason')) < 3 or command->>'reason' ~ '[[:cntrl:]]'
  ) then
    raise sqlstate 'PT400' using message = 'Record a short operational reason for the change';
  end if;

  if action = 'create' and (
    jsonb_typeof(command->'clientId') is distinct from 'string'
    or command->>'clientId' !~ uuid_pattern
    or jsonb_typeof(command->'service') is distinct from 'string'
    or command->>'service' not in ('Home support', 'Nursing')
  ) then
    raise sqlstate 'PT400' using message = 'Invalid service or client';
  end if;
  if action in ('create', 'assign') and not (action = 'create' and command->'workerId' = 'null'::jsonb)
    and (jsonb_typeof(command->'workerId') is distinct from 'string' or command->>'workerId' !~ uuid_pattern) then
    raise sqlstate 'PT400' using message = 'Invalid worker';
  end if;
  if action in ('create', 'reschedule') then
    foreach field in array array['start', 'end'] loop
      if jsonb_typeof(command->field) is distinct from 'string' or command->>field !~ time_pattern then
        raise sqlstate 'PT400' using message = 'Choose a valid schedule time with an explicit offset';
      end if;
    end loop;
  end if;

  -- Fresh snapshots inside this volatile function are required after waiting:
  -- another command may insert an overlapping visit or a new access request.
  if current_setting('transaction_isolation') <> 'read committed' then
    raise sqlstate 'PT409' using message = 'Schedule commands require read committed isolation';
  end if;
  session_claim := auth.jwt()->>'session_id';
  if session_claim is null or session_claim !~* uuid_pattern then
    raise sqlstate 'PT403' using message = 'Operations command access denied';
  end if;
  -- Reject callers without current access before they can contend on the shared lock.
  -- All checks are repeated with row locks after acquiring it.
  if public.ech_session_active() is not true or not exists (
    select 1 from public.ech_memberships m
    join public.ech_operations_grants g on g.user_id=m.user_id and g.active and g.membership_revision=m.revision
    join auth.users u on u.id=m.user_id
    join auth.sessions s on s.id=session_claim::uuid and s.user_id=m.user_id
    where m.user_id=actor and m.active and (u.banned_until is null or u.banned_until<=clock_timestamp())
      and u.deleted_at is null and u.is_anonymous is not true and (s.not_after is null or s.not_after>clock_timestamp())
      and ((m.operational_role in ('owner','manager') and g.access_level='manager')
        or (m.operational_role='staff' and g.access_level='staff' and g.worker_id is not null))
  ) then
    raise sqlstate 'PT403' using message = 'Operations command access denied';
  end if;
  perform pg_advisory_xact_lock(617243902117::bigint);
  -- Provider operations use different lock orders; never wait on their rows.
  perform 1 from auth.users u where u.id=actor and (u.banned_until is null or u.banned_until<=clock_timestamp())
    and u.deleted_at is null and u.is_anonymous is not true for share nowait;
  if not found then
    raise sqlstate 'PT403' using message = 'Operations command access denied';
  end if;
  perform 1 from auth.sessions s where s.id=session_claim::uuid and s.user_id=actor
    and (s.not_after is null or s.not_after>clock_timestamp()) for share nowait;
  if not found then
    raise sqlstate 'PT403' using message = 'Operations command access denied';
  end if;
  select * into session from public.ech_sessions s
  where s.session_id = session_claim::uuid and s.user_id = actor for share;
  if not found then
    raise sqlstate 'PT403' using message = 'Operations command access denied';
  end if;
  access := public.ech_schedule_lock_access(actor, null);
  if access is null or (action in ('confirm','start') and access not in ('staff','manager'))
    or (action not in ('confirm','start') and access <> 'manager')
    or session.revoked_at is not null or session.expires_at <= clock_timestamp()
    or session.created_at + interval '7 days' <= clock_timestamp()
    or public.ech_session_active() is not true then
    raise sqlstate 'PT403' using message = 'Operations command access denied';
  end if;
  if action = 'start' and not exists (
    select 1 from public.ech_memberships m where m.user_id=actor
      and m.operational_role=command->>'expectedRole'
      and m.revision=(command->>'membershipRevision')::bigint
  ) then
    raise sqlstate 'PT409' using message = 'Visit access changed; reload before starting';
  end if;
  if pinned and not exists (
    select 1 from public.ech_memberships m where m.user_id=actor
      and m.operational_role=p_envelope->>'expectedRole'
      and m.revision=(p_envelope->>'membershipRevision')::bigint
  ) then
    raise sqlstate 'PT409' using message = 'Schedule access changed; reload before preparing another command';
  end if;

  select * into target from public.ech_schedule_visits v where v.id = visit_id for update;
  if action in ('confirm','start') then
    select g.worker_id into actor_worker from public.ech_operations_grants g where g.user_id = actor;
    if actor_worker is null or target.worker_id is distinct from actor_worker or target.status = 'Cancelled'
      or public.ech_schedule_lock_access(actor, actor_worker) is null then
      raise sqlstate 'PT403' using message = 'Operations command access denied';
    end if;
  end if;

  select * into saved from public.ech_schedule_operation_receipts r where r.operation_id = operation;
  if found then
    if session.expires_at <= clock_timestamp() or session.created_at + interval '7 days' <= clock_timestamp()
      or not exists (select 1 from auth.sessions s where s.id=session_claim::uuid and s.user_id=actor
        and (s.not_after is null or s.not_after>clock_timestamp()))
      or ((action = 'start' or pinned) and (auth.jwt()->>'exp')::bigint <= extract(epoch from clock_timestamp())) then
      raise sqlstate 'PT403' using message = 'Operations command access denied';
    end if;
    if saved.actor_id <> actor or saved.envelope <> p_envelope then
      raise sqlstate 'PT409' using message = 'Operation identity conflict';
    end if;
    return saved.response;
  end if;

  -- Reporting is installed later; reserve operation identities across both
  -- command domains without making the earlier migration depend on it.
  if pg_catalog.to_regclass('public.ech_visit_report_events') is not null then
    execute 'select exists (select 1 from public.ech_visit_report_events where operation_id = $1)'
      into operation_used using operation;
    if operation_used then
      raise sqlstate 'PT409' using message = 'Operation identity conflict';
    end if;
  end if;

  if coalesce(target.revision, 0) <> expected then
    raise sqlstate 'PT409' using message = 'Visit changed; reload before retrying';
  end if;
  if action <> 'create' then
    before_visit := public.ech_schedule_visit_snapshot(target);
    if target.status not in ('Open', 'Assigned', 'Confirmed')
      or (action = 'unassign' and target.worker_id is null)
      or (action = 'confirm' and target.status <> 'Assigned')
      or (action = 'start' and target.status <> 'Confirmed') then
      raise sqlstate 'PT409' using message = 'Command does not match the current visit status';
    end if;
  end if;

  if action = 'create' then
    target.id := visit_id;
    target.client_id := (command->>'clientId')::uuid;
    target.service := command->>'service';
    -- The reviewed source token includes the client name, so block concurrent
    -- non-key edits as well as deletion until the source comparison commits.
    perform 1 from public.ech_schedule_clients c where c.id = target.client_id for share nowait;
    if not found then raise sqlstate 'PT400' using message = 'Choose an existing client'; end if;
  end if;
  if action in ('create', 'reschedule') then
    target.starts_at := (command->>'start')::timestamptz;
    target.ends_at := (command->>'end')::timestamptz;
    if target.starts_at < timestamptz '0001-01-01 00:00:00+00'
      or target.ends_at >= timestamptz '10000-01-01 00:00:00+00'
      or target.starts_at >= target.ends_at then
      raise sqlstate 'PT400' using message = 'Choose a valid schedule interval';
    end if;
  end if;
  if action in ('create', 'assign') then
    target.worker_id := (command->>'workerId')::uuid;
  elsif action = 'unassign' then
    target.worker_id := null;
  end if;

  target.status := case
    when action = 'cancel' then 'Cancelled'
    when action = 'confirm' then 'Confirmed'
    when action = 'start' then 'In progress'
    when target.worker_id is not null then 'Assigned'
    else 'Open'
  end;
  target.revision := expected + 1;
  if action = 'create' then
    -- Run the same current rules first, then compare the exact source reviewed
    -- by the manager. The shared writer lock remains held through receipt and
    -- immutable provenance insertion. Receipt replay above does not reauthorize
    -- a second create if the source subsequently changes.
    perform public.ech_schedule_validate_dispatch(target, false);
    if command->'source' is distinct from public.ech_schedule_creation_source(target.client_id, target.service)
      or jsonb_typeof(command->'source') is distinct from 'object' then
      raise sqlstate 'PT409' using message = 'Scheduling source changed; reload and review it before preparing a new request';
    end if;
    if command ? 'taskPlanToken' then
      -- Installed by the task-plan migration. Preparation precedes the visit
      -- insert and shares its transaction, source locks and canonical receipt.
      perform public.ech_task_plan_prepare_create(p_envelope->>'expectedRole',(p_envelope->>'membershipRevision')::bigint,
        target.id,operation,target.client_id,(command->'source'->>'instructionsVersion')::bigint,command->>'taskPlanToken');
    end if;
  end if;
  begin
    if action = 'create' then
      insert into public.ech_schedule_visits (id, client_id, worker_id, service, starts_at, ends_at, status, revision)
      values (target.id, target.client_id, target.worker_id, target.service, target.starts_at, target.ends_at, target.status, target.revision);
    else
      update public.ech_schedule_visits v set
        worker_id = target.worker_id, starts_at = target.starts_at, ends_at = target.ends_at,
        status = target.status, revision = target.revision
      where v.id = target.id;
    end if;
  exception when sqlstate 'PT409' then
    -- Internal readiness and other clients' travel details are not staff data.
    if action in ('confirm','start') and access = 'staff' then
      raise sqlstate 'PT409' using message = 'This visit needs manager review before confirmation or start';
    end if;
    raise;
  end;

  -- Eligibility and its locks can delay an otherwise valid command past expiry.
  -- Raising here rolls the visit write back before a receipt or audit is saved.
  if session.expires_at <= clock_timestamp() or session.created_at + interval '7 days' <= clock_timestamp()
    or not exists (select 1 from auth.sessions s where s.id=session_claim::uuid and s.user_id=actor
      and (s.not_after is null or s.not_after>clock_timestamp()))
    or ((action = 'start' or pinned) and (auth.jwt()->>'exp')::bigint <= extract(epoch from clock_timestamp())) then
    raise sqlstate 'PT403' using message = 'Operations command access denied';
  end if;

  after_visit := public.ech_schedule_visit_snapshot(target);
  result := jsonb_build_object('visit', after_visit, 'receipt', jsonb_build_object(
    'operationId', operation, 'expectedRevision', expected, 'revision', target.revision
  ));
  insert into public.ech_schedule_events (operation_id, actor_id, visit_id, revision, action, reason, previous_visit, next_visit)
  values (operation, actor, target.id, target.revision, action, case when command ? 'reason' then btrim(command->>'reason') else null end, before_visit, after_visit);
  insert into public.ech_schedule_operation_receipts (operation_id, actor_id, envelope, response)
  values (operation, actor, p_envelope, result);
  if action='create' and command ? 'taskPlanToken' then
    perform public.ech_task_plan_finish_create(p_envelope->>'expectedRole',(p_envelope->>'membershipRevision')::bigint,
      target.id,operation,command->>'taskPlanToken');
  end if;
  -- A slow audit or receipt write must not commit after the session expires.
  if session.expires_at <= clock_timestamp() or session.created_at + interval '7 days' <= clock_timestamp()
    or not exists (select 1 from auth.sessions s where s.id=session_claim::uuid and s.user_id=actor
      and (s.not_after is null or s.not_after>clock_timestamp()))
    or ((action = 'start' or pinned) and (auth.jwt()->>'exp')::bigint <= extract(epoch from clock_timestamp())) then
    raise sqlstate 'PT403' using message = 'Operations command access denied';
  end if;
  return result;
exception
  when lock_not_available then
    raise sqlstate 'PT409' using message = 'Account access is changing; retry the same operation';
  when invalid_datetime_format or datetime_field_overflow or invalid_time_zone_displacement_value then
    raise sqlstate 'PT400' using message = 'Invalid schedule time';
end;
$$;

revoke all on function public.ech_schedule_keep_history(), public.ech_schedule_lock_access(uuid, uuid),
  public.ech_schedule_visit_snapshot(public.ech_schedule_visits), public.ech_operations_visit_commit(jsonb),
  public.ech_schedule_validate_dispatch(public.ech_schedule_visits, boolean), public.ech_schedule_serialize_dispatch(),
  public.ech_schedule_guard_dispatch()
  from public, anon, authenticated;

-- Hosted environments can add explicit defaults for other roles.
do $$
declare recipient record;
begin
  for recipient in
    select distinct c.relname, r.rolname
    from pg_catalog.pg_class c
    cross join lateral pg_catalog.aclexplode(coalesce(c.relacl, pg_catalog.acldefault('r', c.relowner))) a
    join pg_catalog.pg_roles r on r.oid = a.grantee
    where c.oid in ('public.ech_schedule_events'::regclass, 'public.ech_schedule_operation_receipts'::regclass)
      and a.grantee <> c.relowner
  loop
    execute pg_catalog.format('revoke all privileges on table public.%I from %I', recipient.relname, recipient.rolname);
  end loop;
  for recipient in
    select distinct p.oid::regprocedure as signature, r.rolname
    from pg_catalog.pg_proc p
    cross join lateral pg_catalog.aclexplode(coalesce(p.proacl, pg_catalog.acldefault('f', p.proowner))) a
    join pg_catalog.pg_roles r on r.oid = a.grantee
    where p.oid in ('public.ech_schedule_keep_history()'::regprocedure, 'public.ech_schedule_lock_access(uuid,uuid)'::regprocedure,
      'public.ech_schedule_visit_snapshot(public.ech_schedule_visits)'::regprocedure,
      'public.ech_operations_visit_commit(jsonb)'::regprocedure, 'public.ech_schedule_creation_source(uuid,text)'::regprocedure,
      'public.ech_schedule_validate_dispatch(public.ech_schedule_visits, boolean)'::regprocedure,
      'public.ech_schedule_serialize_dispatch()'::regprocedure, 'public.ech_schedule_guard_dispatch()'::regprocedure)
      and a.grantee <> p.proowner
  loop
    execute pg_catalog.format('revoke all privileges on function %s from %I', recipient.signature, recipient.rolname);
  end loop;
end;
$$;
-- Application execution remains disabled until an explicitly reviewed activation.

commit;
