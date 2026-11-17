begin;
create table public.ech_phone_source_refreshes (
 operation_id uuid primary key, actor_id uuid not null references public.ech_memberships(user_id),
 client_id uuid not null references public.ech_schedule_clients(id), inquiry_id uuid not null,
 source_revision bigint not null check(source_revision>0), generation bigint not null check(generation>0),
 envelope jsonb not null, occurred_at timestamptz not null default clock_timestamp(), unique(client_id,generation)
);
alter table public.ech_phone_source_refreshes enable row level security;
revoke all on public.ech_phone_source_refreshes from public,anon,authenticated;
do $$ declare recipient record; begin
 for recipient in select distinct r.rolname from pg_catalog.pg_class c cross join lateral pg_catalog.aclexplode(c.relacl) a join pg_catalog.pg_roles r on r.oid=a.grantee where c.oid='public.ech_phone_source_refreshes'::regclass and a.grantee<>c.relowner
 loop execute format('revoke all on table public.ech_phone_source_refreshes from %I',recipient.rolname); end loop;
end;$$;
create trigger ech_phone_refresh_immutable before update or delete or truncate on public.ech_phone_source_refreshes
 for each statement execute function public.ech_schedule_keep_history();
-- Disabled draft: no execution grant. Current inquiry source only; no phone snapshot.
create function public.ech_visit_source_phones(p_visit uuid,p_visit_revision bigint,p_role text,p_membership_revision bigint)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v public.ech_schedule_visits; binding public.ech_schedule_client_readiness; q public.ech_records; refreshed public.ech_phone_source_refreshes; state text := 'unavailable'; recipient text; contact text; source_revision bigint;
begin
 -- This existing gate checks the current active session, membership, visit revision and staff assignment.
 perform public.ech_operations_visit_detail(p_visit,p_visit_revision,p_role,p_membership_revision);
 select * into v from public.ech_schedule_visits where id=p_visit for share nowait;
 if v.status not in ('Cancelled','Completed') then
  select * into binding from public.ech_schedule_client_readiness where client_id=v.client_id and service=v.service for share nowait;
  if found and binding.inquiry_id is not null then
   select * into refreshed from public.ech_phone_source_refreshes where client_id=v.client_id order by generation desc limit 1;
   source_revision := case when refreshed.inquiry_id=binding.inquiry_id then refreshed.source_revision else binding.inquiry_revision end;
   select * into q from public.ech_records where kind='inquiry' and id=binding.inquiry_id for share nowait;
   if found and q.revision=source_revision and q.data->>'status' in ('New','Contacted','Assessment booked','On hold') then
    state := 'current'; recipient := nullif(q.data->>'careRecipientPhone',''); contact := nullif(q.data->>'phone','');
   else state := 'stale'; end if;
  end if;
 end if;
 perform public.ech_operations_visit_detail(p_visit,p_visit_revision,p_role,p_membership_revision);
 return jsonb_build_object('schema',1,'visitId',p_visit,'visitRevision',p_visit_revision,'state',state,'clientPhone',recipient,'mainContactPhone',contact);
end;$$;
revoke all on function public.ech_visit_source_phones(uuid,bigint,text,bigint) from public;
do $$ declare recipient record; begin
 for recipient in select distinct r.rolname from pg_catalog.pg_proc p cross join lateral pg_catalog.aclexplode(p.proacl) a join pg_catalog.pg_roles r on r.oid=a.grantee
 where p.oid='public.ech_visit_source_phones(uuid,bigint,text,bigint)'::regprocedure and a.grantee<>p.proowner
 loop execute format('revoke all on function public.ech_visit_source_phones(uuid,bigint,text,bigint) from %I',recipient.rolname); end loop;
end;$$;
commit;
