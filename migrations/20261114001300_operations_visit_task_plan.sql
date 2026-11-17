-- Local review draft: no grants or seeded records.
-- Nonclinical Home support only. Authorship is not consent or clinical authority.
-- Planned create/series commands opt in with an exact taskPlanToken. The draft
-- writers prepare/finish each occurrence atomically; application access remains
-- disabled. Durable planned reservation also requires migration 014.
begin;

create function public.ech_task_plan_text(p_value text,p_max integer)
returns boolean language sql immutable set search_path='' as $$
 select coalesce(length(p_value) between 1 and p_max and p_value=public.ech_client_trim(p_value)
  and (p_value collate "C") !~ U&'[\0001-\001F\007F-\009F]',false)
$$;

-- Arrays are the authored category/task order. No sorting, parsing of existing
-- prose, inferred categories, timing, outcomes, or default completion occurs.
create function public.ech_task_plan_categories(p_value jsonb)
returns boolean language plpgsql immutable set search_path='' as $$
declare c jsonb; t jsonb; category_ids text[]:='{}'; task_ids text[]:='{}'; count_tasks integer:=0;
 uuid_pattern constant text:='^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
begin
 if jsonb_typeof(p_value) is distinct from 'array' then return false;end if;
 if jsonb_array_length(p_value)>20 or octet_length(p_value::text)>100000 then return false;end if;
 for c in select value from jsonb_array_elements(p_value) loop
  if jsonb_typeof(c) is distinct from 'object' then return false;end if;
  if not(c ?& array['id','label','tasks'])
   or c-array['id','label','tasks']<>'{}'::jsonb or jsonb_typeof(c->'id') is distinct from 'string'
   or c->>'id' !~ uuid_pattern or c->>'id'=any(category_ids)
   or jsonb_typeof(c->'label') is distinct from 'string' or not public.ech_task_plan_text(c->>'label',100)
   or jsonb_typeof(c->'tasks') is distinct from 'array' then return false;end if;
  category_ids:=array_append(category_ids,c->>'id');
  for t in select value from jsonb_array_elements(c->'tasks') loop
   if jsonb_typeof(t) is distinct from 'object' then return false;end if;
   if not(t ?& array['id','text'])
    or t-array['id','text']<>'{}'::jsonb or jsonb_typeof(t->'id') is distinct from 'string'
    or t->>'id' !~ uuid_pattern or t->>'id'=any(task_ids)
    or jsonb_typeof(t->'text') is distinct from 'string' or not public.ech_task_plan_text(t->>'text',500)
    then return false;end if;
   task_ids:=array_append(task_ids,t->>'id');count_tasks:=count_tasks+1;
   if count_tasks>100 then return false;end if;
  end loop;
 end loop;
 return true;
end;$$;

create function public.ech_task_plan_token(p_value jsonb)
returns text language sql immutable strict set search_path='' as $$
 select pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(p_value::text,'UTF8')),'hex')
$$;

-- Every typed row entering plan tokens or saved provenance passes through this
-- one serializer. PostgreSQL JSON timestamp rendering otherwise follows the
-- caller's TimeZone. Function-local configuration restores it on return/error;
-- JSON already saved in immutable history is never rewritten or reinterpreted.
-- Earlier draft data with noncanonical provenance needs a separate reviewed
-- migration/reauthoring decision before activation; this contract rejects it.
create function public.ech_task_plan_snapshot(p_value anyelement)
returns jsonb language sql stable strict set search_path='' set timezone='UTC' as $$
 select to_jsonb(p_value)
$$;

