begin;
-- Draft only. No application privileges or activation.
create function public.ech_phone_source_refresh(p_envelope jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid(); op uuid; cid uuid; vid uuid; inquiry uuid; source_rev bigint; visit_rev bigint; generation bigint; expected bigint; role_name text; member_rev bigint; v public.ech_schedule_visits; binding public.ech_schedule_client_readiness; prior public.ech_phone_source_refreshes; source jsonb;
begin
 if jsonb_typeof(p_envelope) is distinct from 'object' or not(p_envelope ?& array['schema','operationId','clientId','visitId','visitRevision','inquiryId','inquiryRevision','expectedGeneration','expectedRole','membershipRevision'])
 or p_envelope-array['schema','operationId','clientId','visitId','visitRevision','inquiryId','inquiryRevision','expectedGeneration','expectedRole','membershipRevision']<>'{}'::jsonb or p_envelope->'schema' is distinct from '1'::jsonb then raise sqlstate 'PT400' using message='Invalid phone refresh'; end if;
 op:=(p_envelope->>'operationId')::uuid;cid:=(p_envelope->>'clientId')::uuid;vid:=(p_envelope->>'visitId')::uuid;inquiry:=(p_envelope->>'inquiryId')::uuid;
 source_rev:=(p_envelope->>'inquiryRevision')::bigint;visit_rev:=(p_envelope->>'visitRevision')::bigint;expected:=(p_envelope->>'expectedGeneration')::bigint;member_rev:=(p_envelope->>'membershipRevision')::bigint;role_name:=p_envelope->>'expectedRole';
 if actor is null or op is null or cid is null or vid is null or inquiry is null or source_rev is null or source_rev<1 or visit_rev is null or visit_rev<1 or expected is null or expected<0 or expected>=9007199254740991 or member_rev is null or member_rev<1 or role_name not in ('owner','manager') or role_name is null then raise sqlstate 'PT400' using message='Invalid phone refresh'; end if;
 perform pg_advisory_xact_lock(617243902117::bigint);
 perform public.ech_schedule_check_series_access(role_name,member_rev);
 -- Exact receipt recovery uses current visit authority, without requiring the
 -- historical visit or inquiry revision to remain current after the write.
 perform public.ech_operations_schedule_visit(vid,role_name,member_rev);
 select * into v from public.ech_schedule_visits where id=vid for share nowait;
 if v.client_id is distinct from cid then raise sqlstate 'PT409' using message='Client or visit changed';end if;
 select * into prior from public.ech_phone_source_refreshes where operation_id=op;
 if found then
  if prior.actor_id<>actor or prior.envelope<>p_envelope then raise sqlstate 'PT409' using message='Operation identity conflict';end if;
  perform public.ech_schedule_check_series_access(role_name,member_rev);
  perform public.ech_operations_schedule_visit(vid,role_name,member_rev);
  return jsonb_build_object('schema',1,'operationId',op,'clientId',cid,'generation',prior.generation,'sourceRevision',prior.source_revision);
 end if;
 if v.status in ('Cancelled','Completed') then raise sqlstate 'PT409' using message='Client or visit changed';end if;
 perform public.ech_operations_visit_detail(vid,visit_rev,role_name,member_rev);
 select * into binding from public.ech_schedule_client_readiness where client_id=cid and service=v.service for share nowait;
 if v.client_id is distinct from cid or v.status in ('Cancelled','Completed') or binding.inquiry_id is distinct from inquiry then raise sqlstate 'PT409' using message='Client or visit changed';end if;
 source:=public.ech_operations_client_source(inquiry);
 if source->>'revision' is distinct from source_rev::text or coalesce(source->>'status','') not in ('New','Contacted','Assessment booked','On hold') then raise sqlstate 'PT409' using message='Inquiry changed';end if;
 select coalesce(max(r.generation),0) into generation from public.ech_phone_source_refreshes r where r.client_id=cid;
 if generation<>expected then raise sqlstate 'PT409' using message='Phone source changed';end if;
 insert into public.ech_phone_source_refreshes(operation_id,actor_id,client_id,inquiry_id,source_revision,generation,envelope) values(op,actor,cid,inquiry,source_rev,generation+1,p_envelope);
 perform public.ech_schedule_check_series_access(role_name,member_rev);
 perform public.ech_operations_visit_detail(vid,visit_rev,role_name,member_rev);
 return jsonb_build_object('schema',1,'operationId',op,'clientId',cid,'generation',generation+1,'sourceRevision',source_rev);
exception when invalid_text_representation or numeric_value_out_of_range then raise sqlstate 'PT400' using message='Invalid phone refresh'; end;$$;
create function public.ech_phone_source_refresh_context(p_visit uuid,p_visit_revision bigint,p_role text,p_membership_revision bigint)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v public.ech_schedule_visits; binding public.ech_schedule_client_readiness; source jsonb; generation bigint;
begin
 if p_role is null or p_role not in ('owner','manager') then raise sqlstate 'PT403' using message='Current manager access is required';end if;
 perform pg_advisory_xact_lock(617243902117::bigint);
 perform public.ech_schedule_check_series_access(p_role,p_membership_revision);
 perform public.ech_operations_visit_detail(p_visit,p_visit_revision,p_role,p_membership_revision);
 select * into v from public.ech_schedule_visits where id=p_visit for share nowait;
 select * into binding from public.ech_schedule_client_readiness where client_id=v.client_id and service=v.service for share nowait;
 if v.status in ('Cancelled','Completed') or binding.inquiry_id is null then raise sqlstate 'PT409' using message='Current linked source is unavailable';end if;
 source:=public.ech_operations_client_source(binding.inquiry_id);
 if coalesce(source->>'status','') not in ('New','Contacted','Assessment booked','On hold') then raise sqlstate 'PT409' using message='Current linked source is unavailable';end if;
 select coalesce(max(r.generation),0) into generation from public.ech_phone_source_refreshes r where r.client_id=v.client_id;
 perform public.ech_schedule_check_series_access(p_role,p_membership_revision);
 perform public.ech_operations_visit_detail(p_visit,p_visit_revision,p_role,p_membership_revision);
 return jsonb_build_object('schema',1,'visitId',p_visit,'visitRevision',p_visit_revision,'clientId',v.client_id,'inquiryId',binding.inquiry_id,'inquiryRevision',(source->>'revision')::bigint,'generation',generation,'membershipRevision',p_membership_revision);
end;$$;
revoke all on function public.ech_phone_source_refresh(jsonb),public.ech_phone_source_refresh_context(uuid,bigint,text,bigint) from public;
do $$ declare recipient record; begin for recipient in select p.oid::regprocedure sig,r.rolname from pg_catalog.pg_proc p cross join lateral pg_catalog.aclexplode(p.proacl) a join pg_catalog.pg_roles r on r.oid=a.grantee where p.oid in ('public.ech_phone_source_refresh(jsonb)'::regprocedure,'public.ech_phone_source_refresh_context(uuid,bigint,text,bigint)'::regprocedure) and a.grantee<>p.proowner loop execute format('revoke all on function %s from %I',recipient.sig,recipient.rolname);end loop;end;$$;
commit;
