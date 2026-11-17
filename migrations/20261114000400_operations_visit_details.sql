-- Read-only visit details. Publication is private, with no application write path.
begin;

-- A visit revision identifies one schedule state for publication. Keep the
-- existing rows as the baseline; only new visits have to start at revision 1.
create function public.ech_schedule_guard_visit_revision()
returns trigger language plpgsql set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    if new.revision is distinct from 1 then
      raise sqlstate 'PT409' using message = 'New visits must start at revision 1';
    end if;
  elsif new.id is distinct from old.id or new.revision is distinct from old.revision + 1 then
    raise sqlstate 'PT409' using message = 'Visit changes must keep the ID and advance exactly one revision';
  end if;
  return new;
end;
$$;

create trigger ech_schedule_guard_visit_revision before insert or update on public.ech_schedule_visits
for each row execute function public.ech_schedule_guard_visit_revision();

-- Cancellation keeps the visit ID reserved. This draft does not define a
-- retention or purge process.
create trigger ech_schedule_keep_visit_identity before delete or truncate on public.ech_schedule_visits
for each statement execute function public.ech_schedule_keep_history();

create table public.ech_schedule_visit_details (
  id uuid primary key default gen_random_uuid(),
  visit_id uuid not null references public.ech_schedule_visits(id),
  visit_revision bigint not null check (visit_revision between 1 and 9007199254740991),
  field text not null check (field in ('address', 'unit', 'entry', 'preferences', 'contact')),
  detail text not null check (
    length(detail) between 1 and 500 and detail ~ '[^[:space:]]' and detail !~ '[[:cntrl:]]'
  ),
  contact_phone text check (contact_phone ~ '^\+[1-9][0-9]{6,14}$'),
  contact_purpose text,
  -- A null recipient authorizes management display only.
  staff_worker_id uuid references public.ech_schedule_workers(id),
  source_reference text not null check (
    length(source_reference) between 1 and 256 and source_reference ~ '[^[:space:]]'
    and source_reference !~ '[[:cntrl:]]'
  ),
  approved_by uuid not null references public.ech_memberships(user_id),
  approved_at timestamptz not null check (isfinite(approved_at)),
  revoked_at timestamptz check (isfinite(revoked_at) and revoked_at >= approved_at),
  check (case when field = 'contact' then contact_purpose is not distinct from 'visit_logistics'
    else contact_purpose is null and contact_phone is null end)
);

create unique index ech_schedule_visit_details_active_field
  on public.ech_schedule_visit_details (visit_id, visit_revision, field) where revoked_at is null;

create function public.ech_schedule_guard_visit_detail()
returns trigger language plpgsql set search_path = ''
as $$
declare
  visit public.ech_schedule_visits;
begin
  if tg_op = 'UPDATE' then
    if old.revoked_at is not null or new.revoked_at is null or new.revoked_at > clock_timestamp()
      or (to_jsonb(new) - 'revoked_at') is distinct from (to_jsonb(old) - 'revoked_at') then
      raise sqlstate 'PT409' using message = 'Only an active visit detail can be revoked';
    end if;
    return new;
  end if;

  select * into visit from public.ech_schedule_visits v where v.id = new.visit_id for share nowait;
  if not found or visit.revision <> new.visit_revision or visit.status in ('Cancelled', 'Completed')
    or (new.staff_worker_id is not null and new.staff_worker_id is distinct from visit.worker_id)
    or new.revoked_at is not null or new.approved_at > clock_timestamp() then
    raise sqlstate 'PT409' using message = 'Visit detail requires the current visit and recipient';
  end if;
  return new;
end;
$$;

create trigger ech_schedule_guard_visit_detail before insert or update on public.ech_schedule_visit_details
for each row execute function public.ech_schedule_guard_visit_detail();

-- Preserve publication history in this draft. A retention or purge procedure
-- requires a separate policy and implementation.
create trigger ech_schedule_keep_visit_detail_history before delete or truncate on public.ech_schedule_visit_details
for each statement execute function public.ech_schedule_keep_history();

alter table public.ech_schedule_visit_details enable row level security;
revoke all on public.ech_schedule_visit_details from public;
revoke all on function public.ech_schedule_guard_visit_detail(), public.ech_schedule_guard_visit_revision() from public;

