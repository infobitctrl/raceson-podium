begin;

alter table public.track_reviews
  add column helpful_count integer not null default 0,
  add column not_helpful_count integer not null default 0,
  add constraint track_reviews_helpful_count_nonnegative check (helpful_count >= 0),
  add constraint track_reviews_not_helpful_count_nonnegative check (not_helpful_count >= 0);

create table public.track_review_reactions (
  track_review_id uuid not null references public.track_reviews (id) on delete cascade,
  athlete_profile_id uuid not null references public.athlete_profiles (id) on delete cascade,
  reaction smallint not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (track_review_id, athlete_profile_id),
  check (reaction in (-1, 1))
);

create table public.track_review_comments (
  id uuid primary key default gen_random_uuid(),
  track_review_id uuid not null references public.track_reviews (id) on delete cascade,
  athlete_profile_id uuid not null references public.athlete_profiles (id) on delete cascade,
  body text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (char_length(btrim(body)) between 2 and 2000)
);

create index track_review_reactions_athlete_idx
  on public.track_review_reactions (athlete_profile_id, track_review_id);

create index track_review_comments_review_created_idx
  on public.track_review_comments (track_review_id, created_at asc);

create index track_review_comments_athlete_idx
  on public.track_review_comments (athlete_profile_id, created_at desc);

create or replace function public.refresh_track_review_reaction_counts()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  target_review_id uuid := coalesce(new.track_review_id, old.track_review_id);
begin
  update public.track_reviews review
  set helpful_count = counts.helpful_count,
      not_helpful_count = counts.not_helpful_count
  from (
    select
      count(*) filter (where reaction = 1)::integer as helpful_count,
      count(*) filter (where reaction = -1)::integer as not_helpful_count
    from public.track_review_reactions
    where track_review_id = target_review_id
  ) counts
  where review.id = target_review_id;

  return coalesce(new, old);
end;
$$;

revoke all on function public.refresh_track_review_reaction_counts()
  from public, anon, authenticated;

create trigger track_review_reactions_refresh_counts
after insert or update or delete on public.track_review_reactions
for each row execute function public.refresh_track_review_reaction_counts();

create trigger track_review_reactions_set_updated_at
before update on public.track_review_reactions
for each row execute function public.set_updated_at();

create trigger track_review_comments_set_updated_at
before update on public.track_review_comments
for each row execute function public.set_updated_at();

alter table public.track_review_reactions enable row level security;
alter table public.track_review_comments enable row level security;

revoke all on table public.track_review_reactions from public, anon, authenticated;
revoke all on table public.track_review_comments from public, anon, authenticated;

grant select on table public.track_review_reactions to authenticated;
grant select on table public.track_review_comments to anon, authenticated;
grant select, insert, update, delete on table public.track_review_reactions to service_role;
grant select, insert, update, delete on table public.track_review_comments to service_role;

create policy track_review_reactions_select_self
on public.track_review_reactions
for select
to authenticated
using (public.user_can_access_athlete_profile(athlete_profile_id));

create policy track_review_comments_select_public
on public.track_review_comments
for select
to anon, authenticated
using (
  exists (
    select 1
    from public.track_reviews review
    where review.id = track_review_comments.track_review_id
      and public.is_track_template_public(review.track_template_id)
  )
);

create policy track_review_comments_select_moderator
on public.track_review_comments
for select
to authenticated
using (
  exists (
    select 1
    from public.track_reviews review
    where review.id = track_review_comments.track_review_id
      and (
        public.can_manage_organization(public.organization_id_for_track_template(review.track_template_id))
        or public.is_platform_administrator()
      )
  )
);

commit;
