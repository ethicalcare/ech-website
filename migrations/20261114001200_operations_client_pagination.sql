-- Local review draft. Additive reads only; existing authoring safeguards remain intact.
-- No application execution or storage privileges are granted by this migration.
begin;

create table public.ech_client_collection_generation (
 singleton boolean primary key default true check(singleton),
 generation uuid not null
);
insert into public.ech_client_collection_generation values(true,gen_random_uuid());
alter table public.ech_client_collection_generation enable row level security;

-- AFTER STATEMENT also covers changes outside the client command RPC. The epoch
-- changes in the same transaction as the data and cannot survive its rollback.
-- Readers hold this advisory lock, prelock their known relations NOWAIT and use
-- NOWAIT for source rows. Administrative relation-lock inversions fail explicitly.
-- Conservatively invalidate on partner writes too rather than miss a CRM mutation.
create function public.ech_client_generation_track_v2() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 perform pg_advisory_xact_lock(617243902117::bigint);
 lock table public.ech_client_collection_generation in row exclusive mode nowait;
 update public.ech_client_collection_generation set generation=gen_random_uuid() where singleton;
 return null;
exception when lock_not_available then raise sqlstate 'PT409' using message='Client generation maintenance is in progress';
end;$$;
do $$declare n text;begin
 foreach n in array array['ech_records','ech_operations_client_requests','ech_schedule_clients',
  'ech_operations_instruction_content','ech_schedule_service_instructions',
  'ech_schedule_client_readiness','ech_schedule_visit_sources','ech_schedule_service_rules'] loop
  execute format('create trigger ech_client_generation_v2 after insert or update or delete or truncate on public.%I for each statement execute function public.ech_client_generation_track_v2()',n);
 end loop;
end;$$;

create index ech_client_source_page_v2 on public.ech_records(id)
 where kind='inquiry' and data->>'status' in ('New','Contacted','Assessment booked','On hold');

-- These private helpers run only behind definer RPCs with current DB authorization.
create function public.ech_client_read_enter_v2(p_role text,p_revision bigint,p_generation uuid default null)
returns uuid language plpgsql volatile set search_path='' as $$
declare g uuid;begin
 if current_setting('transaction_isolation')<>'read committed' or p_role is null or p_role not in ('owner','manager')
  or p_revision is null or p_revision not between 1 and 9007199254740991 then
  raise sqlstate 'PT403' using message='Current manager access is unavailable';
 end if;
 perform pg_advisory_xact_lock(617243902117::bigint);
 -- ROW SHARE also covers the table lock needed by SELECT ... FOR SHARE.
 -- NOWAIT is essential: an administrator may hold EXCLUSIVE/ACCESS EXCLUSIVE
 -- and then queue on our advisory lock in an AFTER mutation trigger. Do not
 -- wait for that relation while retaining the advisory lock. No timeout GUC is
 -- changed, so a caller's existing transaction settings remain untouched.
 lock table public.ech_client_collection_generation,public.ech_records,
  public.ech_operations_client_requests,public.ech_schedule_clients,
  public.ech_operations_instruction_content,public.ech_schedule_service_instructions,
  public.ech_schedule_client_readiness,public.ech_schedule_visit_sources,
  public.ech_schedule_service_rules,public.ech_sessions,public.ech_memberships,
  public.ech_access_requests,public.ech_operations_grants,public.ech_schedule_workers,
  auth.users,auth.sessions in row share mode nowait;
 perform public.ech_schedule_check_series_access(p_role,p_revision);
 select generation into g from public.ech_client_collection_generation where singleton;
 if g is null then raise sqlstate 'PT409' using message='Client collection generation is unavailable';end if;
 if p_generation is not null and p_generation<>g then raise sqlstate 'PT409' using message='Client collection changed; restart this page sequence';end if;
 return g;
end;$$;

-- Explicit Unicode Cc ranges make schedule reads conservative across database
-- locales. Raw names/areas retain the established U+0020-only btrim semantics.
create function public.ech_client_schedule_text_v2(p_text text,p_area boolean)
returns boolean language sql immutable set search_path='' as $$
 select coalesce((p_text collate "C") !~ U&'[\0001-\001F\007F-\009F]' and case when p_area
  then length(p_text) between 2 and 100 and p_text=btrim(p_text)
  else length(p_text) between 1 and 160 and length(btrim(p_text))>0 end,false)
$$;

create function public.ech_client_stamp_supported_v2(p_at timestamptz)
returns boolean language sql immutable set search_path='' as $$
 select coalesce(isfinite(p_at) and (p_at at time zone 'UTC')>=timestamp '0001-01-01'
  and (p_at at time zone 'UTC')<timestamp '10000-01-01',false)