create table public.ech_task_plan_versions (
 client_id uuid not null,
 -- The structured version is the SAME exact immutable instruction version,
 -- not a separate mutable "latest" pointer. A revision needs a new version.
 instructions_version bigint not null check(instructions_version between 1 and 9007199254740991),
 categories jsonb not null check(public.ech_task_plan_categories(categories)),
 author_id uuid not null references public.ech_memberships(user_id),
 author_label text not null check(public.ech_task_plan_text(author_label,160)),
 membership_revision bigint not null check(membership_revision between 1 and 9007199254740991),
 request_id uuid not null,
 source_reference text not null check(public.ech_task_plan_text(source_reference,256)),
 source_snapshot jsonb not null check(jsonb_typeof(source_snapshot)='object'),
 authored_at timestamptz not null default clock_timestamp() check(isfinite(authored_at)),
 primary key(client_id,instructions_version), unique(author_id,request_id),
 foreign key(client_id,instructions_version) references public.ech_operations_instruction_content(client_id,version)
);

-- Call only after current manager/source authorization. Reuse the existing
-- dispatch transaction and hold the exact immutable source rows through commit.
-- Older noncanonical saved JSON is rejected, never normalized into new history.
create function public.ech_task_plan_check_provenance(p_plan public.ech_task_plan_versions)
returns void language plpgsql volatile set search_path='' as $$
declare i public.ech_schedule_service_instructions; c public.ech_operations_instruction_content;
begin
 select * into i from public.ech_schedule_service_instructions where client_id=p_plan.client_id and version=p_plan.instructions_version for share nowait;
 select * into c from public.ech_operations_instruction_content where client_id=p_plan.client_id and version=p_plan.instructions_version for share nowait;
 if p_plan.client_id is null or i.client_id is null or c.client_id is null
  or p_plan.source_snapshot->>'kind' is distinct from 'authored-nonclinical-instructions'
  or p_plan.source_snapshot->>'service' is distinct from 'Home support'
  or coalesce(p_plan.source_snapshot->>'inquiryId','') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  or p_plan.source_snapshot->>'inquiryRevision' is distinct from c.source_revision::text
  or p_plan.source_snapshot->'instructions' is distinct from public.ech_task_plan_snapshot(i)
  or p_plan.source_snapshot->'content' is distinct from public.ech_task_plan_snapshot(c) then
  raise sqlstate 'PT409' using message='Review the exact canonical nonclinical task-plan source';end if;
exception when lock_not_available then raise sqlstate 'PT409' using message='Task-plan source access is changing';end;$$;

-- A private future writer reserves the exact reviewed plan BEFORE inserting the
-- visit. The deferred circular link prohibits committing a partial preparation.
-- request_id is actor-scoped within task authoring/additions, not a global
-- Operations operation ID. create_operation_id uses the canonical create ID.
create table public.ech_task_plan_create_pins (
 visit_id uuid primary key,
 create_operation_id uuid not null unique references public.ech_schedule_events(operation_id) deferrable initially deferred,
 client_id uuid not null, instructions_version bigint not null,
 actor_id uuid not null references public.ech_memberships(user_id),
 membership_revision bigint not null check(membership_revision between 1 and 9007199254740991),
 create_xid xid8 not null,
 plan_snapshot jsonb not null check(jsonb_typeof(plan_snapshot)='object'),
 plan_token text not null check(plan_token ~ '^[0-9a-f]{64}$'),
 prepared_at timestamptz not null default clock_timestamp() check(isfinite(prepared_at)),
 foreign key(client_id,instructions_version) references public.ech_task_plan_versions(client_id,instructions_version)
);
create table public.ech_visit_task_plan_snapshots (
 visit_id uuid primary key references public.ech_schedule_visit_sources(visit_id),
 create_operation_id uuid not null unique references public.ech_schedule_events(operation_id),
 plan_snapshot jsonb not null check(jsonb_typeof(plan_snapshot)='object'),
 plan_token text not null check(plan_token ~ '^[0-9a-f]{64}$'),
 source_snapshot jsonb not null check(jsonb_typeof(source_snapshot)='object'),
 create_visit_snapshot jsonb not null check(jsonb_typeof(create_visit_snapshot)='object'),
 captured_at timestamptz not null default clock_timestamp() check(isfinite(captured_at)),
 foreign key(visit_id) references public.ech_task_plan_create_pins(visit_id)
);
alter table public.ech_task_plan_create_pins add foreign key(visit_id)
 references public.ech_visit_task_plan_snapshots(visit_id) deferrable initially deferred;

