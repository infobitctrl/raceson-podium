begin;

-- Keep stable identifiers and historical migration files intact while moving
-- current, user-visible platform copy to the RacesOn brand.
update public.badge_definitions
set description = 'Complete 25 races on RacesOn.'
where id = '41000000-0000-4000-8000-000000000007'
  and description is distinct from 'Complete 25 races on RacesOn.';

update public.event_series as series
set
  name = 'RacesOn Test Race',
  updated_at = now()
where series.name = 'SiTrail Test Race'
  and exists (
    select 1
    from public.event_editions as edition
    where edition.event_series_id = series.id
      and edition.is_practice
  );

update public.track_templates as template
set
  name = 'RacesOn Test Route',
  updated_at = now()
where template.name = 'SiTrail Test Route'
  and exists (
    select 1
    from public.event_category_track_snapshots as snapshot
    join public.event_categories as category
      on category.id = snapshot.event_category_id
    join public.event_editions as edition
      on edition.id = category.event_edition_id
    where snapshot.track_template_id = template.id
      and edition.is_practice
  );

do $$
declare
  function_definition text;
begin
  select pg_get_functiondef(
    'public.service_render_analytics_export(jsonb,text[],text,jsonb)'::regprocedure
  )
  into function_definition;

  if position('# SiTrail export metadata:' in function_definition) > 0 then
    execute replace(
      function_definition,
      '# SiTrail export metadata:',
      '# RacesOn export metadata:'
    );
  end if;
end;
$$;

commit;