$$;

create function public.ech_client_read_finish_v2(p_role text,p_revision bigint,p_value jsonb)
returns jsonb language plpgsql volatile set search_path='' as $$
begin
 perform public.ech_schedule_check_series_access(p_role,p_revision);
 if octet_length(p_value::text)>500000 then raise sqlstate 'PT413' using message='A client read response exceeds its 500000-byte limit';end if;
 return p_value;
end;$$;

create function public.ech_client_source_read_v2(p_id uuid)
returns jsonb language plpgsql volatile set search_path='' as $$
declare s jsonb;begin
 s:=public.ech_operations_client_source(p_id);
 if length(s->>'name')>3000 or length(s->>'careRecipient')>3000 then
  raise sqlstate 'PT413' using message='An inquiry label exceeds the supported per-record contract';
 end if;
 if (s->>'revision')::bigint not between 1 and 9007199254740991
  or (s->>'status' is not null and s->>'status' not in ('New','Contacted','Assessment booked','On hold','Closed')) then
  raise sqlstate 'PT413' using message='Inquiry metadata exceeds the supported read contract';end if;
 return s;
end;$$;

create function public.ech_client_detail_read_v2(p_id uuid)
returns jsonb language plpgsql volatile set search_path='' as $$
declare r public.ech_operations_client_requests; s jsonb; current_source boolean; name_value text; latest bigint;
begin
 select * into r from public.ech_operations_client_requests where client_id=p_id for share nowait;
 if not found then raise sqlstate 'PT403' using message='Current client access is unavailable';end if;
 s:=public.ech_client_source_read_v2(r.inquiry_id);
 current_source:=s->>'revision'=r.inquiry_revision::text and coalesce(s->>'status','') in ('New','Contacted','Assessment booked','On hold');
 if current_source then
  select name into name_value from public.ech_schedule_clients where id=r.client_id for share nowait;
  if not public.ech_client_schedule_text_v2(name_value,false) or length(r.area) not between 2 and 100
   or r.area<>public.ech_client_trim(r.area) or r.area ~ '[\x01-\x1f\x7f]' then
   raise sqlstate 'PT413' using message='Client metadata exceeds the supported read contract';end if;
  select max(version) into latest from public.ech_operations_instruction_content where client_id=r.client_id;
  if latest>9007199254740991 then raise sqlstate 'PT413' using message='An instruction version exceeds the supported revision range';end if;
 end if;
 return jsonb_build_object('id',r.client_id,'revision',r.revision,'inquiryId',r.inquiry_id,'inquiryRevision',r.inquiry_revision,
  'current',current_source,'source',s,'state',r.state,'name',name_value,'area',case when current_source then r.area else null end,'latestVersion',latest);
end;$$;

create function public.ech_client_version_read_v2(p_client uuid,p_version bigint)
returns jsonb language plpgsql volatile set search_path='' as $$
declare v jsonb; c public.ech_operations_instruction_content; i public.ech_schedule_service_instructions; source_revision bigint;
begin
 select * into c from public.ech_operations_instruction_content where client_id=p_client and version=p_version;
 if not found then raise sqlstate 'PT403' using message='Current instruction access is unavailable';end if;
 select * into i from public.ech_schedule_service_instructions where client_id=p_client and version=p_version;
 if not found then raise sqlstate 'PT403' using message='Current instruction access is unavailable';end if;
 select inquiry_revision into source_revision from public.ech_operations_client_requests where client_id=p_client;
 -- Keep immutable originals and legitimate older source revisions. Unsupported
 -- owner-maintained metadata is rejected, never normalized or silently dropped.
 if length(c.author_label) not between 1 and 160 or c.source_revision not between 1 and 9007199254740991
  or source_revision is null or c.source_revision>source_revision or i.version not between 1 and 9007199254740991
  or not public.ech_client_stamp_supported_v2(i.saved_at) or length(c.body) not between 3 and 2000
  or c.body<>public.ech_client_trim(c.body) or translate(c.body,chr(10)||chr(13)||chr(9),'') ~ '[\x01-\x1f\x7f]' then
  raise sqlstate 'PT413' using message='Instruction metadata exceeds the supported read contract';end if;
 v:=jsonb_build_object('version',i.version,'text',c.body,'by',i.saved_by,'author',c.author_label,
  'at',to_char(i.saved_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),'sourceRevision',c.source_revision);
 return v;
end;$$;

