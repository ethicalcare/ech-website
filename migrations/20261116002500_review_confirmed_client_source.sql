-- Draft only. Requires independent review and explicit activation; no grants.
begin;
create or replace function public.ech_operations_client_validate(p_envelope jsonb) returns void language plpgsql set search_path='' as $$
declare c jsonb;role_name text;membership_revision bigint;begin
 if jsonb_typeof(p_envelope) is distinct from 'object' or not(p_envelope ?& array['schema','operationId','expectedRole','membershipRevision','command']) or p_envelope-array['schema','operationId','expectedRole','membershipRevision','command']<>'{}'::jsonb or p_envelope->'schema' is distinct from '1'::jsonb
 or jsonb_typeof(p_envelope->'membershipRevision') is distinct from 'number' or coalesce(p_envelope->>'membershipRevision','') !~ '^[1-9][0-9]{0,15}$'
 or jsonb_typeof(p_envelope->'operationId') is distinct from 'string' or coalesce(p_envelope->>'operationId','') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then raise sqlstate 'PT400' using message='Choose an exact client command';end if;
 role_name:=p_envelope->>'expectedRole';membership_revision:=(p_envelope->>'membershipRevision')::bigint;
 if current_setting('transaction_isolation')<>'read committed' or role_name not in ('owner','manager') or role_name is null or membership_revision>9007199254740991 then raise sqlstate 'PT403' using message='Current manager access is unavailable';end if;
 c:=p_envelope->'command';
 if jsonb_typeof(c) is distinct from 'object' or not(c ?& array['type','clientId','expectedRevision','inquiryId','inquiryRevision']) or coalesce(c->>'type','') not in ('handoff','refresh-handoff','review-confirmed-source','confirm-service','save-plan')
 or c-array['type','clientId','expectedRevision','inquiryId','inquiryRevision',case when c->>'type'='handoff' then 'area' when c->>'type'='save-plan' then 'text' else 'type' end]<>'{}'::jsonb
 or coalesce(c->>'clientId','') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' or coalesce(c->>'inquiryId','') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
 or jsonb_typeof(c->'expectedRevision') is distinct from 'number' or coalesce(c->>'expectedRevision','') !~ '^(0|[1-9][0-9]{0,15})$' or jsonb_typeof(c->'inquiryRevision') is distinct from 'number' or coalesce(c->>'inquiryRevision','') !~ '^[1-9][0-9]{0,15}$' then raise sqlstate 'PT400' using message='Choose an exact client command';end if;

 if (c->>'expectedRevision')::bigint>9007199254740990 or (c->>'inquiryRevision')::bigint>9007199254740991 or (c->>'type'<>'handoff' and (c->>'expectedRevision')::bigint<1) then raise sqlstate 'PT400' using message='Invalid client revision';end if;
 if c->>'type'='handoff' and (c->'expectedRevision' is distinct from '0'::jsonb or jsonb_typeof(c->'area') is distinct from 'string' or length(c->>'area') not between 2 and 100 or c->>'area'<>public.ech_client_trim(c->>'area') or c->>'area' ~ '[\x01-\x1f\x7f]') then raise sqlstate 'PT400' using message='Choose a home-support service area';end if;
 if c->>'type'='save-plan' and (jsonb_typeof(c->'text') is distinct from 'string' or length(c->>'text') not between 3 and 2000 or c->>'text'<>public.ech_client_trim(c->>'text') or translate(c->>'text',chr(10)||chr(13)||chr(9),'') ~ '[\x01-\x1f\x7f]') then raise sqlstate 'PT400' using message='Enter nonclinical home-support instructions';end if;
end;$$;

create or replace function public.ech_operations_client_commit(p_envelope jsonb)
returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare c jsonb; s jsonb; r public.ech_operations_client_requests; e public.ech_operations_client_events;
 d public.ech_operations_client_drafts; op uuid; cid uuid; source_id uuid; role_name text; membership_revision bigint; source_revision bigint; expected bigint; latest bigint; result jsonb; label text; saved_at timestamptz;
