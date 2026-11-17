begin;
-- Disabled source: no execute privilege is granted by this migration.
create function public.ech_schedule_receipt_status(p_envelope jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid := auth.uid(); visit_id uuid; requested_operation_id uuid; role_value text; member_revision bigint; saved public.ech_schedule_operation_receipts;
begin
 if actor is null or jsonb_typeof(p_envelope) is distinct from 'object'
   or not (p_envelope ?& array['schema','operationId','expectedRevision','expectedRole','membershipRevision','command'])
   or (p_envelope - array['schema','operationId','expectedRevision','expectedRole','membershipRevision','command']) <> '{}'::jsonb
   or p_envelope->'schema' is distinct from '2'::jsonb
   or jsonb_typeof(p_envelope->'command') is distinct from 'object'
   or p_envelope#>>'{command,type}' not in ('assign','unassign','reschedule','cancel','confirm') then
  raise sqlstate 'PT400' using message='Invalid receipt request';
 end if;
 requested_operation_id := (p_envelope->>'operationId')::uuid;
 visit_id := (p_envelope#>>'{command,visitId}')::uuid;
 role_value := p_envelope->>'expectedRole';
 member_revision := (p_envelope->>'membershipRevision')::bigint;
 if requested_operation_id is null or visit_id is null or role_value not in ('owner','manager','staff') or member_revision < 1 then
  raise sqlstate 'PT400' using message='Invalid receipt request';
 end if;
 -- The existing read function checks active session, current grant, role and assignment.
 perform public.ech_operations_schedule_visit(visit_id,role_value,member_revision);
 select * into saved from public.ech_schedule_operation_receipts r where r.operation_id=requested_operation_id and r.actor_id=actor;
 if found and saved.envelope=p_envelope then
  perform public.ech_operations_schedule_visit(visit_id,role_value,member_revision);
  return jsonb_build_object('schema',1,'status','recorded','operationId',requested_operation_id,'visitId',visit_id);
 end if;
 perform public.ech_operations_schedule_visit(visit_id,role_value,member_revision);
 return jsonb_build_object('schema',1,'status','unknown','operationId',requested_operation_id,'visitId',visit_id);
exception when invalid_text_representation or numeric_value_out_of_range then
 raise sqlstate 'PT400' using message='Invalid receipt request';
end;$$;
revoke all on function public.ech_schedule_receipt_status(jsonb) from public;
do $$ declare recipient record; begin
 for recipient in select distinct r.rolname from pg_catalog.pg_proc p
 cross join lateral pg_catalog.aclexplode(p.proacl) a join pg_catalog.pg_roles r on r.oid=a.grantee
 where p.oid='public.ech_schedule_receipt_status(jsonb)'::regprocedure and a.grantee<>p.proowner
 loop execute format('revoke all on function public.ech_schedule_receipt_status(jsonb) from %I',recipient.rolname); end loop;
end;$$;
commit;