-- Preserve the existing dispatch source and its token, without publishing content.
create function public.ech_client_schedule_source_read_v2(p_client uuid,p_as_of timestamptz)
returns jsonb language plpgsql volatile set search_path='' as $$
declare r public.ech_schedule_client_readiness; i public.ech_schedule_service_instructions; v jsonb; name_value text;
begin
 select * into r from public.ech_schedule_client_readiness where client_id=p_client for share nowait;
 if not found then return null;end if;
 if not public.ech_client_stamp_supported_v2(r.confirmed_at) or r.instructions_version not between 1 and 9007199254740991
  or not public.ech_client_schedule_text_v2(r.area,true) or (r.inquiry_revision is not null and r.inquiry_revision not between 1 and 9007199254740991) then
  raise sqlstate 'PT413' using message='Scheduling metadata exceeds the supported read contract';end if;
 if r.confirmed_at>p_as_of then return null;end if;
 select * into i from public.ech_schedule_service_instructions where client_id=r.client_id and version=r.instructions_version for share nowait;
 if not found then return null;end if;
 if not public.ech_client_stamp_supported_v2(i.saved_at) then raise sqlstate 'PT413' using message='Scheduling metadata exceeds the supported read contract';end if;
 if i.saved_at>p_as_of then return null;end if;
 if r.inquiry_id is not null then
  -- Check current inquiry authorization even when its source revision is stale.
  perform public.ech_client_source_read_v2(r.inquiry_id);
 end if;
 select name into name_value from public.ech_schedule_clients where id=p_client for share nowait;
 if not public.ech_client_schedule_text_v2(name_value,false) then raise sqlstate 'PT413' using message='Scheduling metadata exceeds the supported read contract';end if;
 v:=public.ech_schedule_creation_source(p_client,r.service);
 return v;
end;$$;

create function public.ech_operations_client_context_v2(p_role text,p_revision bigint)
returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare g uuid;begin
 g:=public.ech_client_read_enter_v2(p_role,p_revision);
 return public.ech_client_read_finish_v2(p_role,p_revision,jsonb_build_object('schema',2,'kind','context','membershipRevision',p_revision,'generation',g));
exception when lock_not_available then raise sqlstate 'PT409' using message='Client access is changing';end;$$;

-- Fixed ten-row pages bound response work and memory. UUID/version keysets avoid
-- OFFSET shifts; generation rejects changed collections for a supplied seek.
-- Cursors are unsigned positions, not authenticated server-issued tokens. The
-- caller may choose another valid after/asOf; every read reauthorizes its scope.
-- asOf freezes time-based readiness eligibility throughout schedule pagination.
create function public.ech_operations_client_page_v2(p_role text,p_revision bigint,p_kind text,p_client uuid default null,p_cursor jsonb default null)
returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare g uuid; cursor_generation uuid; after_id uuid; after_version bigint; at_time timestamptz:=clock_timestamp();
 at_label text; rows jsonb:='[]'; client_value jsonb; item jsonb; last_key jsonb; next_value jsonb; q record; count_rows int:=0;
