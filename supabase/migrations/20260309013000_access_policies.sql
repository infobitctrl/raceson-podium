begin;

create or replace function public.request_user_id()
returns uuid
language sql
stable
as $$
  select case
    when nullif(current_setting('request.jwt.claim.sub', true), '') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      then nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
    else null
  end
$$;

create or replace function public.request_jwt_role()
returns text
language sql
stable
as $$
  select coalesce(
    nullif(current_setting('request.jwt.claim.role', true), ''),
    nullif(current_setting('role', true), ''),
    'anon'
  )
$$;

create or replace function public.is_authenticated()
returns boolean
language sql
stable
as $$
  select public.request_user_id() is not null
    or public.request_jwt_role() in ('authenticated', 'service_role')
$$;

create or replace function public.is_athlete_profile_public(target_athlete_profile_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from athlete_profiles ap
    where ap.id = target_athlete_profile_id
      and ap.status = 'active'
      and ap.merged_into_athlete_profile_id is null
  )
$$;

create or replace function public.current_user_profile_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select up.id
  from user_profiles up
  where up.user_id = public.request_user_id()
$$;

create or replace function public.current_primary_athlete_profile_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select up.primary_athlete_profile_id
  from user_profiles up
  where up.user_id = public.request_user_id()
$$;

create or replace function public.user_can_access_athlete_profile(target_athlete_profile_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from athlete_profiles ap
    where ap.id = target_athlete_profile_id
      and public.request_user_id() is not null
      and (
        ap.claimed_by_user_id = public.request_user_id()
        or exists (
          select 1
          from user_profiles up
          where up.user_id = public.request_user_id()
            and up.primary_athlete_profile_id = ap.id
        )
        or exists (
          select 1
          from athlete_claims ac
          where ac.athlete_profile_id = ap.id
            and ac.claimant_user_id = public.request_user_id()
            and ac.status = 'approved'
        )
        or exists (
          select 1
          from athlete_identities ai
          where ai.athlete_profile_id = ap.id
            and ai.user_id = public.request_user_id()
            and ai.is_verified
        )
      )
  )
$$;

create or replace function public.user_can_access_registration(target_registration_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from registrations r
    where r.id = target_registration_id
      and public.user_can_access_athlete_profile(r.athlete_profile_id)
  )
$$;

create or replace function public.is_organization_member(
  target_organization_id uuid,
  allowed_roles organization_membership_role[] default array['owner', 'admin', 'staff', 'timer']::organization_membership_role[]
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from organization_memberships om
    where om.organization_id = target_organization_id
      and om.user_id = public.request_user_id()
      and om.status = 'active'
      and om.role = any (allowed_roles)
  )
$$;

