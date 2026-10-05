begin;

create table migration_support.legacy_import_payload_chunks (
  legacy_import_batch_id uuid not null
    references migration_support.legacy_import_batches (id) on delete cascade,
  target_table text not null,
  target_row_id text not null,
  target_column text not null,
  chunk_index integer not null,
  payload_chunk_base64 text not null,
  payload_sha256 text not null,
  created_at timestamptz not null default clock_timestamp(),
  primary key (
    legacy_import_batch_id,
    target_table,
    target_row_id,
    target_column,
    chunk_index
  ),
  check (target_table ~ '^public\.[a-z_][a-z0-9_]*$'),
  check (length(trim(target_row_id)) > 0),
  check (target_column ~ '^[a-z_][a-z0-9_]*$'),
  check (chunk_index >= 0),
  check (payload_chunk_base64 ~ '^[A-Za-z0-9+/]*={0,2}$'),
  check (payload_sha256 ~ '^[0-9a-f]{64}$')
);

create index legacy_import_payload_chunks_batch_idx
  on migration_support.legacy_import_payload_chunks (
    legacy_import_batch_id,
    target_table,
    target_row_id,
    target_column
  );

alter table migration_support.legacy_import_payload_chunks enable row level security;

revoke all on migration_support.legacy_import_payload_chunks from public;
revoke all on migration_support.legacy_import_payload_chunks from anon;
revoke all on migration_support.legacy_import_payload_chunks from authenticated;
revoke all on migration_support.legacy_import_payload_chunks from service_role;

comment on table migration_support.legacy_import_payload_chunks is
  'Private resumable transport for oversized RacesOn recovery fields. Chunks are SHA-256 verified, reconstructed inside PostgreSQL, and deleted immediately after the target field is restored.';

comment on column migration_support.legacy_import_payload_chunks.payload_chunk_base64 is
  'A bounded base64 segment of the original UTF-8 field payload; it is not a durable source archive.';

commit;
