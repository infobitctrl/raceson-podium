-- Owner decision 2026-09-10: any signed-in account may contribute photos.
-- Registration and athlete-profile ownership are not prerequisites. Uploads
-- remain private and submissions still enter the organizer's pending review.
alter table public.event_photo_submissions
  alter column athlete_profile_id drop not null;

create or replace function app_private.can_submit_event_photo(
  target_event_edition_id uuid,
  target_event_category_id uuid,
  target_athlete_profile_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select auth.uid() is not null
    and target_athlete_profile_id is not distinct from app_private.current_primary_athlete_profile_id()
    and exists (
      select 1
      from public.user_profiles account
      join public.event_categories category on category.id = target_event_category_id
      join public.event_editions edition on edition.id = category.event_edition_id
      where account.user_id = auth.uid()
        and account.status = 'active'
        and category.organizer_deleted_at is null
        and edition.id = target_event_edition_id
        and edition.published_at is not null
        and edition.status <> 'draft'
        and edition.organizer_deleted_at is null
        and (
          edition.public_visibility = 'public'
          or (
            edition.public_visibility = 'club_members'
            and exists (
              select 1
              from public.event_eligible_clubs eligible
              join public.club_memberships membership on membership.club_id = eligible.club_id
              where eligible.event_edition_id = edition.id
                and membership.athlete_profile_id = account.primary_athlete_profile_id
                and membership.status = 'active'
            )
          )
        )
    )
$$;

revoke all on function app_private.can_submit_event_photo(uuid, uuid, uuid) from public, anon;
grant execute on function app_private.can_submit_event_photo(uuid, uuid, uuid) to authenticated, service_role;

comment on function app_private.can_submit_event_photo(uuid, uuid, uuid) is
  'Private Storage RLS helper: signed-in contributors may upload to their own path for a visible published race/category, without a race registration. No review or publication authority is granted.';
