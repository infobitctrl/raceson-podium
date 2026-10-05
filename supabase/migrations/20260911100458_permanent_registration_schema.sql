-- Fresh empty installations only; not an upgrade path.
-- Owner policy, 2026-09-11: entries persist until athlete/organizer cancellation.
-- PostgreSQL infinity preserves existing NOT NULL/comparison contracts. API read
-- models expose no registration deadline; security/payment-session TTLs remain.
create or replace function app_private.permanent_registration_hold()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  if new.state = 'active' then new.expires_at := 'infinity'::timestamptz; end if;
  return new;
end;
$$;
revoke all on function app_private.permanent_registration_hold() from public, anon, authenticated;
grant execute on function app_private.permanent_registration_hold() to service_role;
drop trigger if exists zz_registration_quotes_permanent_hold on public.registration_quotes;
create trigger zz_registration_quotes_permanent_hold before insert or update of expires_at,state
on public.registration_quotes for each row execute function app_private.permanent_registration_hold();
drop trigger if exists zz_capacity_reservations_permanent_hold on public.capacity_reservations;
create trigger zz_capacity_reservations_permanent_hold before insert or update of expires_at,state
on public.capacity_reservations for each row execute function app_private.permanent_registration_hold();

-- Retained for older entry/payment callers. It can no longer remove a registration.
create or replace function public.service_expire_registration_holds(p_event_category_id uuid)
returns integer language sql security invoker set search_path = '' as $$ select 0 $$;
revoke all on function public.service_expire_registration_holds(uuid) from public, anon, authenticated;
grant execute on function public.service_expire_registration_holds(uuid) to service_role;

-- The legacy RPC argument remains accepted but has no effect. New clients do not
-- send an offer duration. Offers reserve a place until explicitly cancelled.
do $$
declare definition text;
begin
  select pg_get_functiondef('public.service_promote_waitlist_offer(uuid,uuid,integer)'::regprocedure) into definition;
  definition := replace(definition,
    '  if p_offer_minutes < 30 or p_offer_minutes > 10080 then
    raise exception using errcode = ''22023'', message = ''invalid_offer_duration'';
  end if;', '  -- Legacy offer-duration argument intentionally ignored.');
  definition := replace(definition,
    'resolved_offer_expires_at := now() + make_interval(mins => p_offer_minutes);',
    'resolved_offer_expires_at := ''infinity''::timestamptz;');
  definition := replace(definition, '''offerExpiresAt'', resolved_offer_expires_at', '''offerExpiresAt'', null');
  execute definition;
end;
$$;
create or replace function app_private.permanent_waitlist_offer()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  if new.state = 'offered' then new.offer_expires_at := null; end if;
  return new;
end;
$$;
revoke all on function app_private.permanent_waitlist_offer() from public, anon, authenticated;
grant execute on function app_private.permanent_waitlist_offer() to service_role;
drop trigger if exists waitlist_permanent_offer on public.registration_waitlist_entries;
create trigger waitlist_permanent_offer before insert or update of offer_expires_at,state
on public.registration_waitlist_entries for each row execute function app_private.permanent_waitlist_offer();

-- Provider checkout sessions still need a finite technical lifetime; their expiry
-- does not expire the entry, quote or reserved place and permits a new attempt.
do $$
declare target record; definition text;
begin
  for target in select p.oid from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname='service_prepare_payment_attempt'
  loop
    definition := pg_get_functiondef(target.oid);
    definition := replace(definition, 'least(target_quote.expires_at, target_reservation.expires_at)',
      'least(target_quote.expires_at, target_reservation.expires_at, now() + interval ''60 minutes'')');
    execute definition;
  end loop;
end;
$$;

-- Historical registration backfills and incident repair omitted on the empty target.

-- An unpaid non-starter can receive DNS without inventing a paid/confirmed entry.
-- Other participant commands still require confirmation, especially starts/results.
do $$
declare definition text;
begin
  select pg_get_functiondef('public.service_record_participant_status(uuid,uuid,text,timestamptz,text,uuid,boolean,jsonb)'::regprocedure) into definition;
  if position('permanent_entry_unpaid_dns' in definition)=0 then
    if position('if registration_row.status <> ''confirmed'' then' in definition)=0 then
      raise exception 'Participant status confirmation guard changed';
    end if;
    definition := replace(definition, 'if registration_row.status <> ''confirmed'' then',
      'if registration_row.status <> ''confirmed'' and not (
        -- permanent_entry_unpaid_dns
        registration_row.status in (''pending'', ''offered'', ''waitlisted'')
        and registration_row.payment_status in (''unpaid'', ''pending'', ''failed'')
        and registration_row.participation_status in (''not_started'', ''checked_in'')
        and registration_row.organizer_removed_at is null
        and p_status = ''dns'' and not coalesce(p_is_correction, false)
      ) then');
    execute definition;
  end if;
end;
$$;

create or replace function app_private.finish_unpaid_registrations_as_dns(category_ids uuid[], actor_id uuid)
returns void language plpgsql security invoker set search_path = '' as $$
declare registration record;
begin
  for registration in select r.id from public.registrations r
    where r.event_category_id=any(category_ids)
      and r.status in ('pending','offered','waitlisted')
      and r.payment_status in ('unpaid','pending','failed')
      and r.participation_status in ('not_started','checked_in')
      and r.organizer_removed_at is null
    order by r.id for update
  loop
    perform public.service_record_participant_status(registration.id, actor_id, 'dns',
      clock_timestamp(), 'Unpaid registration at race completion', gen_random_uuid(), false,
      jsonb_build_object('source','race_finish_unpaid_dns'));
  end loop;
end;
$$;
revoke all on function app_private.finish_unpaid_registrations_as_dns(uuid[],uuid) from public,anon,authenticated;
grant execute on function app_private.finish_unpaid_registrations_as_dns(uuid[],uuid) to service_role;

-- Both ordinary finish (including its DNF wrapper) and audited blocker override
-- run this inside their existing transaction, after validation/category locks.
do $$
declare target record; definition text; patched integer := 0;
begin
  for target in select p.oid from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public'
      and p.proname in ('service_finish_race_categories','service_finish_race_categories_with_override')
      and position('update public.event_categories category' in p.prosrc)>0
  loop
    definition := pg_get_functiondef(target.oid);
    if position('app_private.finish_unpaid_registrations_as_dns' in definition)=0 then
      if position('    update public.event_categories category' in definition)=0 then
        raise exception 'Race completion update marker changed';
      end if;
      definition := replace(definition, '    update public.event_categories category',
        '    perform app_private.finish_unpaid_registrations_as_dns(active_category_ids, p_actor_user_id);
    update public.event_categories category');
      execute definition;
    end if;
    patched := patched+1;
  end loop;
  if patched<>2 then raise exception 'Expected both race completion implementations'; end if;
end;
$$;
