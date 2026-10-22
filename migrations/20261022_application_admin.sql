begin;
alter table public.ech_memberships add column application_admin boolean not null default false;
alter table public.ech_memberships add column revision bigint not null default 1 check(revision > 0 and revision <= 9007199254740991);
create table public.ech_membership_receipts (
 actor_id uuid not null references public.ech_memberships(user_id), operation_id uuid not null,
 fingerprint text not null, target_id uuid not null references public.ech_memberships(user_id),
 result jsonb not null, at timestamptz not null default now(), primary key(actor_id,operation_id)
);
alter table public.ech_membership_receipts enable row level security;
revoke all on public.ech_membership_receipts from public,anon,authenticated;
-- Membership writes are available only through the guarded command function.
revoke insert,update,delete,truncate,references,trigger on public.ech_memberships from public,anon,authenticated;
create function public.ech_application_admin() returns boolean language sql stable security definer set search_path='' as $$
 select public.ech_session_active() and exists(select 1 from public.ech_memberships where user_id=auth.uid() and active and application_admin);
$$;
create function public.ech_membership_projection(m public.ech_memberships,p_email text) returns jsonb language sql immutable set search_path='' as $$
 select jsonb_build_object('userId',m.user_id,'email',p_email,'displayName',m.display_name,'technicalAdmin',m.technical_admin,'operationalRole',m.operational_role,'applicationAdmin',m.application_admin,'active',m.active,'revision',m.revision);
$$;
create function public.ech_membership_list() returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
 if not public.ech_application_admin() then raise sqlstate 'PT403' using message='Action forbidden';end if;
 return coalesce((select jsonb_agg(public.ech_membership_projection(m,lower(u.email)) order by lower(u.email),m.user_id) from public.ech_memberships m join auth.users u on u.id=m.user_id),'[]'::jsonb);
