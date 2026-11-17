-- Draft read foundation. Install only after the canonical ECH session migrations.
-- Does not provision identities, grant Operations access, or provide a write API.
begin;

create table public.ech_schedule_clients (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(name) <= 160 and length(btrim(name)) between 1 and 160 and name !~ '[[:cntrl:]]')
);

create table public.ech_schedule_workers (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(name) <= 160 and length(btrim(name)) between 1 and 160 and name !~ '[[:cntrl:]]'),
  user_id uuid unique references public.ech_memberships(user_id),
  unique (id, user_id)
);

create table public.ech_operations_grants (
  user_id uuid primary key references public.ech_memberships(user_id),
  membership_revision bigint not null check (membership_revision between 1 and 9007199254740991),
  access_level text not null check (access_level in ('manager', 'staff')),
  worker_id uuid,
  active boolean not null default false,
  check (access_level <> 'staff' or worker_id is not null),
  foreign key (worker_id, user_id) references public.ech_schedule_workers(id, user_id)
);

create table public.ech_schedule_visits (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.ech_schedule_clients(id),
  worker_id uuid references public.ech_schedule_workers(id),
  service text not null check (service in ('Home support', 'Nursing')),
  starts_at timestamptz(3) not null,
  ends_at timestamptz(3) not null,
  status text not null check (status in ('Open', 'Assigned', 'Confirmed', 'In progress', 'Completed', 'Cancelled')),
  revision bigint not null default 1 check (revision between 1 and 9007199254740991),
  check (starts_at >= timestamptz '0001-01-01 00:00:00+00' and ends_at < timestamptz '10000-01-01 00:00:00+00' and starts_at < ends_at),
  check (status = 'Cancelled' or (status = 'Open') = (worker_id is null))
);

-- A worker row represents one person; reusing it must never transfer visits.
create function public.ech_schedule_worker_identity_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.user_id is distinct from old.user_id and (old.user_id is not null or
    exists(select 1 from public.ech_schedule_visits v where v.worker_id=old.id)) then
    raise sqlstate 'PT409' using message='Create a separate worker record for a different identity';
  end if;
  return new;
end;
$$;
create trigger ech_schedule_worker_identity_immutable before update of user_id on public.ech_schedule_workers
for each row execute function public.ech_schedule_worker_identity_guard();
revoke all on function public.ech_schedule_worker_identity_guard() from public, anon, authenticated;

create index ech_schedule_visits_start_idx on public.ech_schedule_visits(starts_at, id);
create index ech_schedule_visits_worker_start_idx on public.ech_schedule_visits(worker_id, starts_at, id)
  where status <> 'Cancelled';

alter table public.ech_schedule_clients enable row level security;
alter table public.ech_schedule_workers enable row level security;
alter table public.ech_operations_grants enable row level security;
alter table public.ech_schedule_visits enable row level security;
revoke all on public.ech_schedule_clients, public.ech_schedule_workers,
  public.ech_operations_grants, public.ech_schedule_visits from public, anon, authenticated;

