begin;

-- Review baseline: effective 003 dispatch and 020 note-enabled report RPC.
-- Do not replace drifted/activated functions or an unexpected table constraint.
lock table public.ech_visit_report_events in access exclusive mode;
create temporary table ech_exact_day_check_probe (like public.ech_visit_report_events) on commit drop;
alter table pg_temp.ech_exact_day_check_probe add constraint expected_prior_check check (case when action = 'review' then
    decision is not null and review_note is not null and outcome is null and summary is null and issue is null
    and actual_start is null and actual_end is null and completed_tasks is null and observations is null
  else
    decision is null and review_note is null and outcome is not null and summary is not null and issue is not null
    and actual_start is not null and actual_end is not null and isfinite(actual_start) and isfinite(actual_end)
    and actual_start < actual_end and actual_end <= recorded_at and actual_end - actual_start < interval '24 hours'
    and completed_tasks is not null and cardinality(completed_tasks) <= 50
    and (outcome <> 'completed' or cardinality(completed_tasks) > 0) and observations is not null
  end);

do $$
declare
  target text;
  expected_def text;
  guarded record;
  prior record;
begin
  for guarded in select * from (values
    ('public.ech_schedule_validate_dispatch(public.ech_schedule_visits,boolean)', '8b3077fb4a7706f195eb93c4034bc47d398f9da7321c58cf04a5f5417e808e9a', false),
    ('public.ech_operations_visit_report_commit(jsonb)', 'bbafaff1d565b3b1c63f4d247dbeba10acfe7985decf2174e3db5f07e259b8ed', true)
  ) as candidates(signature,body_hash,is_definer)
  loop
    select p.* into strict prior from pg_catalog.pg_proc p
      where p.oid=pg_catalog.to_regprocedure(guarded.signature);
    if pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(prior.prosrc,'UTF8')),'hex') <> guarded.body_hash
       or prior.prosecdef is distinct from guarded.is_definer
       or prior.provolatile <> 'v' or prior.proconfig is distinct from array['search_path=""']::text[]
       or prior.prolang <> (select oid from pg_catalog.pg_language where lanname='plpgsql')
       or exists (
         select 1 from pg_catalog.aclexplode(coalesce(prior.proacl,pg_catalog.acldefault('f',prior.proowner))) a
         where a.grantee <> prior.proowner and a.privilege_type='EXECUTE'
       ) then
      raise exception 'Unexpected prior exact-day function definition or authorization: %', guarded.signature;
    end if;
  end loop;
  select pg_catalog.pg_get_constraintdef(oid) into strict expected_def
    from pg_catalog.pg_constraint
    where conrelid = 'pg_temp.ech_exact_day_check_probe'::regclass and conname = 'expected_prior_check';
  select conname into strict target
    from pg_catalog.pg_constraint
    where conrelid = 'public.ech_visit_report_events'::regclass and contype='c' and convalidated
      and pg_catalog.pg_get_constraintdef(oid) = expected_def;
  execute format('alter table public.ech_visit_report_events drop constraint %I', target);
end;
$$;

alter table public.ech_visit_report_events add constraint ech_visit_report_events_actual_interval_check check (case when action = 'review' then
    decision is not null and review_note is not null and outcome is null and summary is null and issue is null
    and actual_start is null and actual_end is null and completed_tasks is null and observations is null
  else
    decision is null and review_note is null and outcome is not null and summary is not null and issue is not null
    and actual_start is not null and actual_end is not null and isfinite(actual_start) and isfinite(actual_end)
    and actual_start < actual_end and actual_end <= recorded_at and actual_end - actual_start <= interval '24 hours'
    and completed_tasks is not null and cardinality(completed_tasks) <= 50
    and (outcome <> 'completed' or cardinality(completed_tasks) > 0) and observations is not null
  end);

create or replace function public.ech_schedule_validate_dispatch(p_visit public.ech_schedule_visits, p_pin_source boolean)
returns void language plpgsql volatile set search_path = ''
as $$
declare
  readiness public.ech_schedule_client_readiness;
  rules public.ech_schedule_service_rules;
  worker_actor uuid;
  local_end date;
  neighbor record;
  neighbor_area text;
  route_minutes integer;
