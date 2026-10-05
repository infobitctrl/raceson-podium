begin;

alter table event_categories
  add column if not exists ranking_config_json jsonb not null default jsonb_build_object(
    'overall', jsonb_build_object('enabled', true),
    'sex', jsonb_build_object(
      'enabled', true,
      'buckets', jsonb_build_array(
        jsonb_build_object('key', 'female', 'label', 'Female', 'gender', 'F'),
        jsonb_build_object('key', 'male', 'label', 'Male', 'gender', 'M')
      )
    ),
    'age', jsonb_build_object(
      'enabled', false,
      'buckets', jsonb_build_array(
        jsonb_build_object('key', 'u18', 'label', 'U18', 'minAge', 0, 'maxAge', 17),
        jsonb_build_object('key', 'adult', 'label', '18-65', 'minAge', 18, 'maxAge', 65),
        jsonb_build_object('key', 'senior', 'label', 'Seniors', 'minAge', 66, 'maxAge', null)
      )
    ),
    'team', jsonb_build_object(
      'enabled', false,
      'mode', 'club',
      'label', 'Club / Team',
      'scoringMethod', 'best_three_by_place',
      'scoringCount', 3
    )
  );

update event_categories
set ranking_config_json = jsonb_build_object(
  'overall', jsonb_build_object('enabled', true),
  'sex', jsonb_build_object(
    'enabled', true,
    'buckets', jsonb_build_array(
      jsonb_build_object('key', 'female', 'label', 'Female', 'gender', 'F'),
      jsonb_build_object('key', 'male', 'label', 'Male', 'gender', 'M')
    )
  ),
  'age', jsonb_build_object(
    'enabled', false,
    'buckets', jsonb_build_array(
      jsonb_build_object('key', 'u18', 'label', 'U18', 'minAge', 0, 'maxAge', 17),
      jsonb_build_object('key', 'adult', 'label', '18-65', 'minAge', 18, 'maxAge', 65),
      jsonb_build_object('key', 'senior', 'label', 'Seniors', 'minAge', 66, 'maxAge', null)
    )
  ),
  'team', jsonb_build_object(
    'enabled', false,
    'mode', 'club',
    'label', 'Club / Team',
    'scoringMethod', 'best_three_by_place',
    'scoringCount', 3
  )
)
where ranking_config_json is null or ranking_config_json = '{}'::jsonb;

commit;
