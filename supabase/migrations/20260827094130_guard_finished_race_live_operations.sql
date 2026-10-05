-- Completing timing is independent of final result publication. Keep historical
-- sessions and result corrections intact, but never reactivate a closed race.
create or replace function app_private.guard_live_race_operation()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  edition_row record;
  category_row record;
begin
  if tg_table_name = 'timing_sessions' then
    if new.status::text = 'closed' then return new; end if;
  end if;

  -- Use the finish command's edition/category order. NOWAIT also prevents a
  -- start command already holding a category lock from deadlocking with finish.
  if tg_table_name = 'race_start_events' then
    -- Starts will update the edition. Take the stronger lock immediately so
    -- simultaneous category starts cannot deadlock while upgrading share locks.
    select edition.status, edition.organizer_deleted_at into edition_row
    from public.event_editions edition
    where edition.id = new.event_edition_id
    for update nowait;
  else
    select edition.status, edition.organizer_deleted_at into edition_row
    from public.event_editions edition
    where edition.id = new.event_edition_id
    for share nowait;
  end if;
  if edition_row.status::text in ('completed', 'archived', 'cancelled')
     or edition_row.organizer_deleted_at is not null then
    raise exception using errcode = 'P0001', message = 'race_live_operations_closed';
  end if;

  if new.event_category_id is not null then
    select category.status, category.organizer_deleted_at, category.event_edition_id into category_row
    from public.event_categories category
    where category.id = new.event_category_id
    for share nowait;
    if category_row.event_edition_id <> new.event_edition_id then
      raise exception using errcode = '23514', message = 'race_operation_category_mismatch';
    end if;
    if category_row.status::text in ('completed', 'closed')
       or category_row.organizer_deleted_at is not null then
      raise exception using errcode = 'P0001', message = 'race_live_operations_closed';
    end if;
  end if;
  return new;
exception when lock_not_available then
  raise exception using errcode = 'P0001', message = 'race_live_operations_busy';
end;
$$;

revoke all on function app_private.guard_live_race_operation() from public, anon, authenticated;

create trigger timing_sessions_live_lifecycle_guard
before insert or update on public.timing_sessions
for each row execute function app_private.guard_live_race_operation();

create trigger race_start_events_live_lifecycle_guard
before insert on public.race_start_events
for each row execute function app_private.guard_live_race_operation();