create table public.ech_visit_task_plan_additions (
 visit_id uuid not null references public.ech_visit_task_plan_snapshots(visit_id),
 ordinal integer not null check(ordinal between 1 and 50),
 actor_id uuid not null references public.ech_memberships(user_id),
 request_id uuid not null,
 actor_label text not null check(public.ech_task_plan_text(actor_label,160)),
 membership_revision bigint not null check(membership_revision between 1 and 9007199254740991),
 visit_revision bigint not null check(visit_revision between 1 and 9007199254740991),
 -- An addition names an existing authored category, then appends separately.
 -- It never edits/reorders the base array or becomes part of a later base plan.
 category_id uuid not null, task_id uuid not null,
 task_text text not null check(public.ech_task_plan_text(task_text,500)),
 source_kind text not null check(source_kind='manager-authored-nonclinical'),
 source_reference text not null check(public.ech_task_plan_text(source_reference,256)),
 reason text not null check(public.ech_task_plan_text(reason,500)),
 visit_snapshot jsonb not null check(jsonb_typeof(visit_snapshot)='object'),
 base_plan_token text not null check(base_plan_token ~ '^[0-9a-f]{64}$'),
 recorded_at timestamptz not null default clock_timestamp() check(isfinite(recorded_at)),
 primary key(visit_id,ordinal), unique(actor_id,request_id), unique(visit_id,task_id)
);

create function public.ech_task_plan_manager_enter(p_role text,p_revision bigint)
returns void language plpgsql volatile set search_path='' as $$
begin
 if current_setting('transaction_isolation')<>'read committed' or p_role is null or p_role not in ('owner','manager')
  or p_revision is null or p_revision not between 1 and 9007199254740991 then
  raise sqlstate 'PT403' using message='Current manager task-plan access is unavailable';end if;
 perform pg_advisory_xact_lock(617243902117::bigint);
 -- Auth sub/session/expiry/provider identity, approval, active role/revision and
 -- exact current Operations grant use the existing canonical manager contract.
 perform public.ech_schedule_check_series_access(p_role,p_revision);
end;$$;

create function public.ech_task_plan_guard_version() returns trigger
language plpgsql volatile set search_path='' as $$
declare r public.ech_schedule_client_readiness; c public.ech_operations_instruction_content;
 i public.ech_schedule_service_instructions; q jsonb; label text;
begin
 perform public.ech_task_plan_manager_enter((select operational_role from public.ech_memberships where user_id=auth.uid()),new.membership_revision);
 select * into r from public.ech_schedule_client_readiness where client_id=new.client_id for share nowait;
 select * into c from public.ech_operations_instruction_content where client_id=new.client_id and version=new.instructions_version;
 select * into i from public.ech_schedule_service_instructions where client_id=new.client_id and version=new.instructions_version;
 if r.client_id is null or r.service<>'Home support' or r.instructions_version<>new.instructions_version
  or r.inquiry_id is null or c.client_id is null or c.source_revision is distinct from r.inquiry_revision
  or i.client_id is null or i.saved_at>clock_timestamp() or r.confirmed_at>clock_timestamp() then
  raise sqlstate 'PT409' using message='Use the current authored nonclinical instruction source';end if;
 q:=public.ech_operations_client_source(r.inquiry_id);
 if q->>'revision' is distinct from r.inquiry_revision::text or coalesce(q->>'status','') not in ('New','Contacted','Assessment booked','On hold') then
  raise sqlstate 'PT409' using message='Review the current open instruction source';end if;
 -- No backfill or late attachment to an instruction version already scheduled.
 if exists(select 1 from public.ech_schedule_visit_sources where client_id=new.client_id and instructions_version=new.instructions_version) then
  raise sqlstate 'PT409' using message='Create a new instruction version before authoring its task plan';end if;
 select display_name into label from public.ech_memberships where user_id=auth.uid();
 new.author_id:=auth.uid();new.author_label:=label;new.authored_at:=clock_timestamp();
 new.source_snapshot:=jsonb_build_object('kind','authored-nonclinical-instructions','instructions',public.ech_task_plan_snapshot(i),'content',public.ech_task_plan_snapshot(c),
  'inquiryId',r.inquiry_id,'inquiryRevision',r.inquiry_revision,'service',r.service);
 return new;
