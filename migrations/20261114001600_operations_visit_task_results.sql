-- Local review draft only. This migration is not applied or granted to the app.
-- A visit's pinned plan is immutable; factual results are separate events.
begin;

create table public.ech_visit_task_result_events (
  visit_id uuid not null references public.ech_visit_task_plan_snapshots(visit_id),
  task_id uuid not null,
  version integer not null check (version between 1 and 1000),
  operation_id uuid not null unique,
  actor_id uuid not null references public.ech_memberships(user_id),
  visit_revision bigint not null check (visit_revision between 1 and 9007199254740991),
  outcome text not null check (outcome in ('done','declined','unable','not-required')),
  observation text not null check (length(observation) <= 3000),
  actual_at timestamptz not null check (isfinite(actual_at)),
  recorded_at timestamptz not null default clock_timestamp() check (isfinite(recorded_at)),
  correction_reason text,
  primary key (visit_id,task_id,version),
  check ((version = 1 and correction_reason is null) or
    (version > 1 and correction_reason is not null and length(btrim(correction_reason)) between 3 and 500))
);

create trigger ech_visit_task_results_keep
  before update or delete or truncate on public.ech_visit_task_result_events
  for each statement execute function public.ech_schedule_keep_history();
alter table public.ech_visit_task_result_events enable row level security;
revoke all on public.ech_visit_task_result_events from public, anon, authenticated;

-- Authorization is delegated to the existing current-visit check, including
-- the assigned-worker and session checks. No inquiry record is returned.
create function public.ech_operations_visit_task_plan_read(
  p_visit uuid, p_visit_revision bigint, p_role text, p_membership_revision bigint
) returns jsonb language plpgsql volatile security definer set search_path='' set timezone='UTC' as $$
declare base public.ech_visit_task_plan_snapshots; visit_status text; additions jsonb; results jsonb; response jsonb;
begin
  perform public.ech_operations_visit_detail(p_visit,p_visit_revision,p_role,p_membership_revision);
  -- Historical task disclosure is not established by the visit-detail contract.
  select status into visit_status from public.ech_schedule_visits where id=p_visit for share nowait;
  if visit_status is null or visit_status in ('Completed','Cancelled') then
    raise sqlstate 'PT403' using message='Visit task details are unavailable';
  end if;
  select * into base from public.ech_visit_task_plan_snapshots where visit_id=p_visit for share nowait;
  if not found then
    response:=jsonb_build_object('visitId',p_visit,'visitRevision',p_visit_revision,'plan',null,'additions','[]'::jsonb,'results','[]'::jsonb,
      'resultVisibility',case when p_role='staff' then 'limited' else 'complete' end);
  else
    select coalesce(jsonb_agg(jsonb_build_object('categoryId',a.category_id,'taskId',a.task_id,
      'text',a.task_text,'ordinal',a.ordinal) order by a.ordinal),'[]'::jsonb) into additions
      from public.ech_visit_task_plan_additions a where a.visit_id=p_visit;
    select coalesce(jsonb_agg(jsonb_build_object('taskId',e.task_id,'version',e.version,
      'outcome',e.outcome,'observation',e.observation,'actualAt',e.actual_at,
      'recordedAt',e.recorded_at,'actorId',e.actor_id,'reason',e.correction_reason)
      order by e.task_id,e.version),'[]'::jsonb) into results
      from public.ech_visit_task_result_events e where e.visit_id=p_visit
        and (p_role <> 'staff' or e.actor_id=auth.uid());
    response:=jsonb_build_object('visitId',p_visit,'visitRevision',p_visit_revision,
      'plan',base.plan_snapshot->'categories','additions',additions,'results',results,
      'resultVisibility',case when p_role='staff' then 'limited' else 'complete' end);
  end if;
  if octet_length(response::text)>500000 then
    raise sqlstate 'PT413' using message='Visit task history exceeds the supported read limit';
  end if;
  perform public.ech_operations_visit_detail(p_visit,p_visit_revision,p_role,p_membership_revision);
  return response;
exception when lock_not_available then raise sqlstate 'PT503' using message='Visit task access is changing';
end;$$;

revoke all on function public.ech_operations_visit_task_plan_read(uuid,bigint,text,bigint)
  from public, anon, authenticated;

-- This inactive writer accepts only the current assigned worker while the visit
-- is in progress. Later corrections and reassignment visibility remain closed.
create function public.ech_operations_visit_task_result_write(
  p_visit uuid, p_visit_revision bigint, p_membership_revision bigint,
  p_task uuid, p_expected_version integer, p_operation uuid, p_outcome text,
  p_observation text, p_actual_at timestamptz, p_reason text
) returns jsonb language plpgsql volatile security definer set search_path='' set timezone='UTC' as $$
declare v public.ech_schedule_visits; base public.ech_visit_task_plan_snapshots;
  existing public.ech_visit_task_result_events; latest public.ech_visit_task_result_events;
  saved public.ech_visit_task_result_events; history_count bigint; history jsonb; additions jsonb; projected jsonb;
