-- The legacy importer publishes every migrated round, but its original column
-- list omitted public_visibility and therefore inherited the private default.
-- Scope this repair to completed legacy batches and mapped event editions so
-- organizer-created private editions and practice races remain untouched.
update public.event_editions as edition
set
  public_visibility = 'public',
  updated_at = clock_timestamp()
where edition.public_visibility = 'private'
  and edition.published_at is not null
  and not edition.is_practice
  and exists (
    select 1
    from migration_support.legacy_entity_map as mapping
    join migration_support.legacy_import_batches as batch
      on batch.id = mapping.legacy_import_batch_id
    where mapping.target_table = 'event_editions'
      and mapping.target_id = edition.id
      and batch.import_state = 'completed'
  );
