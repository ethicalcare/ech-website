-- Draft additive storage only. Do not activate until the report writer and
-- projection are updated and reviewed together. Existing entries stay null.
begin;
alter table public.ech_visit_report_events
  add column note_event_at timestamptz(3);
alter table public.ech_visit_report_events
  add constraint ech_report_note_event_time_valid
  check (note_event_at is null or (action <> 'review' and isfinite(note_event_at) and note_event_at <= recorded_at));

create or replace function public.ech_visit_report_projection(p_visit public.ech_schedule_visits, p_appending boolean default false)
returns jsonb language plpgsql volatile set search_path = ''
as $$
declare
  original public.ech_visit_report_events;
  entry public.ech_visit_report_events;
  content public.ech_visit_report_events;
  stream_revision bigint := 0;
  versions jsonb := '[]'::jsonb;
  reviews jsonb := '[]'::jsonb;
  result jsonb;
  capacity_state text := case when p_appending then 'PT409' else 'PT503' end;
begin
  -- Lock the complete bounded stream while holding current access and visit locks.
  -- No earlier assignee, prior revision, cancelled visit or changed client inherits
  -- access. Historical-access policy is deliberately not inferred here.
  for entry in select * from public.ech_visit_report_events e
    where e.visit_id = p_visit.id order by e.report_revision for share nowait
  loop
    stream_revision := stream_revision + 1;
    if stream_revision > 1000 then
      raise exception using errcode = capacity_state, message = 'Visit report history exceeds the supported limit';
    end if;
    if entry.report_revision <> stream_revision then
      raise sqlstate 'PT503' using message = 'Visit report history could not be verified';
    end if;
    if stream_revision = 1 then
      original := entry;
      if original.action <> 'submit' or original.report_version <> 0 or original.source_revision is not null then
        raise sqlstate 'PT503' using message = 'Visit report history could not be verified';
      end if;
      if p_visit.status <> 'Completed' or original.completed_visit_revision <> p_visit.revision
        or original.client_id <> p_visit.client_id or original.worker_id is distinct from p_visit.worker_id then
        raise sqlstate 'PT403' using message = 'Visit reports are unavailable';
      end if;
    end if;
    if entry.visit_revision <> original.visit_revision or entry.completed_visit_revision <> original.completed_visit_revision
      or entry.client_id <> original.client_id or entry.worker_id <> original.worker_id
      or (stream_revision > 1 and entry.source_revision is distinct from content.report_revision)
      or (entry.action = 'review' and (entry.report_version is distinct from content.report_version
        or entry.actor_role not in ('owner','manager') or entry.actor_id in (original.actor_id, content.actor_id)))
      or (entry.action = 'correct' and (entry.report_version is distinct from content.report_version + 1
        or entry.outcome is distinct from original.outcome)) then
      raise sqlstate 'PT503' using message = 'Visit report history could not be verified';
    end if;
    if entry.action = 'review' then
      reviews := reviews || jsonb_build_array(jsonb_build_object(
        'revision', entry.report_revision, 'version', entry.report_version, 'sourceRevision', entry.source_revision,
        'actorId', entry.actor_id, 'actorRole', entry.actor_role,
        'recordedAt', to_char(entry.recorded_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
        'decision', entry.decision, 'note', entry.review_note));
    else
      content := entry;
      versions := versions || jsonb_build_array(jsonb_build_object(
        'revision', entry.report_revision, 'version', entry.report_version, 'sourceRevision', entry.source_revision,
        'actorId', entry.actor_id, 'actorRole', entry.actor_role,
        'recordedAt', to_char(entry.recorded_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
        'outcome', entry.outcome, 'summary', entry.summary, 'issue', entry.issue,
        'noteEventAt', case when entry.note_event_at is null then null else to_char(entry.note_event_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') end,
        'actualStart', to_char(entry.actual_start at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
        'actualEnd', to_char(entry.actual_end at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
        'completedTasks', entry.completed_tasks, 'observations', entry.observations, 'reason', entry.correction_reason));
    end if;
  end loop;
  result := jsonb_build_object('schema', 1, 'visitId', p_visit.id, 'visitRevision', p_visit.revision,
    'reportRevision', stream_revision, 'versions', versions, 'reviews', reviews);
  if octet_length(convert_to(result::text, 'UTF8')) > 1500000 then
    raise exception using errcode = capacity_state, message = 'Visit report history exceeds the supported limit';
  end if;
  return result;
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
      if starts >= ends or ends > clock_timestamp() or ends - starts >= interval '24 hours' then
        raise sqlstate 'PT400' using message = 'Use a past actual visit interval under 24 hours';
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