begin
  if p_visit is null or p_task is null or p_operation is null or p_expected_version is null
    or p_expected_version not between 0 and 999 or p_outcome is null
    or p_outcome not in ('done','declined','unable','not-required')
    or p_observation is null or length(p_observation)>3000
    or p_actual_at is null or not isfinite(p_actual_at)
    or (p_expected_version=0 and p_reason is not null)
    or (p_expected_version>0 and (p_reason is null or length(btrim(p_reason)) not between 3 and 500)) then
    raise sqlstate 'PT400' using message='Review the task result';
  end if;
  perform public.ech_operations_visit_detail(p_visit,p_visit_revision,'staff',p_membership_revision);
  select * into v from public.ech_schedule_visits where id=p_visit for update nowait;
  if v.status is distinct from 'In progress' or v.revision is distinct from p_visit_revision then
    raise sqlstate 'PT409' using message='The visit changed; review the current task';
  end if;
  select * into base from public.ech_visit_task_plan_snapshots where visit_id=p_visit for share nowait;
  if not found or (not exists(select 1 from jsonb_array_elements(base.plan_snapshot->'categories') c
      cross join lateral jsonb_array_elements(c->'tasks') t where t->>'id'=p_task::text)
    and not exists(select 1 from public.ech_visit_task_plan_additions a where a.visit_id=p_visit and a.task_id=p_task)) then
    raise sqlstate 'PT409' using message='The task is not in this visit plan';
  end if;
  select * into existing from public.ech_visit_task_result_events where operation_id=p_operation;
  if found then
    if existing.visit_id is distinct from p_visit or existing.task_id is distinct from p_task
      or existing.version is distinct from p_expected_version+1 or existing.actor_id is distinct from auth.uid()
      or existing.visit_revision is distinct from p_visit_revision or existing.outcome is distinct from p_outcome
      or existing.observation is distinct from p_observation or existing.actual_at is distinct from p_actual_at
      or existing.correction_reason is distinct from p_reason then
      raise sqlstate 'PT409' using message='Keep the original task-result request';
    end if;
    saved:=existing;
  else
    select * into latest from public.ech_visit_task_result_events
      where visit_id=p_visit and task_id=p_task order by version desc limit 1;
    if coalesce(latest.version,0)<>p_expected_version or (latest.actor_id is not null and latest.actor_id<>auth.uid()) then
      raise sqlstate 'PT409' using message='Review the current task result';
    end if;
    insert into public.ech_visit_task_result_events(visit_id,task_id,version,operation_id,actor_id,visit_revision,
      outcome,observation,actual_at,correction_reason)
      values(p_visit,p_task,p_expected_version+1,p_operation,auth.uid(),p_visit_revision,p_outcome,p_observation,p_actual_at,p_reason)
      returning * into saved;
    -- Keep the complete manager read bounded. The visit row lock serializes
    -- writers; an over-budget insert rolls back instead of losing history.
    select count(*),coalesce(jsonb_agg(jsonb_build_object('taskId',e.task_id,'version',e.version,
      'outcome',e.outcome,'observation',e.observation,'actualAt',e.actual_at,'recordedAt',e.recorded_at,
      'actorId',e.actor_id,'reason',e.correction_reason) order by e.task_id,e.version),'[]'::jsonb)
      into history_count,history from public.ech_visit_task_result_events e where e.visit_id=p_visit;
    select coalesce(jsonb_agg(jsonb_build_object('categoryId',a.category_id,'taskId',a.task_id,
      'text',a.task_text,'ordinal',a.ordinal) order by a.ordinal),'[]'::jsonb) into additions
      from public.ech_visit_task_plan_additions a where a.visit_id=p_visit;
    projected:=jsonb_build_object('visitId',p_visit,'visitRevision',p_visit_revision,
      'plan',base.plan_snapshot->'categories','additions',additions,'results',history,'resultVisibility','complete');
    if history_count>1000 or octet_length(projected::text)>450000 then
      raise sqlstate 'PT413' using message='Visit task history reached its supported limit';
    end if;
  end if;
  perform public.ech_operations_visit_detail(p_visit,p_visit_revision,'staff',p_membership_revision);
  return jsonb_build_object('visitId',saved.visit_id,'taskId',saved.task_id,'version',saved.version,
    'operationId',saved.operation_id,'recordedAt',saved.recorded_at);
exception when lock_not_available then raise sqlstate 'PT503' using message='Visit task access is changing';
  when unique_violation then raise sqlstate 'PT409' using message='Keep the original task-result request';
end;$$;

revoke all on function public.ech_operations_visit_task_result_write(uuid,bigint,bigint,uuid,integer,uuid,text,text,timestamptz,text)
  from public, anon, authenticated;

-- Provider default privileges can name roles beyond the standard API roles.
do $$declare r record; begin
  for r in select roles.rolname from pg_catalog.pg_class t
    cross join lateral pg_catalog.aclexplode(coalesce(t.relacl,pg_catalog.acldefault('r',t.relowner))) a
    join pg_catalog.pg_roles roles on roles.oid=a.grantee
    where t.oid='public.ech_visit_task_result_events'::regclass and a.grantee<>t.relowner loop
    execute format('revoke all on table public.ech_visit_task_result_events from %I',r.rolname);
  end loop;
  for r in select p.oid::regprocedure sig,roles.rolname from pg_catalog.pg_proc p
    cross join lateral pg_catalog.aclexplode(coalesce(p.proacl,pg_catalog.acldefault('f',p.proowner))) a
    join pg_catalog.pg_roles roles on roles.oid=a.grantee
    where p.oid in ('public.ech_operations_visit_task_plan_read(uuid,bigint,text,bigint)'::regprocedure,
      'public.ech_operations_visit_task_result_write(uuid,bigint,bigint,uuid,integer,uuid,text,text,timestamptz,text)'::regprocedure)
      and a.grantee<>p.proowner loop
    execute format('revoke all on function %s from %I',r.sig,r.rolname);
  end loop;
end;$$;
commit;
