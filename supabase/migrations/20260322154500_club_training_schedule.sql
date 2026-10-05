begin;

alter table public.clubs
  add column if not exists training_days text[] not null default '{}'::text[];

alter table public.clubs
  add column if not exists has_regular_training boolean not null default true;

commit;