end;$$;
create trigger ech_task_plan_guard_version before insert on public.ech_task_plan_versions
 for each row execute function public.ech_task_plan_guard_version();

create function public.ech_operations_task_plan_author(p_role text,p_revision bigint,p_client uuid,p_version bigint,p_request uuid,p_categories jsonb,p_source_reference text)
returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare v public.ech_task_plan_versions;
begin
 perform public.ech_task_plan_manager_enter(p_role,p_revision);
 if p_client is null or p_version is null or p_version not between 1 and 9007199254740991 or p_request is null
  or not public.ech_task_plan_categories(p_categories) or not public.ech_task_plan_text(p_source_reference,256) then
  raise sqlstate 'PT400' using message='Choose an exact nonclinical task-plan version';end if;
 select * into v from public.ech_task_plan_versions where author_id=auth.uid() and request_id=p_request;
 if found then
  if v.client_id<>p_client or v.instructions_version<>p_version or v.categories<>p_categories or v.source_reference<>p_source_reference
   or v.membership_revision<>p_revision then raise sqlstate 'PT409' using message='Task-plan request identity conflict';end if;
 else
  insert into public.ech_task_plan_versions(client_id,instructions_version,categories,author_id,author_label,membership_revision,request_id,source_reference,source_snapshot)
   values(p_client,p_version,p_categories,auth.uid(),'',p_revision,p_request,p_source_reference,'{}') returning * into v;
 end if;
 perform public.ech_operations_client_source((v.source_snapshot->>'inquiryId')::uuid);
 perform public.ech_task_plan_check_provenance(v);
 perform public.ech_schedule_check_series_access(p_role,p_revision);
 return jsonb_build_object('plan',public.ech_task_plan_snapshot(v),'planToken',public.ech_task_plan_token(public.ech_task_plan_snapshot(v)));
exception when unique_violation then raise sqlstate 'PT409' using message='Task-plan version or request already exists';
 when lock_not_available then raise sqlstate 'PT409' using message='Task-plan source access is changing';end;$$;

-- Private creation integration helpers. These are deliberately not a later
-- capture API. Prepare rejects an existing visit; finish requires the exact
-- preparation transaction and canonical create event/receipt. Deferred links
-- prevent prepare-only commits. Commands without a token call neither helper.
create function public.ech_task_plan_prepare_create(p_role text,p_revision bigint,p_visit uuid,p_operation uuid,p_client uuid,p_version bigint,p_plan_token text)
returns void language plpgsql volatile set search_path='' as $$
declare v public.ech_task_plan_versions; q jsonb;
begin
 perform public.ech_task_plan_manager_enter(p_role,p_revision);
 if p_visit is null or p_operation is null or p_client is null or p_version is null
  or p_plan_token is null or p_plan_token !~ '^[0-9a-f]{64}$' then raise sqlstate 'PT400' using message='Choose an exact reviewed task plan';end if;
 if exists(select 1 from public.ech_schedule_visits where id=p_visit) or exists(select 1 from public.ech_schedule_events where operation_id=p_operation) then
  raise sqlstate 'PT409' using message='Prepare a task plan before creating this visit';end if;
 select * into v from public.ech_task_plan_versions where client_id=p_client and instructions_version=p_version for share nowait;
 if not found or public.ech_task_plan_token(public.ech_task_plan_snapshot(v))<>p_plan_token then raise sqlstate 'PT409' using message='Task plan changed; review the exact version';end if;
 -- Reauthorize the current inquiry before copying any saved plan into a pin.
 -- The canonical source helper takes FOR SHARE NOWAIT on that exact inquiry
 -- and checks ech_can_read against its current owner. Hold through commit.
 q:=public.ech_operations_client_source((v.source_snapshot->>'inquiryId')::uuid);
 if q->>'id' is distinct from v.source_snapshot->>'inquiryId'
  or q->>'revision' is distinct from v.source_snapshot->>'inquiryRevision'
  or coalesce(q->>'status','') not in ('New','Contacted','Assessment booked','On hold') then
  raise sqlstate 'PT409' using message='Review the current open task-plan source before preparing this visit';end if;
 perform public.ech_task_plan_check_provenance(v);
 insert into public.ech_task_plan_create_pins(visit_id,create_operation_id,client_id,instructions_version,actor_id,membership_revision,create_xid,plan_snapshot,plan_token)
  values(p_visit,p_operation,p_client,p_version,auth.uid(),p_revision,pg_current_xact_id(),public.ech_task_plan_snapshot(v),p_plan_token);
 perform public.ech_schedule_check_series_access(p_role,p_revision);
