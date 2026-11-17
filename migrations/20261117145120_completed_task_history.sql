-- Draft only: separate completed-history access approved November 17, 2026.
-- No existing task read/write policy is relaxed; no application grants.
begin;
create function public.ech_operations_completed_task_history(
 p_visit uuid,p_visit_revision bigint,p_role text,p_membership_revision bigint,p_report_revision bigint
) returns jsonb language plpgsql volatile security definer set search_path='' set timezone='UTC' as $$
declare report jsonb; original public.ech_visit_report_events; visit public.ech_schedule_visits;
 results jsonb; response jsonb; result_count bigint;
begin
 if p_report_revision is null or p_report_revision not between 1 and 9007199254740991 then
  raise sqlstate 'PT400' using message='Choose a current completed report';
 end if;
 -- Canonical report authority locks current identity, session, membership,
 -- operational grant and visit, validates original author/assignment and every
 -- report revision. It fails closed on revoked, stale or reassigned access.
 report:=public.ech_operations_visit_report(p_visit,p_visit_revision,p_role,p_membership_revision,p_report_revision);
 select * into visit from public.ech_schedule_visits where id=p_visit for share nowait;
 select * into original from public.ech_visit_report_events where visit_id=p_visit and report_revision=1 for share nowait;
 if visit.status is distinct from 'Completed' or visit.revision is distinct from p_visit_revision
  or original.action is distinct from 'submit' or original.completed_visit_revision is distinct from visit.revision
  or original.client_id is distinct from visit.client_id or original.worker_id is distinct from visit.worker_id
  or (p_role='staff' and original.actor_id is distinct from auth.uid()) then
  raise sqlstate 'PT403' using message='Completed task history is unavailable';
 end if;
 -- Results are immutable. Current visit's share lock excludes concurrent task
 -- writers; cancelled visits never inherit this separate disclosure contract.
 select count(*) into result_count from public.ech_visit_task_result_events e
  where e.visit_id=p_visit and (p_role<>'staff' or e.actor_id=auth.uid());
 if result_count>1000 then raise sqlstate 'PT413' using message='Completed task history exceeds the supported limit';end if;
 with labels as (
  select (t->>'id')::uuid task_id,t->>'text' task_label
  from public.ech_visit_task_plan_snapshots s cross join lateral jsonb_array_elements(s.plan_snapshot->'categories') c
   cross join lateral jsonb_array_elements(c->'tasks') t where s.visit_id=p_visit
  union all select task_id,task_text from public.ech_visit_task_plan_additions where visit_id=p_visit
 ) select coalesce(jsonb_agg(jsonb_build_object('taskId',e.task_id,'taskLabel',l.task_label,'version',e.version,
  'outcome',e.outcome,'observation',e.observation,'actualAt',e.actual_at,'recordedAt',e.recorded_at,
  'actorId',e.actor_id,'reason',e.correction_reason) order by e.task_id,e.version),'[]'::jsonb) into results
 from public.ech_visit_task_result_events e left join labels l on l.task_id=e.task_id
 where e.visit_id=p_visit and (p_role<>'staff' or e.actor_id=auth.uid());
 if jsonb_array_length(results)<>result_count or exists(select 1 from jsonb_array_elements(results) e where e->>'taskLabel' is null) then
  raise sqlstate 'PT503' using message='Completed task history could not be verified';
 end if;
 response:=jsonb_build_object('visitId',p_visit,'visitRevision',p_visit_revision,'reportRevision',p_report_revision,
  'resultVisibility',case when p_role='staff' then 'limited' else 'complete' end,'results',results);
 if octet_length(response::text)>500000 then raise sqlstate 'PT413' using message='Completed task history exceeds the supported limit';end if;
 -- Revalidate exact report stream and current session after projection.
 perform public.ech_operations_visit_report(p_visit,p_visit_revision,p_role,p_membership_revision,p_report_revision);
 return response;
exception when lock_not_available then raise sqlstate 'PT503' using message='Completed task access is changing';
end;$$;
revoke all on function public.ech_operations_completed_task_history(uuid,bigint,text,bigint,bigint) from public,anon,authenticated;
do $$declare r record;begin
 for r in select roles.rolname from pg_catalog.pg_proc p
  cross join lateral pg_catalog.aclexplode(coalesce(p.proacl,pg_catalog.acldefault('f',p.proowner))) a
  join pg_catalog.pg_roles roles on roles.oid=a.grantee
  where p.oid='public.ech_operations_completed_task_history(uuid,bigint,text,bigint,bigint)'::regprocedure and a.grantee<>p.proowner
 loop execute format('revoke all on function public.ech_operations_completed_task_history(uuid,bigint,text,bigint,bigint) from %I',r.rolname);end loop;
end;$$;
commit;
