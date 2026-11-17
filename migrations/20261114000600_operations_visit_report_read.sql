-- Draft read-only report projection. Apply after the report event schema.
-- Report submission, correction and review RPC privileges remain disabled.
begin;

create function public.ech_operations_visit_report(
  p_visit_id uuid, p_expected_visit_revision bigint, p_expected_role text, p_membership_revision bigint,
  p_expected_report_revision bigint default null
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
  original public.ech_visit_report_events;
  stream_revision bigint := 0;
  result jsonb;
begin
  if p_visit_id is null or p_expected_visit_revision is null or p_expected_visit_revision not between 1 and 9007199254740991
    or p_membership_revision is null or p_membership_revision not between 1 and 9007199254740991
    or p_expected_role is null or p_expected_role not in ('owner', 'manager', 'staff') then
    raise sqlstate 'PT400' using message = 'Choose a current visit';
  end if;
  if actor is null or auth.jwt()->>'sub' is distinct from actor::text or session_claim is null or session_claim !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    raise sqlstate 'PT403' using message = 'Visit reports are unavailable';
  end if;
  if coalesce(auth.jwt()->>'exp', '') !~ '^[0-9]{1,15}$' then
    raise sqlstate 'PT403' using message = 'Visit reports are unavailable';
  end if;
  if (auth.jwt()->>'exp')::bigint <= extract(epoch from clock_timestamp())
    or current_setting('transaction_isolation') <> 'read committed' or public.ech_session_active() is not true then
    raise sqlstate 'PT403' using message = 'Visit reports are unavailable';
  end if;

  -- Use the same order as scheduling and access writers. NOWAIT on row locks
  -- avoids waiting behind provider refresh or revocation with a different order.
  if not pg_try_advisory_xact_lock_shared(617243902117::bigint) then
    raise sqlstate 'PT503' using message = 'Visit report access is changing';
  end if;
  select lower(u.email), u.email_confirmed_at is not null into identity_email, identity_confirmed
  from auth.users u where u.id = actor and u.deleted_at is null and u.is_anonymous is not true
    and (u.banned_until is null or u.banned_until <= clock_timestamp()) for share nowait;
  if not found then raise sqlstate 'PT403' using message = 'Visit reports are unavailable'; end if;

  select s.not_after into provider_expires from auth.sessions s
  where s.id = session_claim::uuid and s.user_id = actor for share nowait;
  if not found then raise sqlstate 'PT403' using message = 'Visit reports are unavailable'; end if;

  select * into app_session from public.ech_sessions s
  where s.session_id = session_claim::uuid and s.user_id = actor for share nowait;
  if not found then raise sqlstate 'PT403' using message = 'Visit reports are unavailable'; end if;

  -- The advisory lock also covers creation when no request row exists to lock.
  select * into request from public.ech_access_requests r where r.user_id = actor for share nowait;
  select * into member from public.ech_memberships m where m.user_id = actor and m.active for share nowait;
  if not found then raise sqlstate 'PT403' using message = 'Visit reports are unavailable'; end if;
  if request.user_id is not null and (
      request.state <> 'approved' or request.approved_role is distinct from member.operational_role
      or member.application_admin or member.technical_admin or identity_confirmed is not true
      or identity_email is distinct from request.email
    ) then
    raise sqlstate 'PT403' using message = 'Visit reports are unavailable';
  end if;
  if member.operational_role is distinct from p_expected_role or member.revision is distinct from p_membership_revision then
    raise sqlstate 'PT409' using message = 'Visit report access is changing';
  end if;

  select * into permission from public.ech_operations_grants g
  where g.user_id = actor and g.active and g.membership_revision = member.revision for share nowait;
  if not found or (p_expected_role = 'staff' and (permission.access_level <> 'staff' or permission.worker_id is null))
    or (p_expected_role <> 'staff' and permission.access_level <> 'manager') then
    raise sqlstate 'PT403' using message = 'Visit reports are unavailable';
  end if;
  if p_expected_role = 'staff' then
    perform 1 from public.ech_schedule_workers w where w.id = permission.worker_id and w.user_id = actor for share nowait;
    if not found then raise sqlstate 'PT403' using message = 'Visit reports are unavailable'; end if;
  end if;

  select * into visit from public.ech_schedule_visits v where v.id = p_visit_id
    and v.service = 'Home support' and v.status in ('In progress', 'Completed')
    and (p_expected_role <> 'staff' or v.worker_id = permission.worker_id) for share nowait;
  if not found then raise sqlstate 'PT403' using message = 'Visit reports are unavailable'; end if;
  if visit.revision <> p_expected_visit_revision then
    raise sqlstate 'PT412' using message = 'Visit changed; reload the schedule';
  end if;


  if p_expected_report_revision is not null and p_expected_report_revision not between 0 and 9007199254740991 then
    raise sqlstate 'PT400' using message = 'Choose a current report revision';
  end if;
  -- Current authority is checked separately from private canonical serialization.
  select * into original from public.ech_visit_report_events e
    where e.visit_id = visit.id and e.report_revision = 1 for share nowait;
  if original.visit_id is not null and p_expected_role = 'staff' and original.actor_id <> actor then
    raise sqlstate 'PT403' using message = 'Visit reports are unavailable';
  end if;
  result := public.ech_visit_report_projection(visit);
  stream_revision := (result->>'reportRevision')::bigint;
  if p_expected_report_revision is not null and stream_revision <> p_expected_report_revision then
    raise sqlstate 'PT412' using message = 'Visit report changed; reload the report';
  end if;
  if app_session.revoked_at is not null or app_session.expires_at <= clock_timestamp()
    or app_session.created_at + interval '7 days' <= clock_timestamp()
    or provider_expires <= clock_timestamp() or (auth.jwt()->>'exp')::bigint <= extract(epoch from clock_timestamp())
    or public.ech_session_active() is not true then
    raise sqlstate 'PT403' using message = 'Visit reports are unavailable';
  end if;
  return result;
exception when lock_not_available then
  raise sqlstate 'PT503' using message = 'Visit report access is changing';
end;
$$;

revoke all on function public.ech_operations_visit_report(uuid, bigint, text, bigint, bigint) from public;
do $$
declare recipient record;
begin
  for recipient in
    select distinct r.rolname from pg_catalog.pg_proc p
    cross join lateral pg_catalog.aclexplode(p.proacl) a
    join pg_catalog.pg_roles r on r.oid = a.grantee
    where p.oid = 'public.ech_operations_visit_report(uuid,bigint,text,bigint,bigint)'::regprocedure and a.grantee <> p.proowner
  loop
    execute format('revoke all on function public.ech_operations_visit_report(uuid,bigint,text,bigint,bigint) from %I', recipient.rolname);
  end loop;
end;
$$;
grant execute on function public.ech_operations_visit_report(uuid, bigint, text, bigint, bigint) to authenticated;
commit;
