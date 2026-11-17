-- Local review draft. No application execution or table privileges are granted.
-- Home-support logistics only. Existing metadata is never treated as authored content.
begin;
-- Use Unicode code-point lengths and the exact ECMAScript whitespace set at edges.
-- Source labels and attribution remain raw; only the derived scheduling name is trimmed.
create function public.ech_client_trim(p_text text) returns text language sql immutable set search_path='' as $$
 select btrim(p_text, U&'\0009\000A\000B\000C\000D\0020\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000\FEFF')
$$;
create function public.ech_client_name(p_source jsonb) returns text language sql immutable set search_path='' as $$
 select case when length(n) between 1 and 160 and n !~ '[\x01-\x1f\x7f]' then n else null end
 from (select coalesce(nullif(public.ech_client_trim(p_source->>'careRecipient'),''),public.ech_client_trim(p_source->>'name')) n) names
$$;
create table public.ech_operations_client_requests (
 client_id uuid primary key references public.ech_schedule_clients(id),
 inquiry_id uuid not null unique,
 inquiry_kind text generated always as ('inquiry') stored,
 inquiry_revision bigint not null check(inquiry_revision between 1 and 9007199254740991),
 revision bigint not null default 1 check(revision between 1 and 9007199254740991),
 area text not null check(length(area) between 2 and 100 and area=public.ech_client_trim(area) and area !~ '[\x01-\x1f\x7f]'),
 state text not null check(state in ('Awaiting confirmation','Confirmed')),
 confirmed_by uuid references public.ech_memberships(user_id), confirmed_at timestamptz,
 check((state='Confirmed')=(confirmed_by is not null and confirmed_at is not null)),
 foreign key(inquiry_kind,inquiry_id) references public.ech_records(kind,id)
);
create table public.ech_operations_client_events (
 operation_id uuid primary key, actor_id uuid not null references public.ech_memberships(user_id),
 actor_label text not null, client_id uuid not null references public.ech_operations_client_requests(client_id),
 revision bigint not null, envelope jsonb not null, source_snapshot jsonb not null,
 occurred_at timestamptz not null default clock_timestamp(), response jsonb not null,
 unique(client_id,revision)
);
create table public.ech_operations_instruction_content (
 client_id uuid not null, version bigint not null,
 body text not null check(length(body) between 3 and 2000 and body=public.ech_client_trim(body) and translate(body,chr(10)||chr(13)||chr(9),'') !~ '[\x01-\x1f\x7f]'),
 author_label text not null, source_revision bigint not null,
 primary key(client_id,version),
 foreign key(client_id,version) references public.ech_schedule_service_instructions(client_id,version)
);
create table public.ech_operations_client_drafts (
 operation_id uuid primary key, actor_id uuid not null references public.ech_memberships(user_id),
 envelope jsonb not null, state text not null check(state in ('pending','committed','cancelled','resolved')),
 response jsonb, check((state in ('committed','resolved'))=(response is not null))
);
create unique index ech_client_one_outstanding on public.ech_operations_client_drafts(actor_id) where state in ('pending','committed');
create function public.ech_operations_client_draft_guard() returns trigger language plpgsql set search_path='' as $$begin
 if tg_op<>'UPDATE' or (to_jsonb(new)-array['state','response']) is distinct from (to_jsonb(old)-array['state','response'])
 or not((old.state='pending' and new.state in ('committed','cancelled')) or (old.state='committed' and new.state='resolved' and new.response=old.response)) then raise sqlstate 'PT409' using message='Keep the original client request';end if;return new;end;$$;
create trigger ech_client_draft_guard before update or delete on public.ech_operations_client_drafts for each row execute function public.ech_operations_client_draft_guard();
create trigger ech_client_draft_keep before truncate on public.ech_operations_client_drafts for each statement execute function public.ech_schedule_keep_history();

create function public.ech_operations_client_source(p_id uuid)
returns jsonb language plpgsql volatile set search_path='' as $$
declare q public.ech_records; s jsonb;
begin
 select * into q from public.ech_records where kind='inquiry' and id=p_id for share nowait;
 -- Use the existing inquiry ownership/role policy, evaluated against its current assignment.
 if not found or public.ech_can_read(q.owner_id) is not true then raise sqlstate 'PT403' using message='Current inquiry access is unavailable';end if;
 s:=jsonb_build_object('id',q.id,'revision',q.revision,'ownerId',q.owner_id,
   'name',coalesce(q.data->>'name',''),'careRecipient',coalesce(q.data->>'careRecipient',''),'status',q.data->>'status');
 return s||jsonb_build_object('derivedName',public.ech_client_name(s));