begin
  select * into readiness from public.ech_schedule_client_readiness r
  where r.client_id = p_visit.client_id and r.service = p_visit.service
    and r.confirmed_at <= clock_timestamp()
    and exists (
      select 1 from public.ech_schedule_service_instructions i
      where i.client_id = r.client_id and i.version = r.instructions_version and i.saved_at <= clock_timestamp()
    );
  if not found then
    raise sqlstate 'PT409' using message = 'Confirm this client and service and record saved service instructions before scheduling';
  end if;
  if readiness.inquiry_id is not null then
    perform 1 from public.ech_records r where r.kind = 'inquiry' and r.id = readiness.inquiry_id
      and r.revision = readiness.inquiry_revision
      and r.data->>'status' in ('New', 'Contacted', 'Assessment booked', 'On hold')
      for share nowait;
    if not found then
      raise sqlstate 'PT409' using message = 'Review the current inquiry before scheduling this client';
    end if;
    if exists (
      select 1 from public.ech_schedule_visit_sources s
      where s.inquiry_id = readiness.inquiry_id and s.client_id <> readiness.client_id
    ) then
      raise sqlstate 'PT409' using message = 'This inquiry is already linked to a different scheduled client';
    end if;
  end if;

  select * into rules from public.ech_schedule_service_rules r where r.service = p_visit.service for share;
  if not found then
    raise sqlstate 'PT409' using message = 'Scheduling rules for this service are unavailable';
  end if;
  if p_visit.ends_at - p_visit.starts_at < make_interval(mins => rules.min_minutes)
    or (p_visit.ends_at - p_visit.starts_at >= make_interval(mins => rules.max_minutes)
      and not (rules.max_minutes = 1440
        and p_visit.ends_at - p_visit.starts_at = interval '24 hours')) then
    raise sqlstate 'PT409' using message = 'Visit duration is outside the reviewed service limits';
  end if;
  -- The dispatch lock and CRM row lock hold through commit. Any later failure
  -- in validation or command processing rolls back the visit and its binding.
  if p_pin_source then
    insert into public.ech_schedule_visit_sources
      (visit_id, client_id, service, instructions_version, confirmed_by, confirmed_at, inquiry_id, inquiry_revision)
    values (p_visit.id, readiness.client_id, readiness.service, readiness.instructions_version,
      readiness.confirmed_by, readiness.confirmed_at, readiness.inquiry_id, readiness.inquiry_revision);
  end if;
  if p_visit.worker_id is null or p_visit.status = 'Cancelled' then
    return;
  end if;
  if p_visit.service = 'Nursing' then
    raise sqlstate 'PT409' using message = 'Nursing assignment authority is unavailable';
  end if;

  select w.user_id into worker_actor from public.ech_schedule_workers w
  where w.id = p_visit.worker_id for share;
  if worker_actor is null or public.ech_schedule_lock_access(worker_actor, p_visit.worker_id) is null then
    raise sqlstate 'PT409' using message = 'Worker is unavailable for assignment';
  end if;
  if not exists (
    select 1 from public.ech_schedule_worker_qualifications q
    where q.worker_id = p_visit.worker_id and q.service = p_visit.service
  ) then
    raise sqlstate 'PT409' using message = 'Reviewed worker qualification for this service is unavailable';
  end if;
  if not exists (
    select 1 from public.ech_schedule_worker_availability a where a.worker_id = p_visit.worker_id
      and a.starts_at <= p_visit.starts_at and a.ends_at >= p_visit.ends_at
  ) then
    raise sqlstate 'PT409' using message = 'Visit is outside reviewed worker availability';
  end if;
  if exists (
    select 1 from public.ech_schedule_visits v
    where v.worker_id = p_visit.worker_id and v.id <> p_visit.id and v.status <> 'Cancelled'
      and v.starts_at < p_visit.ends_at and v.ends_at > p_visit.starts_at
  ) then
    raise sqlstate 'PT409' using message = 'Worker has an overlapping visit';
  end if;

  local_end := (case when p_visit.ends_at >= timestamptz '2026-03-08 10:00:00+00'
    then (p_visit.ends_at at time zone 'UTC') - interval '7 hours'
    else p_visit.ends_at at time zone 'America/Vancouver' end)::date;
  if exists (
    select 1 from unnest(rules.required_credentials) as required(credential)
    where not exists (
      select 1 from public.ech_schedule_worker_credentials c where c.worker_id = p_visit.worker_id
        and c.credential = required.credential and c.valid_through >= local_end
    )
  ) then
    raise sqlstate 'PT409' using message = 'Required worker credential is missing or expires before the visit ends';
  end if;

  -- Check both closest visits, including ties in older records, using elapsed
  -- time. Visits for the same client need no travel estimate.
  for neighbor in
    (select v.client_id, true as preceding, p_visit.starts_at - v.ends_at as gap
     from public.ech_schedule_visits v
     where v.worker_id = p_visit.worker_id and v.id <> p_visit.id and v.status <> 'Cancelled'
       and v.ends_at <= p_visit.starts_at and v.ends_at > p_visit.starts_at - interval '24 hours'
     order by v.ends_at desc fetch first 1 row with ties)
    union all
    (select v.client_id, false, v.starts_at - p_visit.ends_at
     from public.ech_schedule_visits v
     where v.worker_id = p_visit.worker_id and v.id <> p_visit.id and v.status <> 'Cancelled'
       and v.starts_at >= p_visit.ends_at and v.starts_at < p_visit.ends_at + interval '24 hours'
     order by v.starts_at fetch first 1 row with ties)
  loop
    if neighbor.client_id = p_visit.client_id then
      continue;
    end if;
    select area into neighbor_area from public.ech_schedule_client_readiness where client_id = neighbor.client_id;
    select r.minutes into route_minutes from public.ech_schedule_travel_routes r
    where r.from_area = case when neighbor.preceding then neighbor_area else readiness.area end
      and r.to_area = case when neighbor.preceding then readiness.area else neighbor_area end;
    if not found then
      raise sqlstate 'PT409' using message = 'A directional reviewed travel estimate is required between visits';
    end if;
    if neighbor.gap < make_interval(mins => route_minutes + rules.travel_buffer_minutes) then
      raise sqlstate 'PT409' using message = 'The gap between visits is below the reviewed travel time and buffer';
    end if;
  end loop;
