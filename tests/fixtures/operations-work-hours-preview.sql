-- Additive, disabled persistence candidate: install only into disposable fictional databases.
-- Load after exact ECH main SQL; apply only via isolated fixture process owner.
begin;
create schema ech_fixture_hours;
revoke all on schema ech_fixture_hours from public, anon, authenticated, service_role;
create table ech_fixture_hours.decisions(
  visit_id uuid not null,
  content_revision bigint not null check(content_revision>0),
  visit_revision bigint not null check(visit_revision>0),
  stream_revision bigint not null check(stream_revision>=content_revision),
  membership_revision bigint not null check(membership_revision>0),
  actor_id uuid not null,
  operation_id uuid not null,
  decision text not null check(decision in ('approve','return')),
  reason text,
  actual_start timestamptz not null,
  actual_end timestamptz not null,
  recorded_at timestamptz not null,
  primary key(visit_id,content_revision),
  unique(actor_id,operation_id),
  check(actual_end>actual_start and actual_end-actual_start<interval '24 hours'),
  check(reason is null or length(reason) between 1 and 500),
  check(decision<>'return' or reason is not null)
);
alter table ech_fixture_hours.decisions enable row level security;
revoke all on ech_fixture_hours.decisions from public, anon, authenticated, service_role;

-- Dedicated work-hours function; never calls the care-report review writer.
-- The canonical report reader keeps current auth/scope and report/visit locks
-- (including its shared advisory lock) until this statement transaction ends.
create function ech_fixture_hours.decide(
  p_visit uuid,p_visit_revision bigint,p_stream_revision bigint,p_content_revision bigint,
  p_role text,p_membership_revision bigint,p_operation uuid,p_decision text,p_reason text
) returns jsonb language plpgsql volatile security invoker set search_path='' as $fn$
declare
  report jsonb; selected jsonb; original jsonb; actor uuid; reason_text text;
  started timestamptz; ended timestamptz; saved ech_fixture_hours.decisions;
begin
  if p_role is null or p_role not in ('manager','owner') then
    raise sqlstate 'PT403' using message='Work-hours review is unavailable';
  end if;
  if p_content_revision is null or p_content_revision not between 1 and 9007199254740991
     or p_stream_revision is null or p_stream_revision<p_content_revision
     or p_operation is null or p_decision is null or p_decision not in ('approve','return') then
    raise sqlstate 'PT400' using message='Choose an exact work-hours decision';
  end if;
  reason_text:=nullif(btrim(p_reason),'');
  if length(reason_text)>500 or (p_decision='return' and reason_text is null) then
    raise sqlstate 'PT400' using message='Choose an exact work-hours decision';
  end if;
  report:=public.ech_operations_visit_report(p_visit,p_visit_revision,p_role,p_membership_revision,p_stream_revision);
  original:=report->'versions'->0;
  selected:=report->'versions'->-1;
  actor:=auth.uid();
  if selected is null or actor is null or actor=(original->>'actorId')::uuid or actor=(selected->>'actorId')::uuid then
    raise sqlstate 'PT403' using message='Work-hours review is unavailable';
  end if;
  if (selected->>'revision')::bigint is distinct from p_content_revision then
    raise sqlstate 'PT412' using message='The current reported hours changed';
  end if;
  started:=(selected->>'actualStart')::timestamptz;
  ended:=(selected->>'actualEnd')::timestamptz;
  if started is null or ended is null or not isfinite(started) or not isfinite(ended)
     or ended<=started or ended-started>=interval '24 hours' then
    raise sqlstate 'PT503' using message='Reported hours could not be verified';
  end if;
  insert into ech_fixture_hours.decisions(visit_id,content_revision,visit_revision,stream_revision,membership_revision,
    actor_id,operation_id,decision,reason,actual_start,actual_end,recorded_at)
  values(p_visit,p_content_revision,p_visit_revision,p_stream_revision,p_membership_revision,actor,p_operation,
    p_decision,reason_text,started,ended,clock_timestamp())
  on conflict do nothing returning * into saved;
  if not found then
    select * into saved from ech_fixture_hours.decisions
    where actor_id=actor and operation_id=p_operation;
    if not found or (saved.visit_id,saved.content_revision,saved.visit_revision,saved.stream_revision,saved.membership_revision,
        saved.decision,saved.reason,saved.actual_start,saved.actual_end)
      is distinct from (p_visit,p_content_revision,p_visit_revision,p_stream_revision,p_membership_revision,
        p_decision,reason_text,started,ended) then
      raise sqlstate 'PT409' using message='This report revision already has a decision or the operation changed';
    end if;
  end if;
  return jsonb_build_object('schema',1,'visitId',saved.visit_id,'visitRevision',saved.visit_revision,
    'reportRevision',saved.stream_revision,'contentRevision',saved.content_revision,
    'membershipRevision',saved.membership_revision,'operationId',saved.operation_id,'decision',saved.decision,
    'recordedAt',to_char(saved.recorded_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'));
end;
$fn$;
revoke all on function ech_fixture_hours.decide(uuid,bigint,bigint,bigint,text,bigint,uuid,text,text)
  from public, anon, authenticated, service_role;

create function ech_fixture_hours.read_current(
  p_visit uuid,p_visit_revision bigint,p_stream_revision bigint,p_role text,p_membership_revision bigint
) returns jsonb language plpgsql volatile security invoker set search_path='' as $fn$
declare report jsonb; latest_content bigint; receipt jsonb; actor uuid;
begin
  if p_role is null or p_role not in ('manager','owner','staff') then
    raise sqlstate 'PT403' using message='Work-hours review is unavailable';
  end if;
  if p_stream_revision is null or p_stream_revision<1 then
    raise sqlstate 'PT400' using message='Choose the current report';
  end if;
  report:=public.ech_operations_visit_report(p_visit,p_visit_revision,p_role,p_membership_revision,p_stream_revision);
  latest_content:=(report->'versions'->-1->>'revision')::bigint;
  actor:=auth.uid();
  if latest_content is null or actor is null then
    raise sqlstate 'PT412' using message='The current report is not available';
  end if;
  if p_role='staff' and actor is distinct from (report->'versions'->0->>'actorId')::uuid then
    raise sqlstate 'PT403' using message='Work-hours review is unavailable';
  end if;
  select jsonb_build_object('decision',d.decision) ||
    case when p_role='staff' then '{}'::jsonb else
      jsonb_build_object('recordedAt',to_char(d.recorded_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')) end
    into receipt
    from ech_fixture_hours.decisions d where d.visit_id=p_visit and d.content_revision=latest_content;
  return jsonb_build_object('schema',1,'enabled',true,'visitId',p_visit,'visitRevision',p_visit_revision,
    'reportRevision',p_stream_revision,'contentRevision',latest_content,'membershipRevision',p_membership_revision,
    'canDecide',p_role<>'staff' and receipt is null and actor<>(report->'versions'->0->>'actorId')::uuid
      and actor<>(report->'versions'->-1->>'actorId')::uuid,'receipt',receipt);
end;
$fn$;
revoke all on function ech_fixture_hours.read_current(uuid,bigint,bigint,text,bigint)
  from public, anon, authenticated, service_role;
commit;