create or replace function public.can_manage_organization(target_organization_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.is_organization_member(
    target_organization_id,
    array['owner', 'admin', 'staff']::organization_membership_role[]
  )
$$;

create or replace function public.can_time_organization(target_organization_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.is_organization_member(
    target_organization_id,
    array['owner', 'admin', 'staff', 'timer']::organization_membership_role[]
  )
$$;

create or replace function public.is_club_public(target_club_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from clubs c
    where c.id = target_club_id
      and c.status = 'active'
  )
$$;

create or replace function public.can_manage_club(target_club_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from clubs c
    where c.id = target_club_id
      and c.created_by_athlete_profile_id is not null
      and public.user_can_access_athlete_profile(c.created_by_athlete_profile_id)
  )
$$;

create or replace function public.organization_id_for_event_edition(target_event_edition_id uuid)
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select es.organization_id
  from event_editions ee
  join event_series es on es.id = ee.event_series_id
  where ee.id = target_event_edition_id
$$;

create or replace function public.organization_id_for_event_series(target_event_series_id uuid)
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select es.organization_id
  from event_series es
  where es.id = target_event_series_id
$$;

create or replace function public.organization_id_for_event_category(target_event_category_id uuid)
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select es.organization_id
  from event_categories ec
  join event_editions ee on ee.id = ec.event_edition_id
  join event_series es on es.id = ee.event_series_id
  where ec.id = target_event_category_id
$$;

create or replace function public.organization_id_for_event_document(target_event_document_id uuid)
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select public.organization_id_for_event_edition(ed.event_edition_id)
  from event_documents ed
  where ed.id = target_event_document_id
$$;

create or replace function public.organization_id_for_event_registration_field(target_event_registration_field_id uuid)
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select public.organization_id_for_event_category(erf.event_category_id)
  from event_registration_fields erf
  where erf.id = target_event_registration_field_id
$$;

create or replace function public.organization_id_for_track_version(target_track_version_id uuid)
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select tt.organization_id
  from track_versions tv
  join track_templates tt on tt.id = tv.track_template_id
  where tv.id = target_track_version_id
$$;

create or replace function public.organization_id_for_track_template(target_track_template_id uuid)
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select tt.organization_id
  from track_templates tt
  where tt.id = target_track_template_id
$$;

create or replace function public.organization_id_for_snapshot(target_snapshot_id uuid)
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select public.organization_id_for_event_category(ects.event_category_id)
  from event_category_track_snapshots ects
  where ects.id = target_snapshot_id
$$;

create or replace function public.organization_id_for_checkpoint(target_checkpoint_id uuid)
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select public.organization_id_for_event_category(cp.event_category_id)
  from checkpoints cp
  where cp.id = target_checkpoint_id
$$;

create or replace function public.organization_id_for_registration(target_registration_id uuid)
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select public.organization_id_for_event_category(r.event_category_id)
  from registrations r
  where r.id = target_registration_id
$$;

create or replace function public.organization_id_for_registration_answer(target_registration_answer_id uuid)
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select public.organization_id_for_registration(ra.registration_id)
  from registration_answers ra
  where ra.id = target_registration_answer_id
$$;

create or replace function public.organization_id_for_registration_status_history(target_registration_status_history_id uuid)
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select public.organization_id_for_registration(rsh.registration_id)
  from registration_status_history rsh
  where rsh.id = target_registration_status_history_id
$$;

create or replace function public.organization_id_for_bib_assignment(target_bib_assignment_id uuid)
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select public.organization_id_for_event_edition(ba.event_edition_id)
  from bib_assignments ba
  where ba.id = target_bib_assignment_id
$$;

create or replace function public.organization_id_for_checkin(target_checkin_id uuid)
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select public.organization_id_for_registration(c.registration_id)
  from checkins c
  where c.id = target_checkin_id
$$;

create or replace function public.organization_id_for_timing_session(target_timing_session_id uuid)
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select public.organization_id_for_event_edition(ts.event_edition_id)
  from timing_sessions ts
  where ts.id = target_timing_session_id
$$;

create or replace function public.organization_id_for_punch_event(target_punch_event_id uuid)
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select public.organization_id_for_event_category(pe.event_category_id)
  from punch_events pe
  where pe.id = target_punch_event_id
$$;

create or replace function public.organization_id_for_punch_event_revision(target_punch_event_revision_id uuid)
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select public.organization_id_for_punch_event(per.punch_event_id)
  from punch_event_revisions per
  where per.id = target_punch_event_revision_id
$$;

create or replace function public.organization_id_for_participant_status(target_participant_status_id uuid)
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select public.organization_id_for_registration(ps.registration_id)
  from participant_statuses ps
  where ps.id = target_participant_status_id
$$;

create or replace function public.organization_id_for_result_run(target_result_run_id uuid)
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select public.organization_id_for_event_category(rr.event_category_id)
  from result_runs rr
  where rr.id = target_result_run_id
$$;

create or replace function public.organization_id_for_result_row(target_result_row_id uuid)
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select public.organization_id_for_result_run(rr.result_run_id)
  from result_rows rr
  where rr.id = target_result_row_id
$$;

create or replace function public.organization_id_for_result_split(target_result_split_id uuid)
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select public.organization_id_for_result_row(rs.result_row_id)
  from result_splits rs
  where rs.id = target_result_split_id
$$;

create or replace function public.organization_id_for_result_publication(target_result_publication_id uuid)
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select public.organization_id_for_event_category(rp.event_category_id)
  from result_publications rp
  where rp.id = target_result_publication_id
$$;

create or replace function public.organization_id_for_track_attempt(target_track_attempt_id uuid)
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select tt.organization_id
  from track_attempts ta
  join track_templates tt on tt.id = ta.track_template_id
  where ta.id = target_track_attempt_id
$$;

create or replace function public.organization_id_for_league_season(target_league_season_id uuid)
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select l.organization_id
  from league_seasons ls
  join leagues l on l.id = ls.league_id
  where ls.id = target_league_season_id
$$;

create or replace function public.organization_id_for_league(target_league_id uuid)
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select l.organization_id
  from leagues l
  where l.id = target_league_id
$$;

create or replace function public.organization_id_for_league_round(target_league_round_id uuid)
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select public.organization_id_for_league_season(lr.league_season_id)
  from league_rounds lr
  where lr.id = target_league_round_id
$$;

create or replace function public.organization_id_for_league_scoring_rule(target_league_scoring_rule_id uuid)
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select public.organization_id_for_league_season(lsr.league_season_id)
  from league_scoring_rules lsr
  where lsr.id = target_league_scoring_rule_id
$$;

create or replace function public.organization_id_for_league_individual_standing(target_league_individual_standing_id uuid)
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select public.organization_id_for_league_season(lis.league_season_id)
  from league_individual_standings lis
  where lis.id = target_league_individual_standing_id
$$;

create or replace function public.organization_id_for_league_club_standing(target_league_club_standing_id uuid)
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select public.organization_id_for_league_season(lcs.league_season_id)
  from league_club_standings lcs
  where lcs.id = target_league_club_standing_id
$$;

create or replace function public.is_event_edition_public(target_event_edition_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from event_editions ee
    where ee.id = target_event_edition_id
      and ee.status in (
        'published',
        'registration_open',
        'registration_closed',
        'in_progress',
        'completed',
        'archived'
      )
  )
$$;

create or replace function public.is_event_series_public(target_event_series_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from event_editions ee
    where ee.event_series_id = target_event_series_id
      and public.is_event_edition_public(ee.id)
  )
$$;

create or replace function public.is_event_category_public(target_event_category_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from event_categories ec
    where ec.id = target_event_category_id
      and ec.status <> 'draft'
      and public.is_event_edition_public(ec.event_edition_id)
  )
$$;

create or replace function public.is_track_template_public(target_track_template_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from track_templates tt
    where tt.id = target_track_template_id
      and exists (
        select 1
        from track_versions tv
        where tv.track_template_id = tt.id
      )
  )
$$;

create or replace function public.is_track_version_public(target_track_version_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from track_versions tv
    where tv.id = target_track_version_id
      and public.is_track_template_public(tv.track_template_id)
  )
$$;

create or replace function public.is_result_run_public(target_result_run_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from result_publications rp
    where rp.result_run_id = target_result_run_id
  )
$$;

create or replace function public.is_result_row_public(target_result_row_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from result_rows rr
    where rr.id = target_result_row_id
      and public.is_result_run_public(rr.result_run_id)
  )
$$;

create or replace function public.is_result_split_public(target_result_split_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from result_splits rs
    join result_rows rr on rr.id = rs.result_row_id
    where rs.id = target_result_split_id
      and public.is_result_run_public(rr.result_run_id)
  )
$$;

create or replace function public.is_league_public(target_league_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from leagues l
    where l.id = target_league_id
      and l.status <> 'draft'
  )
$$;

create or replace function public.is_league_season_public(target_league_season_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from league_seasons ls
    where ls.id = target_league_season_id
      and ls.status <> 'draft'
      and public.is_league_public(ls.league_id)
  )
$$;

create or replace function public.is_league_round_public(target_league_round_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from league_rounds lr
    where lr.id = target_league_round_id
      and public.is_league_season_public(lr.league_season_id)
  )
$$;

create or replace function public.is_league_scoring_rule_public(target_league_scoring_rule_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from league_scoring_rules lsr
    where lsr.id = target_league_scoring_rule_id
      and public.is_league_season_public(lsr.league_season_id)
  )
$$;

create or replace function public.is_league_individual_standing_public(target_league_individual_standing_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from league_individual_standings lis
    where lis.id = target_league_individual_standing_id
      and public.is_league_season_public(lis.league_season_id)
  )
$$;

create or replace function public.is_league_club_standing_public(target_league_club_standing_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from league_club_standings lcs
    where lcs.id = target_league_club_standing_id
      and public.is_league_season_public(lcs.league_season_id)
  )
$$;

do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'athlete_profiles',
    'athlete_identities',
    'athlete_aliases',
    'profile_visibility_settings',
    'organizations',
    'organization_memberships',
    'event_series',
    'event_editions',
    'event_rulesets',
    'event_categories',
    'event_documents',
    'track_templates',
    'track_versions',
    'event_category_track_snapshots',
    'checkpoints',
    'clubs',
    'club_memberships',
    'club_posts',
    'club_stats',
    'registrations',
    'registration_answers',
    'registration_status_history',
    'bib_assignments',
    'checkins',
    'timing_devices',
    'timing_sessions',
    'punch_events',
    'punch_event_revisions',
    'participant_statuses',
    'result_runs',
    'result_rows',
    'result_splits',
    'result_publications',
    'leagues',
    'league_seasons',
    'league_rounds',
    'league_scoring_rules',
    'league_individual_standings',
    'league_club_standings',
    'audit_log',
    'import_jobs',
    'export_jobs',
    'notification_jobs',
    'user_profiles',
    'athlete_claims',
    'event_registration_fields',
    'athlete_favorites',
    'athlete_activities',
    'track_render_cache',
    'track_attempts',
    'track_reviews',
    'track_condition_reports'
  ]
  loop
    execute format('alter table %I enable row level security', table_name);
  end loop;
end;
$$;

create policy athlete_profiles_select_public_or_self
on athlete_profiles
for select
using (
  public.is_athlete_profile_public(id)
  or public.user_can_access_athlete_profile(id)
);

create policy athlete_profiles_update_self
on athlete_profiles
for update
using (public.user_can_access_athlete_profile(id))
with check (public.user_can_access_athlete_profile(id));

create policy athlete_identities_select_self
on athlete_identities
for select
using (public.user_can_access_athlete_profile(athlete_profile_id));

create policy athlete_identities_insert_self
on athlete_identities
for insert
with check (
  public.user_can_access_athlete_profile(athlete_profile_id)
  and user_id = public.request_user_id()
);

create policy athlete_identities_update_self
on athlete_identities
for update
using (public.user_can_access_athlete_profile(athlete_profile_id))
with check (
  public.user_can_access_athlete_profile(athlete_profile_id)
  and user_id = public.request_user_id()
);

create policy athlete_aliases_select_public_or_self
on athlete_aliases
for select
using (
  public.is_athlete_profile_public(athlete_profile_id)
  or public.user_can_access_athlete_profile(athlete_profile_id)
);

create policy profile_visibility_settings_select_public_or_self
on profile_visibility_settings
for select
using (
  public.is_athlete_profile_public(athlete_profile_id)
  or public.user_can_access_athlete_profile(athlete_profile_id)
);

create policy profile_visibility_settings_upsert_self
on profile_visibility_settings
for insert
with check (public.user_can_access_athlete_profile(athlete_profile_id));

create policy profile_visibility_settings_update_self
on profile_visibility_settings
for update
using (public.user_can_access_athlete_profile(athlete_profile_id))
with check (public.user_can_access_athlete_profile(athlete_profile_id));

create policy organizations_select_public_or_member
on organizations
for select
using (
  status = 'active'
  or public.can_manage_organization(id)
  or public.can_time_organization(id)
);

create policy organizations_update_manage
on organizations
for update
using (public.can_manage_organization(id))
with check (public.can_manage_organization(id));

create policy organization_memberships_select_self_or_manager
on organization_memberships
for select
using (
  user_id = public.request_user_id()
  or public.can_manage_organization(organization_id)
);

create policy organization_memberships_insert_manage
on organization_memberships
for insert
with check (public.can_manage_organization(organization_id));

create policy organization_memberships_update_manage
on organization_memberships
for update
using (public.can_manage_organization(organization_id))
with check (public.can_manage_organization(organization_id));

create policy organization_memberships_delete_manage
on organization_memberships
for delete
using (public.can_manage_organization(organization_id));

create policy event_series_select_public_or_org
on event_series
for select
using (
  public.is_event_series_public(id)
  or public.can_manage_organization(organization_id)
  or public.can_time_organization(organization_id)
);

create policy event_series_write_manage
on event_series
for insert
with check (public.can_manage_organization(organization_id));

create policy event_series_update_manage
on event_series
for update
using (public.can_manage_organization(organization_id))
with check (public.can_manage_organization(organization_id));

create policy event_series_delete_manage
on event_series
for delete
using (public.can_manage_organization(organization_id));

create policy event_editions_select_public_or_org
on event_editions
for select
using (
  public.is_event_edition_public(id)
  or public.can_manage_organization(public.organization_id_for_event_edition(id))
  or public.can_time_organization(public.organization_id_for_event_edition(id))
);

create policy event_editions_insert_manage
on event_editions
for insert
with check (
  public.can_manage_organization(public.organization_id_for_event_series(event_series_id))
);

create policy event_editions_update_manage
on event_editions
for update
using (public.can_manage_organization(public.organization_id_for_event_edition(id)))
with check (public.can_manage_organization(public.organization_id_for_event_series(event_series_id)));

create policy event_editions_delete_manage
on event_editions
for delete
using (public.can_manage_organization(public.organization_id_for_event_edition(id)));

create policy event_rulesets_select_manage
on event_rulesets
for select
using (public.can_manage_organization(organization_id));

create policy event_rulesets_write_manage
on event_rulesets
for insert
with check (public.can_manage_organization(organization_id));

create policy event_rulesets_update_manage
on event_rulesets
for update
using (public.can_manage_organization(organization_id))
with check (public.can_manage_organization(organization_id));

create policy event_rulesets_delete_manage
on event_rulesets
for delete
using (public.can_manage_organization(organization_id));

create policy event_categories_select_public_or_org
on event_categories
for select
using (
  public.is_event_category_public(id)
  or public.can_manage_organization(public.organization_id_for_event_category(id))
  or public.can_time_organization(public.organization_id_for_event_category(id))
);

create policy event_categories_insert_manage
on event_categories
for insert
with check (
  public.can_manage_organization(public.organization_id_for_event_edition(event_edition_id))
);

create policy event_categories_update_manage
on event_categories
for update
using (public.can_manage_organization(public.organization_id_for_event_category(id)))
with check (
  public.can_manage_organization(public.organization_id_for_event_edition(event_edition_id))
);

create policy event_categories_delete_manage
on event_categories
for delete
using (public.can_manage_organization(public.organization_id_for_event_category(id)));

create policy event_documents_select_public_or_org
on event_documents
for select
using (
  (visibility = 'public' and public.is_event_edition_public(event_edition_id))
  or public.can_manage_organization(public.organization_id_for_event_document(id))
  or public.can_time_organization(public.organization_id_for_event_document(id))
);

create policy event_documents_write_manage
on event_documents
for insert
with check (
  public.can_manage_organization(public.organization_id_for_event_edition(event_edition_id))
);

create policy event_documents_update_manage
on event_documents
for update
using (public.can_manage_organization(public.organization_id_for_event_document(id)))
with check (
  public.can_manage_organization(public.organization_id_for_event_edition(event_edition_id))
);

create policy event_documents_delete_manage
on event_documents
for delete
using (public.can_manage_organization(public.organization_id_for_event_document(id)));

create policy event_registration_fields_select_public_or_org
on event_registration_fields
for select
using (
  public.is_event_category_public(event_category_id)
  or public.can_manage_organization(public.organization_id_for_event_registration_field(id))
  or public.can_time_organization(public.organization_id_for_event_registration_field(id))
);

create policy event_registration_fields_insert_manage
on event_registration_fields
for insert
with check (
  public.can_manage_organization(public.organization_id_for_event_category(event_category_id))
);

create policy event_registration_fields_update_manage
on event_registration_fields
for update
using (public.can_manage_organization(public.organization_id_for_event_registration_field(id)))
with check (
  public.can_manage_organization(public.organization_id_for_event_category(event_category_id))
);

create policy event_registration_fields_delete_manage
on event_registration_fields
for delete
using (public.can_manage_organization(public.organization_id_for_event_registration_field(id)));

create policy track_templates_select_public_or_org
on track_templates
for select
using (
  public.is_track_template_public(id)
  or public.can_manage_organization(organization_id)
  or public.can_time_organization(organization_id)
);

create policy track_templates_write_manage
on track_templates
for insert
with check (public.can_manage_organization(organization_id));

create policy track_templates_update_manage
on track_templates
for update
using (public.can_manage_organization(organization_id))
with check (public.can_manage_organization(organization_id));

create policy track_templates_delete_manage
on track_templates
for delete
using (public.can_manage_organization(organization_id));

create policy track_versions_select_public_or_org
on track_versions
for select
using (
  public.is_track_version_public(id)
  or public.can_manage_organization(public.organization_id_for_track_version(id))
  or public.can_time_organization(public.organization_id_for_track_version(id))
);

create policy track_versions_insert_manage
on track_versions
for insert
with check (
  public.can_manage_organization(public.organization_id_for_track_template(track_template_id))
);

create policy track_versions_update_manage
on track_versions
for update
using (public.can_manage_organization(public.organization_id_for_track_version(id)))
with check (
  public.can_manage_organization(public.organization_id_for_track_template(track_template_id))
);

create policy track_versions_delete_manage
on track_versions
for delete
using (public.can_manage_organization(public.organization_id_for_track_version(id)));

create policy snapshots_select_public_or_org
on event_category_track_snapshots
for select
using (
  public.is_event_category_public(event_category_id)
  or public.can_manage_organization(public.organization_id_for_snapshot(id))
  or public.can_time_organization(public.organization_id_for_snapshot(id))
);

create policy snapshots_insert_manage
on event_category_track_snapshots
for insert
with check (
  public.can_manage_organization(public.organization_id_for_event_category(event_category_id))
);

create policy snapshots_update_manage
on event_category_track_snapshots
for update
using (public.can_manage_organization(public.organization_id_for_snapshot(id)))
with check (
  public.can_manage_organization(public.organization_id_for_event_category(event_category_id))
);

create policy snapshots_delete_manage
on event_category_track_snapshots
for delete
using (public.can_manage_organization(public.organization_id_for_snapshot(id)));

create policy checkpoints_select_public_or_org
on checkpoints
for select
using (
  public.is_event_category_public(event_category_id)
  or public.can_manage_organization(public.organization_id_for_checkpoint(id))
  or public.can_time_organization(public.organization_id_for_checkpoint(id))
);

create policy checkpoints_insert_manage
on checkpoints
for insert
with check (
  public.can_manage_organization(public.organization_id_for_event_category(event_category_id))
);

create policy checkpoints_update_manage
on checkpoints
for update
using (public.can_manage_organization(public.organization_id_for_checkpoint(id)))
with check (
  public.can_manage_organization(public.organization_id_for_event_category(event_category_id))
);

create policy checkpoints_delete_manage
on checkpoints
for delete
using (public.can_manage_organization(public.organization_id_for_checkpoint(id)));

create policy clubs_select_public_or_member
on clubs
for select
using (
  public.is_club_public(id)
  or public.can_manage_club(id)
);

create policy clubs_insert_creator
on clubs
for insert
with check (
  created_by_athlete_profile_id is not null
  and public.user_can_access_athlete_profile(created_by_athlete_profile_id)
);

create policy clubs_update_creator
on clubs
for update
using (public.can_manage_club(id))
with check (
  created_by_athlete_profile_id is not null
  and public.user_can_access_athlete_profile(created_by_athlete_profile_id)
);

create policy clubs_delete_creator
on clubs
for delete
using (public.can_manage_club(id));

create policy club_memberships_select_public_or_self
on club_memberships
for select
using (
  public.is_club_public(club_id)
  or public.user_can_access_athlete_profile(athlete_profile_id)
  or public.can_manage_club(club_id)
);

create policy club_memberships_insert_self_or_manager
on club_memberships
for insert
with check (
  public.user_can_access_athlete_profile(athlete_profile_id)
  or public.can_manage_club(club_id)
);

create policy club_memberships_update_self_or_manager
on club_memberships
for update
using (
  public.user_can_access_athlete_profile(athlete_profile_id)
  or public.can_manage_club(club_id)
)
with check (
  public.user_can_access_athlete_profile(athlete_profile_id)
  or public.can_manage_club(club_id)
);

create policy club_memberships_delete_self_or_manager
on club_memberships
for delete
using (
  public.user_can_access_athlete_profile(athlete_profile_id)
  or public.can_manage_club(club_id)
);

create policy club_posts_select_public_or_self
on club_posts
for select
using (
  (visibility = 'public' and public.is_club_public(club_id))
  or public.user_can_access_athlete_profile(author_athlete_profile_id)
  or public.can_manage_club(club_id)
);

create policy club_posts_insert_self_or_manager
on club_posts
for insert
with check (
  public.user_can_access_athlete_profile(author_athlete_profile_id)
  or public.can_manage_club(club_id)
);

create policy club_posts_update_self_or_manager
on club_posts
for update
using (
  public.user_can_access_athlete_profile(author_athlete_profile_id)
  or public.can_manage_club(club_id)
)
with check (
  public.user_can_access_athlete_profile(author_athlete_profile_id)
  or public.can_manage_club(club_id)
);

create policy club_posts_delete_self_or_manager
on club_posts
for delete
using (
  public.user_can_access_athlete_profile(author_athlete_profile_id)
  or public.can_manage_club(club_id)
);

create policy club_stats_select_public_or_manager
on club_stats
for select
using (
  public.is_club_public(club_id)
  or public.can_manage_club(club_id)
);

create policy registrations_select_self_or_org
on registrations
for select
using (
  public.user_can_access_registration(id)
  or public.can_manage_organization(public.organization_id_for_registration(id))
  or public.can_time_organization(public.organization_id_for_registration(id))
);

create policy registrations_insert_self_or_manager
on registrations
for insert
with check (
  public.user_can_access_athlete_profile(athlete_profile_id)
  or public.can_manage_organization(public.organization_id_for_event_category(event_category_id))
);

create policy registrations_update_self_or_org
on registrations
for update
using (
  public.user_can_access_registration(id)
  or public.can_manage_organization(public.organization_id_for_registration(id))
  or public.can_time_organization(public.organization_id_for_registration(id))
)
with check (
  public.user_can_access_athlete_profile(athlete_profile_id)
  or public.can_manage_organization(public.organization_id_for_event_category(event_category_id))
  or public.can_time_organization(public.organization_id_for_event_category(event_category_id))
);

create policy registration_answers_select_self_or_org
on registration_answers
for select
using (
  public.user_can_access_registration(registration_id)
  or public.can_manage_organization(public.organization_id_for_registration_answer(id))
  or public.can_time_organization(public.organization_id_for_registration_answer(id))
);

create policy registration_answers_insert_self_or_org
on registration_answers
for insert
with check (
  public.user_can_access_registration(registration_id)
  or public.can_manage_organization(public.organization_id_for_registration(registration_id))
);

create policy registration_answers_update_self_or_org
on registration_answers
for update
using (
  public.user_can_access_registration(registration_id)
  or public.can_manage_organization(public.organization_id_for_registration_answer(id))
  or public.can_time_organization(public.organization_id_for_registration_answer(id))
)
with check (
  public.user_can_access_registration(registration_id)
  or public.can_manage_organization(public.organization_id_for_registration(registration_id))
  or public.can_time_organization(public.organization_id_for_registration(registration_id))
);

create policy registration_answers_delete_self_or_org
on registration_answers
for delete
using (
  public.user_can_access_registration(registration_id)
  or public.can_manage_organization(public.organization_id_for_registration_answer(id))
);

create policy registration_status_history_select_self_or_org
on registration_status_history
for select
using (
  public.user_can_access_registration(registration_id)
  or public.can_manage_organization(public.organization_id_for_registration_status_history(id))
  or public.can_time_organization(public.organization_id_for_registration_status_history(id))
);

create policy registration_status_history_insert_org
on registration_status_history
for insert
with check (
  public.can_manage_organization(public.organization_id_for_registration(registration_id))
  or public.can_time_organization(public.organization_id_for_registration(registration_id))
);

create policy bib_assignments_select_self_or_org
on bib_assignments
for select
using (
  public.user_can_access_registration(registration_id)
  or public.can_manage_organization(public.organization_id_for_bib_assignment(id))
  or public.can_time_organization(public.organization_id_for_bib_assignment(id))
);

create policy bib_assignments_insert_org
on bib_assignments
for insert
with check (
  public.can_manage_organization(public.organization_id_for_event_edition(event_edition_id))
  or public.can_time_organization(public.organization_id_for_event_edition(event_edition_id))
);

create policy bib_assignments_update_org
on bib_assignments
for update
using (
  public.can_manage_organization(public.organization_id_for_bib_assignment(id))
  or public.can_time_organization(public.organization_id_for_bib_assignment(id))
)
with check (
  public.can_manage_organization(public.organization_id_for_event_edition(event_edition_id))
  or public.can_time_organization(public.organization_id_for_event_edition(event_edition_id))
);

create policy checkins_select_self_or_org
on checkins
for select
using (
  public.user_can_access_registration(registration_id)
  or public.can_manage_organization(public.organization_id_for_checkin(id))
  or public.can_time_organization(public.organization_id_for_checkin(id))
);

create policy checkins_insert_org
on checkins
for insert
with check (
  public.can_manage_organization(public.organization_id_for_registration(registration_id))
  or public.can_time_organization(public.organization_id_for_registration(registration_id))
);

create policy checkins_update_org
on checkins
for update
using (
  public.can_manage_organization(public.organization_id_for_checkin(id))
  or public.can_time_organization(public.organization_id_for_checkin(id))
)
with check (
  public.can_manage_organization(public.organization_id_for_registration(registration_id))
  or public.can_time_organization(public.organization_id_for_registration(registration_id))
);

create policy timing_devices_select_org
on timing_devices
for select
using (
  public.can_manage_organization(organization_id)
  or public.can_time_organization(organization_id)
);

create policy timing_devices_write_org
on timing_devices
for insert
with check (
  public.can_manage_organization(organization_id)
  or public.can_time_organization(organization_id)
);

create policy timing_devices_update_org
on timing_devices
for update
using (
  public.can_manage_organization(organization_id)
  or public.can_time_organization(organization_id)
)
with check (
  public.can_manage_organization(organization_id)
  or public.can_time_organization(organization_id)
);

create policy timing_sessions_select_org
on timing_sessions
for select
using (
  public.can_manage_organization(public.organization_id_for_timing_session(id))
  or public.can_time_organization(public.organization_id_for_timing_session(id))
);

create policy timing_sessions_insert_org
on timing_sessions
for insert
with check (
  public.can_manage_organization(public.organization_id_for_event_edition(event_edition_id))
  or public.can_time_organization(public.organization_id_for_event_edition(event_edition_id))
);

create policy timing_sessions_update_org
on timing_sessions
for update
using (
  public.can_manage_organization(public.organization_id_for_timing_session(id))
  or public.can_time_organization(public.organization_id_for_timing_session(id))
)
with check (
  public.can_manage_organization(public.organization_id_for_event_edition(event_edition_id))
  or public.can_time_organization(public.organization_id_for_event_edition(event_edition_id))
);

create policy punch_events_select_org
on punch_events
for select
using (
  public.can_manage_organization(public.organization_id_for_punch_event(id))
  or public.can_time_organization(public.organization_id_for_punch_event(id))
);

create policy punch_events_insert_org
on punch_events
for insert
with check (
  public.can_manage_organization(public.organization_id_for_event_category(event_category_id))
  or public.can_time_organization(public.organization_id_for_event_category(event_category_id))
);

create policy punch_events_update_org
on punch_events
for update
using (
  public.can_manage_organization(public.organization_id_for_punch_event(id))
  or public.can_time_organization(public.organization_id_for_punch_event(id))
)
with check (
  public.can_manage_organization(public.organization_id_for_event_category(event_category_id))
  or public.can_time_organization(public.organization_id_for_event_category(event_category_id))
);

create policy punch_event_revisions_select_org
on punch_event_revisions
for select
using (
  public.can_manage_organization(public.organization_id_for_punch_event_revision(id))
  or public.can_time_organization(public.organization_id_for_punch_event_revision(id))
);

create policy punch_event_revisions_insert_org
on punch_event_revisions
for insert
with check (
  public.can_manage_organization(public.organization_id_for_punch_event(punch_event_id))
  or public.can_time_organization(public.organization_id_for_punch_event(punch_event_id))
);

create policy participant_statuses_select_self_or_org
on participant_statuses
for select
using (
  public.user_can_access_registration(registration_id)
  or public.can_manage_organization(public.organization_id_for_participant_status(id))
  or public.can_time_organization(public.organization_id_for_participant_status(id))
);

create policy participant_statuses_insert_org
on participant_statuses
for insert
with check (
  public.can_manage_organization(public.organization_id_for_registration(registration_id))
  or public.can_time_organization(public.organization_id_for_registration(registration_id))
);

create policy participant_statuses_update_org
on participant_statuses
for update
using (
  public.can_manage_organization(public.organization_id_for_participant_status(id))
  or public.can_time_organization(public.organization_id_for_participant_status(id))
)
with check (
  public.can_manage_organization(public.organization_id_for_registration(registration_id))
  or public.can_time_organization(public.organization_id_for_registration(registration_id))
);

create policy result_runs_select_public_or_org
on result_runs
for select
using (
  public.is_result_run_public(id)
  or public.can_manage_organization(public.organization_id_for_result_run(id))
  or public.can_time_organization(public.organization_id_for_result_run(id))
);

create policy result_runs_insert_org
on result_runs
for insert
with check (
  public.can_manage_organization(public.organization_id_for_event_category(event_category_id))
  or public.can_time_organization(public.organization_id_for_event_category(event_category_id))
);

create policy result_runs_update_org
on result_runs
for update
using (
  public.can_manage_organization(public.organization_id_for_result_run(id))
  or public.can_time_organization(public.organization_id_for_result_run(id))
)
with check (
  public.can_manage_organization(public.organization_id_for_event_category(event_category_id))
  or public.can_time_organization(public.organization_id_for_event_category(event_category_id))
);

create policy result_rows_select_public_or_org
on result_rows
for select
using (
  public.is_result_row_public(id)
  or public.can_manage_organization(public.organization_id_for_result_row(id))
  or public.can_time_organization(public.organization_id_for_result_row(id))
);

create policy result_rows_insert_org
on result_rows
for insert
with check (
  public.can_manage_organization(public.organization_id_for_result_run(result_run_id))
  or public.can_time_organization(public.organization_id_for_result_run(result_run_id))
);

create policy result_rows_update_org
on result_rows
for update
using (
  public.can_manage_organization(public.organization_id_for_result_row(id))
  or public.can_time_organization(public.organization_id_for_result_row(id))
)
with check (
  public.can_manage_organization(public.organization_id_for_result_run(result_run_id))
  or public.can_time_organization(public.organization_id_for_result_run(result_run_id))
);

create policy result_splits_select_public_or_org
on result_splits
for select
using (
  public.is_result_split_public(id)
  or public.can_manage_organization(public.organization_id_for_result_split(id))
  or public.can_time_organization(public.organization_id_for_result_split(id))
);

create policy result_splits_insert_org
on result_splits
for insert
with check (
  public.can_manage_organization(public.organization_id_for_result_row(result_row_id))
  or public.can_time_organization(public.organization_id_for_result_row(result_row_id))
);

create policy result_splits_update_org
on result_splits
for update
using (
  public.can_manage_organization(public.organization_id_for_result_split(id))
  or public.can_time_organization(public.organization_id_for_result_split(id))
)
with check (
  public.can_manage_organization(public.organization_id_for_result_row(result_row_id))
  or public.can_time_organization(public.organization_id_for_result_row(result_row_id))
);

create policy result_publications_select_public_or_org
on result_publications
for select
using (
  public.is_event_category_public(event_category_id)
  or public.can_manage_organization(public.organization_id_for_result_publication(id))
  or public.can_time_organization(public.organization_id_for_result_publication(id))
);

create policy result_publications_insert_org
on result_publications
for insert
with check (
  public.can_manage_organization(public.organization_id_for_event_category(event_category_id))
  or public.can_time_organization(public.organization_id_for_event_category(event_category_id))
);

create policy result_publications_update_org
on result_publications
for update
using (
  public.can_manage_organization(public.organization_id_for_result_publication(id))
  or public.can_time_organization(public.organization_id_for_result_publication(id))
)
with check (
  public.can_manage_organization(public.organization_id_for_event_category(event_category_id))
  or public.can_time_organization(public.organization_id_for_event_category(event_category_id))
);

create policy leagues_select_public_or_org
on leagues
for select
using (
  public.is_league_public(id)
  or public.can_manage_organization(organization_id)
);

create policy leagues_write_manage
on leagues
for insert
with check (public.can_manage_organization(organization_id));

create policy leagues_update_manage
on leagues
for update
using (public.can_manage_organization(organization_id))
with check (public.can_manage_organization(organization_id));

create policy leagues_delete_manage
on leagues
for delete
using (public.can_manage_organization(organization_id));

create policy league_seasons_select_public_or_org
on league_seasons
for select
using (
  public.is_league_season_public(id)
  or public.can_manage_organization(public.organization_id_for_league_season(id))
);

create policy league_seasons_insert_manage
on league_seasons
for insert
with check (
  public.can_manage_organization(public.organization_id_for_league(league_id))
);

create policy league_seasons_update_manage
on league_seasons
for update
using (public.can_manage_organization(public.organization_id_for_league_season(id)))
with check (public.can_manage_organization(public.organization_id_for_league(league_id)));

create policy league_seasons_delete_manage
on league_seasons
for delete
using (public.can_manage_organization(public.organization_id_for_league_season(id)));

create policy league_rounds_select_public_or_org
on league_rounds
for select
using (
  public.is_league_round_public(id)
  or public.can_manage_organization(public.organization_id_for_league_round(id))
);

create policy league_rounds_insert_manage
on league_rounds
for insert
with check (
  public.can_manage_organization(public.organization_id_for_league_season(league_season_id))
);

create policy league_rounds_update_manage
on league_rounds
for update
using (public.can_manage_organization(public.organization_id_for_league_round(id)))
with check (
  public.can_manage_organization(public.organization_id_for_league_season(league_season_id))
);

create policy league_rounds_delete_manage
on league_rounds
for delete
using (public.can_manage_organization(public.organization_id_for_league_round(id)));

create policy league_scoring_rules_select_public_or_org
on league_scoring_rules
for select
using (
  public.is_league_scoring_rule_public(id)
  or public.can_manage_organization(public.organization_id_for_league_scoring_rule(id))
);

create policy league_scoring_rules_insert_manage
on league_scoring_rules
for insert
with check (
  public.can_manage_organization(public.organization_id_for_league_season(league_season_id))
);

create policy league_scoring_rules_update_manage
on league_scoring_rules
for update
using (public.can_manage_organization(public.organization_id_for_league_scoring_rule(id)))
with check (
  public.can_manage_organization(public.organization_id_for_league_season(league_season_id))
);

create policy league_scoring_rules_delete_manage
on league_scoring_rules
for delete
using (public.can_manage_organization(public.organization_id_for_league_scoring_rule(id)));

create policy league_individual_standings_select_public_or_org
on league_individual_standings
for select
using (
  public.is_league_individual_standing_public(id)
  or public.can_manage_organization(public.organization_id_for_league_individual_standing(id))
);

create policy league_individual_standings_insert_manage
on league_individual_standings
for insert
with check (
  public.can_manage_organization(public.organization_id_for_league_season(league_season_id))
);

create policy league_individual_standings_update_manage
on league_individual_standings
for update
using (public.can_manage_organization(public.organization_id_for_league_individual_standing(id)))
with check (
  public.can_manage_organization(public.organization_id_for_league_season(league_season_id))
);

create policy league_individual_standings_delete_manage
on league_individual_standings
for delete
using (public.can_manage_organization(public.organization_id_for_league_individual_standing(id)));

create policy league_club_standings_select_public_or_org
on league_club_standings
for select
using (
  public.is_league_club_standing_public(id)
  or public.can_manage_organization(public.organization_id_for_league_club_standing(id))
);

create policy league_club_standings_insert_manage
on league_club_standings
for insert
with check (
  public.can_manage_organization(public.organization_id_for_league_season(league_season_id))
);

create policy league_club_standings_update_manage
on league_club_standings
for update
using (public.can_manage_organization(public.organization_id_for_league_club_standing(id)))
with check (
  public.can_manage_organization(public.organization_id_for_league_season(league_season_id))
);

create policy league_club_standings_delete_manage
on league_club_standings
for delete
using (public.can_manage_organization(public.organization_id_for_league_club_standing(id)));

create policy user_profiles_select_self
on user_profiles
for select
using (user_id = public.request_user_id());

create policy user_profiles_insert_self
on user_profiles
for insert
with check (user_id = public.request_user_id());

create policy user_profiles_update_self
on user_profiles
for update
using (user_id = public.request_user_id())
with check (user_id = public.request_user_id());

create policy athlete_claims_select_self
on athlete_claims
for select
using (claimant_user_id = public.request_user_id());

create policy athlete_claims_insert_self
on athlete_claims
for insert
with check (
  claimant_user_id = public.request_user_id()
  and status = 'pending'
  and reviewed_at is null
  and reviewed_by_user_id is null
);

create policy athlete_claims_update_pending_self
on athlete_claims
for update
using (
  claimant_user_id = public.request_user_id()
  and status = 'pending'
)
with check (
  claimant_user_id = public.request_user_id()
  and status = 'pending'
  and reviewed_at is null
  and reviewed_by_user_id is null
);

create policy athlete_favorites_select_self
on athlete_favorites
for select
using (public.user_can_access_athlete_profile(athlete_profile_id));

create policy athlete_favorites_insert_self
on athlete_favorites
for insert
with check (public.user_can_access_athlete_profile(athlete_profile_id));

create policy athlete_favorites_update_self
on athlete_favorites
for update
using (public.user_can_access_athlete_profile(athlete_profile_id))
with check (public.user_can_access_athlete_profile(athlete_profile_id));

create policy athlete_favorites_delete_self
on athlete_favorites
for delete
using (public.user_can_access_athlete_profile(athlete_profile_id));

create policy athlete_activities_select_self
on athlete_activities
for select
using (public.user_can_access_athlete_profile(athlete_profile_id));

create policy athlete_activities_insert_self
on athlete_activities
for insert
with check (public.user_can_access_athlete_profile(athlete_profile_id));

create policy athlete_activities_update_self
on athlete_activities
for update
using (public.user_can_access_athlete_profile(athlete_profile_id))
with check (public.user_can_access_athlete_profile(athlete_profile_id));

create policy athlete_activities_delete_self
on athlete_activities
for delete
using (public.user_can_access_athlete_profile(athlete_profile_id));

create policy track_render_cache_select_public_or_org
on track_render_cache
for select
using (
  public.is_track_version_public(track_version_id)
  or public.can_manage_organization(public.organization_id_for_track_version(track_version_id))
  or public.can_time_organization(public.organization_id_for_track_version(track_version_id))
);

create policy track_render_cache_write_manage
on track_render_cache
for insert
with check (
  public.can_manage_organization(public.organization_id_for_track_version(track_version_id))
);

create policy track_render_cache_update_manage
on track_render_cache
for update
using (public.can_manage_organization(public.organization_id_for_track_version(track_version_id)))
with check (public.can_manage_organization(public.organization_id_for_track_version(track_version_id)));

create policy track_render_cache_delete_manage
on track_render_cache
for delete
using (public.can_manage_organization(public.organization_id_for_track_version(track_version_id)));

create policy track_attempts_select_public_self_or_org
on track_attempts
for select
using (
  verification_status = 'verified'
  or public.user_can_access_athlete_profile(athlete_profile_id)
  or public.can_manage_organization(public.organization_id_for_track_attempt(id))
  or public.can_time_organization(public.organization_id_for_track_attempt(id))
);

create policy track_attempts_insert_self_or_org
on track_attempts
for insert
with check (
  public.user_can_access_athlete_profile(athlete_profile_id)
  or public.can_manage_organization(public.organization_id_for_track_template(track_template_id))
  or public.can_time_organization(public.organization_id_for_track_template(track_template_id))
);

create policy track_attempts_update_self_or_org
on track_attempts
for update
using (
  public.user_can_access_athlete_profile(athlete_profile_id)
  or public.can_manage_organization(public.organization_id_for_track_attempt(id))
  or public.can_time_organization(public.organization_id_for_track_attempt(id))
)
with check (
  public.user_can_access_athlete_profile(athlete_profile_id)
  or public.can_manage_organization(public.organization_id_for_track_template(track_template_id))
  or public.can_time_organization(public.organization_id_for_track_template(track_template_id))
);

create policy track_attempts_delete_self_or_org
on track_attempts
for delete
using (
  public.user_can_access_athlete_profile(athlete_profile_id)
  or public.can_manage_organization(public.organization_id_for_track_attempt(id))
);

create policy track_reviews_select_public_or_org
on track_reviews
for select
using (
  public.is_track_template_public(track_template_id)
  or public.can_manage_organization(public.organization_id_for_track_template(track_template_id))
  or public.can_time_organization(public.organization_id_for_track_template(track_template_id))
);

create policy track_reviews_insert_self
on track_reviews
for insert
with check (
  public.user_can_access_athlete_profile(athlete_profile_id)
  and public.is_track_template_public(track_template_id)
);

create policy track_reviews_update_self_or_org
on track_reviews
for update
using (
  public.user_can_access_athlete_profile(athlete_profile_id)
  or public.can_manage_organization(public.organization_id_for_track_template(track_template_id))
)
with check (
  public.user_can_access_athlete_profile(athlete_profile_id)
  or public.can_manage_organization(public.organization_id_for_track_template(track_template_id))
);

create policy track_reviews_delete_self_or_org
on track_reviews
for delete
using (
  public.user_can_access_athlete_profile(athlete_profile_id)
  or public.can_manage_organization(public.organization_id_for_track_template(track_template_id))
);

create policy track_condition_reports_select_public_or_org
on track_condition_reports
for select
using (
  public.is_track_template_public(track_template_id)
  or public.can_manage_organization(public.organization_id_for_track_template(track_template_id))
  or public.can_time_organization(public.organization_id_for_track_template(track_template_id))
);

create policy track_condition_reports_insert_self
on track_condition_reports
for insert
with check (
  public.user_can_access_athlete_profile(athlete_profile_id)
  and public.is_track_template_public(track_template_id)
);

create policy track_condition_reports_update_self_or_org
on track_condition_reports
for update
using (
  public.user_can_access_athlete_profile(athlete_profile_id)
  or public.can_manage_organization(public.organization_id_for_track_template(track_template_id))
)
with check (
  public.user_can_access_athlete_profile(athlete_profile_id)
  or public.can_manage_organization(public.organization_id_for_track_template(track_template_id))
);

create policy track_condition_reports_delete_self_or_org
on track_condition_reports
for delete
using (
  public.user_can_access_athlete_profile(athlete_profile_id)
  or public.can_manage_organization(public.organization_id_for_track_template(track_template_id))
);

commit;
