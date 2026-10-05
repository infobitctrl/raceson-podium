create schema if not exists migration_support authorization postgres;

revoke all on schema migration_support from public;
revoke all on schema migration_support from anon;
revoke all on schema migration_support from authenticated;

create table migration_support.legacy_import_batches (
  id uuid primary key,
  source_project_ref text not null,
  target_project_ref text not null,
  mapping_version text not null,
  source_snapshot_at timestamptz not null,
  source_digest_sha256 text not null,
  source_counts jsonb not null,
  import_state text not null default 'prepared',
  imported_counts jsonb not null default '{}'::jsonb,
  reconciliation_json jsonb not null default '{}'::jsonb,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  unique (source_project_ref, target_project_ref, mapping_version, source_digest_sha256),
  check (source_project_ref ~ '^[a-z]{20}$'),
  check (target_project_ref ~ '^[a-z]{20}$'),
  check (length(trim(mapping_version)) > 0),
  check (source_digest_sha256 ~ '^[0-9a-f]{64}$'),
  check (jsonb_typeof(source_counts) = 'object'),
  check (jsonb_typeof(imported_counts) = 'object'),
  check (jsonb_typeof(reconciliation_json) = 'object'),
  check (import_state in ('prepared', 'running', 'completed', 'failed', 'rolled_back'))
);

create table migration_support.legacy_entity_map (
  legacy_import_batch_id uuid not null
    references migration_support.legacy_import_batches (id) on delete restrict,
  source_table text not null,
  source_id text not null,
  target_table text not null,
  target_id uuid not null,
  source_digest_sha256 text not null,
  created_at timestamptz not null default clock_timestamp(),
  primary key (legacy_import_batch_id, source_table, source_id, target_table),
  check (length(trim(source_table)) > 0),
  check (length(trim(source_id)) > 0),
  check (length(trim(target_table)) > 0),
  check (source_digest_sha256 ~ '^[0-9a-f]{64}$')
);

create index legacy_entity_map_target_idx
  on migration_support.legacy_entity_map (target_table, target_id);

alter table migration_support.legacy_import_batches enable row level security;
alter table migration_support.legacy_entity_map enable row level security;

revoke all on all tables in schema migration_support from public;
revoke all on all tables in schema migration_support from anon;
revoke all on all tables in schema migration_support from authenticated;

comment on schema migration_support is
  'Private operational metadata for controlled one-time and rehearsal data migrations.';