end;$$;

create function public.ech_task_plan_finish_create(p_role text,p_revision bigint,p_visit uuid,p_operation uuid,p_plan_token text)
returns void language plpgsql volatile set search_path='' as $$
declare pin public.ech_task_plan_create_pins; s public.ech_schedule_visit_sources; v public.ech_schedule_visits;
 e public.ech_schedule_events; receipt public.ech_schedule_operation_receipts; q jsonb;
begin
 perform public.ech_task_plan_manager_enter(p_role,p_revision);
 select * into pin from public.ech_task_plan_create_pins where visit_id=p_visit for share nowait;
 if pin.visit_id is null or pin.create_operation_id is distinct from p_operation or pin.actor_id is distinct from auth.uid()
  or pin.membership_revision is distinct from p_revision or pin.create_xid is distinct from pg_current_xact_id()
  or pin.plan_token is distinct from p_plan_token then raise sqlstate 'PT409' using message='Keep the original same-transaction task-plan preparation';end if;
 -- Preparation is not authority to expose saved content later in this same
 -- transaction. Recheck current inquiry visibility, revision and open status;
 -- the source helper independently locks the current inquiry until commit.
 q:=public.ech_operations_client_source((pin.plan_snapshot->'source_snapshot'->>'inquiryId')::uuid);
 if q->>'id' is distinct from pin.plan_snapshot->'source_snapshot'->>'inquiryId'
  or q->>'revision' is distinct from pin.plan_snapshot->'source_snapshot'->>'inquiryRevision'
  or coalesce(q->>'status','') not in ('New','Contacted','Assessment booked','On hold') then
  raise sqlstate 'PT409' using message='Review the current open task-plan source before publishing this visit snapshot';end if;
 select * into v from public.ech_schedule_visits where id=p_visit for share nowait;
 select * into s from public.ech_schedule_visit_sources where visit_id=p_visit;
 select * into e from public.ech_schedule_events where operation_id=p_operation;
 select * into receipt from public.ech_schedule_operation_receipts where operation_id=p_operation;
 if v.id is null or v.revision<>1 or v.status not in ('Open','Assigned') or v.service<>'Home support'
  or s.visit_id is null or s.client_id<>pin.client_id or s.instructions_version<>pin.instructions_version
  or s.inquiry_id::text is distinct from pin.plan_snapshot->'source_snapshot'->>'inquiryId'
  or s.inquiry_revision::text is distinct from pin.plan_snapshot->'source_snapshot'->>'inquiryRevision'
  or e.visit_id is distinct from p_visit or e.action is distinct from 'create' or e.revision is distinct from 1
  or e.actor_id is distinct from pin.actor_id or e.previous_visit is not null or e.next_visit is distinct from public.ech_schedule_visit_snapshot(v)
  or receipt.actor_id is distinct from pin.actor_id or receipt.envelope->>'expectedRole' is distinct from p_role
  or receipt.envelope->>'membershipRevision' is distinct from p_revision::text
  -- The canonical receipt must retain the exact reviewed token; a separate
  -- reservation, tokenless receipt or late capture cannot substitute for it.
  or receipt.envelope->'command'->>'taskPlanToken' is distinct from p_plan_token
  or receipt.envelope->'command'->>'type' is distinct from 'create'
  or receipt.envelope->'command'->>'visitId' is distinct from p_visit::text
  or receipt.response->'visit' is distinct from e.next_visit then
  raise sqlstate 'PT409' using message='Pin the exact reviewed task plan in the new visit creation transaction';end if;
 insert into public.ech_visit_task_plan_snapshots(visit_id,create_operation_id,plan_snapshot,plan_token,source_snapshot,create_visit_snapshot)
  values(p_visit,p_operation,pin.plan_snapshot,pin.plan_token,public.ech_task_plan_snapshot(s),e.next_visit);
 perform public.ech_schedule_check_series_access(p_role,p_revision);
