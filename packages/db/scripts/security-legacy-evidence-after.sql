-- Prove the real migration preserves old evidence and existing private copies.
do $$ begin
  if (select count(*) from public.track_attempts where id between
      '99870000-0000-4000-8000-000000000001' and '99870000-0000-4000-8000-000000000003'
      and result_json = '{"activityName":"Legacy summary"}'::jsonb) <> 3 then
    raise exception 'Legacy public evidence was not removed without losing summary';
  end if;
  if (select evidence_json->>'analysisVersion' from public.track_attempt_evidence where track_attempt_id = '99870000-0000-4000-8000-000000000001') is distinct from '1'
    or (select evidence_json->>'existingPrivateCopy' from public.track_attempt_evidence where track_attempt_id = '99870000-0000-4000-8000-000000000002') is distinct from 'true'
    or (select evidence_json->'activity'->'route' from public.track_attempt_evidence where track_attempt_id = '99870000-0000-4000-8000-000000000003') is distinct from '[{"lat":1,"lng":2}]'::jsonb then
    raise exception 'Migration lost legacy evidence or overwrote a ready private copy';
  end if;
end $$;
delete from public.track_attempts where id between '99870000-0000-4000-8000-000000000001' and '99870000-0000-4000-8000-000000000003';
delete from public.track_templates where id = '99870000-0000-4000-8000-000000000001';
delete from public.organizations where id = '99870000-0000-4000-8000-000000000001';
delete from public.athlete_profiles where id between '99870000-0000-4000-8000-000000000001' and '99870000-0000-4000-8000-000000000003';
