begin;

-- A season has one editable recurrence definition. Keep generated history by
-- archiving a superseded rule, but remove an unmaterialized draft completely.
create temporary table superseded_league_recurrence_rules
on commit drop
as
with ranked_rules as (
  select
    rule.id,
    row_number() over (
      partition by rule.league_season_id
      order by rule.created_at desc, rule.id desc
    ) as position,
    exists (
      select 1
      from public.league_recurrence_occurrences occurrence
      where occurrence.recurrence_rule_id = rule.id
        and occurrence.state = 'materialized'
    ) as has_materialized_occurrence
  from public.league_recurrence_rules rule
  where rule.status = 'active'
)
select id, has_materialized_occurrence
from ranked_rules
where position > 1;

update public.league_recurrence_rules rule
set status = 'archived'
from superseded_league_recurrence_rules superseded
where superseded.id = rule.id
  and superseded.has_materialized_occurrence;

delete from public.league_recurrence_occurrences occurrence
using superseded_league_recurrence_rules superseded
where occurrence.recurrence_rule_id = superseded.id
  and not superseded.has_materialized_occurrence;

delete from public.league_recurrence_rules rule
using superseded_league_recurrence_rules superseded
where rule.id = superseded.id
  and not superseded.has_materialized_occurrence;

create or replace function public.replace_previous_active_league_recurrence_rule()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if new.status <> 'active' then
    return new;
  end if;

  update public.league_recurrence_rules existing_rule
  set status = 'archived'
  where existing_rule.league_season_id = new.league_season_id
    and existing_rule.status = 'active'
    and existing_rule.id is distinct from new.id
    and exists (
      select 1
      from public.league_recurrence_occurrences occurrence
      where occurrence.recurrence_rule_id = existing_rule.id
        and occurrence.state = 'materialized'
    );

  delete from public.league_recurrence_occurrences occurrence
  using public.league_recurrence_rules existing_rule
  where existing_rule.league_season_id = new.league_season_id
    and existing_rule.status = 'active'
    and existing_rule.id is distinct from new.id
    and occurrence.recurrence_rule_id = existing_rule.id
    and not exists (
      select 1
      from public.league_recurrence_occurrences materialized_occurrence
      where materialized_occurrence.recurrence_rule_id = existing_rule.id
        and materialized_occurrence.state = 'materialized'
    );

  delete from public.league_recurrence_rules existing_rule
  where existing_rule.league_season_id = new.league_season_id
    and existing_rule.status = 'active'
    and existing_rule.id is distinct from new.id
    and not exists (
      select 1
      from public.league_recurrence_occurrences materialized_occurrence
      where materialized_occurrence.recurrence_rule_id = existing_rule.id
        and materialized_occurrence.state = 'materialized'
    );

  return new;
end;
$$;

drop trigger if exists league_recurrence_rules_replace_previous_active
on public.league_recurrence_rules;
create trigger league_recurrence_rules_replace_previous_active
before insert or update of league_season_id, status
on public.league_recurrence_rules
for each row execute function public.replace_previous_active_league_recurrence_rule();

create unique index if not exists league_recurrence_rules_one_active_per_season_idx
  on public.league_recurrence_rules (league_season_id)
  where status = 'active';

revoke all on function public.replace_previous_active_league_recurrence_rule()
from public, anon, authenticated;
grant execute on function public.replace_previous_active_league_recurrence_rule()
to service_role;

comment on function public.replace_previous_active_league_recurrence_rule() is
  'Keeps one active recurrence definition per league season, deleting unmaterialized drafts and archiving generated history.';

commit;