end;$$;

create function public.ech_operations_visit_task_add(p_role text,p_revision bigint,p_visit uuid,p_visit_revision bigint,p_expected_additions integer,
 p_request uuid,p_plan_token text,p_category uuid,p_task uuid,p_text text,p_source_reference text,p_reason text)
returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare v public.ech_schedule_visits; base public.ech_visit_task_plan_snapshots; a public.ech_visit_task_plan_additions;
 n integer; label text; q jsonb;
begin
 perform public.ech_task_plan_manager_enter(p_role,p_revision);
 if p_visit is null or p_visit_revision is null or p_visit_revision not between 1 and 9007199254740991
  or p_expected_additions is null or p_expected_additions not between 0 and 49 or p_request is null or p_category is null or p_task is null
  or p_plan_token is null or not public.ech_task_plan_text(p_text,500) or not public.ech_task_plan_text(p_source_reference,256)
  or not public.ech_task_plan_text(p_reason,500) then raise sqlstate 'PT400' using message='Choose an exact nonclinical visit-only addition';end if;
 select * into v from public.ech_schedule_visits where id=p_visit and service='Home support' for share nowait;
 select * into base from public.ech_visit_task_plan_snapshots where visit_id=p_visit;
 if v.id is null or base.visit_id is null then raise sqlstate 'PT403' using message='Visit task-plan access is unavailable';end if;
 -- A manager's current inquiry visibility is required; no old assignment or
 -- membership grant is revived by possession of an immutable snapshot/token.
 q:=public.ech_operations_client_source((base.source_snapshot->>'inquiry_id')::uuid);
 if q->>'revision' is distinct from base.source_snapshot->>'inquiry_revision'
  or coalesce(q->>'status','') not in ('New','Contacted','Assessment booked','On hold') then
  raise sqlstate 'PT409' using message='Review the current task-plan source before adding a task';end if;
 select * into a from public.ech_visit_task_plan_additions where actor_id=auth.uid() and request_id=p_request;
 if found then
  if a.visit_id<>p_visit or a.visit_revision<>p_visit_revision or a.ordinal<>p_expected_additions+1 or a.base_plan_token<>p_plan_token
   or a.category_id<>p_category or a.task_id<>p_task or a.task_text<>p_text or a.source_reference<>p_source_reference or a.reason<>p_reason
   or a.membership_revision<>p_revision then raise sqlstate 'PT409' using message='Visit-only request identity conflict';end if;
 else
  if v.revision<>p_visit_revision then raise sqlstate 'PT412' using message='Visit changed; reload the task plan';end if;
  -- Changes during/after care and staff-authored additions need separate scope.
  if v.status not in ('Open','Assigned','Confirmed') then raise sqlstate 'PT409' using message='Visit-only additions require an unstarted active visit';end if;
  if base.plan_token<>p_plan_token then raise sqlstate 'PT409' using message='Keep the immutable base task-plan token';end if;
  select count(*) into n from public.ech_visit_task_plan_additions where visit_id=p_visit;
  if n<>p_expected_additions then raise sqlstate 'PT412' using message='Visit-only additions changed; reload the task plan';end if;
  if not exists(select 1 from jsonb_array_elements(base.plan_snapshot->'categories') c where c->>'id'=p_category::text)
   or exists(select 1 from jsonb_array_elements(base.plan_snapshot->'categories') c cross join lateral jsonb_array_elements(c->'tasks') t where t->>'id'=p_task::text) then
   raise sqlstate 'PT400' using message='Use an existing category and a new task identity';end if;
  select display_name into label from public.ech_memberships where user_id=auth.uid();
  insert into public.ech_visit_task_plan_additions(visit_id,ordinal,actor_id,request_id,actor_label,membership_revision,visit_revision,
   category_id,task_id,task_text,source_kind,source_reference,reason,visit_snapshot,base_plan_token)
   values(p_visit,n+1,auth.uid(),p_request,label,p_revision,p_visit_revision,p_category,p_task,p_text,'manager-authored-nonclinical',
    p_source_reference,p_reason,public.ech_schedule_visit_snapshot(v),p_plan_token) returning * into a;
 end if;
 perform public.ech_schedule_check_series_access(p_role,p_revision);
 return public.ech_task_plan_snapshot(a);
