alter table checkpoints
  add column if not exists settings_json jsonb not null default '{}'::jsonb;
