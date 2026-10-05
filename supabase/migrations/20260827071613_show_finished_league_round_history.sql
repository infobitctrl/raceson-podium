-- Keep event history in the existing RLS-filtered, single-request detail
-- bundle. League events show the latest finished rounds in their published
-- seasons, not the latest scheduled editions of a recurring event series.
do $migration$
declare
  bundle_definition text;
  old_history text := $old$      'previous_editions', coalesce((
        select jsonb_agg(to_jsonb(previous_row) order by previous_row.start_date desc)
        from (
          select previous.slug, previous.name, previous.start_date
          from public.event_editions previous
          join selected_edition edition
            on edition.event_series_id = previous.event_series_id
          where previous.id <> edition.id
          order by previous.start_date desc
          limit 3
        ) previous_row
      ), '[]'::jsonb),$old$;
  new_history text := $new$      'previous_editions', coalesce((
        with history_seasons as (
          select season.id
          from public.league_seasons season
          join selected_seasons selected on selected.id = season.id
          where season.status <> 'draft'
        )
        select jsonb_agg(to_jsonb(previous_row) order by previous_row.start_date desc, previous_row.slug)
        from (
          select previous.slug, previous.name, previous.start_date
          from public.event_editions previous
          cross join selected_edition edition
          where previous.id <> edition.id
            and previous.published_at is not null
            and previous.status <> 'draft'
            and previous.public_visibility = 'public'
            and previous.organizer_deleted_at is null
            and (
              (
                not exists (select 1 from history_seasons)
                and previous.event_series_id = edition.event_series_id
              )
              or (
                previous.status in ('completed', 'archived')
                and exists (
                  select 1
                  from public.league_rounds previous_round
                  join history_seasons season on season.id = previous_round.league_season_id
                  where previous_round.event_edition_id = previous.id
                    and previous_round.status not in ('draft', 'cancelled')
                )
              )
            )
          order by previous.start_date desc, previous.slug
          limit 3
        ) previous_row
      ), '[]'::jsonb),$new$;
  replacement_count integer;
begin
  select pg_get_functiondef('public.public_event_detail_bundle(text)'::regprocedure)
  into bundle_definition;

  -- Permit reapplying this exact local change without altering other bundle
  -- fields, function security, or its reviewed execution grants.
  if strpos(bundle_definition, new_history) > 0 then
    return;
  end if;
  replacement_count := (
    length(bundle_definition) - length(replace(bundle_definition, old_history, ''))
  ) / length(old_history);
  if replacement_count <> 1 then
    raise exception 'Expected one public event history query, found %', replacement_count;
  end if;

  execute replace(bundle_definition, old_history, new_history);
end
$migration$;
