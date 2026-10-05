begin;

-- A result can be published before an organizer adds its race to a league.
-- Publication propagation cannot see mappings that do not exist yet, so the
-- attach workflow needs an idempotent way to select the latest immutable
-- publication after the mapping has been saved.
create or replace function public.service_reconcile_league_result_sources(
  p_organization_id uuid,
  p_league_season_id uuid,
  p_actor_user_id uuid,
  p_change_note text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $reconcile$
declare
  season_row public.league_seasons%rowtype;
  mapping_row record;
  legacy_round_row record;
  mapping_source public.league_round_mapping_source_versions%rowtype;
  legacy_source public.league_round_source_versions%rowtype;
  resolved_organization_id uuid;
  publication_digest text;
  source_digest text;
  next_version integer;
  source_selection_count integer := 0;
  pointer_repair_count integer := 0;
  computed_standings jsonb := null;
  standings_ready boolean := false;
begin
  if p_organization_id is null
     or p_league_season_id is null
     or p_actor_user_id is null
     or nullif(trim(p_change_note), '') is null then
    raise exception using errcode = '22023', message = 'league_source_reconciliation_input_invalid';
  end if;

  select season.*
  into season_row
  from public.league_seasons season
  where season.id = p_league_season_id
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'league_season_not_found';
  end if;

  select league.organization_id
  into resolved_organization_id
  from public.leagues league
  where league.id = season_row.league_id;
  if resolved_organization_id is distinct from p_organization_id then
    raise exception using errcode = '42501', message = 'league_organization_mismatch';
  end if;
  if not public.service_user_has_organization_permission(
    p_organization_id, p_actor_user_id, 'leagues.manage', 'organization', null
  ) then
    raise exception using errcode = '42501', message = 'league_manage_permission_required';
  end if;

  for mapping_row in
    select
      mapping.id,
      mapping.current_source_version_id,
      mapping.current_result_publication_id,
      round_event.id as round_event_id,
      publication.id as publication_id,
      publication.result_run_id,
      publication.publication_state,
      publication.manifest_digest_sha256,
      publication.published_at,
      publication.created_at,
      publication.change_note
    from public.league_round_race_mappings mapping
    join public.league_round_events round_event
      on round_event.id = mapping.league_round_event_id
    join lateral (
      select candidate.*
      from public.result_publications candidate
      where candidate.event_category_id = mapping.event_category_id
        and candidate.publication_state in ('official', 'corrected')
      order by candidate.published_at desc, candidate.created_at desc, candidate.id desc
      limit 1
    ) publication on true
    where round_event.league_season_id = p_league_season_id
      and mapping.status = 'mapped'
    order by round_event.round_number, mapping.id
    for update of mapping
  loop
    publication_digest := coalesce(
      mapping_row.manifest_digest_sha256,
      encode(
        public.digest(
          convert_to(
            jsonb_build_object(
              'publicationId', mapping_row.publication_id,
              'resultRunId', mapping_row.result_run_id,
              'publicationState', mapping_row.publication_state,
              'publishedAt', mapping_row.published_at
            )::text,
            'utf8'
          ),
          'sha256'
        ),
        'hex'
      )
    );

    select source.*
    into mapping_source
    from public.league_round_mapping_source_versions source
    where source.league_round_race_mapping_id = mapping_row.id
      and source.result_publication_id = mapping_row.publication_id;

    if not found then
      select coalesce(max(source.version_number), 0) + 1
      into next_version
      from public.league_round_mapping_source_versions source
      where source.league_round_race_mapping_id = mapping_row.id;

      source_digest := encode(
        public.digest(
          convert_to(
            jsonb_build_object(
              'leagueRoundRaceMappingId', mapping_row.id,
              'versionNumber', next_version,
              'resultPublicationId', mapping_row.publication_id,
              'publicationDigestSha256', publication_digest
            )::text,
            'utf8'
          ),
          'sha256'
        ),
        'hex'
      );

      insert into public.league_round_mapping_source_versions (
        league_round_race_mapping_id,
        version_number,
        result_publication_id,
        publication_state,
        publication_digest_sha256,
        source_digest_sha256,
        change_note,
        selected_by_user_id
      )
      values (
        mapping_row.id,
        next_version,
        mapping_row.publication_id,
        mapping_row.publication_state,
        publication_digest,
        source_digest,
        coalesce(nullif(trim(coalesce(mapping_row.change_note, '')), ''), trim(p_change_note)),
        p_actor_user_id
      )
      returning * into mapping_source;
    end if;

    if mapping_row.current_source_version_id is distinct from mapping_source.id then
      source_selection_count := source_selection_count + 1;
    end if;
    if mapping_row.current_source_version_id is distinct from mapping_source.id
       or mapping_row.current_result_publication_id is distinct from mapping_row.publication_id then
      pointer_repair_count := pointer_repair_count + 1;
    end if;

    update public.league_round_race_mappings mapping
    set
      current_source_version_id = mapping_source.id,
      current_result_publication_id = mapping_row.publication_id,
      updated_at = clock_timestamp()
    where mapping.id = mapping_row.id
      and (
        mapping.current_source_version_id is distinct from mapping_source.id
        or mapping.current_result_publication_id is distinct from mapping_row.publication_id
      );
  end loop;

  update public.league_round_events round_event
  set
    status = 'completed',
    updated_at = clock_timestamp()
  where round_event.league_season_id = p_league_season_id
    and round_event.status <> 'cancelled'
    and exists (
      select 1
      from public.league_round_race_mappings mapping
      where mapping.league_round_event_id = round_event.id
        and mapping.status = 'mapped'
    )
    and not exists (
      select 1
      from public.league_round_race_mappings mapping
      where mapping.league_round_event_id = round_event.id
        and mapping.status = 'mapped'
        and (
          mapping.current_source_version_id is null
          or mapping.current_result_publication_id is null
        )
    );

  -- Keep the compatibility round used by the season-level standings manifest
  -- pinned to the same latest publication as its selected race.
  for legacy_round_row in
    select
      round.id,
      round.current_source_version_id,
      round.current_result_publication_id,
      publication.id as publication_id,
      publication.result_run_id,
      publication.publication_state,
      publication.manifest_digest_sha256,
      publication.published_at,
      publication.created_at,
      publication.change_note
    from public.league_rounds round
    join lateral (
      select candidate.*
      from public.result_publications candidate
      where candidate.event_category_id = round.event_category_id
        and candidate.publication_state in ('official', 'corrected')
      order by candidate.published_at desc, candidate.created_at desc, candidate.id desc
      limit 1
    ) publication on true
    where round.league_season_id = p_league_season_id
    order by round.round_number, round.id
    for update of round
  loop
    publication_digest := coalesce(
      legacy_round_row.manifest_digest_sha256,
      encode(
        public.digest(
          convert_to(
            jsonb_build_object(
              'publicationId', legacy_round_row.publication_id,
              'resultRunId', legacy_round_row.result_run_id,
              'publicationState', legacy_round_row.publication_state,
              'publishedAt', legacy_round_row.published_at
            )::text,
            'utf8'
          ),
          'sha256'
        ),
        'hex'
      )
    );

    select source.*
    into legacy_source
    from public.league_round_source_versions source
    where source.league_round_id = legacy_round_row.id
      and source.result_publication_id = legacy_round_row.publication_id;

    if not found then
      select coalesce(max(source.version_number), 0) + 1
      into next_version
      from public.league_round_source_versions source
      where source.league_round_id = legacy_round_row.id;

      source_digest := encode(
        public.digest(
          convert_to(
            jsonb_build_object(
              'leagueRoundId', legacy_round_row.id,
              'versionNumber', next_version,
              'resultPublicationId', legacy_round_row.publication_id,
              'publicationDigestSha256', publication_digest
            )::text,
            'utf8'
          ),
          'sha256'
        ),
        'hex'
      );

      insert into public.league_round_source_versions (
        league_round_id,
        version_number,
        result_publication_id,
        publication_state,
        publication_digest_sha256,
        source_digest_sha256,
        change_note,
        selected_by_user_id,
        client_event_id
      )
      values (
        legacy_round_row.id,
        next_version,
        legacy_round_row.publication_id,
        legacy_round_row.publication_state,
        publication_digest,
        source_digest,
        coalesce(nullif(trim(coalesce(legacy_round_row.change_note, '')), ''), trim(p_change_note)),
        p_actor_user_id,
        gen_random_uuid()
      )
      returning * into legacy_source;
    end if;

    if legacy_round_row.current_source_version_id is distinct from legacy_source.id then
      source_selection_count := source_selection_count + 1;
    end if;
    if legacy_round_row.current_source_version_id is distinct from legacy_source.id
       or legacy_round_row.current_result_publication_id is distinct from legacy_round_row.publication_id then
      pointer_repair_count := pointer_repair_count + 1;
    end if;

    update public.league_rounds round
    set
      current_source_version_id = legacy_source.id,
      current_result_publication_id = legacy_round_row.publication_id,
      status = 'completed',
      updated_at = clock_timestamp()
    where round.id = legacy_round_row.id
      and (
        round.current_source_version_id is distinct from legacy_source.id
        or round.current_result_publication_id is distinct from legacy_round_row.publication_id
        or round.status <> 'completed'
      );
  end loop;

  if source_selection_count > 0 then
    update public.league_seasons season
    set
      standings_stale_since = coalesce(season.standings_stale_since, clock_timestamp()),
      updated_at = clock_timestamp()
    where season.id = p_league_season_id;

    select
      season_row.current_scoring_rule_version_id is not null
      and exists (
        select 1
        from public.league_rounds round
        where round.league_season_id = p_league_season_id
      )
      and not exists (
        select 1
        from public.league_rounds round
        where round.league_season_id = p_league_season_id
          and round.current_source_version_id is null
      )
      and not exists (
        select 1
        from public.league_round_events round_event
        join public.league_round_race_mappings mapping
          on mapping.league_round_event_id = round_event.id
         and mapping.status = 'mapped'
        join public.league_competitions competition
          on competition.id = mapping.league_competition_id
         and competition.status <> 'archived'
        where round_event.league_season_id = p_league_season_id
          and (
            mapping.current_source_version_id is null
            or competition.current_scoring_policy_version_id is null
          )
      )
    into standings_ready;

    if standings_ready then
      begin
        computed_standings := public.service_compute_league_standings(
          p_organization_id,
          p_league_season_id,
          p_actor_user_id,
          trim(p_change_note),
          gen_random_uuid()
        );
      exception
        when unique_violation then
          if sqlerrm <> 'league_standings_inputs_unchanged' then
            raise;
          end if;
          update public.league_seasons season
          set standings_stale_since = null, updated_at = clock_timestamp()
          where season.id = p_league_season_id;
      end;
    end if;
  end if;

  return jsonb_build_object(
    'leagueSeasonId', p_league_season_id,
    'sourceSelectionCount', source_selection_count,
    'pointerRepairCount', pointer_repair_count,
    'standingsReady', standings_ready,
    'standingsVersionId', coalesce(
      computed_standings ->> 'standingsVersionId',
      (select current_standings_version_id::text from public.league_seasons where id = p_league_season_id)
    )
  );
end
$reconcile$;

revoke all on function public.service_reconcile_league_result_sources(uuid,uuid,uuid,text)
  from public, anon, authenticated;
grant execute on function public.service_reconcile_league_result_sources(uuid,uuid,uuid,text)
  to service_role;

comment on function public.service_reconcile_league_result_sources(uuid,uuid,uuid,text) is
  'Pins latest eligible result publications after league mapping mutations, repairs compatibility pointers, and recomputes ready standings.';

-- Existing immutable source selections are already audited. Repair only the
-- denormalized publication pointers derived from those selections; do not
-- create history or recompute standings for unrelated seasons during release.
update public.league_round_race_mappings mapping
set
  current_result_publication_id = source.result_publication_id,
  updated_at = clock_timestamp()
from public.league_round_mapping_source_versions source
where source.id = mapping.current_source_version_id
  and mapping.current_result_publication_id is distinct from source.result_publication_id;

update public.league_rounds round
set
  current_result_publication_id = source.result_publication_id,
  status = case when round.status = 'cancelled' then round.status else 'completed' end,
  updated_at = clock_timestamp()
from public.league_round_source_versions source
where source.id = round.current_source_version_id
  and (
    round.current_result_publication_id is distinct from source.result_publication_id
    or round.status not in ('completed', 'cancelled')
  );

update public.league_round_events round_event
set
  status = 'completed',
  updated_at = clock_timestamp()
where round_event.status <> 'cancelled'
  and exists (
    select 1
    from public.league_round_race_mappings mapping
    where mapping.league_round_event_id = round_event.id
      and mapping.status = 'mapped'
  )
  and not exists (
    select 1
    from public.league_round_race_mappings mapping
    where mapping.league_round_event_id = round_event.id
      and mapping.status = 'mapped'
      and (
        mapping.current_source_version_id is null
        or mapping.current_result_publication_id is null
      )
  );

commit;
