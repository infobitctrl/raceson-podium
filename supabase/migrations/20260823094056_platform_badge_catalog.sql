begin;

-- Platform-owned badge definitions belong to the schema release, not demo
-- fixtures. Stable identifiers keep local and staging catalog hashes equal.
insert into public.badge_definitions (
  id,
  slug,
  name,
  description,
  scope,
  tier,
  icon_key,
  track_template_id,
  sort_order,
  is_active,
  criteria_json
)
values
  (
    '41000000-0000-4000-8000-000000000001',
    'ultra-finisher',
    'Ultra Finisher',
    'Complete an ultra-distance race on the platform.',
    'athlete',
    'gold',
    'mountain',
    null,
    10,
    true,
    '{"distance_km_min":42}'::jsonb
  ),
  (
    '41000000-0000-4000-8000-000000000002',
    'season-leader',
    'Season Leader',
    'Hold a top league standing during the active season.',
    'athlete',
    'gold',
    'trophy',
    null,
    20,
    true,
    '{"standing_rank_max":3}'::jsonb
  ),
  (
    '41000000-0000-4000-8000-000000000003',
    'night-runner',
    'Night Runner',
    'Finish an event or track effort that starts before sunrise or ends after sunset.',
    'athlete',
    'silver',
    'moon',
    null,
    30,
    true,
    '{"requires_night_effort":true}'::jsonb
  ),
  (
    '41000000-0000-4000-8000-000000000004',
    'podium-regular',
    'Podium Regular',
    'Earn at least three podium finishes in official results.',
    'athlete',
    'gold',
    'award',
    null,
    40,
    true,
    '{"podiums_min":3}'::jsonb
  ),
  (
    '41000000-0000-4000-8000-000000000005',
    'iron-legs',
    'Iron Legs',
    'Accumulate 500 km of race or training distance.',
    'athlete',
    'silver',
    'flame',
    null,
    50,
    true,
    '{"distance_km_total_min":500}'::jsonb
  ),
  (
    '41000000-0000-4000-8000-000000000006',
    'speed-demon',
    'Speed Demon',
    'Finish a recorded effort under 5:00/km average pace.',
    'athlete',
    'bronze',
    'zap',
    null,
    60,
    true,
    '{"pace_seconds_per_km_max":300}'::jsonb
  ),
  (
    '41000000-0000-4000-8000-000000000007',
    'race-veteran',
    'Race Veteran',
    'Complete 25 races on Sitrail.',
    'athlete',
    'default',
    'shield',
    null,
    70,
    true,
    '{"official_results_min":25}'::jsonb
  ),
  (
    '41000000-0000-4000-8000-000000000008',
    'mountain-goat',
    'Mountain Goat',
    'Accumulate 25,000 m of climbing across efforts.',
    'athlete',
    'default',
    'target',
    null,
    80,
    true,
    '{"elevation_gain_total_min":25000}'::jsonb
  ),
  (
    '41000000-0000-4000-8000-000000000009',
    'streak-master',
    'Streak Master',
    'Record activity or race results in six consecutive months.',
    'athlete',
    'default',
    'star',
    null,
    90,
    true,
    '{"consecutive_months_min":6}'::jsonb
  ),
  (
    '41000000-0000-4000-8000-000000000010',
    'legend',
    'Legend',
    'Win 10 races on the platform.',
    'athlete',
    'default',
    'star',
    null,
    100,
    true,
    '{"wins_min":10}'::jsonb
  )
on conflict (id) do update
set
  slug = excluded.slug,
  name = excluded.name,
  description = excluded.description,
  scope = excluded.scope,
  tier = excluded.tier,
  icon_key = excluded.icon_key,
  track_template_id = excluded.track_template_id,
  sort_order = excluded.sort_order,
  is_active = excluded.is_active,
  criteria_json = excluded.criteria_json;

commit;
