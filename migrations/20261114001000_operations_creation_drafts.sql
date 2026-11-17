-- Durable local creation recovery. Application execution remains revoked.
begin;
create table public.ech_schedule_creation_drafts (
 operation_id uuid primary key,
 actor_id uuid not null references public.ech_memberships(user_id),
 envelope jsonb not null,
 state text not null check(state in ('pending','committed','cancelled','resolved')),
 response jsonb,
 executing_xid xid8,
 created_at timestamptz not null default clock_timestamp(),
 check ((state in ('committed','resolved')) = (response is not null))
);
create unique index ech_schedule_creation_one_outstanding on public.ech_schedule_creation_drafts(actor_id) where state in ('pending','committed');
create table public.ech_schedule_creation_identities (
 identity uuid primary key,
 draft_id uuid not null references public.ech_schedule_creation_drafts(operation_id),
 domain text not null check(domain in ('operation','visit')),
 envelope jsonb
);
alter table public.ech_schedule_creation_drafts enable row level security;
alter table public.ech_schedule_creation_identities enable row level security;
create trigger ech_schedule_creation_identities_immutable before update or delete or truncate on public.ech_schedule_creation_identities
 for each statement execute function public.ech_schedule_keep_history();
create function public.ech_schedule_creation_keep_envelope()
returns trigger language plpgsql set search_path='' as $$
begin
 if tg_op<>'UPDATE' then raise sqlstate 'PT409' using message='Creation history is immutable';end if;
 if new.operation_id<>old.operation_id or new.actor_id<>old.actor_id or new.envelope<>old.envelope or new.created_at<>old.created_at
   or not ((old.state='pending' and new.state in ('pending','committed','cancelled')) or (old.state='committed' and new.state='resolved'))
   or (old.response is not null and new.response is distinct from old.response) then
   raise sqlstate 'PT409' using message='Creation history is immutable';end if;
 return new;
end;$$;
create trigger ech_schedule_creation_drafts_immutable before update or delete on public.ech_schedule_creation_drafts for each row execute function public.ech_schedule_creation_keep_envelope();
create trigger ech_schedule_creation_drafts_no_truncate before truncate on public.ech_schedule_creation_drafts for each statement execute function public.ech_schedule_keep_history();
-- Internal implementations have no RPC-facing execution grants. Public entry
-- points below fence every create, including series occurrence calls.
create schema ech_schedule_internal;
revoke all on schema ech_schedule_internal from public,anon,authenticated;
alter function public.ech_operations_visit_commit(jsonb) rename to ech_operations_visit_commit_reserved_impl;
alter function public.ech_operations_series_commit(jsonb) rename to ech_operations_series_commit_reserved_impl;
alter function public.ech_operations_visit_commit_reserved_impl(jsonb) set schema ech_schedule_internal;
alter function public.ech_operations_series_commit_reserved_impl(jsonb) set schema ech_schedule_internal;

