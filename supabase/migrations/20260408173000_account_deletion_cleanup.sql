begin;

create or replace function public.delete_user_account_data(
  target_user_id uuid,
  target_email text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  normalized_email citext := nullif(trim(target_email), '')::citext;
  released_athlete_profiles integer := 0;
  deleted_memberships integer := 0;
  deleted_identities integer := 0;
  deleted_claims integer := 0;
  deleted_security_events integer := 0;
  deleted_user_profiles integer := 0;
begin
  if target_user_id is null then
    raise exception 'target_user_id is required'
      using errcode = '22023';
  end if;

  update public.organization_memberships
  set
    invited_by_user_id = null,
    updated_at = now()
  where invited_by_user_id = target_user_id;

  update public.registration_status_history
  set changed_by_user_id = null
  where changed_by_user_id = target_user_id;

  update public.bib_assignments
  set assigned_by_user_id = null
  where assigned_by_user_id = target_user_id;

  update public.checkins
  set checked_in_by_user_id = null
  where checked_in_by_user_id = target_user_id;

  update public.timing_sessions
  set started_by_user_id = null
  where started_by_user_id = target_user_id;

  update public.punch_events
  set entered_by_user_id = null
  where entered_by_user_id = target_user_id;

  update public.punch_event_revisions
  set created_by_user_id = null
  where created_by_user_id = target_user_id;

  update public.participant_statuses
  set created_by_user_id = null
  where created_by_user_id = target_user_id;

  update public.result_publications
  set published_by_user_id = null
  where published_by_user_id = target_user_id;

  update public.audit_log
  set actor_user_id = null
  where actor_user_id = target_user_id;

  update public.export_jobs
  set requested_by_user_id = null
  where requested_by_user_id = target_user_id;

  update public.athlete_profiles
  set
    claimed_by_user_id = null,
    is_claimed = false,
    primary_email = case
      when normalized_email is not null and primary_email = normalized_email then null
      else primary_email
    end,
    updated_at = now()
  where claimed_by_user_id = target_user_id;

  get diagnostics released_athlete_profiles = row_count;

  delete from public.organization_memberships
  where user_id = target_user_id;

  get diagnostics deleted_memberships = row_count;

  delete from public.athlete_identities
  where user_id = target_user_id;

  get diagnostics deleted_identities = row_count;

  delete from public.athlete_claims
  where claimant_user_id = target_user_id;

  get diagnostics deleted_claims = row_count;

  delete from public.auth_security_events
  where user_id = target_user_id
    or (
      normalized_email is not null
      and email = normalized_email
    );

  get diagnostics deleted_security_events = row_count;

  delete from public.user_profiles
  where user_id = target_user_id;

  get diagnostics deleted_user_profiles = row_count;

  return jsonb_build_object(
    'released_athlete_profiles', released_athlete_profiles,
    'deleted_memberships', deleted_memberships,
    'deleted_identities', deleted_identities,
    'deleted_claims', deleted_claims,
    'deleted_security_events', deleted_security_events,
    'deleted_user_profiles', deleted_user_profiles
  );
end;
$$;

revoke all on function public.delete_user_account_data(uuid, text) from public;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function public.delete_user_account_data(uuid, text) to service_role;
  end if;
end;
$$;

commit;
