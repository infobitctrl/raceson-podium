begin;

alter table public.clubs
  add column if not exists training_location text;

alter table public.clubs
  add column if not exists training_note text;

commit;
