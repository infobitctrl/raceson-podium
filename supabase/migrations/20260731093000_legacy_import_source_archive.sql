create table migration_support.legacy_source_rows (
  legacy_import_batch_id uuid not null
    references migration_support.legacy_import_batches (id) on delete restrict,
  source_table text not null,
  source_id text not null,
  source_record jsonb not null,
  source_digest_sha256 text not null,
  created_at timestamptz not null default clock_timestamp(),
  primary key (legacy_import_batch_id, source_table, source_id),
  check (length(trim(source_table)) > 0),
  check (length(trim(source_id)) > 0),
  check (jsonb_typeof(source_record) = 'object'),
  check (source_digest_sha256 ~ '^[0-9a-f]{64}$')
);

create index legacy_source_rows_source_idx
  on migration_support.legacy_source_rows (source_table, source_id);

alter table migration_support.legacy_source_rows enable row level security;

revoke all on migration_support.legacy_source_rows from public;
revoke all on migration_support.legacy_source_rows from anon;
revoke all on migration_support.legacy_source_rows from authenticated;

comment on table migration_support.legacy_source_rows is
  'Lossless private archive of canonical legacy rows used by controlled imports; never exposed through the portal API.';
