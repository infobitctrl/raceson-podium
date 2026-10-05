begin;

create or replace function public.organization_id_for_badge_definition(badge_definition_id uuid)
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select tt.organization_id
  from badge_definitions bd
  join track_templates tt on tt.id = bd.track_template_id
  where bd.id = badge_definition_id
$$;

create or replace function public.is_badge_definition_public(badge_definition_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from badge_definitions bd
    where bd.id = badge_definition_id
      and bd.is_active
      and (
        bd.scope <> 'track'
        or bd.track_template_id is null
        or public.is_track_template_public(bd.track_template_id)
      )
  )
$$;

create or replace function public.organization_id_for_athlete_badge(athlete_badge_id uuid)
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select public.organization_id_for_badge_definition(ab.badge_definition_id)
  from athlete_badges ab
  where ab.id = athlete_badge_id
$$;

drop policy if exists athlete_badges_insert_manage_org on athlete_badges;
create policy athlete_badges_insert_manage_org
on athlete_badges
for insert
with check (
  public.can_manage_organization(public.organization_id_for_badge_definition(badge_definition_id))
);

drop policy if exists athlete_badges_update_manage_org on athlete_badges;
create policy athlete_badges_update_manage_org
on athlete_badges
for update
using (
  public.can_manage_organization(public.organization_id_for_athlete_badge(id))
)
with check (
  public.can_manage_organization(public.organization_id_for_badge_definition(badge_definition_id))
);

drop policy if exists athlete_badges_delete_manage_org on athlete_badges;
create policy athlete_badges_delete_manage_org
on athlete_badges
for delete
using (
  public.can_manage_organization(public.organization_id_for_athlete_badge(id))
);

commit;