end;$$;

-- Collection-scale limit: this unpaginated workspace admits at most 100 sources,
-- 100 clients and 100 immutable versions per client, within 500000 UTF8 response bytes.
-- Separate CRM growth can still exceed this read limit; no rows are silently omitted.
create function public.ech_operations_clients(p_role text,p_revision bigint)
returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare q record; r public.ech_operations_client_requests; s jsonb; rows jsonb:='[]'; sources jsonb:='[]'; current_source boolean; versions jsonb; snapshot jsonb;
begin
 if current_setting('transaction_isolation')<>'read committed' or p_role not in ('owner','manager') or p_revision is null or p_revision<1 then raise sqlstate 'PT403' using message='Current manager access is unavailable';end if;
 perform pg_advisory_xact_lock(617243902117::bigint);
 perform public.ech_schedule_check_series_access(p_role,p_revision);
 for q in select id from public.ech_records where kind='inquiry' and public.ech_can_read(owner_id) and data->>'status' in ('New','Contacted','Assessment booked','On hold') order by id loop
  s:=public.ech_operations_client_source(q.id);
  if not exists(select 1 from public.ech_operations_client_requests where inquiry_id=q.id) and not exists(select 1 from public.ech_schedule_client_readiness where inquiry_id=q.id) and not exists(select 1 from public.ech_schedule_visit_sources where inquiry_id=q.id) then sources:=sources||jsonb_build_array(s);end if;
  if jsonb_array_length(sources)>100 then raise sqlstate 'PT413' using message='Too many inquiries for this workspace';end if;
 end loop;
 for r in select * from public.ech_operations_client_requests order by client_id loop
  s:=public.ech_operations_client_source(r.inquiry_id);
  current_source:=s->>'revision'=r.inquiry_revision::text and s->>'status' in ('New','Contacted','Assessment booked','On hold');
  versions:='[]';
  if current_source then
   select coalesce(jsonb_agg(jsonb_build_object('version',i.version,'text',c.body,'by',i.saved_by,'author',c.author_label,'at',to_char(i.saved_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),'sourceRevision',c.source_revision) order by i.version),'[]') into versions
   from public.ech_operations_instruction_content c join public.ech_schedule_service_instructions i using(client_id,version) where c.client_id=r.client_id;
  end if;
  if jsonb_array_length(versions)>100 then raise sqlstate 'PT413' using message='Too many instruction versions for this workspace';end if;
  rows:=rows||jsonb_build_array(jsonb_build_object('id',r.client_id,'revision',r.revision,'inquiryId',r.inquiry_id,'inquiryRevision',r.inquiry_revision,'current',current_source,'source',s,'state',r.state,
    'name',case when current_source then (select name from public.ech_schedule_clients where id=r.client_id) else null end,'area',case when current_source then r.area else null end,'versions',versions));
  if jsonb_array_length(rows)>100 then raise sqlstate 'PT413' using message='Too many client requests for this workspace';end if;
 end loop;
 perform public.ech_schedule_check_series_access(p_role,p_revision);
 snapshot:=jsonb_build_object('schema',1,'membershipRevision',p_revision,'sources',sources,'clients',rows);
 -- This is the exact UTF8 JSONB response representation served by the RPC.
 if octet_length(snapshot::text)>500000 then raise sqlstate 'PT413' using message='Client workspace exceeds the 500000-byte read limit';end if;
 return snapshot;
exception when lock_not_available then raise sqlstate 'PT409' using message='Client source access is changing';end;$$;

