-- Vrpolje is a public Croatian event, but its imported event-series row has no
-- Croatian country scope. Public portal readers therefore include it through
-- RLS while the country-scoped server projection omits it. Repair only the
-- exact imported series and fail the migration if its identity has drifted.
do $$
declare
  target_edition_id constant uuid := '62692e70-3319-48c2-8bc4-76a67b882d5e';
  target_series_id uuid;
  current_country_code text;
  target_id_count integer;
  matched_row_count integer;
  updated_row_count integer;
begin
  select count(*)
  into target_id_count
  from public.event_editions
  where id = target_edition_id;

  -- Fresh installations do not contain the staging-only legacy import.
  if target_id_count = 0 then
    return;
  end if;

  select
    edition.event_series_id,
    nullif(upper(trim(series.country_code)), '')
  into target_series_id, current_country_code
  from public.event_editions edition
  join public.event_series series
    on series.id = edition.event_series_id
  where edition.id = target_edition_id
    and edition.slug = 'vrpolje-trail-2026-2026'
    and edition.name = 'Vrpolje Trail 2026'
    and edition.location_name = 'Vrpolje, Šibenik'
    and edition.status = 'completed'
    and edition.public_visibility = 'public'
    and edition.published_at is not null;

  get diagnostics matched_row_count = row_count;

  if matched_row_count <> 1 or target_series_id is null then
    raise exception
      'vrpolje_public_country_scope_identity_mismatch: expected 1 exact public edition, found %',
      matched_row_count;
  end if;

  if current_country_code is not null and current_country_code <> 'HR' then
    raise exception
      'vrpolje_public_country_scope_conflict: expected NULL or HR, found %',
      current_country_code;
  end if;

  update public.event_series
  set country_code = 'HR'
  where id = target_series_id
    and country_code is distinct from 'HR';

  get diagnostics updated_row_count = row_count;

  if current_country_code is null and updated_row_count <> 1 then
    raise exception
      'vrpolje_public_country_scope_update_mismatch: expected 1 update, found %',
      updated_row_count;
  end if;

  if current_country_code = 'HR' and updated_row_count <> 0 then
    raise exception
      'vrpolje_public_country_scope_idempotency_mismatch: expected 0 updates, found %',
      updated_row_count;
  end if;

  if not exists (
    select 1
    from public.event_editions edition
    join public.event_series series
      on series.id = edition.event_series_id
    where edition.id = target_edition_id
      and series.country_code = 'HR'
      and edition.public_visibility = 'public'
      and edition.published_at is not null
      and edition.status <> 'draft'
  ) then
    raise exception 'vrpolje_public_country_scope_verification_failed';
  end if;
end
$$;
