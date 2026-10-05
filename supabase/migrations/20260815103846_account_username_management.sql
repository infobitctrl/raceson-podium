begin;

alter table public.account_login_identifiers
  add column if not exists username_changed_at timestamptz;

comment on column public.account_login_identifiers.username_changed_at is
  'Timestamp of the most recent user-requested username selection or change; used for the account change cooldown.';

create table public.account_username_history (
  username citext primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  reserved_until timestamptz not null,
  created_at timestamptz not null default now(),
  check (username::text = lower(trim(username::text))),
  check (username::text ~ '^[a-z0-9][a-z0-9._-]{2,47}$'),
  check (reserved_until > created_at)
);

comment on table public.account_username_history is
  'Service-only hold on previous account usernames to prevent immediate reassignment and impersonation.';

create index account_username_history_reserved_until_idx
  on public.account_username_history (reserved_until);

alter table public.account_username_history enable row level security;
revoke all on table public.account_username_history from public, anon, authenticated;
grant all on table public.account_username_history to service_role;

commit;