create function public.ech_operations_client_validate(p_envelope jsonb) returns void language plpgsql set search_path='' as $$
declare c jsonb;role_name text;membership_revision bigint;begin
 if jsonb_typeof(p_envelope) is distinct from 'object' or not(p_envelope ?& array['schema','operationId','expectedRole','membershipRevision','command']) or p_envelope-array['schema','operationId','expectedRole','membershipRevision','command']<>'{}'::jsonb or p_envelope->'schema' is distinct from '1'::jsonb
 or jsonb_typeof(p_envelope->'membershipRevision') is distinct from 'number' or coalesce(p_envelope->>'membershipRevision','') !~ '^[1-9][0-9]{0,15}$'
 or jsonb_typeof(p_envelope->'operationId') is distinct from 'string' or coalesce(p_envelope->>'operationId','') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then raise sqlstate 'PT400' using message='Choose an exact client command';end if;
 role_name:=p_envelope->>'expectedRole';membership_revision:=(p_envelope->>'membershipRevision')::bigint;
 if current_setting('transaction_isolation')<>'read committed' or role_name not in ('owner','manager') or role_name is null or membership_revision>9007199254740991 then raise sqlstate 'PT403' using message='Current manager access is unavailable';end if;
 c:=p_envelope->'command';
 if jsonb_typeof(c) is distinct from 'object' or not(c ?& array['type','clientId','expectedRevision','inquiryId','inquiryRevision']) or coalesce(c->>'type','') not in ('handoff','refresh-handoff','confirm-service','save-plan')
 or c-array['type','clientId','expectedRevision','inquiryId','inquiryRevision',case when c->>'type'='handoff' then 'area' when c->>'type'='save-plan' then 'text' else 'type' end]<>'{}'::jsonb
 or coalesce(c->>'clientId','') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' or coalesce(c->>'inquiryId','') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
 or jsonb_typeof(c->'expectedRevision') is distinct from 'number' or coalesce(c->>'expectedRevision','') !~ '^(0|[1-9][0-9]{0,15})$' or jsonb_typeof(c->'inquiryRevision') is distinct from 'number' or coalesce(c->>'inquiryRevision','') !~ '^[1-9][0-9]{0,15}$' then raise sqlstate 'PT400' using message='Choose an exact client command';end if;

 if (c->>'expectedRevision')::bigint>9007199254740990 or (c->>'inquiryRevision')::bigint>9007199254740991 or (c->>'type'<>'handoff' and (c->>'expectedRevision')::bigint<1) then raise sqlstate 'PT400' using message='Invalid client revision';end if;
 if c->>'type'='handoff' and (c->'expectedRevision' is distinct from '0'::jsonb or jsonb_typeof(c->'area') is distinct from 'string' or length(c->>'area') not between 2 and 100 or c->>'area'<>public.ech_client_trim(c->>'area') or c->>'area' ~ '[\x01-\x1f\x7f]') then raise sqlstate 'PT400' using message='Choose a home-support service area';end if;
 if c->>'type'='save-plan' and (jsonb_typeof(c->'text') is distinct from 'string' or length(c->>'text') not between 3 and 2000 or c->>'text'<>public.ech_client_trim(c->>'text') or translate(c->>'text',chr(10)||chr(13)||chr(9),'') ~ '[\x01-\x1f\x7f]') then raise sqlstate 'PT400' using message='Enter nonclinical home-support instructions';end if;
end;$$;

create function public.ech_operations_client_commit(p_envelope jsonb)
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
  if c->>'type'='refresh-handoff' then
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
   on conflict(client_id) do update set instructions_version=excluded.instructions_version;
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

create function public.ech_operations_client_draft(p_action text,p_role text,p_revision bigint,p_envelope jsonb default null)
returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare d public.ech_operations_client_drafts; op uuid;
begin
 if current_setting('transaction_isolation')<>'read committed' or p_action not in ('recover','reserve','inspect','cancel','resolve') or p_action is null or p_role not in ('owner','manager') or p_role is null then raise sqlstate 'PT400' using message='Choose a current client recovery action';end if;
 perform pg_advisory_xact_lock(617243902117::bigint);
 perform public.ech_schedule_check_series_access(p_role,p_revision);
 if p_action='recover' then
  if p_envelope is not null then raise sqlstate 'PT400' using message='Recovery takes no envelope';end if;
  select * into d from public.ech_operations_client_drafts where actor_id=auth.uid() and state in ('pending','committed');
 else
  if jsonb_typeof(p_envelope) is distinct from 'object' or length(p_envelope::text)>8192 or coalesce(p_envelope->>'operationId','') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then raise sqlstate 'PT400' using message='Choose an exact client reservation';end if;
  op:=(p_envelope->>'operationId')::uuid;
  select * into d from public.ech_operations_client_drafts where operation_id=op for update;
  if found then
   if d.actor_id<>auth.uid() or d.envelope<>p_envelope then raise sqlstate 'PT409' using message='Client reservation identity conflict';end if;
  elsif p_action='reserve' then
   perform public.ech_operations_client_validate(p_envelope);
   if p_envelope->>'expectedRole' is distinct from p_role or p_envelope->>'membershipRevision' is distinct from p_revision::text then raise sqlstate 'PT409' using message='Client access changed';end if;
   if exists(select 1 from public.ech_schedule_events where operation_id=op) or exists(select 1 from public.ech_visit_report_events where operation_id=op) or exists(select 1 from public.ech_schedule_series_receipts where operation_id=op) or exists(select 1 from public.ech_schedule_creation_identities where identity=op) or exists(select 1 from public.ech_command_receipts where operation_id=op) then raise sqlstate 'PT409' using message='Command identity conflict';end if;
   insert into public.ech_operations_client_drafts values(op,auth.uid(),p_envelope,'pending',null) returning * into d;
  else raise sqlstate 'PT409' using message='Client reservation unavailable';end if;
  if p_action='cancel' and d.state='pending' then update public.ech_operations_client_drafts set state='cancelled' where operation_id=op returning * into d;
  elsif p_action='resolve' and d.state='committed' then update public.ech_operations_client_drafts set state='resolved' where operation_id=op returning * into d;end if;
 end if;
 perform public.ech_schedule_check_series_access(p_role,p_revision);
 return jsonb_build_object('schema',1,'draft',case when d.operation_id is null then null else jsonb_build_object('envelope',d.envelope,'state',d.state,'result',d.response) end);
