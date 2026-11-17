-- Private planned-creation reservation check. No grants or seeded records.
-- Only explicitly planned Home support creates call this contract. The draft
-- writer prepares before insertion and finishes against the real canonical
-- receipt for each occurrence. Unplanned requests retain their existing path.
begin;

create function public.ech_task_plan_review_creation(p_role text,p_revision bigint,p_client uuid,p_version bigint,p_plan_token text)
returns void language plpgsql volatile set search_path='' as $$
declare v public.ech_task_plan_versions; q jsonb; r public.ech_schedule_client_readiness;
begin
 perform public.ech_task_plan_manager_enter(p_role,p_revision);
 if p_client is null or p_version is null or p_plan_token is null or p_plan_token !~ '^[0-9a-f]{64}$' then
  raise sqlstate 'PT400' using message='Choose an exact reviewed nonclinical task plan';end if;
 select * into r from public.ech_schedule_client_readiness where client_id=p_client for share nowait;
 select * into v from public.ech_task_plan_versions where client_id=p_client and instructions_version=p_version for share nowait;
 if v.client_id is null or public.ech_task_plan_token(public.ech_task_plan_snapshot(v))<>p_plan_token
  or r.client_id is null or r.service<>'Home support' or r.instructions_version<>p_version
  or r.inquiry_id::text is distinct from v.source_snapshot->>'inquiryId'
  or r.inquiry_revision::text is distinct from v.source_snapshot->>'inquiryRevision' then
  raise sqlstate 'PT409' using message='Review the exact current nonclinical task-plan source';end if;
 -- Authorship supplies neither consent nor clinical authority. Check current
 -- visibility and open revision independently of saved authoring provenance.
 q:=public.ech_operations_client_source((v.source_snapshot->>'inquiryId')::uuid);
 if q->>'id' is distinct from v.source_snapshot->>'inquiryId'
  or q->>'revision' is distinct from v.source_snapshot->>'inquiryRevision'
  or coalesce(q->>'status','') not in ('New','Contacted','Assessment booked','On hold') then
  raise sqlstate 'PT409' using message='Review the current open task-plan source before reserving this creation';end if;
 perform public.ech_task_plan_check_provenance(v);
 perform public.ech_schedule_check_series_access(p_role,p_revision);
end;$$;

revoke all on function public.ech_task_plan_review_creation(text,bigint,uuid,bigint,text) from public,anon,authenticated;
do $$ declare r record;begin
 for r in select p.oid::regprocedure signature,roles.rolname from pg_catalog.pg_proc p
 cross join lateral pg_catalog.aclexplode(coalesce(p.proacl,pg_catalog.acldefault('f',p.proowner))) a
 join pg_catalog.pg_roles roles on roles.oid=a.grantee
 where p.oid='public.ech_task_plan_review_creation(text,bigint,uuid,bigint,text)'::regprocedure and a.grantee<>p.proowner loop
  execute format('revoke all on function %s from %I',r.signature,r.rolname);
 end loop;
end;$$;
commit;
