-- Source-only attendance recording, separate from schedules, reports and pay.
-- No application or hosted role is granted execution by this migration.
begin;

create table public.ech_visit_attendance (
  visit_id uuid not null references public.ech_schedule_visits(id),
  worker_id uuid not null references public.ech_schedule_workers(id),
  check_in_at timestamptz(3) not null check (isfinite(check_in_at)),
  check_out_at timestamptz(3) check (isfinite(check_out_at) and check_out_at >= check_in_at),
  primary key (visit_id, worker_id)
);
alter table public.ech_visit_attendance enable row level security;
revoke all on public.ech_visit_attendance from public, anon, authenticated, service_role;

create function public.ech_operations_visit_attendance(
  p_visit_id uuid, p_revision bigint, p_role text, p_membership_revision bigint, p_action text
) returns jsonb language plpgsql volatile security definer set search_path = ''
as $$
declare
  actor uuid := auth.uid();
  session_claim text := auth.jwt()->>'session_id';
  session public.ech_sessions;
  v public.ech_schedule_visits;
  a public.ech_visit_attendance;
  access text;
  observed_at timestamptz(3);
begin
  if actor is null or session_claim is null
    or session_claim !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    or public.ech_session_active() is not true then
    raise sqlstate 'PT403' using message='Attendance access denied';
  end if;
  if p_action is null or p_action not in ('read', 'check_in', 'check_out')
      or p_visit_id is null or p_revision is null or p_revision < 1 then
    raise sqlstate 'PT400' using message='Choose a current visit and attendance action';
  end if;
  perform pg_advisory_xact_lock(617243902117::bigint);
  perform 1 from auth.sessions s where s.id=session_claim::uuid and s.user_id=actor
    and (s.not_after is null or s.not_after>clock_timestamp()) for share nowait;
  if not found then
    raise sqlstate 'PT403' using message='Attendance access denied';
  end if;
  select * into session from public.ech_sessions s
    where s.session_id=session_claim::uuid and s.user_id=actor for share;
  if not found or session.revoked_at is not null or session.expires_at<=clock_timestamp()
    or session.created_at+interval '7 days'<=clock_timestamp() then
    raise sqlstate 'PT403' using message='Attendance access denied';
  end if;
  access := public.ech_schedule_lock_access(actor, null);
  if access is null or public.ech_session_active() is not true or not exists (
    select from public.ech_memberships m where m.user_id=actor
      and m.operational_role=p_role and m.revision=p_membership_revision
  ) then
    raise sqlstate 'PT403' using message='Attendance access denied';
  end if;
  select * into v from public.ech_schedule_visits s where s.id=p_visit_id for share;
  if not found or (access='staff' and (
    v.worker_id is null or public.ech_schedule_lock_access(actor,v.worker_id) is distinct from 'staff'
  )) or (p_action<>'read' and access<>'staff') then
    raise sqlstate 'PT403' using message='Attendance access denied';
  end if;
  if v.revision is distinct from p_revision then
    raise sqlstate 'PT412' using message='Reload the current visit';
  end if;
  select * into a from public.ech_visit_attendance r
    where r.visit_id=v.id and r.worker_id=v.worker_id;
  observed_at := clock_timestamp();
  if p_action='check_in' and a.visit_id is null then
    if v.status not in ('Confirmed','In progress') then
      raise sqlstate 'PT409' using message='A confirmed visit is needed for check-in';
    end if;
    insert into public.ech_visit_attendance (visit_id,worker_id,check_in_at)
      values (v.id,v.worker_id,observed_at) returning * into a;
  elsif p_action='check_out' and a.check_out_at is null then
    if a.visit_id is null or v.status not in ('Confirmed','In progress','Completed') then
      raise sqlstate 'PT409' using message='Record check-in before checking out';
    end if;
    update public.ech_visit_attendance r set check_out_at=greatest(observed_at,a.check_in_at)
      where r.visit_id=v.id and r.worker_id=v.worker_id returning * into a;
  end if;
  return jsonb_build_object(
    'visitId', v.id, 'revision', v.revision,
    'observedAt', to_char(observed_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'checkInAt', to_char(a.check_in_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'checkOutAt', to_char(a.check_out_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
  );
end;
$$;
revoke all on function public.ech_operations_visit_attendance(uuid,bigint,text,bigint,text)
  from public, anon, authenticated, service_role;
commit;