create function public.ech_operations_schedule(p_from timestamptz, p_to timestamptz, p_expected_role text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  actor uuid := auth.uid();
  provider_session text := auth.jwt()->>'session_id';
  actual_role text;
  access text;
  actor_worker uuid;
  visit_count bigint;
  worker_count bigint;
  calendar jsonb;
begin
  if actor is null or provider_session is null or provider_session !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    or public.ech_session_active() is not true or not exists (
      select 1 from auth.sessions s join auth.users u on u.id=s.user_id
      where s.id=provider_session::uuid and s.user_id=actor
        and (s.not_after is null or s.not_after>statement_timestamp())
        and (u.banned_until is null or u.banned_until<=statement_timestamp())
        and u.deleted_at is null and u.is_anonymous is not true
    ) then
    raise sqlstate 'PT403' using message = 'Operations schedule access denied';
  end if;

  -- This stable function uses one snapshot for the current role, grant and schedule rows.
  select m.operational_role, g.access_level, w.id into actual_role, access, actor_worker
  from public.ech_memberships m
  left join public.ech_operations_grants g on g.user_id = m.user_id
    and g.membership_revision = m.revision and g.active
  left join public.ech_schedule_workers w on w.id = g.worker_id and w.user_id = m.user_id
  where m.user_id = actor and m.active;

  if not found then
    raise sqlstate 'PT403' using message = 'Operations schedule access denied';
  end if;
  if actual_role is distinct from p_expected_role then
    raise sqlstate 'PT409' using message = 'Account access changed. Reload the workspace.';
  end if;
  if not coalesce((actual_role in ('owner', 'manager') and access = 'manager')
    or (actual_role = 'staff' and access = 'staff' and actor_worker is not null), false) then
    raise sqlstate 'PT403' using message = 'Operations schedule access denied';
  end if;

  if p_from is null or p_to is null or p_from >= p_to
    or p_from < timestamptz '0001-01-01 00:00:00+00' or p_to > timestamptz '10000-01-01 00:00:00+00' then
    raise sqlstate 'PT400' using message = 'Choose a valid schedule window';
  end if;
  -- A 42-day local calendar may span an extra hour at the end of daylight saving time.
  if p_to - p_from > interval '1032 hours' then
    raise sqlstate 'PT400' using message = 'Choose a schedule window of at most 43 days';
  end if;

  -- Read the half-open window. One extra matching row detects overflow without returning a partial result.
  with visible_visits as materialized (
    select v.id, v.client_id, v.worker_id, v.service, v.starts_at, v.ends_at, v.status, v.revision
    from public.ech_schedule_visits v
    where v.starts_at < p_to and v.ends_at > p_from
      and (access = 'manager' or (v.worker_id = actor_worker and v.status <> 'Cancelled'))
    order by v.starts_at, v.id
    limit 1001
  ), visible_workers as materialized (
    -- Include the current eligible staff roster, plus identities needed to label
    -- visible visits after membership, grant or assignment eligibility changes.
    select w.id, w.name from public.ech_schedule_workers w
    where (access = 'staff' and w.id = actor_worker)
      or (access = 'manager' and (
        exists (select 1 from visible_visits related where related.worker_id = w.id)
        or exists (
          select 1 from public.ech_memberships m
          join public.ech_operations_grants g on g.user_id = m.user_id
            and g.membership_revision = m.revision and g.active
            and g.access_level = 'staff' and g.worker_id = w.id
          where m.user_id = w.user_id and m.active and m.operational_role = 'staff'
        )
      ))
    order by w.id
    limit 1002
  )
  select count(*), (select count(*) from visible_workers), jsonb_build_object(
    'visits', coalesce(jsonb_agg(jsonb_build_object(
      'id', v.id, 'clientId', v.client_id, 'workerId', v.worker_id, 'service', v.service,
      'start', to_char(v.starts_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
      'end', to_char(v.ends_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'), 'status', v.status, 'revision', v.revision
    ) order by v.starts_at, v.id), '[]'::jsonb),
    'clients', coalesce((
      select jsonb_agg(jsonb_build_object('id', c.id, 'name', c.name) order by c.id)
      from public.ech_schedule_clients c
      join (select distinct client_id from visible_visits) related on related.client_id = c.id
    ), '[]'::jsonb),
    'staff', coalesce((
      select jsonb_agg(jsonb_build_object('id', w.id, 'name', w.name) order by w.id)
      from visible_workers w
    ), '[]'::jsonb)
  ) into visit_count, worker_count, calendar
  from visible_visits v;

  if visit_count > 1000 then
    raise sqlstate 'PT413' using message = 'Schedule window has too many visits; choose a shorter window';
  end if;
  if worker_count > 1001 then
    raise sqlstate 'PT503' using message = 'Schedule staff roster exceeds the supported limit';
  end if;
  return calendar;
end;
$$;

revoke all on function public.ech_operations_schedule(timestamptz, timestamptz, text) from public, anon, authenticated;
-- Remove any explicit default grants on these new objects before granting the RPC.
do $$
declare recipient record;
begin
  for recipient in
    select distinct n.nspname, c.relname, r.rolname
    from pg_catalog.pg_class c
    join pg_catalog.pg_namespace n on n.oid=c.relnamespace
    cross join lateral pg_catalog.aclexplode(coalesce(c.relacl,pg_catalog.acldefault('r',c.relowner))) a
    join pg_catalog.pg_roles r on r.oid=a.grantee
    where n.nspname='public' and c.relname in ('ech_schedule_clients','ech_schedule_workers','ech_operations_grants','ech_schedule_visits')
      and a.grantee<>c.relowner
  loop
    execute pg_catalog.format('revoke all privileges on table %I.%I from %I',recipient.nspname,recipient.relname,recipient.rolname);
  end loop;
  for recipient in
    select distinct p.oid::regprocedure as signature, r.rolname
    from pg_catalog.pg_proc p
    cross join lateral pg_catalog.aclexplode(coalesce(p.proacl,pg_catalog.acldefault('f',p.proowner))) a
    join pg_catalog.pg_roles r on r.oid=a.grantee
    where p.oid in ('public.ech_operations_schedule(timestamptz,timestamptz,text)'::regprocedure,'public.ech_schedule_worker_identity_guard()'::regprocedure) and a.grantee<>p.proowner
  loop
    execute pg_catalog.format('revoke all privileges on function %s from %I',recipient.signature,recipient.rolname);
  end loop;
end;
$$;
grant execute on function public.ech_operations_schedule(timestamptz, timestamptz, text) to authenticated;

commit;