create function public.ech_operations_visit_detail(
  p_visit_id uuid, p_expected_revision bigint, p_expected_role text, p_membership_revision bigint
)
returns jsonb language plpgsql volatile security definer set search_path = ''
as $$
declare
  actor uuid := auth.uid();
  session_claim text := auth.jwt()->>'session_id';
  identity_email text;
  identity_confirmed boolean;
  provider_expires timestamptz;
  app_session public.ech_sessions;
  request public.ech_access_requests;
  member public.ech_memberships;
  permission public.ech_operations_grants;
  visit public.ech_schedule_visits;
  fields jsonb := '{}'::jsonb;
  publication_revision bigint;
begin
  if p_visit_id is null or p_expected_revision is null or p_expected_revision not between 1 and 9007199254740991
    or p_membership_revision is null or p_membership_revision not between 1 and 9007199254740991
    or p_expected_role is null or p_expected_role not in ('owner', 'manager', 'staff') then
    raise sqlstate 'PT400' using message = 'Choose a current visit';
  end if;
  if actor is null or session_claim is null or session_claim !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    raise sqlstate 'PT403' using message = 'Visit details are unavailable';
  end if;
  if current_setting('transaction_isolation') <> 'read committed' or public.ech_session_active() is not true then
    raise sqlstate 'PT403' using message = 'Visit details are unavailable';
  end if;

  -- Use the same order as scheduling and access writers. NOWAIT on row locks
  -- avoids waiting behind provider refresh or revocation with a different order.
  if not pg_try_advisory_xact_lock_shared(617243902117::bigint) then
    raise sqlstate 'PT503' using message = 'Visit access is changing';
  end if;
  select lower(u.email), u.email_confirmed_at is not null into identity_email, identity_confirmed
  from auth.users u where u.id = actor and u.deleted_at is null and u.is_anonymous is not true
    and (u.banned_until is null or u.banned_until <= clock_timestamp()) for share nowait;
  if not found then raise sqlstate 'PT403' using message = 'Visit details are unavailable'; end if;

  select s.not_after into provider_expires from auth.sessions s
  where s.id = session_claim::uuid and s.user_id = actor for share nowait;
  if not found then raise sqlstate 'PT403' using message = 'Visit details are unavailable'; end if;

  select * into app_session from public.ech_sessions s
  where s.session_id = session_claim::uuid and s.user_id = actor for share nowait;
  if not found then raise sqlstate 'PT403' using message = 'Visit details are unavailable'; end if;

  -- The advisory lock also covers creation when no request row exists to lock.
  select * into request from public.ech_access_requests r where r.user_id = actor for share nowait;
  select * into member from public.ech_memberships m where m.user_id = actor and m.active for share nowait;
  if not found then raise sqlstate 'PT403' using message = 'Visit details are unavailable'; end if;
  if request.user_id is not null and (
      request.state <> 'approved' or request.approved_role is distinct from member.operational_role
      or member.application_admin or member.technical_admin or identity_confirmed is not true
      or identity_email is distinct from request.email
    ) then
    raise sqlstate 'PT403' using message = 'Visit details are unavailable';
  end if;
  if member.operational_role is distinct from p_expected_role or member.revision is distinct from p_membership_revision then
    raise sqlstate 'PT409' using message = 'Visit access is changing';
  end if;

  select * into permission from public.ech_operations_grants g
  where g.user_id = actor and g.active and g.membership_revision = member.revision for share nowait;
  if not found or (p_expected_role = 'staff' and (permission.access_level <> 'staff' or permission.worker_id is null))
    or (p_expected_role <> 'staff' and permission.access_level <> 'manager') then
    raise sqlstate 'PT403' using message = 'Visit details are unavailable';
  end if;
  if p_expected_role = 'staff' then
    perform 1 from public.ech_schedule_workers w where w.id = permission.worker_id and w.user_id = actor for share nowait;
    if not found then raise sqlstate 'PT403' using message = 'Visit details are unavailable'; end if;
  end if;

  select * into visit from public.ech_schedule_visits v where v.id = p_visit_id
    and (p_expected_role <> 'staff' or (v.worker_id = permission.worker_id and v.status <> 'Cancelled')) for share nowait;
  if not found then raise sqlstate 'PT403' using message = 'Visit details are unavailable'; end if;
  if visit.revision <> p_expected_revision then
    raise sqlstate 'PT412' using message = 'Visit changed; reload the schedule';
  end if;

  -- Historical dispatch visibility is unapproved. Schedule context remains
  -- available according to the calendar rights for completed/cancelled visits.
  if visit.status not in ('Cancelled', 'Completed') then
    publication_revision := visit.revision;
    -- A canonical start changes only status/revision, not the purpose,
    -- assignment or logistics. Keep the original publication and its approval
    -- untouched; the immutable start event is the explicit provenance linking
    -- it to this current in-progress state. No arbitrary revision, reassignment,
    -- reschedule or completed-visit history inherits this access.
    if visit.status = 'In progress' then
      select (e.previous_visit->>'revision')::bigint into publication_revision
      from public.ech_schedule_events e
      where e.visit_id = visit.id and e.revision = visit.revision and e.action = 'start'
        and e.next_visit = public.ech_schedule_visit_snapshot(visit)
        and e.previous_visit->>'status' = 'Confirmed'
        and (e.previous_visit->>'revision')::bigint = visit.revision - 1
        and (e.previous_visit - array['status','revision']) = (e.next_visit - array['status','revision']);
      publication_revision := coalesce(publication_revision, visit.revision);
    end if;
    select coalesce(jsonb_object_agg(d.field, case when d.field = 'contact'
      then jsonb_build_object('name', d.detail, 'phone', d.contact_phone, 'purpose', d.contact_purpose)
      else to_jsonb(d.detail) end), '{}'::jsonb)
    into fields
    from (
      select distinct on (field) field, detail, contact_phone, contact_purpose, revoked_at, staff_worker_id
      from (
        select * from public.ech_schedule_visit_details
        where visit_id = visit.id and visit_revision in (visit.revision, publication_revision)
          and approved_at <= clock_timestamp()
        for share nowait
      ) publication order by field, visit_revision desc, (revoked_at is null) desc, approved_at desc, id
    ) d where d.revoked_at is null
      and (p_expected_role <> 'staff' or d.staff_worker_id = permission.worker_id);
  end if;

  if app_session.revoked_at is not null or app_session.expires_at <= clock_timestamp()
    or app_session.created_at + interval '7 days' <= clock_timestamp()
    or provider_expires <= clock_timestamp() or public.ech_session_active() is not true then
    raise sqlstate 'PT403' using message = 'Visit details are unavailable';
  end if;

  return jsonb_build_object('visitId', visit.id, 'revision', visit.revision, 'fields', fields,
    'contactAuthority', 'unknown', 'allergyStatus', 'unknown');
