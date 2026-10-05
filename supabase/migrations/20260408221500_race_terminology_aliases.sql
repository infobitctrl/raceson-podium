comment on table public.event_series is
  'Internal compatibility name. In product language this represents a race series or recurring race brand.';

comment on table public.event_editions is
  'Internal compatibility name. In product language each event edition is a public race.';

comment on table public.event_categories is
  'Internal compatibility name. In product language these are race formats or distance categories within a race.';

create or replace function public.is_race_public(target_race_id uuid)
returns boolean
language sql
stable
as $$
  select public.is_event_edition_public(target_race_id);
$$;

comment on function public.is_race_public(uuid) is
  'Product-language alias for is_event_edition_public. A race maps to an event edition in the underlying schema.';

create or replace view public.race_series
with (security_invoker = true)
as
select *
from public.event_series;

create or replace view public.races
with (security_invoker = true)
as
select *
from public.event_editions;

create or replace view public.race_categories
with (security_invoker = true)
as
select *
from public.event_categories;

create or replace view public.race_documents
with (security_invoker = true)
as
select *
from public.event_documents;

create or replace view public.race_locations
with (security_invoker = true)
as
select *
from public.event_locations;

comment on view public.race_series is
  'Product-language alias view over event_series.';

comment on view public.races is
  'Product-language alias view over event_editions.';

comment on view public.race_categories is
  'Product-language alias view over event_categories.';

comment on view public.race_documents is
  'Product-language alias view over event_documents.';

comment on view public.race_locations is
  'Product-language alias view over event_locations.';
