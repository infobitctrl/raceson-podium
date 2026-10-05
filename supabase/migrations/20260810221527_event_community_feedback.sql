create table public.event_reviews (
  id uuid primary key default gen_random_uuid(),
  event_edition_id uuid not null references public.event_editions (id) on delete cascade,
  athlete_profile_id uuid not null references public.athlete_profiles (id) on delete cascade,
  rating smallint not null check (rating between 1 and 5),
  title text,
  body text not null check (char_length(trim(body)) between 2 and 3000),
  is_public boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (event_edition_id, athlete_profile_id)
);

create table public.event_review_comments (
  id uuid primary key default gen_random_uuid(),
  event_review_id uuid not null references public.event_reviews (id) on delete cascade,
  athlete_profile_id uuid not null references public.athlete_profiles (id) on delete cascade,
  body text not null check (char_length(trim(body)) between 2 and 2000),
  is_public boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index event_reviews_edition_created_idx
  on public.event_reviews (event_edition_id, created_at desc);

create index event_review_comments_review_created_idx
  on public.event_review_comments (event_review_id, created_at asc);

create index event_review_comments_athlete_created_idx
  on public.event_review_comments (athlete_profile_id, created_at desc);

create trigger event_reviews_set_updated_at
before update on public.event_reviews
for each row execute function public.set_updated_at();

create trigger event_review_comments_set_updated_at
before update on public.event_review_comments
for each row execute function public.set_updated_at();

alter table public.event_reviews enable row level security;
alter table public.event_review_comments enable row level security;

revoke all on table public.event_reviews from public, anon, authenticated;
revoke all on table public.event_review_comments from public, anon, authenticated;

grant select on table public.event_reviews to anon, authenticated;
grant select on table public.event_review_comments to anon, authenticated;
grant select, insert, update, delete on table public.event_reviews to service_role;
grant select, insert, update, delete on table public.event_review_comments to service_role;

create policy event_reviews_select_public
on public.event_reviews
for select
to anon, authenticated
using (
  is_public
  and public.is_event_edition_public(event_edition_id)
);

create policy event_review_comments_select_public
on public.event_review_comments
for select
to anon, authenticated
using (
  is_public
  and exists (
    select 1
    from public.event_reviews review
    where review.id = event_review_comments.event_review_id
      and review.is_public
      and public.is_event_edition_public(review.event_edition_id)
  )
);

comment on table public.event_reviews is
  'Event-edition feedback submitted on public event pages. Deliberately separate from reusable track reviews.';

comment on table public.event_review_comments is
  'Discussion attached to event-edition reviews. Deliberately separate from track review comments.';
