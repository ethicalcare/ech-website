-- Install after the schedule and command migrations. Review records are
-- maintained by the database owner. This migration supplies no policy values,
-- credentials, care records, or application permissions.
begin;

create table public.ech_schedule_service_rules (
  service text primary key check (service in ('Home support', 'Nursing')),
  min_minutes integer not null check (min_minutes >= 15),
  max_minutes integer not null check (max_minutes > min_minutes and max_minutes <= 1440),
  travel_buffer_minutes integer not null check (travel_buffer_minutes between 0 and 180),
  required_credentials text[] not null check (
    cardinality(required_credentials) <= 10 and
    (cardinality(required_credentials) = 0 or array_ndims(required_credentials) = 1)
  ),
  review_ref text not null check (length(btrim(review_ref)) between 3 and 200)
);

create table public.ech_schedule_service_instructions (
  client_id uuid not null references public.ech_schedule_clients(id),
  version bigint not null check (version > 0),
  saved_at timestamptz not null check (isfinite(saved_at)),
  saved_by uuid not null references public.ech_memberships(user_id),
  evidence_ref text not null check (length(btrim(evidence_ref)) between 3 and 200),
  primary key (client_id, version)
);

create table public.ech_schedule_client_readiness (
  client_id uuid primary key references public.ech_schedule_clients(id),
  service text not null check (service in ('Home support', 'Nursing')),
  area text not null check (area = btrim(area) and length(area) between 2 and 100 and area !~ '[[:cntrl:]]'),
  confirmed_by uuid not null references public.ech_memberships(user_id),
  confirmed_at timestamptz not null check (isfinite(confirmed_at)),
  instructions_version bigint not null,
  inquiry_id uuid,
  inquiry_revision bigint check (inquiry_revision > 0),
  inquiry_kind text generated always as ('inquiry') stored,
  check ((inquiry_id is null) = (inquiry_revision is null)),
  foreign key (inquiry_kind, inquiry_id) references public.ech_records(kind, id),
  foreign key (client_id, instructions_version) references public.ech_schedule_service_instructions(client_id, version)
);

-- One source inquiry may hand off to at most one client readiness record.
create unique index ech_schedule_readiness_unique_inquiry
  on public.ech_schedule_client_readiness (inquiry_id) where inquiry_id is not null;

alter table public.ech_schedule_visits add unique (id, client_id, service);

-- New visits keep the readiness facts that authorized their creation. Earlier
-- visits have no binding unless one was written when the visit was created.
create table public.ech_schedule_visit_sources (
  visit_id uuid primary key,
  client_id uuid not null,
  service text not null,
  instructions_version bigint not null,
  confirmed_by uuid not null references public.ech_memberships(user_id),
  confirmed_at timestamptz not null check (isfinite(confirmed_at)),
  inquiry_id uuid,
  inquiry_revision bigint check (inquiry_revision > 0),
  inquiry_kind text generated always as ('inquiry') stored,
  check ((inquiry_id is null) = (inquiry_revision is null)),
  foreign key (visit_id, client_id, service) references public.ech_schedule_visits(id, client_id, service),
  foreign key (client_id, instructions_version) references public.ech_schedule_service_instructions(client_id, version),
  foreign key (inquiry_kind, inquiry_id) references public.ech_records(kind, id)
);

create index ech_schedule_visit_sources_inquiry_idx
  on public.ech_schedule_visit_sources (inquiry_id, client_id) where inquiry_id is not null;

create table public.ech_schedule_worker_qualifications (
  worker_id uuid not null references public.ech_schedule_workers(id),
  service text not null check (service in ('Home support', 'Nursing')),
  review_ref text not null check (length(btrim(review_ref)) between 3 and 200),
  primary key (worker_id, service)
);

create table public.ech_schedule_worker_availability (
  worker_id uuid not null references public.ech_schedule_workers(id),
  starts_at timestamptz(3) not null,
  ends_at timestamptz(3) not null,
  check (isfinite(starts_at) and isfinite(ends_at) and starts_at < ends_at),
  primary key (worker_id, starts_at)
);

create table public.ech_schedule_worker_credentials (
  worker_id uuid not null references public.ech_schedule_workers(id),
  credential text not null check (
    credential = btrim(credential) and length(credential) between 2 and 80 and credential !~ '[[:cntrl:]]'
  ),
  valid_through date not null check (isfinite(valid_through)),
  review_ref text not null check (length(btrim(review_ref)) between 3 and 200),
  primary key (worker_id, credential)
);

