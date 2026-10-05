-- Harden helper and trigger resolution against caller-controlled search paths.
-- These functions only use pg_catalog built-ins and explicitly qualified
-- application/auth objects, so no broader path is required.
alter function public.request_jwt_role()
  set search_path = pg_catalog, public, auth, extensions;
alter function public.request_jwt_claims()
  set search_path = pg_catalog, public, auth, extensions;
alter function public.request_user_id()
  set search_path = pg_catalog, public, auth, extensions;
alter function public.is_authenticated()
  set search_path = pg_catalog, public, auth, extensions;
alter function public.is_race_public(uuid)
  set search_path = pg_catalog, public, auth, extensions;
alter function public.auth_user_display_name(jsonb, text)
  set search_path = pg_catalog, public, auth, extensions;
alter function public.auth_user_provider_list(jsonb)
  set search_path = pg_catalog, public, auth, extensions;
alter function public.set_updated_at()
  set search_path = pg_catalog, public, auth, extensions;
alter function public.enforce_active_club_membership_limit()
  set search_path = pg_catalog, public, auth, extensions;

-- One policy per role/action avoids evaluating two permissive SELECT policies
-- for authenticated traffic while preserving public and moderator access.
drop policy if exists track_review_comments_select_moderator
  on public.track_review_comments;
drop policy if exists track_review_comments_select_public
  on public.track_review_comments;

create policy track_review_comments_select_public
on public.track_review_comments
for select
to anon
using (
  exists (
    select 1
    from public.track_reviews review
    where review.id = track_review_comments.track_review_id
      and public.is_track_template_public(review.track_template_id)
  )
);

create policy track_review_comments_select_authenticated
on public.track_review_comments
for select
to authenticated
using (
  exists (
    select 1
    from public.track_reviews review
    where review.id = track_review_comments.track_review_id
      and (
        public.is_track_template_public(review.track_template_id)
        or public.can_manage_organization(
          public.organization_id_for_track_template(review.track_template_id)
        )
        or public.is_platform_administrator()
      )
  )
);

-- Evaluate the authenticated user identifier once per statement instead of
-- once per club-role row.
drop policy if exists club_roles_select_manager
  on public.club_roles;

create policy club_roles_select_manager
on public.club_roles
for select
to authenticated
using (
  public.is_active_platform_administrator((select auth.uid()))
  or public.club_member_has_permission(club_id, 'club.roles.manage')
);

-- Keep anonymous and authenticated activity visibility in separate policies,
-- with a single permissive SELECT policy for each database role.
drop policy if exists club_activities_select_public
  on public.club_activities;
drop policy if exists club_activities_select_member
  on public.club_activities;

create policy club_activities_select_public
on public.club_activities
for select
to anon
using (
  status = 'published'
  and visibility = 'public'
  and public.is_club_public(club_id)
);

create policy club_activities_select_authenticated
on public.club_activities
for select
to authenticated
using (
  (
    status = 'published'
    and visibility = 'public'
    and public.is_club_public(club_id)
  )
  or public.current_user_is_club_member(club_id)
);
