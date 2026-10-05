alter table event_categories
  add column if not exists display_order integer not null default 0;

with ranked_categories as (
  select
    id,
    row_number() over (
      partition by event_edition_id
      order by coalesce(distance_km, 0) desc, created_at asc
    ) - 1 as next_display_order
  from event_categories
)
update event_categories
set display_order = ranked_categories.next_display_order
from ranked_categories
where event_categories.id = ranked_categories.id;

create index if not exists event_categories_display_order_idx
  on event_categories (event_edition_id, display_order);
