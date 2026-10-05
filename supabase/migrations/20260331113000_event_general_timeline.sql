alter table event_editions
  add column if not exists general_timeline_json jsonb;
