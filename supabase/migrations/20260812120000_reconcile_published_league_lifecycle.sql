-- Reconcile legacy league seasons that were made public before the canonical
-- competition and immutable-standings publication workflow was introduced.
-- Public read models intentionally expose active competitions only, so a
-- published season must never retain draft lifecycle state below it.

update public.league_competitions competition
set
  status = 'active',
  updated_at = clock_timestamp()
from public.league_seasons season
where season.id = competition.league_season_id
  and season.published_at is not null
  and competition.status = 'draft';

update public.league_seasons season
set
  status = 'published',
  updated_at = clock_timestamp()
where season.published_at is not null
  and season.status = 'draft';

update public.leagues league
set
  status = 'published',
  updated_at = clock_timestamp()
where league.status = 'draft'
  and exists (
    select 1
    from public.league_seasons season
    where season.league_id = league.id
      and season.published_at is not null
  );

-- Legacy result imports already created immutable source versions but did not
-- populate the current pointer required by the standings pipeline.
with latest_source as (
  select distinct on (source.league_round_id)
    source.league_round_id,
    source.id
  from public.league_round_source_versions source
  order by source.league_round_id, source.version_number desc, source.created_at desc, source.id desc
)
update public.league_rounds round
set
  current_source_version_id = latest_source.id,
  updated_at = clock_timestamp()
from latest_source, public.league_seasons season
where round.id = latest_source.league_round_id
  and season.id = round.league_season_id
  and season.published_at is not null
  and round.current_source_version_id is null;

-- The canonical multi-competition pipeline pins each mapped race separately.
-- These mapping source rows were imported alongside the legacy round sources,
-- but their current pointers were likewise left empty.
with latest_mapping_source as (
  select distinct on (source.league_round_race_mapping_id)
    source.league_round_race_mapping_id,
    source.id
  from public.league_round_mapping_source_versions source
  order by
    source.league_round_race_mapping_id,
    source.version_number desc,
    source.created_at desc,
    source.id desc
)
update public.league_round_race_mappings mapping
set
  current_source_version_id = latest_mapping_source.id,
  updated_at = clock_timestamp()
from latest_mapping_source, public.league_round_events round_event, public.league_seasons season
where mapping.id = latest_mapping_source.league_round_race_mapping_id
  and round_event.id = mapping.league_round_event_id
  and season.id = round_event.league_season_id
  and season.published_at is not null
  and mapping.status = 'mapped'
  and mapping.current_source_version_id is null;

-- Freeze the existing season-level scoring policy through the same audited
-- service used by organizer publication. Competition-specific immutable
-- policies remain the source of truth for Short and Long public boards.
do $backfill_scoring_versions$
declare
  target record;
  actor_user_id uuid;
begin
  for target in
    select
      season.id as season_id,
      league.organization_id,
      rules.name,
      rules.points_table_json,
      rules.best_n_rounds,
      coalesce(rules.minimum_rounds, 1) as minimum_rounds,
      case
        when rules.tie_break_method in ('most_wins', 'best_finish', 'last_round')
          then rules.tie_break_method
        else 'last_round'
      end as tie_break_method,
      case when rules.club_scoring_mode = 'best_one' then 1 else 3 end as club_members_per_round
    from public.league_seasons season
    join public.leagues league on league.id = season.league_id
    join public.league_scoring_rules rules on rules.league_season_id = season.id
    where season.published_at is not null
      and season.current_scoring_rule_version_id is null
  loop
    select membership.user_id
    into actor_user_id
    from public.organization_memberships membership
    where membership.organization_id = target.organization_id
      and membership.status = 'active'
      and membership.role in ('owner', 'admin')
    order by
      case membership.role when 'owner' then 0 else 1 end,
      membership.created_at,
      membership.user_id
    limit 1;

    if actor_user_id is null then
      raise exception 'Published league season % has no active owner or admin for scoring backfill', target.season_id;
    end if;

    perform public.service_publish_league_scoring_rules(
      target.organization_id,
      target.season_id,
      actor_user_id,
      target.name,
      target.points_table_json,
      target.best_n_rounds,
      target.minimum_rounds,
      target.tie_break_method,
      target.club_members_per_round,
      '{}'::jsonb,
      gen_random_uuid()
    );
  end loop;
end
$backfill_scoring_versions$;

-- Once every round has an immutable result source, generate the missing
-- persisted standings version so API consumers and future publication jobs
-- start from the same canonical state as the public derived boards.
do $backfill_standings$
declare
  target record;
  actor_user_id uuid;
begin
  for target in
    select season.id as season_id, league.organization_id
    from public.league_seasons season
    join public.leagues league on league.id = season.league_id
    where season.published_at is not null
      and season.current_scoring_rule_version_id is not null
      and season.current_standings_version_id is null
      and exists (
        select 1
        from public.league_rounds round
        where round.league_season_id = season.id
      )
      and not exists (
        select 1
        from public.league_rounds round
        where round.league_season_id = season.id
          and round.current_source_version_id is null
      )
  loop
    select membership.user_id
    into actor_user_id
    from public.organization_memberships membership
    where membership.organization_id = target.organization_id
      and membership.status = 'active'
      and membership.role in ('owner', 'admin')
    order by
      case membership.role when 'owner' then 0 else 1 end,
      membership.created_at,
      membership.user_id
    limit 1;

    if actor_user_id is null then
      raise exception 'Published league season % has no active owner or admin for standings backfill', target.season_id;
    end if;

    perform public.service_compute_league_standings(
      target.organization_id,
      target.season_id,
      actor_user_id,
      'Backfilled canonical standings for a published league season',
      gen_random_uuid()
    );
  end loop;
end
$backfill_standings$;
