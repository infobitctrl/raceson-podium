begin;

create table public.track_attempt_evidence (
  track_attempt_id uuid primary key references public.track_attempts (id) on delete cascade,
  source public.track_attempt_source not null,
  original_file_name text,
  storage_bucket text,
  storage_path text,
  file_sha256 text,
  evidence_json jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  check (source in ('gpx_upload', 'strava')),
  check (original_file_name is null or length(original_file_name) between 1 and 160),
  check (storage_bucket is null or length(storage_bucket) between 1 and 100),
  check (storage_path is null or length(storage_path) between 1 and 500),
  check (file_sha256 is null or file_sha256 ~ '^[a-f0-9]{64}$'),
  check (
    source <> 'gpx_upload'
    or (
      original_file_name is not null
      and storage_bucket = 'track-attempt-gpx'
      and storage_path is not null
      and file_sha256 is not null
    )
  )
);

create unique index track_attempt_evidence_file_sha256_uidx
  on public.track_attempt_evidence (file_sha256)
  where file_sha256 is not null;

create index track_attempt_evidence_source_created_idx
  on public.track_attempt_evidence (source, created_at desc);

alter table public.track_attempt_evidence enable row level security;

revoke all on table public.track_attempt_evidence from public, anon, authenticated;
grant select, insert, update, delete on table public.track_attempt_evidence to service_role;

create trigger track_attempt_evidence_set_updated_at
before update on public.track_attempt_evidence
for each row execute function public.set_updated_at();

insert into storage.buckets (
  id,
  name,
  public,
  file_size_limit,
  allowed_mime_types
)
values (
  'track-attempt-gpx',
  'track-attempt-gpx',
  false,
  4194304,
  array['application/gpx+xml', 'application/xml', 'text/xml', 'application/octet-stream']
)
on conflict (id) do update
set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

commit;
