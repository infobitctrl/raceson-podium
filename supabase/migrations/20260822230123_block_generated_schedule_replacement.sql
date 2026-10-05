begin;

create or replace function public.block_generated_league_schedule_replacement()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.status <> 'active' then
    return new;
  end if;

  if exists (
    select 1
    from public.league_recurrence_rules existing_rule
    join public.league_recurrence_occurrences occurrence
      on occurrence.recurrence_rule_id = existing_rule.id
     and occurrence.state = 'materialized'
    where existing_rule.league_season_id = new.league_season_id
      and existing_rule.status = 'active'
      and existing_rule.id is distinct from new.id
  ) then
    raise exception using
      errcode = '23514',
      message = 'league_recurrence_delete_rounds_before_replacement';
  end if;

  return new;
end;
$$;

drop trigger if exists league_recurrence_rules_block_generated_replacement
on public.league_recurrence_rules;
create trigger league_recurrence_rules_block_generated_replacement
before insert or update of league_season_id, status
on public.league_recurrence_rules
for each row execute function public.block_generated_league_schedule_replacement();

revoke all on function public.block_generated_league_schedule_replacement()
  from public, anon, authenticated;
grant execute on function public.block_generated_league_schedule_replacement()
  to service_role;

comment on function public.block_generated_league_schedule_replacement() is
  'Prevents a second active recurrence rule from creating duplicate events while the current schedule still has generated rounds.';

commit;
