begin;

create or replace function public.organization_id_for_badge_definition(badge_definition_id uuid)
returns uuid
language sql
stable
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
as $$
  select public.organization_id_for_badge_definition(ab.badge_definition_id)
  from athlete_badges ab
  where ab.id = athlete_badge_id
$$;

alter table badge_definitions enable row level security;
alter table athlete_badges enable row level security;

create policy badge_definitions_select_public_or_org
on badge_definitions
for select
using (
  public.is_badge_definition_public(id)
  or public.can_manage_organization(public.organization_id_for_badge_definition(id))
  or public.can_time_organization(public.organization_id_for_badge_definition(id))
);

create policy badge_definitions_insert_manage_track
on badge_definitions
for insert
with check (
  scope = 'track'
  and public.can_manage_organization(public.organization_id_for_track_template(track_template_id))
);

create policy badge_definitions_update_manage_track
on badge_definitions
for update
using (
  public.can_manage_organization(public.organization_id_for_badge_definition(id))
)
with check (
  scope = 'track'
  and public.can_manage_organization(public.organization_id_for_track_template(track_template_id))
);

create policy badge_definitions_delete_manage_track
on badge_definitions
for delete
using (
  public.can_manage_organization(public.organization_id_for_badge_definition(id))
);

create policy athlete_badges_select_public_self_or_org
on athlete_badges
for select
using (
  (
    public.is_athlete_profile_public(athlete_profile_id)
    and public.is_badge_definition_public(badge_definition_id)
  )
  or public.user_can_access_athlete_profile(athlete_profile_id)
  or public.can_manage_organization(public.organization_id_for_athlete_badge(id))
  or public.can_time_organization(public.organization_id_for_athlete_badge(id))
);

commit;
