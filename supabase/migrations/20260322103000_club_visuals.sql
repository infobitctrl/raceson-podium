begin;

alter table public.clubs
  add column if not exists icon_key text;

alter table public.clubs
  add column if not exists color_key text;

update public.clubs
set
  icon_key = case
    when slug = 'pd-velebit' then 'mountain'
    when slug = 'tk-zagreb' then 'flag'
    when slug = 'ak-slavonija' then 'tree'
    when slug = 'pd-mosor' then 'wind'
    else coalesce(nullif(btrim(icon_key), ''), 'mountain')
  end,
  color_key = case
    when slug = 'pd-velebit' then 'primary'
    when slug = 'tk-zagreb' then 'amber'
    when slug = 'ak-slavonija' then 'green'
    when slug = 'pd-mosor' then 'blue'
    else coalesce(nullif(btrim(color_key), ''), 'primary')
  end
where icon_key is null
   or btrim(icon_key) = ''
   or color_key is null
   or btrim(color_key) = '';

commit;