end;$$;
create function public.ech_membership_commit(p_envelope jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid=auth.uid();op uuid;expected bigint;email_value text;target uuid;f jsonb;m public.ech_memberships;prior public.ech_membership_receipts;hash text;result jsonb;user_count integer;
begin
 if not public.ech_application_admin() then raise sqlstate 'PT403' using message='Action forbidden';end if;
 if jsonb_typeof(p_envelope) is distinct from 'object' or not(p_envelope ?& array['schema','operationId','expectedRevision','command']) or (p_envelope-array['schema','operationId','expectedRevision','command'])<>'{}'::jsonb or p_envelope->'schema' is distinct from '1'::jsonb or jsonb_typeof(p_envelope->'command') is distinct from 'object' or jsonb_typeof(p_envelope->'operationId') is distinct from 'string' or jsonb_typeof(p_envelope->'expectedRevision') is distinct from 'number' or (p_envelope->>'expectedRevision')!~'^[0-9]+$' then raise sqlstate 'PT400' using message='Invalid envelope';end if;
 if not((p_envelope->'command') ?& array['type','email','fields']) or ((p_envelope->'command')-array['type','email','fields'])<>'{}'::jsonb or p_envelope#>>'{command,type}' is distinct from 'upsert' or jsonb_typeof(p_envelope#>'{command,email}') is distinct from 'string' then raise sqlstate 'PT400' using message='Invalid command';end if;
 op=(p_envelope->>'operationId')::uuid;expected=(p_envelope->>'expectedRevision')::bigint;email_value=p_envelope#>>'{command,email}';f=p_envelope#>'{command,fields}';
 if expected<0 or expected>=9007199254740991 or email_value<>lower(trim(email_value)) or length(email_value)>254 or email_value!~'^[^\s@]+@[^\s@]+\.[^\s@]+$' then raise sqlstate 'PT400' using message='Invalid membership identity';end if;
 if jsonb_typeof(f) is distinct from 'object' or not(f ?& array['displayName','technicalAdmin','operationalRole','applicationAdmin','active']) or (f-array['displayName','technicalAdmin','operationalRole','applicationAdmin','active'])<>'{}'::jsonb then raise sqlstate 'PT400' using message='Invalid fields';end if;
 if jsonb_typeof(f->'displayName') is distinct from 'string' or length(trim(f->>'displayName')) not between 1 and 160 or (f->>'displayName')~'[[:cntrl:]]' or jsonb_typeof(f->'technicalAdmin') is distinct from 'boolean' or jsonb_typeof(f->'applicationAdmin') is distinct from 'boolean' or jsonb_typeof(f->'active') is distinct from 'boolean' or (f->'operationalRole'<>'null'::jsonb and (jsonb_typeof(f->'operationalRole') is distinct from 'string' or f->>'operationalRole' not in ('owner','manager','staff'))) then raise sqlstate 'PT400' using message='Invalid fields';end if;
 -- Serialize all membership changes so concurrent demotions cannot remove the last admin.
 perform pg_advisory_xact_lock(617243902117::bigint);
 if not public.ech_application_admin() then raise sqlstate 'PT403' using message='Action forbidden';end if;
 select count(*),min(id::text)::uuid into user_count,target from auth.users where lower(email)=email_value;
 if user_count<>1 then raise sqlstate 'PT400' using message='Existing account required';end if;
 hash=encode(sha256(convert_to(public.ech_canonical(p_envelope),'UTF8')),'hex');
 select * into prior from public.ech_membership_receipts where actor_id=actor and operation_id=op;
 if found then
  if prior.fingerprint<>hash or prior.target_id<>target then raise sqlstate 'PT409' using message='Operation identity conflict';end if;
  return prior.result;
 end if;
 select * into m from public.ech_memberships where user_id=target for update;
 if coalesce(m.revision,0)<>expected then raise sqlstate 'PT409' using message='Revision conflict';end if;
 if m.active and m.application_admin and not((f->>'active')::boolean and (f->>'applicationAdmin')::boolean) and not exists(select 1 from public.ech_memberships where active and application_admin and user_id<>target) then raise sqlstate 'PT409' using message='Keep an active application administrator';end if;
 insert into public.ech_memberships(user_id,display_name,technical_admin,operational_role,application_admin,active,revision)
 values(target,f->>'displayName',(f->>'technicalAdmin')::boolean,f->>'operationalRole',(f->>'applicationAdmin')::boolean,(f->>'active')::boolean,expected+1)
 on conflict(user_id) do update set display_name=excluded.display_name,technical_admin=excluded.technical_admin,operational_role=excluded.operational_role,application_admin=excluded.application_admin,active=excluded.active,revision=excluded.revision returning * into m;
 result=jsonb_build_object('member',public.ech_membership_projection(m,email_value),'receipt',jsonb_build_object('operationId',op,'expectedRevision',expected,'revision',m.revision,'commandFingerprint',hash));
 insert into public.ech_membership_receipts(actor_id,operation_id,fingerprint,target_id,result) values(actor,op,hash,target,result);
 return result;
exception when invalid_text_representation or numeric_value_out_of_range then raise sqlstate 'PT400' using message='Invalid membership command';
end;$$;
create function public.ech_application_backup() returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
 if not public.ech_application_admin() then raise sqlstate 'PT403' using message='Action forbidden';end if;
 return jsonb_build_object('format','ech-application-snapshot','version',1,'exportedAt',now(),'exportedBy',auth.uid(),'restorePolicy','isolated-data-only-no-automatic-grants',
 'records',coalesce((select jsonb_agg(to_jsonb(r) order by r.kind,r.id) from public.ech_records r),'[]'::jsonb),
 'personKeys',coalesce((select jsonb_agg(to_jsonb(p) order by p.id) from public.ech_person_keys p),'[]'::jsonb),
 'events',coalesce((select jsonb_agg(to_jsonb(e) order by e.record_type,e.record_id,e.revision) from public.ech_events e),'[]'::jsonb),
 'commandReceipts',coalesce((select jsonb_agg(to_jsonb(c) order by c.actor_id,c.operation_id) from public.ech_command_receipts c),'[]'::jsonb),
 'memberships',public.ech_membership_list(),
 'membershipReceipts',coalesce((select jsonb_agg(to_jsonb(c) order by c.actor_id,c.operation_id) from public.ech_membership_receipts c),'[]'::jsonb));
end;$$;
revoke all on function public.ech_application_admin(),public.ech_membership_projection(public.ech_memberships,text),public.ech_membership_list(),public.ech_membership_commit(jsonb),public.ech_application_backup() from public,anon,authenticated;
grant execute on function public.ech_application_admin(),public.ech_membership_list(),public.ech_membership_commit(jsonb),public.ech_application_backup() to authenticated;
create unique index ech_partner_import_source_key on public.ech_records ((data#>>'{source,sourceKey}'))
 where kind='partner' and data#>>'{source,origin}'='executive-handoff';
create function public.ech_validate_partner_import(p jsonb) returns void language plpgsql immutable set search_path='' as $$
declare s jsonb;v jsonb;b jsonb;a jsonb;item jsonb;cell jsonb;field_name text;field_index integer;i integer;rank_value integer;row_value integer;boards text[]=array['1YlzNi4idvoAuErFXcVCYhNqtcvW21S4JN8RRTgAXf60','1K3Tn7UASsvSpPfw_qQh40yYc10z5wBrSkeGXaFRsRI8'];
begin
 if jsonb_typeof(p) is distinct from 'object' or not(p ?& array['schema','operationId','expectedRevision','command','source']) or (p-array['schema','operationId','expectedRevision','command','source'])<>'{}'::jsonb or p->'schema' is distinct from '1'::jsonb or p->'expectedRevision' is distinct from '0'::jsonb or jsonb_typeof(p->'operationId') is distinct from 'string' or jsonb_typeof(p->'command') is distinct from 'object' or octet_length(public.ech_canonical(p))>65536 then raise sqlstate 'PT400' using message='Invalid import envelope';end if;
 perform (p->>'operationId')::uuid;
 if not((p->'command') ?& array['type','id','fields']) or ((p->'command')-array['type','id','fields'])<>'{}'::jsonb or p#>>'{command,type}' is distinct from 'create' or jsonb_typeof(p#>'{command,id}') is distinct from 'string' then raise sqlstate 'PT400' using message='Invalid import command';end if;
 perform (p#>>'{command,id}')::uuid;perform public.ech_validate_fields('partner','create',p#>'{command,fields}');
 s=p->'source';
 if jsonb_typeof(s) is distinct from 'object' or not(s ?& array['origin','sourceKey','rank','sourceVariants','brief','reviewFlags','assignment']) or (s-array['origin','sourceKey','rank','sourceVariants','brief','reviewFlags','assignment'])<>'{}'::jsonb or s->>'origin' is distinct from 'executive-handoff' or jsonb_typeof(s->'rank') is distinct from 'number' or (s->>'rank')!~'^[0-9]+$' then raise sqlstate 'PT400' using message='Invalid import source';end if;
 rank_value=(s->>'rank')::integer;row_value=rank_value+6;
 if rank_value not between 1 and 50 or s->>'sourceKey' is distinct from boards[1]||':689102916:'||row_value::text or jsonb_typeof(s->'sourceVariants') is distinct from 'array' or jsonb_array_length(s->'sourceVariants')<>2 then raise sqlstate 'PT400' using message='Invalid source identity';end if;
 for i in 0..1 loop
  v=s->'sourceVariants'->i;
  if jsonb_typeof(v) is distinct from 'object' or not(v ?& array['spreadsheetId','sheetId','tab','row','url','values']) or (v-array['spreadsheetId','sheetId','tab','row','url','values'])<>'{}'::jsonb or v->>'spreadsheetId' is distinct from boards[i+1] or v->'sheetId' is distinct from '689102916'::jsonb or v->>'tab' is distinct from 'Prospect Bank' or v->'row' is distinct from to_jsonb(row_value) or v->>'url' is distinct from 'https://docs.google.com/spreadsheets/d/'||boards[i+1]||'/edit#gid=689102916&range=A'||row_value::text||':N'||row_value::text or jsonb_typeof(v->'values') is distinct from 'array' or jsonb_array_length(v->'values')<>14 then raise sqlstate 'PT400' using message='Invalid source board';end if;
  for cell in select value from jsonb_array_elements(v->'values') loop
   if cell<>'null'::jsonb and (jsonb_typeof(cell) is distinct from 'string' or length(cell#>>'{}')>12000 or (cell#>>'{}')~'[\x01-\x08\x0b\x0c\x0e-\x1f]') then raise sqlstate 'PT400' using message='Invalid source value';end if;
  end loop;
 end loop;
 v=s->'sourceVariants'->0;
 if v#>>'{values,1}' is distinct from rank_value::text or (v->'values')-13 is distinct from ((s->'sourceVariants'->1->'values')-13) or v#>>'{values,0}' not in ('TRUE','FALSE') or p#>'{command,fields,contacted}' is distinct from to_jsonb(v#>>'{values,0}'='TRUE') then raise sqlstate 'PT400' using message='Source values do not match import';end if;
 for field_name,field_index in select * from (values ('sprint',2),('geography',3),('category',4),('organization',5),('contactRoute',6),('openingAsk',7),('stage',8),('materials',10),('lastTouch',11),('nextDate',12)) fields(name,idx) loop
  if p#>>array['command','fields',field_name] is distinct from coalesce(v->'values'->>field_index,'') then raise sqlstate 'PT400' using message='Source fields do not match import';end if;
 end loop;
 a=s->'assignment';
 if jsonb_typeof(a) is distinct from 'object' or not(a ?& array['status','sourceText']) or (a-array['status','sourceText'])<>'{}'::jsonb or a->>'status' not in ('caller_tbc','unassigned','proposed') or jsonb_typeof(a->'status') is distinct from 'string' or jsonb_typeof(a->'sourceText') is distinct from 'string' or length(a->>'sourceText')>1000 or a->>'sourceText' is distinct from v#>>'{values,9}' then raise sqlstate 'PT400' using message='Invalid assignment metadata';end if;
 if jsonb_typeof(s->'reviewFlags') is distinct from 'array' or jsonb_array_length(s->'reviewFlags')>20 then raise sqlstate 'PT400' using message='Invalid review flags';end if;
 for item in select value from jsonb_array_elements(s->'reviewFlags') loop
  if jsonb_typeof(item) is distinct from 'string' or length(trim(item#>>'{}')) not between 1 and 2000 then raise sqlstate 'PT400' using message='Invalid review flag';end if;
 end loop;
 b=s->'brief';
 if (rank_value<=15) is distinct from (b<>'null'::jsonb) then raise sqlstate 'PT400' using message='Brief rank mismatch';end if;
 if b<>'null'::jsonb then
  if jsonb_typeof(b) is distinct from 'object' or not(b ?& array['documentId','title','url','modifiedAt','text','sources']) or (b-array['documentId','title','url','modifiedAt','text','sources'])<>'{}'::jsonb or jsonb_typeof(b->'documentId') is distinct from 'string' or b->>'documentId'!~'^[A-Za-z0-9_-]{20,100}$' or b->>'url' not in ('https://docs.google.com/document/d/'||(b->>'documentId')||'/edit','https://docs.google.com/document/d/'||(b->>'documentId')||'/edit?usp=drivesdk') or jsonb_typeof(b->'url') is distinct from 'string' or jsonb_typeof(b->'title') is distinct from 'string' or length(trim(b->>'title')) not between 1 and 500 or jsonb_typeof(b->'text') is distinct from 'string' or length(trim(b->>'text')) not between 1 and 24000 or jsonb_typeof(b->'modifiedAt') is distinct from 'string' or b->>'modifiedAt'!~'^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$' or jsonb_typeof(b->'sources') is distinct from 'array' or jsonb_array_length(b->'sources')>20 then raise sqlstate 'PT400' using message='Invalid source brief';end if;
  if left(b->>'title',5) is distinct from lpad(rank_value::text,2,'0')||' - ' or (b->>'text')!~('Prospect Bank #'||rank_value::text||'([^0-9]|$)') then raise sqlstate 'PT400' using message='Brief rank mismatch';end if;
  perform (b->>'modifiedAt')::timestamptz;
  for item in select value from jsonb_array_elements(b->'sources') loop
   if jsonb_typeof(item) is distinct from 'object' or not(item ?& array['label','url']) or (item-array['label','url'])<>'{}'::jsonb or jsonb_typeof(item->'label') is distinct from 'string' or length(trim(item->>'label')) not between 1 and 500 or jsonb_typeof(item->'url') is distinct from 'string' or length(item->>'url')>2048 or item->>'url'!~'^https://[A-Za-z0-9.-]+(/[^[:space:]]*)?$' then raise sqlstate 'PT400' using message='Invalid brief reference';end if;
  end loop;
 end if;
exception when invalid_text_representation or numeric_value_out_of_range or invalid_datetime_format or datetime_field_overflow then raise sqlstate 'PT400' using message='Invalid import source';
end;$$;
create function public.ech_import_partner(p_envelope jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid=auth.uid();op uuid;rid uuid;source_value jsonb;hash text;prior public.ech_command_receipts;imported_result jsonb;
begin
 if not public.ech_application_admin() or public.ech_role() is null or public.ech_role() not in ('owner','manager') then raise sqlstate 'PT403' using message='Action forbidden';end if;
 perform public.ech_validate_partner_import(p_envelope);
 op=(p_envelope->>'operationId')::uuid;rid=(p_envelope#>>'{command,id}')::uuid;source_value=p_envelope->'source';
 perform pg_advisory_xact_lock(hashtextextended(actor::text||':'||op::text,0));
 perform pg_advisory_xact_lock(hashtextextended('ech-import-source:'||(source_value->>'sourceKey'),0));
 if not public.ech_application_admin() or public.ech_role() is null or public.ech_role() not in ('owner','manager') then raise sqlstate 'PT403' using message='Action forbidden';end if;
 if exists(select 1 from public.ech_records where kind='partner' and id=rid) and not public.ech_can_read_subject('partner',rid) then raise sqlstate 'PT403' using message='Record unavailable';end if;
 hash=encode(sha256(convert_to(public.ech_canonical(p_envelope),'UTF8')),'hex');
 select * into prior from public.ech_command_receipts where actor_id=actor and operation_id=op;
 if found then
  if prior.fingerprint<>hash or prior.record_type<>'partner' or prior.record_id<>rid then raise sqlstate 'PT409' using message='Operation identity conflict';end if;
  return prior.result;
 end if;
 if exists(select 1 from public.ech_records where kind='partner' and data#>>'{source,origin}'='executive-handoff' and data#>>'{source,sourceKey}'=source_value->>'sourceKey') then raise sqlstate 'PT409' using message='Source already imported';end if;
 imported_result=public.ech_commit('partner',p_envelope-'source');
 update public.ech_records set data=jsonb_set(data,'{source}',source_value) where kind='partner' and id=rid and revision=1;
 if not found then raise sqlstate 'PT409' using message='Import record conflict';end if;
 imported_result=jsonb_set(imported_result,'{record,source}',source_value);
 imported_result=jsonb_set(imported_result,'{receipt,commandFingerprint}',to_jsonb(hash));
 update public.ech_command_receipts set fingerprint=hash,result=imported_result where actor_id=actor and operation_id=op;
 update public.ech_events set details=jsonb_set(details,'{changedFields}',(details->'changedFields')||jsonb_build_array('source'))||jsonb_build_object('source',source_value)
 where actor_id=actor and operation_id=op and record_type='partner' and record_id=rid and revision=1;
 return imported_result;
exception when unique_violation then raise sqlstate 'PT409' using message='Import identity conflict';
end;$$;
revoke all on function public.ech_validate_partner_import(jsonb),public.ech_import_partner(jsonb) from public,anon,authenticated;
grant execute on function public.ech_import_partner(jsonb) to authenticated;

-- Enable only the designated existing account. Authentication confirmation is separate.
do $$
begin
 if not exists(select 1 from auth.users where id='1fbc76c6-8521-4f9e-b0c9-f174ada676aa'::uuid and lower(email)='erick@bloxlabs.tech') then raise exception 'Designated existing account not found';end if;
 insert into public.ech_memberships(user_id,display_name,technical_admin,operational_role,application_admin,active)
 values('1fbc76c6-8521-4f9e-b0c9-f174ada676aa','Erick',true,'owner',true,true)
 on conflict(user_id) do update set technical_admin=true,operational_role='owner',application_admin=true,active=true,revision=public.ech_memberships.revision+1
 where not(public.ech_memberships.technical_admin and public.ech_memberships.operational_role='owner' and public.ech_memberships.application_admin and public.ech_memberships.active);
end;$$;
commit;
