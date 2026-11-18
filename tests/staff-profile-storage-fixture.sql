create role anon;create role authenticated;create role service_role;
create schema auth;
create function auth.uid() returns uuid language sql stable as $$select current_setting('fixture.actor')::uuid$$;
create table public.ech_memberships(user_id uuid primary key,display_name text,active boolean,operational_role text,application_admin boolean,technical_admin boolean,delegated_user_admin boolean);
create function public.ech_session_active() returns boolean language sql stable as $$select true$$;
create function public.ech_managed_account(public.ech_memberships) returns boolean language sql stable as $$select true$$;
insert into public.ech_memberships values('11111111-1111-4111-8111-111111111111','Fictional staff',true,'staff',false,false,false),('22222222-2222-4222-8222-222222222222','Fictional manager',true,'manager',true,false,false);
\i migrations/20261118091000_staff_profile_store.sql
set fixture.actor='22222222-2222-4222-8222-222222222222';
select ech_staff_profile_store_write('11111111-1111-4111-8111-111111111111',0,'initialized',null);
set fixture.actor='11111111-1111-4111-8111-111111111111';
select ech_staff_profile_store_write('11111111-1111-4111-8111-111111111111',1,'submitted','{"availability":"Monday","credentials":[{"id":"first-aid","name":"First aid","expiresOn":null}]}','33333333-3333-4333-8333-333333333333');
set fixture.actor='22222222-2222-4222-8222-222222222222';
select ech_staff_profile_store_write('11111111-1111-4111-8111-111111111111',2,'approved',null,'33333333-3333-4333-8333-333333333333');
select ech_staff_profile_store_write('11111111-1111-4111-8111-111111111111',3,'credential_verified',null,null,'first-aid');
set fixture.actor='11111111-1111-4111-8111-111111111111';
select ech_staff_profile_store_write('11111111-1111-4111-8111-111111111111',4,'submitted','{"credentials":[{"id":"first-aid","name":"First aid","expiresOn":null},{"id":"rn","name":"RN registration","expiresOn":"2027-01-01"}]}','44444444-4444-4444-8444-444444444444');
set fixture.actor='22222222-2222-4222-8222-222222222222';
select ech_staff_profile_store_write('11111111-1111-4111-8111-111111111111',5,'approved',null,'44444444-4444-4444-8444-444444444444');
do $$begin
 if (select public_fields#>>'{credentials,0,verifiedBy}' from ech_staff_profiles)<>'22222222-2222-4222-8222-222222222222' then raise exception 'Lost unchanged verification';end if;
 if (select public_fields->>'availability' from ech_staff_profiles)<>'Monday' then raise exception 'Lost saved availability';end if;
 if exists(select from ech_staff_profile_pending) then raise exception 'Pending not cleared';end if;
end$$;
select 'staff profile storage workflow passed' as result;
