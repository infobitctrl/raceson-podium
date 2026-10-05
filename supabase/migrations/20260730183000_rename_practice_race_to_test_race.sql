begin;

update public.event_series as series
set
  name = 'SiTrail Test Race',
  description = 'Private Test Race for organizers and timing crews.',
  location_name = 'Test course',
  updated_at = now()
where exists (
  select 1
  from public.event_editions as edition
  where edition.event_series_id = series.id
    and edition.is_practice
);

update public.event_editions
set
  name = 'Test Race',
  location_name = 'Test course',
  about_text = 'Permanent private Test Race. Reset it whenever the team needs a fresh run.',
  updated_at = now()
where is_practice;

update public.event_categories as category
set
  name = case category.slug
    when 'practice-short' then 'Test Short'
    when 'practice-long' then 'Test Long'
    else regexp_replace(category.name, '^Practice ', 'Test ')
  end,
  organizer_notes = 'Private test category with five synthetic runners.',
  updated_at = now()
where exists (
  select 1
  from public.event_editions as edition
  where edition.id = category.event_edition_id
    and edition.is_practice
);

update public.track_templates as template
set
  name = 'SiTrail Test Route',
  notes = 'Private synthetic route used only by Test Race.',
  updated_at = now()
where exists (
  select 1
  from public.event_category_track_snapshots as snapshot
  join public.event_categories as category
    on category.id = snapshot.event_category_id
  join public.event_editions as edition
    on edition.id = category.event_edition_id
  where snapshot.track_template_id = template.id
    and edition.is_practice
);

update public.event_category_track_snapshots as snapshot
set snapshot_name = regexp_replace(snapshot.snapshot_name, 'practice route$', 'test route', 'i')
where exists (
  select 1
  from public.event_categories as category
  join public.event_editions as edition
    on edition.id = category.event_edition_id
  where category.id = snapshot.event_category_id
    and edition.is_practice
);

update public.athlete_profiles as athlete
set
  display_name = regexp_replace(athlete.display_name, '^Practice Runner', 'Test Runner'),
  first_name = case when athlete.first_name = 'Practice' then 'Test' else athlete.first_name end,
  city = case when athlete.city = 'Practice course' then 'Test course' else athlete.city end,
  updated_at = now()
where exists (
  select 1
  from public.registrations as registration
  join public.event_categories as category
    on category.id = registration.event_category_id
  join public.event_editions as edition
    on edition.id = category.event_edition_id
  where registration.athlete_profile_id = athlete.id
    and edition.is_practice
);

update public.athlete_registration_profiles as profile
set
  emergency_contact_name = case
    when profile.emergency_contact_name = 'Practice Emergency Contact'
      then 'Test Emergency Contact'
    else profile.emergency_contact_name
  end,
  updated_at = now()
where exists (
  select 1
  from public.registrations as registration
  join public.event_categories as category
    on category.id = registration.event_category_id
  join public.event_editions as edition
    on edition.id = category.event_edition_id
  where registration.athlete_profile_id = profile.athlete_profile_id
    and edition.is_practice
);

update public.event_staff_assignments as assignment
set
  instructions = regexp_replace(assignment.instructions, 'Practice Race', 'Test Race', 'g'),
  updated_at = now()
where assignment.instructions like '%Practice Race%'
  and exists (
    select 1
    from public.event_editions as edition
    where edition.id = assignment.event_edition_id
      and edition.is_practice
  );

commit;