create table public.ech_schedule_travel_routes (
  from_area text not null check (
    from_area = btrim(from_area) and length(from_area) between 2 and 100 and from_area !~ '[[:cntrl:]]'
  ),
  to_area text not null check (
    to_area = btrim(to_area) and length(to_area) between 2 and 100 and to_area !~ '[[:cntrl:]]'
  ),
  minutes integer not null check (minutes between 0 and 360),
  review_ref text not null check (length(btrim(review_ref)) between 3 and 200),
  primary key (from_area, to_area)
);

-- Review edits and scheduling writes use the same lock. Row checks in the
-- volatile validator use a fresh snapshot after any wait.
do $$
declare
  table_name text;
  recipient text;
begin
  foreach table_name in array array[
    'ech_schedule_service_rules', 'ech_schedule_client_readiness', 'ech_schedule_service_instructions',
    'ech_schedule_worker_qualifications', 'ech_schedule_worker_availability', 'ech_schedule_worker_credentials',
    'ech_schedule_travel_routes', 'ech_schedule_visit_sources'
  ] loop
    execute format('alter table public.%I enable row level security', table_name);
    execute format('revoke all on table public.%I from public', table_name);
    for recipient in
      select distinct r.rolname from pg_catalog.pg_class c
      cross join lateral pg_catalog.aclexplode(coalesce(c.relacl, pg_catalog.acldefault('r', c.relowner))) a
      join pg_catalog.pg_roles r on r.oid = a.grantee
      where c.oid = format('public.%I', table_name)::regclass and a.grantee <> c.relowner
    loop
      execute format('revoke all on table public.%I from %I', table_name, recipient);
    end loop;
    execute format(
      'create trigger ech_dispatch_review_serialize before insert or update or delete or truncate
       on public.%I for each statement execute function public.ech_schedule_serialize_dispatch()', table_name
    );
  end loop;
end;
$$;

-- An availability replacement can change several windows in one transaction.
-- Check the final windows for the affected worker, including gaps.
create function public.ech_schedule_check_availability_edit()
returns trigger language plpgsql volatile set search_path = ''
as $$
begin
  if tg_op <> 'DELETE' and exists (
    select 1 from public.ech_schedule_worker_availability a
    join public.ech_schedule_worker_availability b on b.worker_id = a.worker_id
      and b.starts_at > a.starts_at and b.starts_at < a.ends_at
    where a.worker_id = new.worker_id
  ) then
    raise sqlstate 'PT409' using message = 'Worker availability windows overlap';
  end if;
  if tg_op <> 'INSERT' and exists (
    select 1 from public.ech_schedule_visits v
    where v.worker_id = old.worker_id and v.status in ('Assigned', 'Confirmed', 'In progress')
      and not exists (
        select 1 from public.ech_schedule_worker_availability a
        where a.worker_id = v.worker_id and a.starts_at <= v.starts_at and a.ends_at >= v.ends_at
      )
  ) then
    raise sqlstate 'PT409' using message = 'Availability would invalidate an active assignment';
  end if;
  return null;
end;
$$;

create constraint trigger ech_dispatch_check_availability
  after insert or update or delete on public.ech_schedule_worker_availability
  deferrable initially deferred for each row execute function public.ech_schedule_check_availability_edit();

-- TRUNCATE has no row events and cannot run the deferred availability check.
create trigger ech_dispatch_keep_availability
  before truncate on public.ech_schedule_worker_availability
  for each statement execute function public.ech_schedule_keep_history();

create trigger ech_dispatch_keep_instruction_versions
  before update or delete or truncate on public.ech_schedule_service_instructions
  for each statement execute function public.ech_schedule_keep_history();

create trigger ech_dispatch_keep_visit_sources
  before update or delete or truncate on public.ech_schedule_visit_sources
  for each statement execute function public.ech_schedule_keep_history();

revoke all on function public.ech_schedule_check_availability_edit() from public;
do $$
declare recipient text;
begin
  for recipient in
    select distinct r.rolname from pg_catalog.pg_proc p
    cross join lateral pg_catalog.aclexplode(coalesce(p.proacl, pg_catalog.acldefault('f', p.proowner))) a
    join pg_catalog.pg_roles r on r.oid = a.grantee
    where p.oid = 'public.ech_schedule_check_availability_edit()'::regprocedure and a.grantee <> p.proowner
  loop
    execute format('revoke all on function public.ech_schedule_check_availability_edit() from %I', recipient);
  end loop;
