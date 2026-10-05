begin;

-- Workforce tasks and inventory remain available as optional coordination tools.
-- They must not prevent an organizer from starting or restarting a race.
drop trigger if exists race_start_events_block_operations_readiness
  on public.race_start_events;

drop function if exists public.block_race_start_for_operations_readiness();

commit;