exception when lock_not_available then
  raise sqlstate 'PT503' using message = 'Visit access is changing';
end;
$$;

revoke all on function public.ech_operations_visit_detail(uuid, bigint, text, bigint) from public;

-- Provider default privileges may include API roles other than authenticated.
do $$
declare recipient record;
begin
  for recipient in
    select distinct r.rolname
    from pg_catalog.pg_class c cross join lateral pg_catalog.aclexplode(c.relacl) a
    join pg_catalog.pg_roles r on r.oid = a.grantee
    where c.oid = 'public.ech_schedule_visit_details'::regclass and a.grantee <> c.relowner
  loop
    execute format('revoke all on public.ech_schedule_visit_details from %I', recipient.rolname);
  end loop;
  for recipient in
    select distinct p.oid::regprocedure as signature, r.rolname
    from pg_catalog.pg_proc p cross join lateral pg_catalog.aclexplode(p.proacl) a
    join pg_catalog.pg_roles r on r.oid = a.grantee
    where p.oid in ('public.ech_operations_visit_detail(uuid,bigint,text,bigint)'::regprocedure,
      'public.ech_schedule_guard_visit_detail()'::regprocedure,
      'public.ech_schedule_guard_visit_revision()'::regprocedure) and a.grantee <> p.proowner
  loop
    execute format('revoke all on function %s from %I', recipient.signature, recipient.rolname);
  end loop;
end;
$$;

grant execute on function public.ech_operations_visit_detail(uuid, bigint, text, bigint) to authenticated;
commit;
