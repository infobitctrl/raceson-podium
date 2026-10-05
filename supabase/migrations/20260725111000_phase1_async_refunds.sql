/*
 * Refunds can remain pending after the provider accepts the request. Provider
 * callbacks are retained and replay-safe, and only a succeeded outcome posts
 * the negative ledger entry.
 */

create or replace function public.service_record_payment_refund_state(
  p_refund_id uuid,
  p_actor_user_id uuid,
  p_provider_refund_id text,
  p_provider_status text,
  p_failure_message text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_refund public.payment_refunds%rowtype;
  result jsonb;
begin
  if p_provider_status not in ('pending', 'succeeded', 'failed', 'cancelled') then
    raise exception using errcode = '22023', message = 'invalid_refund_provider_status';
  end if;

  select refund.*
  into target_refund
  from public.payment_refunds refund
  where refund.id = p_refund_id
  for update;

  if not found then
    raise exception using errcode = 'P0002', message = 'refund_not_found';
  end if;

  if target_refund.status = 'succeeded' then
    return jsonb_build_object(
      'refundId', target_refund.id,
      'registrationId', target_refund.registration_id,
      'status', target_refund.status,
      'providerRefundId', target_refund.provider_refund_id,
      'replayed', true
    );
  end if;

  if target_refund.status in ('failed', 'cancelled')
     and target_refund.status <> p_provider_status then
    raise exception using errcode = 'P0001', message = 'refund_terminal_state_conflict';
  end if;

  if p_provider_status = 'succeeded' then
    return public.service_complete_payment_refund(
      target_refund.id,
      p_actor_user_id,
      p_provider_refund_id,
      true,
      null
    );
  end if;

  if p_provider_status = 'failed' then
    return public.service_complete_payment_refund(
      target_refund.id,
      p_actor_user_id,
      p_provider_refund_id,
      false,
      p_failure_message
    );
  end if;

  update public.payment_refunds refund
  set
    provider_refund_id = coalesce(
      nullif(trim(p_provider_refund_id), ''),
      refund.provider_refund_id
    ),
    status = p_provider_status,
    failure_message = case
      when p_provider_status = 'cancelled' then nullif(trim(p_failure_message), '')
      else null
    end,
    completed_at = case when p_provider_status = 'cancelled' then now() else null end
  where refund.id = target_refund.id
  returning * into target_refund;

  insert into public.audit_log (
    organization_id,
    actor_user_id,
    entity_type,
    entity_id,
    action,
    metadata_json
  )
  values (
    target_refund.organization_id,
    p_actor_user_id,
    'payment_refund',
    target_refund.id,
    case
      when p_provider_status = 'pending' then 'refund.provider_pending'
      else 'refund.cancelled'
    end,
    jsonb_build_object(
      'registrationId', target_refund.registration_id,
      'providerRefundId', target_refund.provider_refund_id,
      'status', target_refund.status
    )
  );

  return jsonb_build_object(
    'refundId', target_refund.id,
    'registrationId', target_refund.registration_id,
    'status', target_refund.status,
    'providerRefundId', target_refund.provider_refund_id,
    'replayed', false
  );
end;
$$;

create or replace function public.service_apply_refund_provider_event(
  p_provider text,
  p_provider_event_id text,
  p_event_type text,
  p_signature_verified boolean,
  p_livemode boolean,
  p_payload_json jsonb,
  p_refund_id uuid,
  p_provider_refund_id text,
  p_provider_status text,
  p_failure_message text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  provider_event public.payment_provider_events%rowtype;
  target_refund public.payment_refunds%rowtype;
  outcome jsonb;
begin
  if not p_signature_verified then
    raise exception using errcode = '28000', message = 'provider_signature_not_verified';
  end if;

  insert into public.payment_provider_events (
    provider,
    provider_event_id,
    event_type,
    signature_verified,
    livemode,
    payload_json,
    processing_status,
    process_attempts
  )
  values (
    p_provider,
    p_provider_event_id,
    p_event_type,
    true,
    p_livemode,
    p_payload_json,
    'received',
    1
  )
  on conflict (provider, provider_event_id) do nothing
  returning * into provider_event;

  if not found then
    select event.*
    into provider_event
    from public.payment_provider_events event
    where event.provider = p_provider
      and event.provider_event_id = p_provider_event_id;

    return jsonb_build_object(
      'providerEventId', provider_event.id,
      'processingStatus', provider_event.processing_status,
      'registrationId', provider_event.registration_id,
      'replayed', true
    );
  end if;

  select refund.*
  into target_refund
  from public.payment_refunds refund
  where refund.id = p_refund_id
  for update;

  if not found then
    update public.payment_provider_events event
    set
      processing_status = 'ignored',
      process_error = 'refund_not_found',
      processed_at = now()
    where event.id = provider_event.id;

    return jsonb_build_object(
      'providerEventId', provider_event.id,
      'processingStatus', 'ignored',
      'reason', 'refund_not_found',
      'replayed', false
    );
  end if;

  update public.payment_provider_events event
  set
    registration_id = target_refund.registration_id,
    payment_intent_id = target_refund.payment_intent_id
  where event.id = provider_event.id;

  outcome := public.service_record_payment_refund_state(
    target_refund.id,
    null,
    p_provider_refund_id,
    p_provider_status,
    p_failure_message
  );

  update public.payment_provider_events event
  set
    processing_status = 'processed',
    process_error = null,
    processed_at = now()
  where event.id = provider_event.id;

  return jsonb_build_object(
    'providerEventId', provider_event.id,
    'processingStatus', 'processed',
    'registrationId', target_refund.registration_id,
    'refundId', target_refund.id,
    'refund', outcome,
    'replayed', false
  );
end;
$$;

revoke all on function public.service_record_payment_refund_state(
  uuid, uuid, text, text, text
) from public, anon, authenticated;
revoke all on function public.service_apply_refund_provider_event(
  text, text, text, boolean, boolean, jsonb, uuid, text, text, text
) from public, anon, authenticated;
grant execute on function public.service_record_payment_refund_state(
  uuid, uuid, text, text, text
) to service_role;
grant execute on function public.service_apply_refund_provider_event(
  text, text, text, boolean, boolean, jsonb, uuid, text, text, text
) to service_role;
