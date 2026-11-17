-- Private exact review read. No application grants, backfill or mutations.
-- A null plan means only that this exact current instruction version has no
-- structured plan. Neither response is scheduling eligibility, consent or
-- clinical authority; creation independently revalidates its reviewed sources.
begin;

create function public.ech_operations_task_plan_read(p_role text,p_revision bigint,p_client uuid,p_version bigint)
returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare r public.ech_schedule_client_readiness; c public.ech_operations_instruction_content;
 i public.ech_schedule_service_instructions; v public.ech_task_plan_versions;
 q jsonb; result jsonb; plan jsonb; token text;
begin
 if current_setting('transaction_isolation')<>'read committed' or p_role is null or p_role not in ('owner','manager')
  or p_revision is null or p_revision not between 1 and 9007199254740991 then
  raise sqlstate 'PT403' using message='Current manager task-plan access is unavailable';end if;
 perform pg_advisory_xact_lock(617243902117::bigint);
 -- Prelock every known relation before the canonical manager/session checks.
 -- An administrative relation/advisory inversion must fail NOWAIT, not hang
 -- while retaining dispatch serialization. Caller timeout settings are intact.
 lock table public.ech_task_plan_versions,public.ech_schedule_client_readiness,
  public.ech_operations_instruction_content,public.ech_schedule_service_instructions,
  public.ech_records,public.ech_sessions,public.ech_memberships,public.ech_access_requests,
  public.ech_operations_grants,public.ech_schedule_workers,auth.users,auth.sessions in row share mode nowait;
 perform public.ech_task_plan_manager_enter(p_role,p_revision);
 if p_client is null or p_version is null or p_version not between 1 and 9007199254740991 then
  raise sqlstate 'PT400' using message='Choose an exact nonclinical instruction version';end if;
 select * into r from public.ech_schedule_client_readiness where client_id=p_client for share nowait;
 if r.client_id is null or r.service<>'Home support' or r.instructions_version<>p_version
  or r.inquiry_id is null or r.inquiry_revision is null or r.inquiry_revision not between 1 and 9007199254740991
  or not public.ech_client_stamp_supported_v2(r.confirmed_at) or r.confirmed_at>clock_timestamp() then
  raise sqlstate 'PT409' using message='Review the exact current nonclinical instruction source';end if;
 -- Current visibility is evaluated against the inquiry's current assignment.
 -- Its FOR SHARE NOWAIT row lock and the readiness lock last through commit.
 q:=public.ech_operations_client_source(r.inquiry_id);
 if q->>'id' is distinct from r.inquiry_id::text or q->>'revision' is distinct from r.inquiry_revision::text
  or coalesce(q->>'status','') not in ('New','Contacted','Assessment booked','On hold') then
  raise sqlstate 'PT409' using message='Review the current open nonclinical instruction source';end if;
 select * into c from public.ech_operations_instruction_content where client_id=p_client and version=p_version for share nowait;
 select * into i from public.ech_schedule_service_instructions where client_id=p_client and version=p_version for share nowait;
 if c.client_id is null or i.client_id is null or c.source_revision is distinct from r.inquiry_revision
  or not public.ech_client_stamp_supported_v2(i.saved_at) or i.saved_at>clock_timestamp() then
  raise sqlstate 'PT409' using message='Review the exact current nonclinical instruction source';end if;
 select * into v from public.ech_task_plan_versions where client_id=p_client and instructions_version=p_version for share nowait;
 if found then
  perform public.ech_task_plan_check_provenance(v);
  -- Immutable authoring provenance must still name the very same instructions,
  -- body and source revision. Never fall back to a different/latest plan.
  if v.source_snapshot->>'kind' is distinct from 'authored-nonclinical-instructions'
   or v.source_snapshot->>'service' is distinct from 'Home support'
   or v.source_snapshot->>'inquiryId' is distinct from r.inquiry_id::text
   or v.source_snapshot->>'inquiryRevision' is distinct from r.inquiry_revision::text
   or v.source_snapshot->'instructions' is distinct from public.ech_task_plan_snapshot(i)
   or v.source_snapshot->'content' is distinct from public.ech_task_plan_snapshot(c) then
   raise sqlstate 'PT409' using message='Review the exact current nonclinical task-plan source';end if;
  if not public.ech_task_plan_categories(v.categories) or not public.ech_task_plan_text(v.author_label,160)
   or not public.ech_task_plan_text(v.source_reference,256) or not public.ech_client_stamp_supported_v2(v.authored_at)
   or v.authored_at>clock_timestamp() then
   raise sqlstate 'PT413' using message='Task-plan metadata exceeds the supported read contract';end if;
  plan:=jsonb_build_object('categories',v.categories,'authorId',v.author_id,'authorLabel',v.author_label,
   'authoredAt',to_char(v.authored_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),'sourceReference',v.source_reference);
  -- Hash the complete immutable row, never the smaller response projection.
  token:=public.ech_task_plan_token(public.ech_task_plan_snapshot(v));
 end if;
 result:=jsonb_build_object('schema',1,'membershipRevision',p_revision,'clientId',p_client,
  'instructionsVersion',p_version,'plan',plan,'planToken',token);
 -- Recheck current inquiry access and time-dependent session/provider/JWT expiry
 -- immediately before publishing either categories or explicit absence.
 if public.ech_operations_client_source(r.inquiry_id) is distinct from q then
  raise sqlstate 'PT409' using message='Nonclinical instruction source changed';end if;
 perform public.ech_schedule_check_series_access(p_role,p_revision);
 if octet_length(result::text)>100000 then
  raise sqlstate 'PT413' using message='Task-plan response exceeds its 100000-byte read limit';end if;
 return result;
exception when lock_not_available then raise sqlstate 'PT409' using message='Task-plan source access is changing';end;$$;

revoke all on function public.ech_operations_task_plan_read(text,bigint,uuid,bigint) from public,anon,authenticated;
do $$declare r record;begin
 for r in select p.oid::regprocedure signature,roles.rolname from pg_catalog.pg_proc p
 cross join lateral pg_catalog.aclexplode(coalesce(p.proacl,pg_catalog.acldefault('f',p.proowner))) a
 join pg_catalog.pg_roles roles on roles.oid=a.grantee
 where p.oid='public.ech_operations_task_plan_read(text,bigint,uuid,bigint)'::regprocedure and a.grantee<>p.proowner loop
  execute format('revoke all on function %s from %I',r.signature,r.rolname);
 end loop;
end;$$;
commit;