create function public.ech_schedule_creation_validate(p_envelope jsonb)
returns void language plpgsql volatile set search_path='' as $$
declare c jsonb:=p_envelope->'command'; o jsonb; v public.ech_schedule_visits; i integer:=0; local_start timestamp; local_end timestamp; days integer; plan_fields text[]:='{}';
begin
 if jsonb_typeof(p_envelope)<>'object' or coalesce(c->>'type','') not in ('create','createSeries')
   or jsonb_typeof(p_envelope->'membershipRevision') is distinct from 'number' or coalesce(p_envelope->>'membershipRevision','') !~ '^[1-9][0-9]{0,15}$'
   or (p_envelope->>'membershipRevision')::numeric>9007199254740991 or coalesce(p_envelope->>'expectedRole','') not in ('owner','manager')
   or jsonb_typeof(p_envelope->'operationId') is distinct from 'string' or coalesce(p_envelope->>'operationId','') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
   raise sqlstate 'PT400' using message='Choose an exact creation envelope'; end if;
 if c->>'type'='create' then
   if p_envelope->'schema' is distinct from '2'::jsonb or p_envelope->'expectedRevision' is distinct from '0'::jsonb
      or p_envelope-array['schema','operationId','expectedRevision','expectedRole','membershipRevision','command']<>'{}'::jsonb then
     raise sqlstate 'PT400' using message='Choose a pinned creation'; end if;
 else
   if p_envelope->'schema' is distinct from '1'::jsonb or c->>'timeZone' is distinct from 'America/Vancouver'
     or coalesce(c->>'count','') !~ '^([2-9]|1[0-2])$' or coalesce(c->>'cadence','') not in ('daily','weekly')
     or jsonb_typeof(c->'occurrences') is distinct from 'array' or jsonb_array_length(c->'occurrences')<>(c->>'count')::integer
     or p_envelope-array['schema','operationId','expectedRole','membershipRevision','command']<>'{}'::jsonb then
     raise sqlstate 'PT400' using message='Choose a pinned Vancouver series'; end if;
   if coalesce(c->>'localStart','') !~ '^20[0-9]{2}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{3}$' or coalesce(c->>'localEnd','') !~ '^20[0-9]{2}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{3}$' then raise sqlstate 'PT400' using message='Choose exact Vancouver local times';end if;
   local_start:=(c->>'localStart')::timestamp; local_end:=(c->>'localEnd')::timestamp;
   days:=case c->>'cadence' when 'daily' then 1 else 7 end;
 end if;
 if jsonb_typeof(c->'source') is distinct from 'object' or jsonb_typeof(c->'clientId') is distinct from 'string'
   or coalesce(c->>'clientId','') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
   or (c->'workerId' is distinct from 'null'::jsonb and (jsonb_typeof(c->'workerId') is distinct from 'string' or coalesce(c->>'workerId','') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$')) then
   raise sqlstate 'PT400' using message='Choose exact client, worker and reviewed source identities';end if;
 if c ? 'taskPlanToken' then
   if jsonb_typeof(c->'taskPlanToken') is distinct from 'string' or c->>'taskPlanToken' !~ '^[0-9a-f]{64}$'
     or c->>'service' is distinct from 'Home support' then
     raise sqlstate 'PT400' using message='Choose an exact nonclinical task-plan token';end if;
   plan_fields:=array['taskPlanToken'];
 end if;
 if (c->>'type'='create' and (not(c ?& array['type','visitId','clientId','workerId','service','start','end','source']) or c-(array['type','visitId','clientId','workerId','service','start','end','source']||plan_fields)<>'{}'::jsonb))
   or (c->>'type'='createSeries' and (not(c ?& array['type','clientId','workerId','service','source','timeZone','localStart','localEnd','cadence','count','occurrences']) or c-(array['type','clientId','workerId','service','source','timeZone','localStart','localEnd','cadence','count','occurrences']||plan_fields)<>'{}'::jsonb)) then
   raise sqlstate 'PT400' using message='Choose an exact creation command';end if;
 for o in select value from jsonb_array_elements(case when c->>'type'='create' then jsonb_build_array(c) else c->'occurrences' end) loop
   if coalesce(o->>'visitId','') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
     or (c->>'type'='createSeries' and coalesce(o->>'operationId','') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$') then
     raise sqlstate 'PT400' using message='Choose distinct creation identities'; end if;
   if (c->>'type'='createSeries' and (not(o ?& array['operationId','visitId','start','end']) or o-array['operationId','visitId','start','end']<>'{}'::jsonb))
     or jsonb_typeof(o->'start') is distinct from 'string' or jsonb_typeof(o->'end') is distinct from 'string'
     or coalesce(o->>'start','') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{3}Z$' or coalesce(o->>'end','') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{3}Z$' then
     raise sqlstate 'PT400' using message='Choose exact occurrence fields';end if;
   v.id:=(o->>'visitId')::uuid; v.client_id:=(c->>'clientId')::uuid; v.worker_id:=(c->>'workerId')::uuid;
   v.service:=c->>'service';v.starts_at:=(o->>'start')::timestamptz;v.ends_at:=(o->>'end')::timestamptz;
   if o->>'start' is distinct from to_char(v.starts_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') or o->>'end' is distinct from to_char(v.ends_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') then raise sqlstate 'PT400' using message='Choose canonical UTC visit times';end if;
   v.status:=case when v.worker_id is null then 'Open' else 'Assigned' end;v.revision:=1;
   if v.client_id is null or v.service not in ('Home support','Nursing') or v.starts_at is null or v.ends_at is null or v.starts_at>=v.ends_at then
     raise sqlstate 'PT400' using message='Choose a valid creation interval';end if;
   if c->>'type'='createSeries' and (o->>'start' is distinct from to_char(public.ech_schedule_recurrence_instant(local_start+i*days*interval '1 day') at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
     or o->>'end' is distinct from to_char(public.ech_schedule_recurrence_instant(local_end+i*days*interval '1 day') at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')) then
     raise sqlstate 'PT400' using message='Occurrence does not match Vancouver recurrence';end if;
   perform 1 from public.ech_schedule_clients where id=v.client_id for share nowait;
   if not found then raise sqlstate 'PT409' using message='Creation source changed';end if;
   perform public.ech_schedule_validate_dispatch(v,false);
   if c->'source' is distinct from public.ech_schedule_creation_source(v.client_id,v.service) then
     raise sqlstate 'PT409' using message='Creation source changed';end if;
   i:=i+1;
 end loop;
 if c ? 'taskPlanToken' then
   -- Validation reads the exact authored version and current inquiry under the
   -- shared dispatch lock; it never prepares a pin during durable reservation.
   perform public.ech_task_plan_review_creation(p_envelope->>'expectedRole',(p_envelope->>'membershipRevision')::bigint,
     (c->>'clientId')::uuid,(c->'source'->>'instructionsVersion')::bigint,c->>'taskPlanToken');
 end if;
end;$$;

create function public.ech_operations_creation_draft(p_action text,p_role text,p_revision bigint,p_envelope jsonb default null)
returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare d public.ech_schedule_creation_drafts; op uuid; c jsonb; o jsonb; e jsonb; result jsonb;
begin
 if current_setting('transaction_isolation')<>'read committed' or p_action not in ('recover','reserve','cancel','resolve','inspect') then
   raise sqlstate 'PT400' using message='Choose a current creation recovery action';end if;
 -- This is the canonical dispatch/access lock, never an unrelated lock.
 perform pg_advisory_xact_lock(617243902117::bigint);
 perform public.ech_schedule_check_series_access(p_role,p_revision);
 if p_action='recover' then
   if p_envelope is not null then raise sqlstate 'PT400' using message='Recovery takes no envelope';end if;
   select * into d from public.ech_schedule_creation_drafts where actor_id=auth.uid() and state in ('pending','committed');
 else
   if p_action='reserve' and (p_envelope->>'expectedRole' is distinct from p_role or p_envelope->>'membershipRevision' is distinct from p_revision::text) then
     raise sqlstate 'PT409' using message='Creation access changed';end if;
   op:=(p_envelope->>'operationId')::uuid;
   select * into d from public.ech_schedule_creation_drafts where operation_id=op for update;
   if found then
     if d.actor_id<>auth.uid() or d.envelope<>p_envelope then raise sqlstate 'PT409' using message='Creation identity conflict';end if;
   elsif p_action='reserve' then
     if exists(select 1 from public.ech_schedule_creation_drafts where actor_id=auth.uid() and state in ('pending','committed')) then
       raise sqlstate 'PT409' using message='Recover the outstanding creation first';end if;
     perform public.ech_schedule_creation_validate(p_envelope);
     insert into public.ech_schedule_creation_drafts(operation_id,actor_id,envelope,state) values(op,auth.uid(),p_envelope,'pending') returning * into d;
     insert into public.ech_schedule_creation_identities values(op,op,'operation',case when p_envelope->'command'->>'type'='create' then p_envelope else null end);
     c:=p_envelope->'command';
     for o in select value from jsonb_array_elements(case when c->>'type'='create' then jsonb_build_array(c) else c->'occurrences' end) loop
       insert into public.ech_schedule_creation_identities values((o->>'visitId')::uuid,op,'visit',null);
       if c->>'type'='createSeries' then
         e:=jsonb_build_object('schema',2,'operationId',o->'operationId','expectedRevision',0,'expectedRole',p_envelope->'expectedRole','membershipRevision',p_envelope->'membershipRevision',
           'command',jsonb_build_object('type','create','visitId',o->'visitId','clientId',c->'clientId','workerId',c->'workerId','service',c->'service','source',c->'source','start',o->'start','end',o->'end')
             ||case when c ? 'taskPlanToken' then jsonb_build_object('taskPlanToken',c->'taskPlanToken') else '{}'::jsonb end);
         insert into public.ech_schedule_creation_identities values((o->>'operationId')::uuid,op,'operation',e);
       end if;
     end loop;
     if exists(select 1 from public.ech_schedule_creation_identities x where x.draft_id=op and (
       exists(select 1 from public.ech_schedule_events where operation_id=x.identity)
       or exists(select 1 from public.ech_visit_report_events where operation_id=x.identity)
       or exists(select 1 from public.ech_schedule_series_receipts where operation_id=x.identity)
       or exists(select 1 from public.ech_schedule_visits where id=x.identity))) then
       raise sqlstate 'PT409' using message='Creation identity conflict';end if;
   else raise sqlstate 'PT409' using message='Creation reservation is unavailable';end if;
   if p_action='cancel' and d.state='pending' then
     update public.ech_schedule_creation_drafts set state='cancelled' where operation_id=op returning * into d;
   elsif p_action='resolve' and d.state='committed' then
     update public.ech_schedule_creation_drafts set state='resolved' where operation_id=op returning * into d;
   end if;
 end if;
 -- Reads and terminal cancellation intentionally do not require old eligibility:
 -- withdrawn sources must remain recoverable/cancellable; fresh access is required.
 perform public.ech_schedule_check_series_access(p_role,p_revision);
 if d.operation_id is null then return jsonb_build_object('schema',1,'draft',null);end if;
 return jsonb_build_object('schema',1,'draft',jsonb_build_object('envelope',d.envelope,'state',d.state,'result',d.response));
exception when unique_violation then raise sqlstate 'PT409' using message='Creation identity or outstanding request conflict';
when invalid_text_representation or invalid_datetime_format or datetime_field_overflow then raise sqlstate 'PT400' using message='Invalid creation envelope';
when lock_not_available then raise sqlstate 'PT409' using message='Creation access is changing';
end;$$;

create function public.ech_operations_visit_commit(p_envelope jsonb)
returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare d public.ech_schedule_creation_drafts; e jsonb; result jsonb;
begin
 if p_envelope->'command'->>'type'<>'create' then return ech_schedule_internal.ech_operations_visit_commit_reserved_impl(p_envelope);end if;
 perform pg_advisory_xact_lock(617243902117::bigint);
 perform public.ech_schedule_check_series_access(p_envelope->>'expectedRole',(p_envelope->>'membershipRevision')::bigint);
 select r.* into d from public.ech_schedule_creation_drafts r join public.ech_schedule_creation_identities x on x.draft_id=r.operation_id
   where x.identity=(p_envelope->>'operationId')::uuid and x.domain='operation';
 -- Fetch separately because a draft is a fixed composite type.
 select x.envelope into e from public.ech_schedule_creation_identities x where x.identity=(p_envelope->>'operationId')::uuid;
 if d.operation_id is null or d.actor_id<>auth.uid() or e is distinct from p_envelope or d.state='cancelled'
   or (d.envelope->'command'->>'type'='createSeries' and d.executing_xid is distinct from pg_current_xact_id()) then
   raise sqlstate 'PT409' using message='An exact active creation reservation is required';end if;
 result:=ech_schedule_internal.ech_operations_visit_commit_reserved_impl(p_envelope);
 if d.envelope->'command'->>'type'='create' and d.state='pending' then
   update public.ech_schedule_creation_drafts set state='committed',response=result where operation_id=d.operation_id;
 end if;
 perform public.ech_schedule_check_series_access(p_envelope->>'expectedRole',(p_envelope->>'membershipRevision')::bigint);
 return result;
end;$$;

create function public.ech_operations_series_commit(p_envelope jsonb)
returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare d public.ech_schedule_creation_drafts; result jsonb;
begin
 perform pg_advisory_xact_lock(617243902117::bigint);
 perform public.ech_schedule_check_series_access(p_envelope->>'expectedRole',(p_envelope->>'membershipRevision')::bigint);
 select * into d from public.ech_schedule_creation_drafts where operation_id=(p_envelope->>'operationId')::uuid for update;
 if not found or d.actor_id<>auth.uid() or d.envelope<>p_envelope or d.state='cancelled' then
   raise sqlstate 'PT409' using message='An exact active series reservation is required';end if;
 if d.state in ('committed','resolved') then
   perform public.ech_schedule_check_series_access(p_envelope->>'expectedRole',(p_envelope->>'membershipRevision')::bigint);return d.response;end if;
 update public.ech_schedule_creation_drafts set executing_xid=pg_current_xact_id() where operation_id=d.operation_id;
 result:=ech_schedule_internal.ech_operations_series_commit_reserved_impl(p_envelope);
 update public.ech_schedule_creation_drafts set state='committed',response=result,executing_xid=null where operation_id=d.operation_id;
 perform public.ech_schedule_check_series_access(p_envelope->>'expectedRole',(p_envelope->>'membershipRevision')::bigint);
 return result;
end;$$;

-- Block operation reuse by other command domains even before a creation commits.
create function public.ech_schedule_creation_identity_guard()
returns trigger language plpgsql set search_path='' as $$
declare x public.ech_schedule_creation_identities;
begin
 select * into x from public.ech_schedule_creation_identities where identity=new.operation_id;
 if found then
   if tg_table_name<>'ech_schedule_events' then raise sqlstate 'PT409' using message='Reserved creation identity conflict';end if;
   if x.domain<>'operation' or x.envelope is null or new.actor_id<>auth.uid() or new.action<>'create' or new.visit_id::text is distinct from x.envelope->'command'->>'visitId' then
     raise sqlstate 'PT409' using message='Reserved creation identity conflict';end if;
 end if;
 return new;
end;$$;
create trigger ech_schedule_creation_event_identity before insert on public.ech_schedule_events for each row execute function public.ech_schedule_creation_identity_guard();
create trigger ech_schedule_creation_report_identity before insert on public.ech_visit_report_events for each row execute function public.ech_schedule_creation_identity_guard();
revoke all on public.ech_schedule_creation_drafts,public.ech_schedule_creation_identities from public,anon,authenticated;
-- Strip every inherited ACL, including any pre-existing custom application role.
do $$ declare r record;begin
 for r in select c.oid::regclass as relation,roles.rolname from pg_catalog.pg_class c cross join lateral pg_catalog.aclexplode(coalesce(c.relacl,pg_catalog.acldefault('r',c.relowner))) a
 join pg_catalog.pg_roles roles on roles.oid=a.grantee where c.oid in ('public.ech_schedule_creation_drafts'::regclass,'public.ech_schedule_creation_identities'::regclass) and a.grantee<>c.relowner
 loop execute format('revoke all on table %s from %I',r.relation,r.rolname);end loop;
 for r in select p.oid::regprocedure as signature,roles.rolname from pg_catalog.pg_proc p cross join lateral pg_catalog.aclexplode(coalesce(p.proacl,pg_catalog.acldefault('f',p.proowner))) a
 join pg_catalog.pg_roles roles on roles.oid=a.grantee where p.pronamespace in ('public'::regnamespace,'ech_schedule_internal'::regnamespace) and p.proname in ('ech_operations_creation_draft','ech_schedule_creation_validate','ech_schedule_creation_identity_guard','ech_schedule_creation_keep_envelope','ech_operations_visit_commit','ech_operations_series_commit','ech_operations_visit_commit_reserved_impl','ech_operations_series_commit_reserved_impl') and a.grantee<>p.proowner
 loop execute format('revoke all on function %s from %I',r.signature,r.rolname);end loop;
end;$$;
revoke all on function public.ech_operations_creation_draft(text,text,bigint,jsonb),public.ech_schedule_creation_validate(jsonb),public.ech_schedule_creation_identity_guard(),public.ech_schedule_creation_keep_envelope(),public.ech_operations_visit_commit(jsonb),public.ech_operations_series_commit(jsonb),ech_schedule_internal.ech_operations_visit_commit_reserved_impl(jsonb),ech_schedule_internal.ech_operations_series_commit_reserved_impl(jsonb) from public,anon,authenticated;
commit;
