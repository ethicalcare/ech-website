-- Draft report-scoped current author labels. Activation requires separate review.
-- The underlying report read enforces the existing visit, session and role rules.
begin;

create function public.ech_operations_report_author_labels(
  p_visit_id uuid, p_expected_visit_revision bigint, p_expected_role text,
  p_membership_revision bigint, p_expected_report_revision bigint default null
)
returns jsonb language plpgsql volatile security definer set search_path = ''
as $$
declare
  report jsonb;
  labels jsonb;
begin
  report := public.ech_operations_visit_report(
    p_visit_id, p_expected_visit_revision, p_expected_role,
    p_membership_revision, p_expected_report_revision
  );

  -- Only actors already present in this authorized report are projected.
  -- Names are current membership labels, not historical name snapshots.
  select coalesce(jsonb_agg(jsonb_build_object(
    'actorId', actors.actor_id,
    'currentLabel', membership.display_name
  ) order by actors.actor_id), '[]'::jsonb)
  into labels
  from (
    select distinct entry->>'actorId' as actor_id
    from jsonb_array_elements((report->'versions') || (report->'reviews')) entry
  ) actors
  left join public.ech_memberships membership on membership.user_id::text = actors.actor_id;

  -- Recheck authority and the exact report stream after the additional lookup.
  perform public.ech_operations_visit_report(
    p_visit_id, p_expected_visit_revision, p_expected_role,
    p_membership_revision, (report->>'reportRevision')::bigint
  );
  return jsonb_build_object(
    'visitId', p_visit_id,
    'visitRevision', p_expected_visit_revision,
    'reportRevision', report->'reportRevision',
    'labels', labels
  );
end;
$$;

-- Deliberately no application grant: the projection is a draft and must not
-- become reachable until the complete integration and access review are ready.
revoke all on function public.ech_operations_report_author_labels(uuid, bigint, text, bigint, bigint) from public;
do $$
declare recipient record;
begin
  for recipient in
    select distinct r.rolname from pg_catalog.pg_proc p
    cross join lateral pg_catalog.aclexplode(p.proacl) a
    join pg_catalog.pg_roles r on r.oid = a.grantee
    where p.oid = 'public.ech_operations_report_author_labels(uuid,bigint,text,bigint,bigint)'::regprocedure
      and a.grantee <> p.proowner
  loop
    execute format('revoke all on function public.ech_operations_report_author_labels(uuid,bigint,text,bigint,bigint) from %I', recipient.rolname);
  end loop;
end;
$$;
commit;
