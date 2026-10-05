create or replace function public.service_reconcile_organizer_category_checkpoints(
  p_category_id uuid,
  p_track_snapshot_id uuid,
  p_checkpoints jsonb
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  checkpoint_record record;
  dependency_record record;
  dependency_exists boolean;
  retained_checkpoint_ids uuid[];
  removed_checkpoint_ids uuid[];
  reconciled_checkpoints jsonb;
begin
  if jsonb_typeof(p_checkpoints) <> 'array' then
    raise exception using errcode = 'P0001', message = 'checkpoint_payload_must_be_array';
  end if;

  perform 1
  from public.event_categories category
  where category.id = p_category_id
  for update;

  if not found then
    raise exception using errcode = 'P0001', message = 'checkpoint_category_not_found';
  end if;

  if not exists (
    select 1
    from public.event_category_track_snapshots snapshot
    where snapshot.id = p_track_snapshot_id
      and snapshot.event_category_id = p_category_id
  ) then
    raise exception using errcode = 'P0001', message = 'checkpoint_snapshot_mismatch';
  end if;

  if exists (
    select 1
    from jsonb_to_recordset(p_checkpoints) as item(
      id uuid,
      code text,
      name text,
      checkpoint_type public.checkpoint_type,
      sequence_number integer,
      distance_from_start_km numeric,
      cutoff_at timestamptz,
      is_mandatory boolean,
      settings_json jsonb
    )
    where nullif(trim(item.code), '') is null
      or nullif(trim(item.name), '') is null
      or item.checkpoint_type is null
      or item.sequence_number is null
      or item.sequence_number < 1
      or item.distance_from_start_km is null
      or item.distance_from_start_km < 0
      or item.is_mandatory is null
      or jsonb_typeof(item.settings_json) <> 'object'
  ) then
    raise exception using errcode = 'P0001', message = 'checkpoint_payload_invalid';
  end if;

  if (
    select count(*)
    from jsonb_to_recordset(p_checkpoints) as item(checkpoint_type public.checkpoint_type)
    where item.checkpoint_type = 'start'
  ) <> 1
  or (
    select count(*)
    from jsonb_to_recordset(p_checkpoints) as item(checkpoint_type public.checkpoint_type)
    where item.checkpoint_type = 'finish'
  ) <> 1 then
    raise exception using errcode = 'P0001', message = 'checkpoint_foundation_invalid';
  end if;

  if exists (
    select item.id
    from jsonb_to_recordset(p_checkpoints) as item(id uuid)
    where item.id is not null
    group by item.id
    having count(*) > 1
  ) then
    raise exception using errcode = 'P0001', message = 'checkpoint_id_repeated';
  end if;

  if exists (
    select item.id
    from jsonb_to_recordset(p_checkpoints) as item(id uuid)
    left join public.checkpoints checkpoint
      on checkpoint.id = item.id
     and checkpoint.event_category_id = p_category_id
    where item.id is not null
      and checkpoint.id is null
  ) then
    raise exception using errcode = 'P0001', message = 'checkpoint_id_not_in_category';
  end if;

  select coalesce(array_agg(item.id) filter (where item.id is not null), '{}'::uuid[])
  into retained_checkpoint_ids
  from jsonb_to_recordset(p_checkpoints) as item(id uuid);

  select coalesce(array_agg(checkpoint.id), '{}'::uuid[])
  into removed_checkpoint_ids
  from public.checkpoints checkpoint
  where checkpoint.event_category_id = p_category_id
    and not (checkpoint.id = any(retained_checkpoint_ids));

  if cardinality(removed_checkpoint_ids) > 0 then
    for dependency_record in
      select
        child_namespace.nspname as table_schema,
        child_table.relname as table_name,
        child_column.attname as column_name
      from pg_catalog.pg_constraint foreign_key
      join pg_catalog.pg_class child_table
        on child_table.oid = foreign_key.conrelid
      join pg_catalog.pg_namespace child_namespace
        on child_namespace.oid = child_table.relnamespace
      join pg_catalog.pg_attribute child_column
        on child_column.attrelid = child_table.oid
       and child_column.attnum = foreign_key.conkey[1]
      where foreign_key.contype = 'f'
        and foreign_key.confrelid = 'public.checkpoints'::regclass
        and cardinality(foreign_key.conkey) = 1
    loop
      execute format(
        'select exists (select 1 from %I.%I where %I = any($1))',
        dependency_record.table_schema,
        dependency_record.table_name,
        dependency_record.column_name
      )
      into dependency_exists
      using removed_checkpoint_ids;

      if dependency_exists then
        raise exception using errcode = 'P0001', message = 'course_point_has_operational_history';
      end if;
    end loop;
  end if;

  with numbered as (
    select
      checkpoint.id,
      row_number() over (order by checkpoint.id)::integer as temporary_sequence
    from public.checkpoints checkpoint
    where checkpoint.event_category_id = p_category_id
  )
  update public.checkpoints checkpoint
  set
    code = '__SYNC__' || replace(checkpoint.id::text, '-', ''),
    sequence_number = -numbered.temporary_sequence
  from numbered
  where checkpoint.id = numbered.id;

  delete from public.checkpoints checkpoint
  where checkpoint.id = any(removed_checkpoint_ids);

  for checkpoint_record in
    select *
    from jsonb_to_recordset(p_checkpoints) as item(
      id uuid,
      code text,
      name text,
      checkpoint_type public.checkpoint_type,
      sequence_number integer,
      distance_from_start_km numeric,
      cutoff_at timestamptz,
      is_mandatory boolean,
      settings_json jsonb
    )
    order by item.sequence_number
  loop
    if checkpoint_record.id is null then
      insert into public.checkpoints (
        event_category_id,
        track_snapshot_id,
        code,
        name,
        checkpoint_type,
        sequence_number,
        distance_from_start_km,
        cutoff_at,
        is_mandatory,
        settings_json
      ) values (
        p_category_id,
        p_track_snapshot_id,
        checkpoint_record.code,
        checkpoint_record.name,
        checkpoint_record.checkpoint_type,
        checkpoint_record.sequence_number,
        checkpoint_record.distance_from_start_km,
        checkpoint_record.cutoff_at,
        checkpoint_record.is_mandatory,
        checkpoint_record.settings_json
      );
    else
      update public.checkpoints checkpoint
      set
        track_snapshot_id = p_track_snapshot_id,
        code = checkpoint_record.code,
        name = checkpoint_record.name,
        checkpoint_type = checkpoint_record.checkpoint_type,
        sequence_number = checkpoint_record.sequence_number,
        distance_from_start_km = checkpoint_record.distance_from_start_km,
        cutoff_at = checkpoint_record.cutoff_at,
        is_mandatory = checkpoint_record.is_mandatory,
        settings_json = checkpoint_record.settings_json
      where checkpoint.id = checkpoint_record.id
        and checkpoint.event_category_id = p_category_id;

      if not found then
        raise exception using errcode = 'P0001', message = 'checkpoint_id_not_in_category';
      end if;
    end if;
  end loop;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id', checkpoint.id,
        'code', checkpoint.code,
        'sequenceNumber', checkpoint.sequence_number
      )
      order by checkpoint.sequence_number
    ),
    '[]'::jsonb
  )
  into reconciled_checkpoints
  from public.checkpoints checkpoint
  where checkpoint.event_category_id = p_category_id;

  return reconciled_checkpoints;
end;
$$;

revoke all on function public.service_reconcile_organizer_category_checkpoints(uuid, uuid, jsonb)
from public, anon, authenticated;

grant execute on function public.service_reconcile_organizer_category_checkpoints(uuid, uuid, jsonb)
to service_role;
