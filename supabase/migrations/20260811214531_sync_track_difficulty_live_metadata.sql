-- Track difficulty is live comparison metadata, while GPX, route geometry,
-- checkpoints, and safety content remain versioned behind explicit publish.
-- Synchronize the three public versions that predate that behavior with their
-- organizer-configured difficulty without exposing any other draft fields.
with latest_configured_version as (
  select distinct on (track_template_id)
    track_template_id,
    difficulty_level
  from public.track_versions
  order by track_template_id, version_number desc
),
latest_published_version as (
  select distinct on (track_template_id)
    id,
    track_template_id,
    difficulty_level
  from public.track_versions
  where published_at is not null
  order by track_template_id, version_number desc
),
targets as (
  select
    published.id,
    configured.difficulty_level
  from latest_configured_version configured
  join latest_published_version published using (track_template_id)
  join public.track_templates template on template.id = configured.track_template_id
  where template.slug in (
    'torak-velika-2026',
    'trtar-long-2026',
    'vrpolje-trail-velika-2026'
  )
    and configured.difficulty_level is not null
    and configured.difficulty_level is distinct from published.difficulty_level
)
update public.track_versions version
set difficulty_level = targets.difficulty_level
from targets
where version.id = targets.id;
