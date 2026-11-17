-- Local draft only: no grants, application activation, or data changes.
begin;
create function public.ech_operations_visit_task_addition_context(
  p_role text,p_revision bigint,p_visit uuid,p_visit_revision bigint
) returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare v public.ech_schedule_visits; base public.ech_visit_task_plan_snapshots; source jsonb; n bigint;
begin
  perform public.ech_task_plan_manager_enter(p_role,p_revision);
  perform public.ech_operations_visit_detail(p_visit,p_visit_revision,p_role,p_revision);
  select * into v from public.ech_schedule_visits where id=p_visit for share nowait;
  select * into base from public.ech_visit_task_plan_snapshots where visit_id=p_visit for share nowait;
  if v.id is null or base.visit_id is null or v.service<>'Home support'
    or v.status not in ('Open','Assigned','Confirmed') then
    raise sqlstate 'PT403' using message='Visit-only task access is unavailable';
  end if;
  source:=public.ech_operations_client_source((base.source_snapshot->>'inquiry_id')::uuid);
  if source->>'revision' is distinct from base.source_snapshot->>'inquiry_revision'
    or coalesce(source->>'status','') not in ('New','Contacted','Assessment booked','On hold') then
    raise sqlstate 'PT409' using message='Review the current task-plan source';
  end if;
  select count(*) into n from public.ech_visit_task_plan_additions where visit_id=p_visit;
  if n>50 then raise sqlstate 'PT413' using message='Visit-only task history exceeds the supported limit';end if;
  perform public.ech_operations_visit_detail(p_visit,p_visit_revision,p_role,p_revision);
  perform public.ech_schedule_check_series_access(p_role,p_revision);
  return jsonb_build_object('visitId',p_visit,'visitRevision',p_visit_revision,
    'membershipRevision',p_revision,'planToken',base.plan_token,'additionCount',n);
exception when lock_not_available then raise sqlstate 'PT503' using message='Visit task access is changing';
end;$$;
revoke all on function public.ech_operations_visit_task_addition_context(text,bigint,uuid,bigint) from public,anon,authenticated;
do $$declare r record;begin
  for r in select p.oid::regprocedure sig,roles.rolname from pg_catalog.pg_proc p
    cross join lateral pg_catalog.aclexplode(coalesce(p.proacl,pg_catalog.acldefault('f',p.proowner))) a
    join pg_catalog.pg_roles roles on roles.oid=a.grantee
    where p.oid='public.ech_operations_visit_task_addition_context(text,bigint,uuid,bigint)'::regprocedure and a.grantee<>p.proowner loop
    execute format('revoke all on function %s from %I',r.sig,r.rolname);
  end loop;
end;$$;
commit;
