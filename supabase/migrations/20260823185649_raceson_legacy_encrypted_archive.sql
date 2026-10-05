begin;

create table migration_support.legacy_encrypted_source_rows (
  legacy_import_batch_id uuid not null
    references migration_support.legacy_import_batches (id) on delete restrict,
  source_table text not null,
  source_id text not null,
  ciphertext_envelope text not null,
  source_digest_sha256 text not null,
  encryption_key_id text not null,
  source_byte_length integer not null,
  created_at timestamptz not null default clock_timestamp(),
  expires_at timestamptz not null,
  primary key (legacy_import_batch_id, source_table, source_id),
  check (length(trim(source_table)) > 0),
  check (length(trim(source_id)) > 0),
  check (ciphertext_envelope ~ '^v1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$'),
  check (source_digest_sha256 ~ '^[0-9a-f]{64}$'),
  check (encryption_key_id ~ '^[A-Za-z0-9._:/-]{1,128}$'),
  check (source_byte_length > 1),
  check (expires_at > created_at)
);

create index legacy_encrypted_source_rows_expiry_idx
  on migration_support.legacy_encrypted_source_rows (expires_at, legacy_import_batch_id);

create index legacy_encrypted_source_rows_source_idx
  on migration_support.legacy_encrypted_source_rows (source_table, source_id);

create table migration_support.legacy_archive_purge_events (
  id uuid primary key,
  legacy_import_batch_id uuid not null
    references migration_support.legacy_import_batches (id) on delete restrict,
  archive_manifest_sha256 text not null,
  purged_row_count integer not null,
  approved_by text not null,
  approval_reference text not null,
  reconciliation_verified_at timestamptz not null,
  restore_verified_at timestamptz not null,
  purged_at timestamptz not null default clock_timestamp(),
  check (archive_manifest_sha256 ~ '^[0-9a-f]{64}$'),
  check (purged_row_count > 0),
  check (length(trim(approved_by)) > 0),
  check (length(trim(approval_reference)) > 0),
  check (restore_verified_at <= purged_at),
  unique (legacy_import_batch_id, archive_manifest_sha256)
);

alter table migration_support.legacy_encrypted_source_rows enable row level security;
alter table migration_support.legacy_archive_purge_events enable row level security;

revoke all on migration_support.legacy_encrypted_source_rows from public;
revoke all on migration_support.legacy_encrypted_source_rows from anon;
revoke all on migration_support.legacy_encrypted_source_rows from authenticated;
revoke all on migration_support.legacy_encrypted_source_rows from service_role;
revoke all on migration_support.legacy_archive_purge_events from public;
revoke all on migration_support.legacy_archive_purge_events from anon;
revoke all on migration_support.legacy_archive_purge_events from authenticated;
revoke all on migration_support.legacy_archive_purge_events from service_role;

comment on table migration_support.legacy_encrypted_source_rows is
  'AES-256-GCM ciphertext for the selected RacesOn recovery source rows. No database decryption function exists and the key is never stored in PostgreSQL.';

comment on column migration_support.legacy_encrypted_source_rows.ciphertext_envelope is
  'Versioned base64url envelope: v1.nonce.ciphertext.authentication-tag.';

comment on table migration_support.legacy_archive_purge_events is
  'Permanent audit evidence for owner-approved encrypted archive purges after reconciliation and restore verification.';

commit;
