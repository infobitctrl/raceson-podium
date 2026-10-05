-- Public catalog pages read these relations through the Supabase Data API.
-- Row-level security remains the authorization boundary for every base table.
grant usage on schema public to anon, authenticated;

grant select on table
  public.organizations,
  public.event_series,
  public.event_editions,
  public.event_categories,
  public.event_documents,
  public.event_locations,
  public.track_templates,
  public.track_versions,
  public.event_category_track_snapshots,
  public.checkpoints,
  public.track_render_cache,
  public.track_attempts,
  public.track_condition_reports,
  public.track_reviews,
  public.clubs,
  public.club_memberships,
  public.club_posts,
  public.club_stats,
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
  public.badge_definitions,
  public.athlete_badges,
  public.public_athlete_profiles
to anon, authenticated;