end;
$$;

create or replace function public.ech_operations_visit_report_commit(p_envelope jsonb)
returns jsonb language plpgsql volatile security definer set search_path = ''
as $$
declare
  uuid_pattern constant text := '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
  timestamp_pattern constant text := '^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])T([01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9](\.[0-9]{1,3})?Z$';
  token jsonb := auth.jwt();
  actor uuid;
  app_session public.ech_sessions;
  provider_expires timestamptz;
  identity_email text;
  identity_confirmed boolean;
  request public.ech_access_requests;
  member public.ech_memberships;
  permission public.ech_operations_grants;
  visit public.ech_schedule_visits;
  original public.ech_visit_report_events;
  content public.ech_visit_report_events;
  saved public.ech_visit_report_events;
  command jsonb;
  fields text[];
  action_name text;
  expected_role text;
  visit_key uuid;
  expected_visit bigint;
  expected_report bigint;
  expected_membership bigint;
  operation uuid;
  request_hash bytea;
  current_report bigint;
  authored_at timestamptz(3);
  recorded_outcome text;
  note_event_at timestamptz;
  starts timestamptz;
  ends timestamptz;
  tasks text[];
  before_visit jsonb;
  after_visit jsonb;
  result jsonb;
begin
  if jsonb_typeof(p_envelope) is distinct from 'object' or octet_length(p_envelope::text) > 150000
    or not (p_envelope ?& array['schema','operationId','visitId','expectedVisitRevision','expectedReportRevision','expectedRole','membershipRevision','command'])
    or (p_envelope - array['schema','operationId','visitId','expectedVisitRevision','expectedReportRevision','expectedRole','membershipRevision','command']) <> '{}'::jsonb
    or p_envelope->'schema' is distinct from '1'::jsonb
    or jsonb_typeof(p_envelope->'operationId') is distinct from 'string' or p_envelope->>'operationId' !~ uuid_pattern
    or jsonb_typeof(p_envelope->'visitId') is distinct from 'string' or p_envelope->>'visitId' !~ uuid_pattern
    or jsonb_typeof(p_envelope->'expectedVisitRevision') is distinct from 'number' or p_envelope->>'expectedVisitRevision' !~ '^[1-9][0-9]{0,15}$'
    or jsonb_typeof(p_envelope->'membershipRevision') is distinct from 'number' or p_envelope->>'membershipRevision' !~ '^[1-9][0-9]{0,15}$'
    or jsonb_typeof(p_envelope->'expectedReportRevision') is distinct from 'number' or p_envelope->>'expectedReportRevision' !~ '^(0|[1-9][0-9]{0,15})$'
    or coalesce(p_envelope->>'expectedRole', '') not in ('owner', 'manager', 'staff')
    or jsonb_typeof(p_envelope->'command') is distinct from 'object' then
    raise sqlstate 'PT400' using message = 'Send a current visit report command';
  end if;
  command := p_envelope->'command';
  action_name := command->>'type';
  expected_role := p_envelope->>'expectedRole';
  visit_key := (p_envelope->>'visitId')::uuid;
  expected_visit := (p_envelope->>'expectedVisitRevision')::bigint;
  expected_report := (p_envelope->>'expectedReportRevision')::bigint;
  expected_membership := (p_envelope->>'membershipRevision')::bigint;
  operation := (p_envelope->>'operationId')::uuid;
  fields := case action_name
    when 'submit' then array['type','outcome','summary','issue','actualStart','actualEnd','completedTasks','observations']
    when 'correct' then array['type','summary','issue','actualStart','actualEnd','completedTasks','observations','reason']
    when 'review' then array['type','version','decision','note']
  end;
  if fields is null or not (command ?& fields) or (command - fields - case when action_name in ('submit','correct') then array['noteEventAt'] else array[]::text[] end) <> '{}'::jsonb
    or greatest(expected_visit, expected_report, expected_membership) > 9007199254740991
    or (action_name = 'submit') <> (expected_report = 0) then
    raise sqlstate 'PT400' using message = 'Send a current visit report command';
  end if;

  if current_setting('transaction_isolation') <> 'read committed'
    or coalesce(token->>'sub', '') !~* uuid_pattern
    or coalesce(token->>'session_id', '') !~* uuid_pattern
    or coalesce(token->>'exp', '') !~ '^[0-9]{1,15}$' then
    raise sqlstate 'PT403' using message = 'Visit reporting is unavailable';
  end if;
  actor := auth.uid();
  if actor is null or (token->>'exp')::bigint <= extract(epoch from clock_timestamp())
    or public.ech_session_active() is not true or not exists (
      select 1 from public.ech_operations_grants g join public.ech_memberships m using (user_id)
      where g.user_id = actor and g.active and m.active and g.membership_revision = m.revision
    ) then
    raise sqlstate 'PT403' using message = 'Visit reporting is unavailable';
  end if;

  -- The canonical writer lock serializes with schedule changes, access request
  -- creation and other report writes, including overlapping actual intervals.
  -- Other provider/account updates may lock rows in a different order.
  if not pg_try_advisory_xact_lock(617243902117::bigint) then
    raise sqlstate 'PT503' using message = 'Visit reporting is changing; retry';
  end if;
  select lower(u.email), u.email_confirmed_at is not null into identity_email, identity_confirmed
  from auth.users u where u.id = actor and u.deleted_at is null and u.is_anonymous is not true
    and (u.banned_until is null or u.banned_until <= clock_timestamp()) for share nowait;
  if not found then raise sqlstate 'PT403' using message = 'Visit reporting is unavailable'; end if;
  select s.not_after into provider_expires from auth.sessions s
  where s.id = (token->>'session_id')::uuid and s.user_id = actor for share nowait;
  if not found then raise sqlstate 'PT403' using message = 'Visit reporting is unavailable'; end if;
  select * into app_session from public.ech_sessions s
  where s.session_id = (token->>'session_id')::uuid and s.user_id = actor for share nowait;
  if not found then raise sqlstate 'PT403' using message = 'Visit reporting is unavailable'; end if;
  select * into request from public.ech_access_requests r where r.user_id = actor for share nowait;
  select * into member from public.ech_memberships m where m.user_id = actor and m.active for share nowait;
  if not found or (request.user_id is not null and (
      request.state <> 'approved' or request.approved_role is distinct from member.operational_role
      or member.application_admin or member.technical_admin or identity_confirmed is not true
      or identity_email is distinct from request.email
    )) then
    raise sqlstate 'PT403' using message = 'Visit reporting is unavailable';
  end if;
  if member.operational_role is distinct from expected_role or member.revision <> expected_membership then
    raise sqlstate 'PT409' using message = 'Visit reporting access changed; reload';
  end if;
  select * into permission from public.ech_operations_grants g
  where g.user_id = actor and g.active and g.membership_revision = member.revision for share nowait;
  if not found or (expected_role = 'staff' and (permission.access_level <> 'staff' or permission.worker_id is null))
    or (expected_role <> 'staff' and permission.access_level <> 'manager')
    or (action_name = 'submit' and permission.worker_id is null)
    or (action_name = 'review' and permission.access_level <> 'manager') then
    raise sqlstate 'PT403' using message = 'Visit reporting is unavailable';
  end if;
  if permission.worker_id is not null then
    perform 1 from public.ech_schedule_workers w
    where w.id = permission.worker_id and w.user_id = actor for share nowait;
    if not found then raise sqlstate 'PT403' using message = 'Visit reporting is unavailable'; end if;
  end if;
  select * into visit from public.ech_schedule_visits v where v.id = visit_key for update nowait;
  if not found or visit.service <> 'Home support' or visit.worker_id is null
    or visit.status not in ('In progress','Completed')
    or ((action_name = 'submit' or permission.access_level = 'staff')
      and visit.worker_id is distinct from permission.worker_id) then
    raise sqlstate 'PT403' using message = 'Visit reporting is unavailable';
  end if;
  select * into original from public.ech_visit_report_events e
  where e.visit_id = visit.id and e.report_revision = 1;
  -- No historical permission is inferred after any change to the pinned visit.
  if original.visit_id is not null and (
      original.completed_visit_revision <> visit.revision or visit.status <> 'Completed'
      or original.client_id <> visit.client_id
      or original.worker_id <> visit.worker_id
      or (permission.access_level = 'staff' and original.actor_id <> actor)
    ) then
    raise sqlstate 'PT403' using message = 'Visit reporting is unavailable';
  end if;
  if original.visit_id is null and (action_name <> 'submit' or visit.status <> 'In progress') then
    raise sqlstate 'PT403' using message = 'Visit reporting is unavailable';
  end if;
  -- Submission retries retain their original in-progress revision. All later
  -- actions name the completed revision. Neither path expands historical reads.
  if expected_visit <> (case when action_name = 'submit' and original.visit_id is not null
      then original.visit_revision else visit.revision end) then
    raise sqlstate 'PT412' using message = 'Visit changed; reload';
  end if;

  if app_session.revoked_at is not null or app_session.expires_at <= clock_timestamp()
    or app_session.created_at + interval '7 days' <= clock_timestamp()
    or provider_expires <= clock_timestamp() or (token->>'exp')::bigint <= extract(epoch from clock_timestamp())
    or public.ech_session_active() is not true then
    raise sqlstate 'PT403' using message = 'Visit reporting is unavailable';
  end if;

  request_hash := sha256(convert_to(p_envelope::text, 'UTF8'));
  select * into saved from public.ech_visit_report_events e where e.operation_id = operation;
  if found then
    if saved.actor_id <> actor or saved.visit_id <> visit.id or saved.request_digest <> request_hash then
      raise sqlstate 'PT409' using message = 'Operation identity conflict';
    end if;
  else
    if exists (select 1 from public.ech_schedule_operation_receipts r where r.operation_id = operation) then
      raise sqlstate 'PT409' using message = 'Operation identity conflict';
    end if;
    select coalesce(max(e.report_revision), 0) into current_report
      from public.ech_visit_report_events e where e.visit_id = visit.id;
    if current_report <> expected_report or current_report = 9007199254740991 then
      raise sqlstate 'PT409' using message = 'Visit report changed; reload';
    end if;
    if action_name = 'submit' and visit.revision = 9007199254740991 then
      raise sqlstate 'PT409' using message = 'Visit revision is exhausted';
    end if;
    if action_name <> 'submit' then
      select * into content from public.ech_visit_report_events e
      where e.visit_id = visit.id and e.action <> 'review' order by e.report_version desc limit 1;
    end if;

    if action_name = 'review' then
      if original.actor_id = actor or content.actor_id = actor then
        raise sqlstate 'PT403' using message = 'A different reviewer is required';
      end if;
      if jsonb_typeof(command->'version') is distinct from 'number'
        or command->>'version' !~ '^(0|[1-9][0-9]{0,15})$'
        or coalesce(command->>'decision', '') not in ('accepted','returned')
        or not public.ech_visit_report_text(command->'note', 3, 500) then
        raise sqlstate 'PT400' using message = 'Send a report version, review decision and note';
      end if;
      if (command->>'version')::bigint <> content.report_version then
        raise sqlstate 'PT409' using message = 'Visit report version changed; reload';
      end if;
    else
      recorded_outcome := case when action_name = 'submit' then command->>'outcome' else original.outcome end;
      if coalesce(recorded_outcome, '') not in ('completed','follow-up','not-completed')
        or not public.ech_visit_report_text(command->'summary', 3, 2000)
        or not public.ech_visit_report_text(command->'issue', 0, 1000)
        or not public.ech_visit_report_text(command->'observations', 0, 3000)
        or (action_name = 'correct' and not public.ech_visit_report_text(command->'reason', 3, 500))
        or jsonb_typeof(command->'completedTasks') is distinct from 'array' then
        raise sqlstate 'PT400' using message = 'Send a report outcome, factual summary and completed tasks';
      end if;
      if jsonb_array_length(command->'completedTasks') > 50
        or (recorded_outcome = 'completed' and jsonb_array_length(command->'completedTasks') = 0)
        or exists (select 1 from jsonb_array_elements(command->'completedTasks') t(value)
          where not public.ech_visit_report_text(t.value, 1, 500)) then
        raise sqlstate 'PT400' using message = 'Record only completed work; explain a zero-task outcome in the summary';
      end if;
      if command ? 'noteEventAt' and command->'noteEventAt' <> 'null'::jsonb then
        if jsonb_typeof(command->'noteEventAt') <> 'string' or command->>'noteEventAt' !~ timestamp_pattern then
          raise sqlstate 'PT400' using message = 'Send a valid UTC note event time';
        end if;
        begin
          note_event_at := (command->>'noteEventAt')::timestamptz;
        exception when invalid_datetime_format or datetime_field_overflow then
          raise sqlstate 'PT400' using message = 'Send a valid UTC note event time';
        end;
        if note_event_at > clock_timestamp() then
          raise sqlstate 'PT400' using message = 'Use a note event time that has already occurred';
        end if;
      end if;
      if coalesce(command->>'actualStart', '') !~ timestamp_pattern or coalesce(command->>'actualEnd', '') !~ timestamp_pattern then
        raise sqlstate 'PT400' using message = 'Send valid UTC actual visit times';
      end if;
      begin
        starts := (command->>'actualStart')::timestamptz;
        ends := (command->>'actualEnd')::timestamptz;
      exception when invalid_datetime_format or datetime_field_overflow then
        raise sqlstate 'PT400' using message = 'Send valid UTC actual visit times';
      end;
      if starts >= ends or ends > clock_timestamp() or ends - starts > interval '24 hours'
        or (ends - starts = interval '24 hours' and visit.ends_at - visit.starts_at <> interval '24 hours') then
        raise sqlstate 'PT400' using message = 'Use past actual times no longer than 24 hours; exactly 24 hours requires a scheduled 24-hour visit';
      end if;
      if exists (
        select 1 from (
          select distinct on (e.visit_id) e.actual_start, e.actual_end
          from public.ech_visit_report_events e
          where e.worker_id = visit.worker_id and e.visit_id <> visit.id and e.action <> 'review'
          order by e.visit_id, e.report_version desc
        ) latest where latest.actual_start < ends and starts < latest.actual_end
      ) then
        raise sqlstate 'PT409' using message = 'Actual times overlap another report for this worker';
      end if;
      tasks := array(select t.value #>> '{}' from jsonb_array_elements(command->'completedTasks')
        with ordinality t(value, position) order by t.position);
    end if;

    if app_session.expires_at <= clock_timestamp() or app_session.created_at + interval '7 days' <= clock_timestamp()
      or provider_expires <= clock_timestamp() or (token->>'exp')::bigint <= extract(epoch from clock_timestamp()) then
      raise sqlstate 'PT403' using message = 'Visit reporting is unavailable';
    end if;
    authored_at := clock_timestamp();
    -- Completion means the assigned actor submitted this factual account,
    -- including follow-up/zero-work outcomes; it does not assert attendance,
    -- accept the report, close an issue or approve worked time. Issue text is
    -- retained below. Addressed handovers require a separate approved recipient
    -- and disclosure contract; extra handover fields are rejected by the schema.
    if action_name = 'submit' then
      before_visit := public.ech_schedule_visit_snapshot(visit);
      update public.ech_schedule_visits v set status = 'Completed', revision = v.revision + 1
      where v.id = visit.id returning * into visit;
      after_visit := public.ech_schedule_visit_snapshot(visit);
    end if;
    insert into public.ech_visit_report_events (
      visit_id, visit_revision, completed_visit_revision, client_id, worker_id, report_revision, report_version, source_revision, operation_id,
      request_digest, action, actor_id, actor_role, membership_revision, recorded_at, outcome, summary, issue,
      actual_start, actual_end, completed_tasks, observations, correction_reason, decision, review_note, note_event_at
    ) values (
      visit.id, coalesce(original.visit_revision, visit.revision - 1), visit.revision,
      visit.client_id, visit.worker_id, current_report + 1,
      case action_name when 'submit' then 0 when 'correct' then content.report_version + 1 else content.report_version end,
      content.report_revision, operation, request_hash, action_name, actor, expected_role, member.revision, authored_at,
      recorded_outcome, command->>'summary', command->>'issue', starts, ends, tasks, command->>'observations',
      command->>'reason', command->>'decision', command->>'note', note_event_at
    ) returning * into saved;
    result := jsonb_build_object('visitId', saved.visit_id, 'visitRevision', saved.completed_visit_revision,
      'reportVersion', saved.report_version, 'reportRevision', saved.report_revision, 'operationId', saved.operation_id,
      'action', saved.action, 'recordedAt', to_char(saved.recorded_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'));
    if action_name = 'submit' then
      insert into public.ech_schedule_events (operation_id, actor_id, visit_id, revision, action, previous_visit, next_visit)
      values (operation, actor, visit.id, visit.revision, 'complete', before_visit, after_visit);
      insert into public.ech_schedule_operation_receipts (operation_id, actor_id, envelope, response)
      values (operation, actor, p_envelope, result);
    end if;
    -- Validate the exact post-append read projection inside this transaction,
    -- after all write triggers and while the exclusive writer lock is held.
    -- Failure rolls completion, report, audit and receipt back together.
    perform public.ech_visit_report_projection(visit, true);
  end if;

  -- Recheck after every trigger/write so an expiry rolls back schedule, report,
  -- event and receipt together; even saved retries require current authority.
  if app_session.expires_at <= clock_timestamp() or app_session.created_at + interval '7 days' <= clock_timestamp()
    or provider_expires <= clock_timestamp() or (token->>'exp')::bigint <= extract(epoch from clock_timestamp())
    or public.ech_session_active() is not true then
    raise sqlstate 'PT403' using message = 'Visit reporting is unavailable';
  end if;
  return jsonb_build_object('visitId', saved.visit_id, 'visitRevision', saved.completed_visit_revision,
    'reportVersion', saved.report_version, 'reportRevision', saved.report_revision, 'operationId', saved.operation_id,
    'action', saved.action, 'recordedAt', to_char(saved.recorded_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'));
exception when lock_not_available then
  raise sqlstate 'PT503' using message = 'Visit reporting is changing; retry';
end;
$$;

commit;