end;
$$;

create or replace function public.ech_schedule_validate_dispatch(p_visit public.ech_schedule_visits, p_pin_source boolean)
returns void language plpgsql volatile set search_path = ''
as $$
declare
  readiness public.ech_schedule_client_readiness;
  rules public.ech_schedule_service_rules;
  worker_actor uuid;
  local_end date;
  neighbor record;
  neighbor_area text;
  route_minutes integer;
begin
  select * into readiness from public.ech_schedule_client_readiness r
  where r.client_id = p_visit.client_id and r.service = p_visit.service
    and r.confirmed_at <= clock_timestamp()
    and exists (
      select 1 from public.ech_schedule_service_instructions i
      where i.client_id = r.client_id and i.version = r.instructions_version and i.saved_at <= clock_timestamp()
    );
  if not found then
    raise sqlstate 'PT409' using message = 'Confirm this client and service and record saved service instructions before scheduling';
  end if;
  if readiness.inquiry_id is not null then
    perform 1 from public.ech_records r where r.kind = 'inquiry' and r.id = readiness.inquiry_id
      and r.revision = readiness.inquiry_revision
      and r.data->>'status' in ('New', 'Contacted', 'Assessment booked', 'On hold')
      for share nowait;
    if not found then
      raise sqlstate 'PT409' using message = 'Review the current inquiry before scheduling this client';
    end if;
    if exists (
      select 1 from public.ech_schedule_visit_sources s
      where s.inquiry_id = readiness.inquiry_id and s.client_id <> readiness.client_id
    ) then
      raise sqlstate 'PT409' using message = 'This inquiry is already linked to a different scheduled client';
    end if;
  end if;

  select * into rules from public.ech_schedule_service_rules r where r.service = p_visit.service;
  if not found then
    raise sqlstate 'PT409' using message = 'Scheduling rules for this service are unavailable';
  end if;
  if p_visit.ends_at - p_visit.starts_at < make_interval(mins => rules.min_minutes)
    or p_visit.ends_at - p_visit.starts_at >= make_interval(mins => rules.max_minutes) then
    raise sqlstate 'PT409' using message = 'Visit duration is outside the reviewed service limits';
  end if;
  -- The dispatch lock and CRM row lock hold through commit. Any later failure
  -- in validation or command processing rolls back the visit and its binding.
  if p_pin_source then
    insert into public.ech_schedule_visit_sources
      (visit_id, client_id, service, instructions_version, confirmed_by, confirmed_at, inquiry_id, inquiry_revision)
    values (p_visit.id, readiness.client_id, readiness.service, readiness.instructions_version,
      readiness.confirmed_by, readiness.confirmed_at, readiness.inquiry_id, readiness.inquiry_revision);
  end if;
  if p_visit.worker_id is null or p_visit.status = 'Cancelled' then
    return;
  end if;
  if p_visit.service = 'Nursing' then
    raise sqlstate 'PT409' using message = 'Nursing assignment authority is unavailable';
  end if;

  select w.user_id into worker_actor from public.ech_schedule_workers w
  where w.id = p_visit.worker_id for share;
  if worker_actor is null or public.ech_schedule_lock_access(worker_actor, p_visit.worker_id) is null then
    raise sqlstate 'PT409' using message = 'Worker is unavailable for assignment';
  end if;
  if not exists (
    select 1 from public.ech_schedule_worker_qualifications q
    where q.worker_id = p_visit.worker_id and q.service = p_visit.service
  ) then
    raise sqlstate 'PT409' using message = 'Reviewed worker qualification for this service is unavailable';
  end if;
  if not exists (
    select 1 from public.ech_schedule_worker_availability a where a.worker_id = p_visit.worker_id
      and a.starts_at <= p_visit.starts_at and a.ends_at >= p_visit.ends_at
  ) then
    raise sqlstate 'PT409' using message = 'Visit is outside reviewed worker availability';
  end if;
  if exists (
    select 1 from public.ech_schedule_visits v
    where v.worker_id = p_visit.worker_id and v.id <> p_visit.id and v.status <> 'Cancelled'
      and v.starts_at < p_visit.ends_at and v.ends_at > p_visit.starts_at
  ) then
    raise sqlstate 'PT409' using message = 'Worker has an overlapping visit';
  end if;

  local_end := (case when p_visit.ends_at >= timestamptz '2026-03-08 10:00:00+00'
    then (p_visit.ends_at at time zone 'UTC') - interval '7 hours'
    else p_visit.ends_at at time zone 'America/Vancouver' end)::date;
  if exists (
    select 1 from unnest(rules.required_credentials) as required(credential)
    where not exists (
      select 1 from public.ech_schedule_worker_credentials c where c.worker_id = p_visit.worker_id
        and c.credential = required.credential and c.valid_through >= local_end
    )
  ) then
    raise sqlstate 'PT409' using message = 'Required worker credential is missing or expires before the visit ends';
  end if;

  -- Check both closest visits, including ties in older records, using elapsed
  -- time. Visits for the same client need no travel estimate.
  for neighbor in
    (select v.client_id, true as preceding, p_visit.starts_at - v.ends_at as gap
     from public.ech_schedule_visits v
     where v.worker_id = p_visit.worker_id and v.id <> p_visit.id and v.status <> 'Cancelled'
       and v.ends_at <= p_visit.starts_at and v.ends_at > p_visit.starts_at - interval '24 hours'
     order by v.ends_at desc fetch first 1 row with ties)
    union all
    (select v.client_id, false, v.starts_at - p_visit.ends_at
     from public.ech_schedule_visits v
     where v.worker_id = p_visit.worker_id and v.id <> p_visit.id and v.status <> 'Cancelled'
       and v.starts_at >= p_visit.ends_at and v.starts_at < p_visit.ends_at + interval '24 hours'
     order by v.starts_at fetch first 1 row with ties)
  loop
    if neighbor.client_id = p_visit.client_id then
      continue;
    end if;
    select area into neighbor_area from public.ech_schedule_client_readiness where client_id = neighbor.client_id;
    select r.minutes into route_minutes from public.ech_schedule_travel_routes r
    where r.from_area = case when neighbor.preceding then neighbor_area else readiness.area end
      and r.to_area = case when neighbor.preceding then readiness.area else neighbor_area end;
    if not found then
      raise sqlstate 'PT409' using message = 'A directional reviewed travel estimate is required between visits';
    end if;
    if neighbor.gap < make_interval(mins => route_minutes + rules.travel_buffer_minutes) then
      raise sqlstate 'PT409' using message = 'The gap between visits is below the reviewed travel time and buffer';
    end if;
  end loop;
