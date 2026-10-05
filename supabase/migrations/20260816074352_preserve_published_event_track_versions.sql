-- Published event snapshots are immutable public history. Restore any source
-- track version that was unpublished after assignment without changing the
-- snapshot to a newer route revision.
update public.track_versions as version
set published_at = protected_version.published_at
from (
  select
    snapshot.track_version_id,
    min(edition.published_at) as published_at
  from public.event_category_track_snapshots as snapshot
  join public.event_categories as category
    on category.id = snapshot.event_category_id
   and category.status <> 'draft'
  join public.event_editions as edition
    on edition.id = category.event_edition_id
   and edition.status <> 'draft'
   and edition.published_at is not null
  where snapshot.track_version_id is not null
  group by snapshot.track_version_id
) as protected_version
where version.id = protected_version.track_version_id
  and version.published_at is null;

create or replace function migration_support.prevent_unpublishing_published_event_track_version()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if exists (
    select 1
    from public.event_category_track_snapshots as snapshot
    join public.event_categories as category
      on category.id = snapshot.event_category_id
     and category.status <> 'draft'
    join public.event_editions as edition
      on edition.id = category.event_edition_id
     and edition.status <> 'draft'
     and edition.published_at is not null
    where snapshot.track_version_id = old.id
  ) then
    raise exception using
      errcode = '23514',
      message = 'published_event_track_version_required';
  end if;

  return new;
end;
$$;

revoke all on function migration_support.prevent_unpublishing_published_event_track_version()
from public, anon, authenticated;

drop trigger if exists track_versions_preserve_published_event_snapshot on public.track_versions;

create trigger track_versions_preserve_published_event_snapshot
before update of published_at on public.track_versions
for each row
when (old.published_at is not null and new.published_at is null)
execute function migration_support.prevent_unpublishing_published_event_track_version();
