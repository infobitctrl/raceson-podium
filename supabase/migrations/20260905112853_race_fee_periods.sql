-- Additive: existing categories and immutable registration quotes are preserved.
alter table public.event_categories
  add column registration_fee_periods jsonb not null default '[]'::jsonb;

create function app_private.validate_race_fee_periods()
returns trigger language plpgsql security invoker set search_path = '' as $$
declare
  period jsonb;
  position integer := 0;
  count_periods integer;
  previous_end timestamptz;
  next_end timestamptz;
  amount numeric;
  maximum_fee integer := 0;
begin
  if jsonb_typeof(new.registration_fee_periods) <> 'array' then
    raise exception 'Price periods must be an array' using errcode = '22023';
  end if;
  count_periods := jsonb_array_length(new.registration_fee_periods);
  if count_periods = 0 then return new; end if;
  if count_periods < 2 or count_periods > 20 then
    raise exception 'Use between 2 and 20 price periods' using errcode = '22023';
  end if;
  if new.results_mode::text = 'informative_age' then
    raise exception 'Informative categories cannot have price periods' using errcode = '22023';
  end if;
  for period in select value from jsonb_array_elements(new.registration_fee_periods) loop
    position := position + 1;
    if jsonb_typeof(period->'amountCents') is distinct from 'number'
      or not (period ? 'until') then
      raise exception 'Invalid price period' using errcode = '22023';
    end if;
    amount := (period->>'amountCents')::numeric;
    if amount < 0 or amount > 2147483647 or amount <> trunc(amount) then
      raise exception 'Invalid price amount' using errcode = '22023';
    end if;
    maximum_fee := greatest(maximum_fee, amount::integer);
    if position = count_periods then
      if period->'until' <> 'null'::jsonb then
        raise exception 'Final price must apply until the race' using errcode = '22023';
      end if;
    else
      if jsonb_typeof(period->'until') is distinct from 'string'
        or period->>'until' !~ '(Z|[+-][0-9]{2}:[0-9]{2})$' then
        raise exception 'Price changes require a date with timezone' using errcode = '22023';
      end if;
      next_end := (period->>'until')::timestamptz;
      if not isfinite(next_end) or next_end <= previous_end or next_end >= new.start_at then
        raise exception 'Price changes must be ordered and before the race' using errcode = '22023';
      end if;
      previous_end := next_end;
    end if;
  end loop;
  -- Existing publication/payment readiness gates must detect future paid periods,
  -- including a free initial period. Quotes/read models resolve the actual fee.
  new.registration_fee_cents := maximum_fee;
  return new;
end;
$$;
revoke all on function app_private.validate_race_fee_periods() from public, anon, authenticated;
create trigger validate_race_fee_periods
before insert or update of registration_fee_periods, registration_fee_cents, start_at, results_mode
on public.event_categories for each row execute function app_private.validate_race_fee_periods();

create function app_private.race_fee_at(base_fee integer, periods jsonb, at_time timestamptz)
returns integer language sql stable security invoker set search_path = '' as $$
  select coalesce((
    select (period->>'amountCents')::integer
    from jsonb_array_elements(periods) with ordinality as entries(period, position)
    where period->>'until' is null or at_time < (period->>'until')::timestamptz
    order by position limit 1
  ), greatest(coalesce(base_fee, 0), 0));
$$;
revoke all on function app_private.race_fee_at(integer, jsonb, timestamptz) from public, anon, authenticated;
grant execute on function app_private.race_fee_at(integer, jsonb, timestamptz) to service_role;

-- Preserve the latest authorization, waitlist, bank-transfer and desk wrappers.
-- Replace only their fee lookup; never update an existing quote or ledger entry.
do $$
declare
  target record;
  definition text;
  replaced integer := 0;
begin
  for target in
    select p.oid, p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.prokind = 'f'
      and p.prosrc like '%fee_cents := greatest(coalesce(category_row.registration_fee_cents, 0), 0);%'
  loop
    definition := pg_get_functiondef(target.oid);
    definition := replace(definition,
      'fee_cents := greatest(coalesce(category_row.registration_fee_cents, 0), 0);',
      'fee_cents := app_private.race_fee_at(category_row.registration_fee_cents, category_row.registration_fee_periods, now());');
    if target.proname = 'review_registration_payment_evidence_atomically' then
      -- Evidence submitted after a price change still settles the original quote.
      definition := replace(definition,
        'fee_cents := app_private.race_fee_at(category_row.registration_fee_cents, category_row.registration_fee_periods, now());',
        'select quote.* into target_quote from public.registration_quotes quote where quote.id = registration_row.current_quote_id for update;
         fee_cents := coalesce(target_quote.total_cents, app_private.race_fee_at(category_row.registration_fee_cents, category_row.registration_fee_periods, registration_row.created_at));');
      definition := replace(definition,
        'quote_currency := upper(coalesce(category_row.currency, ''EUR''))::char(3);',
        'quote_currency := upper(coalesce(target_quote.currency, category_row.currency, ''EUR''))::char(3);');
    elsif target.proname like 'service_record_registration_desk_payment%' then
      definition := replace(definition,
        'category_row.registration_fee_periods, now())',
        'category_row.registration_fee_periods, target_registration.created_at)');
    end if;
    execute definition;
    replaced := replaced + 1;
  end loop;
  if replaced < 3 then raise exception 'Expected registration pricing functions missing'; end if;
end;
$$;

-- Organizer/public bundles use explicit category projections.
do $$
declare target record; definition text;
begin
  for target in
    select p.oid from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.prokind = 'f'
      and p.prosrc like '%category.registration_fee_cents,%'
  loop
    definition := pg_get_functiondef(target.oid);
    execute replace(definition, 'category.registration_fee_cents,',
      'category.registration_fee_cents, category.registration_fee_periods,');
  end loop;
end;
$$;