end;
$$;

-- Metadata only: no instruction text, evidence reference, inquiry answers or
-- contact/clinical fields leave the reviewed-source boundary. The opaque token
-- also covers owner-maintained policy and references without exposing them.
create or replace function public.ech_schedule_creation_source(p_client uuid, p_service text)
returns jsonb language sql volatile set search_path = '' as $$
  select jsonb_build_object(
    'clientId', c.id, 'clientName', c.name, 'service', r.service, 'area', r.area,
    'instructionsVersion', i.version,
    'instructionsSavedAt', to_char(i.saved_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
    'confirmedAt', to_char(r.confirmed_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
    'inquiryId', r.inquiry_id, 'inquiryRevision', r.inquiry_revision,
    'sourceToken', pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(jsonb_build_object('readiness', to_jsonb(r), 'instructions', to_jsonb(i),
      'clientName', c.name, 'rules', to_jsonb(policy))::text,'UTF8')),'hex')
  )
  from public.ech_schedule_client_readiness r
  join public.ech_schedule_clients c on c.id=r.client_id
  join public.ech_schedule_service_instructions i on i.client_id=r.client_id and i.version=r.instructions_version
  join public.ech_schedule_service_rules policy on policy.service=r.service
  where r.client_id=p_client and r.service=p_service and r.confirmed_at<=clock_timestamp()
    and i.saved_at<=clock_timestamp() and i.version between 1 and 9007199254740991
    and (r.inquiry_id is null or exists (select 1 from public.ech_records q where q.kind='inquiry'
      and q.id=r.inquiry_id and q.revision=r.inquiry_revision
      and q.data->>'status' in ('New','Contacted','Assessment booked','On hold')))
    and not exists (select 1 from public.ech_schedule_visit_sources s
      where r.inquiry_id is not null and s.inquiry_id=r.inquiry_id and s.client_id<>r.client_id)
$$;
revoke all on function public.ech_schedule_creation_source(uuid,text) from public, anon, authenticated;

commit;