exception when unique_violation then raise sqlstate 'PT409' using message='Visit-only task or request already exists';
 when lock_not_available then raise sqlstate 'PT409' using message='Visit task-plan access is changing';end;$$;

-- Only new tables have triggers. No legacy function, policy, source token,
-- schedule revision, report, instruction, or visit row is modified here.
do $$declare n text; r record;begin
 foreach n in array array['ech_task_plan_versions','ech_task_plan_create_pins','ech_visit_task_plan_snapshots','ech_visit_task_plan_additions'] loop
  execute format('alter table public.%I enable row level security',n);
  execute format('create trigger ech_task_plan_serialize before insert or update or delete or truncate on public.%I for each statement execute function public.ech_schedule_serialize_dispatch()',n);
  execute format('create trigger ech_task_plan_keep_history before update or delete or truncate on public.%I for each statement execute function public.ech_schedule_keep_history()',n);
  execute format('revoke all on table public.%I from public,anon,authenticated',n);
  for r in select roles.rolname from pg_catalog.pg_class t cross join lateral pg_catalog.aclexplode(coalesce(t.relacl,pg_catalog.acldefault('r',t.relowner))) a
   join pg_catalog.pg_roles roles on roles.oid=a.grantee where t.oid=format('public.%I',n)::regclass and a.grantee<>t.relowner loop
   execute format('revoke all on table public.%I from %I',n,r.rolname);
  end loop;
 end loop;
 for r in select p.oid::regprocedure sig,roles.rolname from pg_catalog.pg_proc p
  cross join lateral pg_catalog.aclexplode(coalesce(p.proacl,pg_catalog.acldefault('f',p.proowner))) a
  join pg_catalog.pg_roles roles on roles.oid=a.grantee where p.pronamespace='public'::regnamespace
  and p.proname in ('ech_task_plan_text','ech_task_plan_categories','ech_task_plan_token','ech_task_plan_snapshot','ech_task_plan_check_provenance','ech_task_plan_manager_enter','ech_task_plan_guard_version',
   'ech_operations_task_plan_author','ech_task_plan_prepare_create','ech_task_plan_finish_create','ech_operations_visit_task_add') and a.grantee<>p.proowner loop
  execute format('revoke all on function %s from %I',r.sig,r.rolname);
 end loop;
end;$$;
revoke all on function public.ech_task_plan_text(text,integer),public.ech_task_plan_categories(jsonb),public.ech_task_plan_token(jsonb),
 public.ech_task_plan_snapshot(anyelement),
 public.ech_task_plan_check_provenance(public.ech_task_plan_versions),
 public.ech_task_plan_manager_enter(text,bigint),public.ech_task_plan_guard_version(),
 public.ech_operations_task_plan_author(text,bigint,uuid,bigint,uuid,jsonb,text),
 public.ech_task_plan_prepare_create(text,bigint,uuid,uuid,uuid,bigint,text),public.ech_task_plan_finish_create(text,bigint,uuid,uuid,text),
 public.ech_operations_visit_task_add(text,bigint,uuid,bigint,integer,uuid,text,uuid,uuid,text,text,text) from public,anon,authenticated;
commit;