begin
 perform public.ech_operations_client_validate(p_envelope);
 role_name:=p_envelope->>'expectedRole';membership_revision:=(p_envelope->>'membershipRevision')::bigint;c:=p_envelope->'command';
 op:=(p_envelope->>'operationId')::uuid;cid:=(c->>'clientId')::uuid;source_id:=(c->>'inquiryId')::uuid;source_revision:=(c->>'inquiryRevision')::bigint;expected:=(c->>'expectedRevision')::bigint;
 if expected>9007199254740990 or source_revision>9007199254740991 then raise sqlstate 'PT400' using message='Invalid revision';end if;
 perform pg_advisory_xact_lock(617243902117::bigint);
 perform public.ech_schedule_check_series_access(role_name,membership_revision);
 select * into d from public.ech_operations_client_drafts where operation_id=op for update;
 if not found or d.actor_id<>auth.uid() or d.envelope<>p_envelope or d.state='cancelled' then raise sqlstate 'PT409' using message='Recover an exact active client reservation';end if;
 s:=public.ech_operations_client_source(source_id);
 if s->>'revision' is distinct from source_revision::text or coalesce(s->>'status','') not in ('New','Contacted','Assessment booked','On hold') then raise sqlstate 'PT409' using message='Review the current open inquiry';end if;
 select * into e from public.ech_operations_client_events where operation_id=op;
 if found then
  if e.actor_id<>auth.uid() or e.envelope<>p_envelope then raise sqlstate 'PT409' using message='Client command identity conflict';end if;
  perform public.ech_schedule_check_series_access(role_name,membership_revision);return e.response;
 end if;
 if exists(select 1 from public.ech_schedule_events where operation_id=op) or exists(select 1 from public.ech_visit_report_events where operation_id=op) or exists(select 1 from public.ech_schedule_series_receipts where operation_id=op) or exists(select 1 from public.ech_schedule_creation_identities where identity=op) or exists(select 1 from public.ech_command_receipts where operation_id=op) then raise sqlstate 'PT409' using message='Command identity conflict';end if;
 select display_name into label from public.ech_memberships where user_id=auth.uid();
 if c->>'type'='handoff' then
  if expected<>0 or jsonb_typeof(c->'area') is distinct from 'string' or length(c->>'area') not between 2 and 100 or c->>'area'<>public.ech_client_trim(c->>'area') or c->>'area' ~ '[\x01-\x1f\x7f]' then raise sqlstate 'PT400' using message='Choose the home-support service area';end if;
  if exists(select 1 from public.ech_operations_client_requests where inquiry_id=source_id) or exists(select 1 from public.ech_schedule_client_readiness where inquiry_id=source_id) or exists(select 1 from public.ech_schedule_visit_sources where inquiry_id=source_id) then raise sqlstate 'PT409' using message='Inquiry already linked';end if;
  if s->>'derivedName' is null then raise sqlstate 'PT400' using message='Review the inquiry recipient name';end if;
  if (select count(*) from public.ech_operations_client_requests)>=100 then raise sqlstate 'PT413' using message='Client workspace has reached the 100-client limit; retain the pending draft';end if;
  insert into public.ech_schedule_clients values(cid,s->>'derivedName');
  insert into public.ech_operations_client_requests(client_id,inquiry_id,inquiry_revision,area,state) values(cid,source_id,source_revision,c->>'area','Awaiting confirmation') returning * into r;
 else
  select * into r from public.ech_operations_client_requests where client_id=cid for update nowait;
  if not found or r.inquiry_id<>source_id or r.revision<>expected then raise sqlstate 'PT409' using message='Client request changed';end if;
  if c->>'type'='review-confirmed-source' then
   if r.state<>'Confirmed' or r.inquiry_revision=source_revision then raise sqlstate 'PT409' using message='Review a changed confirmed source';end if;
   if s->>'derivedName' is null then raise sqlstate 'PT400' using message='Review the inquiry recipient name';end if;
   update public.ech_operations_client_requests set inquiry_revision=source_revision,state='Awaiting confirmation',confirmed_by=null,confirmed_at=null,revision=revision+1 where client_id=cid returning * into r;
   update public.ech_schedule_clients set name=s->>'derivedName' where id=cid;
  elsif c->>'type'='refresh-handoff' then
   if r.state<>'Awaiting confirmation' then raise sqlstate 'PT409' using message='Only pending source links can be refreshed';end if;
   if s->>'derivedName' is null then raise sqlstate 'PT400' using message='Review the inquiry recipient name (1 to 160 code points)';end if;
   update public.ech_operations_client_requests set inquiry_revision=source_revision,revision=revision+1 where client_id=cid returning * into r;
   update public.ech_schedule_clients set name=s->>'derivedName' where id=cid;
  else
   if r.inquiry_revision<>source_revision then raise sqlstate 'PT409' using message='Review the current source link';end if;
   if c->>'type'='confirm-service' then
    if r.state<>'Awaiting confirmation' then raise sqlstate 'PT409' using message='Service already confirmed';end if;
    update public.ech_operations_client_requests set state='Confirmed',confirmed_by=auth.uid(),confirmed_at=clock_timestamp(),revision=revision+1 where client_id=cid returning * into r;
   else
    if jsonb_typeof(c->'text') is distinct from 'string' or length(c->>'text') not between 3 and 2000 or c->>'text'<>public.ech_client_trim(c->>'text') or translate(c->>'text',chr(10)||chr(13)||chr(9),'') ~ '[\x01-\x1f\x7f]' then raise sqlstate 'PT400' using message='Enter nonclinical home-support instructions';end if;
    select coalesce(max(version),0)+1 into latest from public.ech_schedule_service_instructions where client_id=cid;
    if (select count(*) from public.ech_operations_instruction_content where client_id=cid)>=100 then raise sqlstate 'PT413' using message='Client has reached the 100-version history limit; retain the pending draft';end if;
    saved_at:=clock_timestamp();
    insert into public.ech_schedule_service_instructions values(cid,latest,saved_at,auth.uid(),'Nonclinical home-support instructions');
    insert into public.ech_operations_instruction_content values(cid,latest,c->>'text',label,source_revision);
    update public.ech_operations_client_requests set revision=revision+1 where client_id=cid returning * into r;
   end if;
  end if;
 end if;
 select max(c.version) into latest from public.ech_operations_instruction_content c where c.client_id=cid and c.source_revision=r.inquiry_revision;
 if r.state='Confirmed' and latest is not null then
  insert into public.ech_schedule_client_readiness(client_id,service,area,confirmed_by,confirmed_at,instructions_version,inquiry_id,inquiry_revision)
   values(cid,'Home support',r.area,r.confirmed_by,r.confirmed_at,latest,r.inquiry_id,r.inquiry_revision)
   on conflict(client_id) do update set instructions_version=excluded.instructions_version, inquiry_id=excluded.inquiry_id, inquiry_revision=excluded.inquiry_revision, confirmed_by=excluded.confirmed_by, confirmed_at=excluded.confirmed_at, area=excluded.area;
 end if;
 -- Admission uses the same complete projection as reads, under the dispatch lock.
 -- Any failure rolls back this mutation while the separately reserved draft stays pending.
 perform public.ech_operations_clients(role_name,membership_revision);
 result:=jsonb_build_object('schema',1,'operationId',op,'clientId',cid,'revision',r.revision,'instructionVersion',case when c->>'type'='save-plan' then latest else null end);
 insert into public.ech_operations_client_events values(op,auth.uid(),label,cid,r.revision,p_envelope,s,clock_timestamp(),result);
 update public.ech_operations_client_drafts set state='committed',response=result where operation_id=op;
 perform public.ech_schedule_check_series_access(role_name,membership_revision);
 if public.ech_operations_client_source(source_id) is distinct from s then raise sqlstate 'PT409' using message='Inquiry changed';end if;
 return result;
exception when unique_violation then raise sqlstate 'PT409' using message='Client source or identity conflict';
 when lock_not_available then raise sqlstate 'PT409' using message='Client source access is changing';
 when invalid_text_representation or numeric_value_out_of_range then raise sqlstate 'PT400' using message='Invalid client command';end;$$;

commit;
