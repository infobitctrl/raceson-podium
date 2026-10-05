begin;

-- Supabase RLS remains the row-level boundary, but anonymous callers should
-- never inherit blanket table capabilities. Rebuild the anonymous table grant
-- surface from a reviewed public-read allowlist.
revoke all on all tables in schema public from anon;
revoke all on all sequences in schema public from anon;

alter default privileges for role postgres in schema public
  revoke all on tables from anon;
alter default privileges for role postgres in schema public
  revoke all on sequences from anon;

grant select on table
  public.organizations,
  public.event_series,
  public.event_editions,
  public.event_categories,
  public.event_category_selection_groups,
  public.event_documents,
  public.event_locations,
  public.event_edition_sports,
  public.track_templates,
  public.track_versions,
  public.event_category_track_snapshots,
  public.checkpoints,
  public.track_render_cache,
  public.track_attempts,
  public.track_condition_reports,
  public.track_reviews,
  public.track_review_comments,
  public.event_reviews,
  public.event_review_comments,
  public.clubs,
  public.club_memberships,
  public.club_posts,
  public.club_stats,
  public.club_activities,
  public.result_rows,
  public.result_splits,
  public.result_publications,
  public.bib_assignments,
  public.leagues,
  public.league_seasons,
  public.league_rounds,
  public.league_scoring_rules,
  public.league_individual_standings,
  public.league_club_standings,
  public.league_sports,
  public.sport_disciplines,
  public.badge_definitions,
  public.athlete_badges,
  public.public_athlete_profiles
to anon;

grant select (
  id,
  slug,
  display_name,
  gender,
  city,
  country_code,
  status,
  created_at,
  updated_at,
  merged_into_athlete_profile_id
) on table public.athlete_profiles to anon;

grant select (
  athlete_profile_id,
  show_city
) on table public.profile_visibility_settings to anon;

do $$
begin
  if exists (
    select 1
    from information_schema.role_table_grants grant_row
    where grant_row.grantee = 'anon'
      and grant_row.table_schema = 'public'
      and grant_row.privilege_type <> 'SELECT'
  ) then
    raise exception 'anonymous role retains a non-SELECT public table grant';
  end if;

  if has_table_privilege('anon', 'public.user_profiles', 'SELECT')
     or has_table_privilege('anon', 'public.registrations', 'SELECT')
     or has_table_privilege('anon', 'public.athlete_registration_profiles', 'SELECT')
     or has_table_privilege('anon', 'public.audit_log', 'SELECT')
     or has_table_privilege('anon', 'public.auth_security_events', 'SELECT') then
    raise exception 'anonymous role retains a private-table SELECT grant';
  end if;

  if not has_table_privilege('anon', 'public.event_editions', 'SELECT')
     or not has_table_privilege('anon', 'public.public_athlete_profiles', 'SELECT')
     or not has_table_privilege('anon', 'public.leagues', 'SELECT') then
    raise exception 'anonymous public read-model grant allowlist is incomplete';
  end if;
end
$$;

commit;
