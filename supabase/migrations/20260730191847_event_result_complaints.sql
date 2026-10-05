create table public.result_complaints (
  id uuid primary key default gen_random_uuid(),
  event_category_id uuid not null
    references public.event_categories(id) on delete cascade,
  registration_id uuid
    references public.registrations(id) on delete set null,
  bib_number text,
  complainant_name text not null,
  complaint_text text not null,
  status text not null default 'open',
  resolution_note text,
  created_by_user_id uuid not null
    references auth.users(id) on delete restrict,
  resolved_by_user_id uuid
    references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  resolved_at timestamptz,
  updated_at timestamptz not null default now(),
  constraint result_complaints_bib_length
    check (bib_number is null or char_length(btrim(bib_number)) between 1 and 40),
  constraint result_complaints_complainant_length
    check (char_length(btrim(complainant_name)) between 2 and 160),
  constraint result_complaints_text_length
    check (char_length(btrim(complaint_text)) between 3 and 2000),
  constraint result_complaints_status
    check (status in ('open', 'resolved', 'dismissed')),
  constraint result_complaints_resolution_length
    check (resolution_note is null or char_length(btrim(resolution_note)) between 3 and 2000),
  constraint result_complaints_resolution_consistency
    check (
      (status = 'open' and resolved_at is null and resolved_by_user_id is null)
      or
      (status in ('resolved', 'dismissed') and resolved_at is not null and resolved_by_user_id is not null)
    )
);

create index result_complaints_category_status_idx
  on public.result_complaints (event_category_id, status, created_at desc);

create index result_complaints_registration_idx
  on public.result_complaints (registration_id)
  where registration_id is not null;

comment on table public.result_complaints is
  'Organizer-managed complaints attached to provisional event-category results.';

alter table public.result_complaints enable row level security;

revoke all on table public.result_complaints from public, anon, authenticated;
grant select, insert, update, delete on table public.result_complaints to service_role;