begin
 -- Authorization precedes cursor validation, including for stale or foreign cursors.
 g:=public.ech_client_read_enter_v2(p_role,p_revision);
 if p_kind is null or p_kind not in ('sources','clients','versions','schedule-sources')
  or (p_kind='versions')<>(p_client is not null) then raise sqlstate 'PT400' using message='Choose one bounded client collection';end if;
 if p_cursor is not null then
  if octet_length(p_cursor::text)>2048 or jsonb_typeof(p_cursor) is distinct from 'object' or not(p_cursor ?& array['schema','kind','actorId','role','membershipRevision','generation','clientId','after','asOf'])
   or p_cursor-array['schema','kind','actorId','role','membershipRevision','generation','clientId','after','asOf']<>'{}'::jsonb
   or p_cursor->'schema' is distinct from '1'::jsonb or p_cursor->>'kind' is distinct from p_kind
   or p_cursor->>'actorId' is distinct from auth.uid()::text or p_cursor->>'role' is distinct from p_role
   or p_cursor->'membershipRevision' is distinct from to_jsonb(p_revision)
   or p_cursor->'clientId' is distinct from coalesce(to_jsonb(p_client),'null'::jsonb)
   or jsonb_typeof(p_cursor->'generation') is distinct from 'string' or p_cursor->>'generation' !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
   or jsonb_typeof(p_cursor->'asOf') is distinct from 'string' or p_cursor->>'asOf' !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{6}Z$' then
   raise sqlstate 'PT400' using message='Choose an exact cursor for this account and collection';
  end if;
  cursor_generation:=(p_cursor->>'generation')::uuid;
  if cursor_generation<>g then raise sqlstate 'PT409' using message='Client collection changed; restart this page sequence';end if;
  at_time:=(p_cursor->>'asOf')::timestamptz;
  if not isfinite(at_time) or at_time>clock_timestamp() or to_char(at_time at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"')<>p_cursor->>'asOf' then
   raise sqlstate 'PT400' using message='Choose an exact page eligibility instant';end if;
  if p_kind='versions' then
   if jsonb_typeof(p_cursor->'after') is distinct from 'number' or p_cursor->>'after' !~ '^[1-9][0-9]{0,15}$' then raise sqlstate 'PT400' using message='Invalid instruction page position';end if;
   after_version:=(p_cursor->>'after')::bigint;
   if after_version>9007199254740991 then raise sqlstate 'PT400' using message='Invalid instruction page position';end if;
  else
   if jsonb_typeof(p_cursor->'after') is distinct from 'string' or p_cursor->>'after' !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then raise sqlstate 'PT400' using message='Invalid client page position';end if;
   after_id:=(p_cursor->>'after')::uuid;
  end if;
 end if;
 at_label:=to_char(at_time at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"');
 if p_kind='sources' then
  for q in select id from public.ech_records r where kind='inquiry' and public.ech_can_read(owner_id)
   and data->>'status' in ('New','Contacted','Assessment booked','On hold') and (after_id is null or id>after_id)
   and not exists(select 1 from public.ech_operations_client_requests c where c.inquiry_id=r.id)
   and not exists(select 1 from public.ech_schedule_client_readiness c where c.inquiry_id=r.id)
   and not exists(select 1 from public.ech_schedule_visit_sources c where c.inquiry_id=r.id)
   order by id limit 11 loop
   if count_rows=10 then next_value:='true'::jsonb;exit;end if;
   item:=public.ech_client_source_read_v2(q.id);rows:=rows||jsonb_build_array(item);last_key:=to_jsonb(q.id);count_rows:=count_rows+1;
  end loop;
 elsif p_kind='clients' then
  for q in select client_id from public.ech_operations_client_requests where after_id is null or client_id>after_id order by client_id limit 11 loop
   if count_rows=10 then next_value:='true'::jsonb;exit;end if;
   item:=public.ech_client_detail_read_v2(q.client_id);rows:=rows||jsonb_build_array(item);last_key:=to_jsonb(q.client_id);count_rows:=count_rows+1;
  end loop;
 elsif p_kind='versions' then
  client_value:=public.ech_client_detail_read_v2(p_client);
  if (client_value->>'current')::boolean then
   for q in select version from public.ech_operations_instruction_content where client_id=p_client and (after_version is null or version>after_version) order by version limit 11 loop
    if count_rows=10 then next_value:='true'::jsonb;exit;end if;
    if q.version>9007199254740991 then raise sqlstate 'PT413' using message='An instruction version exceeds the supported revision range';end if;
    item:=public.ech_client_version_read_v2(p_client,q.version);rows:=rows||jsonb_build_array(item);last_key:=to_jsonb(q.version);count_rows:=count_rows+1;
   end loop;
  end if;
 else
  -- Seek only eligible metadata, then lock/revalidate the bounded candidate set.
  -- No history or source bodies are aggregated to determine this page.
  for q in select r.client_id from public.ech_schedule_client_readiness r
   join public.ech_schedule_service_instructions i on i.client_id=r.client_id and i.version=r.instructions_version
   where (after_id is null or r.client_id>after_id) and r.confirmed_at<=at_time and i.saved_at<=at_time
   and public.ech_schedule_creation_source(r.client_id,r.service) is not null
   order by r.client_id limit 11 loop
   item:=public.ech_client_schedule_source_read_v2(q.client_id,at_time);
   if item is null then raise sqlstate 'PT409' using message='Scheduling source changed; restart this page sequence';end if;
   if count_rows=10 then next_value:='true'::jsonb;exit;end if;
   rows:=rows||jsonb_build_array(item);last_key:=to_jsonb(q.client_id);count_rows:=count_rows+1;
  end loop;
 end if;
 if next_value is not null then
  next_value:=jsonb_build_object('schema',1,'kind',p_kind,'actorId',auth.uid(),'role',p_role,'membershipRevision',p_revision,
   'generation',g,'clientId',p_client,'after',last_key,'asOf',at_label);
 end if;
 return public.ech_client_read_finish_v2(p_role,p_revision,jsonb_build_object('schema',2,'kind',p_kind,'membershipRevision',p_revision,
  'generation',g,'asOf',at_label,'client',client_value,'items',rows,'nextCursor',next_value));
exception when lock_not_available then raise sqlstate 'PT409' using message='Client source access is changing';
 when invalid_text_representation or numeric_value_out_of_range or datetime_field_overflow then raise sqlstate 'PT400' using message='Invalid client page cursor';end;$$;

create function public.ech_operations_client_item_v2(p_role text,p_revision bigint,p_kind text,p_id uuid,p_version bigint default null,p_generation uuid default null)
returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare g uuid; item jsonb; client_value jsonb;begin
 g:=public.ech_client_read_enter_v2(p_role,p_revision,p_generation);
 if p_id is null or p_kind is null or p_kind not in ('source','client','version','schedule-source')
  or (p_kind='version')<>(p_version is not null) or (p_version is not null and p_version not between 1 and 9007199254740991) then
  raise sqlstate 'PT400' using message='Choose one exact client record';end if;
 if p_kind='source' then
  item:=public.ech_client_source_read_v2(p_id);
  if coalesce(item->>'status','') not in ('New','Contacted','Assessment booked','On hold')
   or exists(select 1 from public.ech_operations_client_requests where inquiry_id=p_id)
   or exists(select 1 from public.ech_schedule_client_readiness where inquiry_id=p_id)
   or exists(select 1 from public.ech_schedule_visit_sources where inquiry_id=p_id) then
   raise sqlstate 'PT409' using message='Inquiry is no longer available for client preparation';end if;
 elsif p_kind='client' then item:=public.ech_client_detail_read_v2(p_id);
 elsif p_kind='version' then
  client_value:=public.ech_client_detail_read_v2(p_id);
  if (client_value->>'current')::boolean then item:=public.ech_client_version_read_v2(p_id,p_version);end if;
 else
  item:=public.ech_client_schedule_source_read_v2(p_id,clock_timestamp());
  if item is null then raise sqlstate 'PT403' using message='Current scheduling source access is unavailable';end if;
 end if;
 return public.ech_client_read_finish_v2(p_role,p_revision,jsonb_build_object('schema',2,'kind',p_kind,'membershipRevision',p_revision,'generation',g,'client',client_value,'item',item));
exception when lock_not_available then raise sqlstate 'PT409' using message='Client source access is changing';end;$$;

-- Strip inherited/default ACLs, including service roles present in review fixtures.
do $$declare r record;begin
 revoke all on table public.ech_client_collection_generation from public,anon,authenticated;
 for r in select roles.rolname from pg_catalog.pg_class t cross join lateral pg_catalog.aclexplode(coalesce(t.relacl,pg_catalog.acldefault('r',t.relowner))) a
  join pg_catalog.pg_roles roles on roles.oid=a.grantee where t.oid='public.ech_client_collection_generation'::regclass and a.grantee<>t.relowner loop
  execute format('revoke all on table public.ech_client_collection_generation from %I',r.rolname);
 end loop;
 for r in select p.oid::regprocedure sig,roles.rolname from pg_catalog.pg_proc p
  cross join lateral pg_catalog.aclexplode(coalesce(p.proacl,pg_catalog.acldefault('f',p.proowner))) a
  join pg_catalog.pg_roles roles on roles.oid=a.grantee where p.pronamespace='public'::regnamespace
  and (p.proname like 'ech_client_%_v2' or p.proname in ('ech_operations_client_context_v2','ech_operations_client_page_v2','ech_operations_client_item_v2')) and a.grantee<>p.proowner loop
  execute format('revoke all on function %s from %I',r.sig,r.rolname);
 end loop;
end;$$;
revoke all on function public.ech_client_generation_track_v2(),public.ech_client_read_enter_v2(text,bigint,uuid),public.ech_client_read_finish_v2(text,bigint,jsonb),
 public.ech_client_schedule_text_v2(text,boolean),public.ech_client_stamp_supported_v2(timestamptz),
 public.ech_client_source_read_v2(uuid),public.ech_client_detail_read_v2(uuid),public.ech_client_version_read_v2(uuid,bigint),public.ech_client_schedule_source_read_v2(uuid,timestamptz),
 public.ech_operations_client_context_v2(text,bigint),public.ech_operations_client_page_v2(text,bigint,text,uuid,jsonb),public.ech_operations_client_item_v2(text,bigint,text,uuid,bigint,uuid)
 from public,anon,authenticated;
commit;
