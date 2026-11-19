create role anon;create role authenticated;create role service_role bypassrls;
create schema auth;
create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('fixture.actor',true),'')::uuid$$;
create table public.ech_memberships(user_id uuid primary key,display_name text,active boolean,operational_role text,application_admin boolean,technical_admin boolean,delegated_user_admin boolean);
create function public.ech_session_active() returns boolean language sql stable security definer set search_path='' as $$select auth.uid() is not null and current_setting('fixture.session_active',true)='on'$$;
create function public.ech_managed_account(m public.ech_memberships) returns boolean language sql immutable set search_path='' as $$select m.user_id<>'77777777-7777-4777-8777-777777777777' and coalesce(m.operational_role in ('staff','manager'),false) and not m.application_admin and not m.technical_admin$$;
insert into public.ech_memberships values('11111111-1111-4111-8111-111111111111','Fictional staff',true,'staff',false,false,false),('22222222-2222-4222-8222-222222222222','Fictional manager',true,'manager',true,false,false);
\i migrations/20261118091000_staff_profile_store.sql
\i migrations/20261119000100_staff_profile_authenticated_boundary.sql
set fixture.session_active='on';
set role authenticated;
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
reset role;
do $$begin
 if (select public_fields#>>'{credentials,0,verifiedBy}' from ech_staff_profiles) IS DISTINCT FROM '22222222-2222-4222-8222-222222222222' then raise exception 'Lost unchanged verification';end if;
 if (select public_fields->>'availability' from ech_staff_profiles) IS DISTINCT FROM 'Monday' then raise exception 'Lost saved availability';end if;
 if exists(select from ech_staff_profile_pending) then raise exception 'Pending not cleared';end if;
end$$;

insert into public.ech_memberships values
 ('55555555-5555-4555-8555-555555555555','Other fictional staff',true,'staff',false,false,false),
 ('66666666-6666-4666-8666-666666666666','Fictional delegated manager',true,'manager',false,false,true),
 ('77777777-7777-4777-8777-777777777777','Fictional scoped-out staff',true,'staff',false,false,false),
 ('88888888-8888-4888-8888-888888888888','Fictional manager without account authority',true,'manager',false,false,false),
 ('99999999-9999-4999-8999-999999999999','Fictional inactive staff',false,'staff',false,false,false),
 ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','Fictional protected staff',true,'staff',true,false,false);

set role authenticated;
set fixture.actor='22222222-2222-4222-8222-222222222222';
select public.ech_staff_profile_store_write('11111111-1111-4111-8111-111111111111',6,'admin_saved','{"payGrade":"management-fixture"}');

set fixture.actor='66666666-6666-4666-8666-666666666666';
do $$
declare v jsonb;
begin
 v:=public.ech_staff_profile_store_read('11111111-1111-4111-8111-111111111111');
 if v#>>'{profile,payGrade}' is distinct from 'management-fixture' then raise exception 'Scoped management field missing';end if;
 begin perform public.ech_staff_profile_store_read('77777777-7777-4777-8777-777777777777');raise exception 'Out of scope profile read';exception when sqlstate 'PT403' then null;end;
 begin perform public.ech_staff_profile_store_write('77777777-7777-4777-8777-777777777777',0,'initialized',null);raise exception 'Out of scope profile write';exception when sqlstate 'PT403' then null;end;
 begin perform public.ech_staff_profile_store_read('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');raise exception 'Protected subject read';exception when sqlstate 'PT403' then null;end;
 begin perform public.ech_staff_profile_store_read('99999999-9999-4999-8999-999999999999');raise exception 'Inactive subject read';exception when sqlstate 'PT403' then null;end;
end;
$$;
select public.ech_staff_profile_store_write('11111111-1111-4111-8111-111111111111',7,'admin_saved','{"availability":"Tuesday"}');

set fixture.actor='88888888-8888-4888-8888-888888888888';
do $$
begin
 begin perform public.ech_staff_profile_store_read('11111111-1111-4111-8111-111111111111');raise exception 'Plain manager gained profile read';exception when sqlstate 'PT403' then null;end;
 begin perform public.ech_staff_profile_store_write('11111111-1111-4111-8111-111111111111',8,'admin_saved','{"availability":"Bad"}');raise exception 'Plain manager gained profile write';exception when sqlstate 'PT403' then null;end;
end;
$$;

set fixture.actor='55555555-5555-4555-8555-555555555555';
do $$
begin
 begin perform public.ech_staff_profile_store_read('11111111-1111-4111-8111-111111111111');raise exception 'Staff read another profile';exception when sqlstate 'PT403' then null;end;
 begin perform public.ech_staff_profile_store_write('11111111-1111-4111-8111-111111111111',8,'submitted','{"availability":"Bad"}','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb');raise exception 'Staff submitted for another profile';exception when sqlstate 'PT403' then null;end;
end;
$$;

set fixture.actor='11111111-1111-4111-8111-111111111111';
do $$
declare v jsonb;bad jsonb;
begin
 v:=public.ech_staff_profile_store_read('11111111-1111-4111-8111-111111111111');
 if v#>>'{profile,availability}' is distinct from 'Tuesday' or (v->'profile') ? 'payGrade' then raise exception 'Incorrect staff projection';end if;
 begin perform public.ech_staff_profile_store_write('11111111-1111-4111-8111-111111111111',8,'admin_saved','{"availability":"Bad"}');raise exception 'Staff saved directly';exception when sqlstate 'PT403' then null;end;
 begin perform public.ech_staff_profile_store_write('11111111-1111-4111-8111-111111111111',8,'submitted','{"payGrade":"Bad"}','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb');raise exception 'Staff set private field';exception when sqlstate 'PT400' then null;end;
 foreach bad in array array[
  '{"credentials":[{"id":"a","name":"Training","expiresOn":null,"extra":{"hidden":true}}]}'::jsonb,
  '{"credentials":[{"id":"a","name":"Training"}]}'::jsonb,
  '{"credentials":[{"id":"a","name":"Training","expiresOn":"2026-02-30"}]}'::jsonb,
  '{"credentials":[{"id":"a","name":"Training","expiresOn":null},{"id":"a","name":"Training","expiresOn":null}]}'::jsonb,
  '{"credentials":[{"id":"a","name":"Training","expiresOn":null,"verifiedBy":"forged"}]}'::jsonb,
  '{"photo":{"objectKey":"other/photo.jpg","contentType":"image/jpeg"}}'::jsonb,
  '{"photo":null}'::jsonb
 ] loop
  begin perform public.ech_staff_profile_store_write('11111111-1111-4111-8111-111111111111',8,'submitted',bad,'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb');raise exception 'Accepted invalid direct payload';exception when sqlstate 'PT400' then null;end;
 end loop;
 begin perform public.ech_staff_profile_store_read_private('11111111-1111-4111-8111-111111111111');raise exception 'Direct backing read';exception when insufficient_privilege then null;end;
 begin perform public.ech_staff_profile_store_write_private('11111111-1111-4111-8111-111111111111',8,'submitted','{"availability":"Bad"}','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb');raise exception 'Direct backing write';exception when insufficient_privilege then null;end;
 begin perform from public.ech_staff_profiles;raise exception 'Direct table read';exception when insufficient_privilege then null;end;
end;
$$;

select public.ech_staff_profile_store_write('11111111-1111-4111-8111-111111111111',8,'submitted','{"availability":"Wednesday"}','cccccccc-cccc-4ccc-8ccc-cccccccccccc');
do $$
declare v jsonb;
begin
 v:=public.ech_staff_profile_store_read('11111111-1111-4111-8111-111111111111');
 if v#>>'{profile,availability}' is distinct from 'Tuesday'
   or v#>>'{pending,status}' is distinct from 'pending_review'
   or (v->'pending') ? 'changes' then raise exception 'Staff pending boundary changed';end if;
end;
$$;

set fixture.session_active='off';
do $$
begin
 begin perform public.ech_staff_profile_store_read('11111111-1111-4111-8111-111111111111');raise exception 'Inactive session read';exception when sqlstate 'PT403' then null;end;
 begin perform public.ech_staff_profile_store_write('11111111-1111-4111-8111-111111111111',9,'submitted','{"availability":"Bad"}','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb');raise exception 'Inactive session write';exception when sqlstate 'PT403' then null;end;
end;
$$;
set fixture.session_active='on';
set fixture.actor='22222222-2222-4222-8222-222222222222';
do $$
declare v jsonb;
begin
 v:=public.ech_staff_profile_store_read('11111111-1111-4111-8111-111111111111');
 if v#>>'{pending,changes,availability}' is distinct from 'Wednesday' then raise exception 'Manager pending field missing';end if;
 begin perform public.ech_staff_profile_store_write('11111111-1111-4111-8111-111111111111',8,'approved',null,'cccccccc-cccc-4ccc-8ccc-cccccccccccc');raise exception 'Accepted stale version';exception when sqlstate 'PT409' then null;end;
 begin perform public.ech_staff_profile_store_write('11111111-1111-4111-8111-111111111111',9,'approved',null,'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb');raise exception 'Accepted wrong pending identity';exception when sqlstate 'PT409' then null;end;
end;
$$;
select public.ech_staff_profile_store_write('11111111-1111-4111-8111-111111111111',9,'approved',null,'cccccccc-cccc-4ccc-8ccc-cccccccccccc');

reset role;
set fixture.actor='11111111-1111-4111-8111-111111111111';
-- Model old owner-only pending photo data; the new boundary must not silently
-- expose or approve it. This is synthetic fixture data only.
select public.ech_staff_profile_store_write_private('11111111-1111-4111-8111-111111111111',10,'submitted','{"photo":{"objectKey":"other/legacy.jpg","contentType":"image/jpeg"}}','dddddddd-dddd-4ddd-8ddd-dddddddddddd');
set role authenticated;
set fixture.actor='22222222-2222-4222-8222-222222222222';
do $$
declare v jsonb;
begin
 v:=public.ech_staff_profile_store_read('11111111-1111-4111-8111-111111111111');
 if v#>>'{pending,id}' is distinct from 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'
   or (v#>'{pending,changes}') ? 'photo' then raise exception 'Leaked legacy photo';end if;
 begin perform public.ech_staff_profile_store_write('11111111-1111-4111-8111-111111111111',11,'approved',null,'dddddddd-dddd-4ddd-8ddd-dddddddddddd');raise exception 'Approved legacy photo';exception when sqlstate 'PT400' then null;end;
end;
$$;
reset role;

set role anon;
do $$
begin
 begin perform public.ech_staff_profile_store_read('11111111-1111-4111-8111-111111111111');raise exception 'Anon read';exception when insufficient_privilege then null;end;
end;
$$;
reset role;
set role service_role;
do $$
begin
 begin perform public.ech_staff_profile_store_write('11111111-1111-4111-8111-111111111111',11,'admin_saved','{"availability":"Bad"}');raise exception 'Service role write';exception when insufficient_privilege then null;end;
end;
$$;
reset role;

select 'staff profile storage workflow passed' as result;