exception when unique_violation then raise sqlstate 'PT409' using message='Recover the outstanding client request';
when lock_not_available then raise sqlstate 'PT409' using message='Client access is changing';end;$$;
create function public.ech_operations_client_identity_guard() returns trigger language plpgsql set search_path='' as $$begin
 if exists(select 1 from public.ech_operations_client_drafts where operation_id=new.operation_id) then raise sqlstate 'PT409' using message='Reserved client operation identity';end if;return new;end;$$;
create trigger ech_client_schedule_identity before insert on public.ech_schedule_events for each row execute function public.ech_operations_client_identity_guard();
create trigger ech_client_report_identity before insert on public.ech_visit_report_events for each row execute function public.ech_operations_client_identity_guard();
create trigger ech_client_series_identity before insert on public.ech_schedule_series_receipts for each row execute function public.ech_operations_client_identity_guard();

create function public.ech_operations_client_creation_identity_guard() returns trigger language plpgsql set search_path='' as $$begin
 if exists(select 1 from public.ech_operations_client_drafts where operation_id=new.identity) then raise sqlstate 'PT409' using message='Reserved client operation identity';end if;return new;end;$$;
create trigger ech_client_creation_identity before insert on public.ech_schedule_creation_identities for each row execute function public.ech_operations_client_creation_identity_guard();
create trigger ech_client_request_keep before delete or truncate on public.ech_operations_client_requests for each statement execute function public.ech_schedule_keep_history();

-- Share the canonical dispatch/access lock, retain originals, and strip inherited ACLs.
do $$declare n text; r record;begin
 foreach n in array array['ech_operations_client_requests','ech_operations_client_events','ech_operations_instruction_content','ech_operations_client_drafts'] loop
  execute format('alter table public.%I enable row level security',n);
  execute format('create trigger ech_client_serialize before insert or update or delete or truncate on public.%I for each statement execute function public.ech_schedule_serialize_dispatch()',n);
  execute format('revoke all on table public.%I from public,anon,authenticated',n);
  for r in select roles.rolname from pg_catalog.pg_class t cross join lateral pg_catalog.aclexplode(coalesce(t.relacl,pg_catalog.acldefault('r',t.relowner))) a join pg_catalog.pg_roles roles on roles.oid=a.grantee where t.oid=format('public.%I',n)::regclass and a.grantee<>t.relowner loop execute format('revoke all on table public.%I from %I',n,r.rolname);end loop;
 end loop;
 foreach n in array array['ech_operations_client_events','ech_operations_instruction_content'] loop
  execute format('create trigger ech_client_keep_history before update or delete or truncate on public.%I for each statement execute function public.ech_schedule_keep_history()',n);
 end loop;
 for r in select p.oid::regprocedure sig,roles.rolname from pg_catalog.pg_proc p cross join lateral pg_catalog.aclexplode(coalesce(p.proacl,pg_catalog.acldefault('f',p.proowner))) a join pg_catalog.pg_roles roles on roles.oid=a.grantee where p.pronamespace='public'::regnamespace and p.proname in ('ech_client_trim','ech_client_name','ech_operations_client_source','ech_operations_clients','ech_operations_client_commit','ech_operations_client_draft','ech_operations_client_draft_guard','ech_operations_client_identity_guard','ech_operations_client_validate','ech_operations_client_creation_identity_guard') and a.grantee<>p.proowner loop execute format('revoke all on function %s from %I',r.sig,r.rolname);end loop;
end;$$;
revoke all on function public.ech_client_trim(text),public.ech_client_name(jsonb),public.ech_operations_client_source(uuid),public.ech_operations_clients(text,bigint),public.ech_operations_client_commit(jsonb),public.ech_operations_client_draft(text,text,bigint,jsonb),public.ech_operations_client_draft_guard(),public.ech_operations_client_identity_guard(),public.ech_operations_client_validate(jsonb),public.ech_operations_client_creation_identity_guard() from public,anon,authenticated;
commit;
