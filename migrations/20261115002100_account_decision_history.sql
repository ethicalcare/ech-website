begin;
-- Source only: activation requires a separate review and execute privilege.
create function public.ech_account_decision_history(p_target uuid, p_revision bigint, p_offset integer)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare current_revision bigint; entries jsonb; more boolean;
begin
 if not coalesce(public.ech_access_reviewer(), false) then
  raise sqlstate 'PT403' using message='Main administrator required';
 end if;
 if p_target is null or p_revision is null or p_revision < 1 or p_offset is null or p_offset < 0 or p_offset > 100000 or p_offset % 20 <> 0 then
  raise sqlstate 'PT400' using message='Invalid history request';
 end if;
 select revision into current_revision from public.ech_access_requests where user_id=p_target;
 if not found or current_revision <> p_revision then
  raise sqlstate 'PT409' using message='Account request changed';
 end if;
 with page as (
  select at, action, previous_state, next_state, approved_role, actor_id, operation_id
  from public.ech_access_decisions where target_id=p_target
  order by at desc, actor_id desc, operation_id desc offset p_offset limit 21
 ), numbered as (select *, row_number() over (order by at desc, actor_id desc, operation_id desc) n from page)
 select coalesce(jsonb_agg(jsonb_build_object('at',at,'action',action,'previousState',previous_state,
   'nextState',next_state,'approvedRole',approved_role) order by n) filter (where n<=20),'[]'::jsonb), count(*)>20
 into entries,more from numbered;
 return jsonb_build_object('schema',1,'userId',p_target,'revision',p_revision,'items',entries,
  'nextOffset',case when more and p_offset < 100000 then p_offset+20 else null end,
  'limitReached',more and p_offset = 100000);
end;$$;
revoke all on function public.ech_account_decision_history(uuid,bigint,integer) from public;
do $$
declare recipient record;
begin
 for recipient in
  select distinct r.rolname from pg_catalog.pg_proc p
  cross join lateral pg_catalog.aclexplode(p.proacl) a
  join pg_catalog.pg_roles r on r.oid = a.grantee
  where p.oid = 'public.ech_account_decision_history(uuid,bigint,integer)'::regprocedure
    and a.grantee <> p.proowner
 loop
  execute format('revoke all on function public.ech_account_decision_history(uuid,bigint,integer) from %I', recipient.rolname);
 end loop;
end;$$;
commit;
