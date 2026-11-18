\set ON_ERROR_STOP 1
create role anon;
create role authenticated;
create role service_role;
create schema auth;
create function auth.uid() returns uuid language sql stable as $$select current_setting('fixture.actor')::uuid$$;
create function auth.jwt() returns jsonb language sql stable as $$select jsonb_build_object('session_id',current_setting('fixture.actor'))$$;
create table auth.sessions(id uuid primary key,user_id uuid,not_after timestamptz);
create table ech_sessions(session_id uuid primary key,user_id uuid,revoked_at timestamptz,expires_at timestamptz,created_at timestamptz);
create function public.ech_session_active() returns boolean language sql stable as $$select true$$;
create table public.ech_memberships(user_id uuid primary key,operational_role text,revision bigint);
create table public.ech_schedule_workers(id uuid primary key,user_id uuid);
create table public.ech_schedule_visits(id uuid primary key,worker_id uuid,status text,revision bigint);
create function public.ech_schedule_lock_access(actor uuid,worker uuid) returns text language sql as $$
  select case when m.operational_role='manager' then 'manager' when m.operational_role='staff' and
     (worker is null or exists(select from public.ech_schedule_workers w where w.id=worker and w.user_id=actor)) then 'staff' end
  from public.ech_memberships m where m.user_id=actor
$$;
insert into ech_memberships values
 ('11111111-1111-4111-8111-111111111111','staff',1),
 ('22222222-2222-4222-8222-222222222222','manager',1),
 ('33333333-3333-4333-8333-333333333333','staff',1);
insert into auth.sessions select user_id,user_id,null from ech_memberships;
insert into ech_sessions select user_id,user_id,null,now()+interval '1 hour',now() from ech_memberships;
insert into ech_schedule_workers values ('44444444-4444-4444-8444-444444444444','11111111-1111-4111-8111-111111111111');
insert into ech_schedule_visits values ('55555555-5555-4555-8555-555555555555','44444444-4444-4444-8444-444444444444','Confirmed',1);
\i migrations/20261118221000_operations_visit_attendance.sql
do $$
declare
  fictional_visit constant uuid := '55555555-5555-4555-8555-555555555555';
  arrived jsonb;
  checked_out jsonb;
begin
  perform set_config('fixture.actor','11111111-1111-4111-8111-111111111111',true);
  if ech_operations_visit_attendance(fictional_visit,1,'staff',1,'read')->>'checkInAt' is not null then
    raise exception 'New visit falsely showed check-in';
  end if;
  arrived:=ech_operations_visit_attendance(fictional_visit,1,'staff',1,'check_in');
  if arrived->>'checkInAt' is null or arrived->>'checkInAt' is distinct from
    ech_operations_visit_attendance(fictional_visit,1,'staff',1,'check_in')->>'checkInAt' then
    raise exception 'Check-in was not persisted and retained';
  end if;
  checked_out:=ech_operations_visit_attendance(fictional_visit,1,'staff',1,'check_out');
  if checked_out->>'checkOutAt' is null then raise exception 'Missing checkout';end if;
  perform set_config('fixture.actor','22222222-2222-4222-8222-222222222222',true);
  if ech_operations_visit_attendance(fictional_visit,1,'manager',1,'read')->>'checkOutAt'
    is distinct from checked_out->>'checkOutAt' then
    raise exception 'Manager could not read saved checkout';
  end if;
  perform set_config('fixture.actor','33333333-3333-4333-8333-333333333333',true);
  begin
    perform ech_operations_visit_attendance(fictional_visit,1,'staff',1,'read');
    raise exception 'Unassigned staff received attendance';
  exception when sqlstate 'PT403' then null;
  end;
  if has_function_privilege('authenticated','public.ech_operations_visit_attendance(uuid,bigint,text,bigint,text)','EXECUTE') then
    raise exception 'Source migration granted hosted execution';
  end if;
end $$;
select 'fictional attendance workflow passed' as result;
