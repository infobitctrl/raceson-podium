-- Validator-only fixture, inserted immediately before the privacy migration.
insert into public.organizations (id, slug, name, kind)
values ('99870000-0000-4000-8000-000000000001', 'security-legacy-evidence', 'Synthetic legacy evidence', 'organizer');
insert into public.track_templates (id, organization_id, slug, name)
values ('99870000-0000-4000-8000-000000000001', '99870000-0000-4000-8000-000000000001', 'security-legacy-evidence', 'Synthetic legacy track');
insert into public.athlete_profiles (id, slug, first_name, last_name, display_name)
select ('99870000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid,
  'security-legacy-athlete-' || n, 'Synthetic', 'Athlete', 'Synthetic Athlete'
from generate_series(1, 3) n;
insert into public.track_attempts (id, track_template_id, athlete_profile_id, source, started_at, result_json)
select id, '99870000-0000-4000-8000-000000000001', id, 'strava', now(),
  case when slug = 'security-legacy-athlete-1' then
    '{"analysisVersion":1,"status":"ready","stravaActivity":{"route":[{"lat":1,"lng":2}],"averageHeartRate":100},"sitrailTrack":{},"comparison":{},"activityName":"Legacy summary"}'::jsonb
  else
    '{"analysisVersion":2,"status":"ready","source":"strava","activity":{"route":[{"lat":1,"lng":2}]},"sitrailTrack":{},"comparison":{},"report":{},"activityName":"Legacy summary"}'::jsonb
  end
from public.athlete_profiles where slug like 'security-legacy-athlete-%';
insert into public.track_attempt_evidence (track_attempt_id, source, evidence_json)
values ('99870000-0000-4000-8000-000000000002', 'strava', '{"analysisVersion":2,"status":"ready","existingPrivateCopy":true}'::jsonb);
