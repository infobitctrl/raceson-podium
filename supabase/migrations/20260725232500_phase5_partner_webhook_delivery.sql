-- SiTrail V2 Phase 5: production outbound webhook delivery.
--
-- Webhook attempts are durable and append-only. Mutable dispatch jobs carry
-- leases and retry state; immutable delivery rows retain the evidence. Raw
-- signing secrets never enter the database: the server stores only a digest
-- plus an AES-GCM envelope encrypted by an application-owned key.

create table public.partner_webhook_signing_secrets (
  id uuid primary key default gen_random_uuid(),
  partner_webhook_subscription_id uuid not null
    references public.partner_webhook_subscriptions (id) on delete restrict,
  version_number integer not null,
  secret_state text not null default 'active',
  signing_secret_prefix text not null,
  signing_secret_digest_sha256 text not null,
  encrypted_secret text not null,
  encryption_key_id text not null,
  valid_from timestamptz not null default clock_timestamp(),
  valid_until timestamptz,
  created_by_user_id uuid not null,
  client_event_id uuid not null unique,
  created_at timestamptz not null default clock_timestamp(),
  unique (partner_webhook_subscription_id, version_number),
  unique (signing_secret_digest_sha256),
  check (version_number > 0),
  check (secret_state in ('active', 'retiring', 'retired')),
  check (signing_secret_prefix ~ '^whsec_[a-z0-9]{8}$'),
  check (signing_secret_digest_sha256 ~ '^[0-9a-f]{64}$'),
  check (encrypted_secret ~ '^v1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$'),
  check (length(trim(encryption_key_id)) between 1 and 200),
  check (valid_until is null or valid_until >= valid_from)
);
create unique index partner_webhook_signing_secrets_active_idx
  on public.partner_webhook_signing_secrets (partner_webhook_subscription_id)
  where secret_state = 'active';
create table public.partner_webhook_dispatch_jobs (
  id uuid primary key default gen_random_uuid(),
  partner_webhook_subscription_id uuid not null
    references public.partner_webhook_subscriptions (id) on delete restrict,
  outbox_event_id uuid not null
    references public.partner_outbox_events (id) on delete restrict,
  partner_webhook_signing_secret_id uuid not null
    references public.partner_webhook_signing_secrets (id) on delete restrict,
  job_state text not null default 'pending',
  attempt_count integer not null default 0,
  next_attempt_at timestamptz not null default clock_timestamp(),
  locked_at timestamptz,
  locked_by_worker_id uuid,
  lock_token uuid,
  last_error_code text,
  completed_at timestamptz,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  unique (partner_webhook_subscription_id, outbox_event_id),
  check (job_state in ('pending', 'inflight', 'delivered', 'failed', 'discarded')),
  check (attempt_count >= 0),
  check (
    (job_state = 'inflight' and locked_at is not null and locked_by_worker_id is not null and lock_token is not null)
    or job_state <> 'inflight'
  )
);
create index partner_webhook_dispatch_jobs_claim_idx
  on public.partner_webhook_dispatch_jobs (job_state, next_attempt_at, created_at);
alter table public.partner_webhook_signing_secrets enable row level security;
alter table public.partner_webhook_dispatch_jobs enable row level security;
revoke all on table
  public.partner_webhook_signing_secrets,
  public.partner_webhook_dispatch_jobs
from public, anon, authenticated;
-- Subscriptions created before encrypted secret custody cannot be dispatched
-- safely. Pause them until an administrator performs a key rotation.
update public.partner_webhook_subscriptions subscription
set subscription_state = 'paused'
where subscription.subscription_state = 'active'
  and not exists (
    select 1
    from public.partner_webhook_signing_secrets secret
    where secret.partner_webhook_subscription_id = subscription.id
  );
drop function public.service_create_partner_webhook_subscription(uuid,uuid,uuid,text,text[],integer,integer,uuid);
create or replace function public.service_create_partner_webhook_subscription(
  p_organization_id uuid,
  p_actor_user_id uuid,
  p_partner_api_client_id uuid,
  p_endpoint_url text,
  p_event_types text[],
  p_max_attempts integer,
  p_timeout_ms integer,
  p_signing_secret_prefix text,
  p_signing_secret_digest_sha256 text,
  p_encrypted_secret text,
  p_encryption_key_id text,
  p_client_event_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $webhook$
declare
  existing_subscription public.partner_webhook_subscriptions%rowtype;
  created_subscription public.partner_webhook_subscriptions%rowtype;
begin
  if not public.service_user_has_organization_permission(
    p_organization_id, p_actor_user_id, 'partners.manage', 'organization', null
  ) then
    raise exception using errcode = '42501', message = 'partner_manage_permission_required';
  end if;
  if p_endpoint_url !~ '^https://[A-Za-z0-9.-]+(?::[0-9]{1,5})?(/.*)?$'
     or coalesce(cardinality(p_event_types), 0) = 0
     or coalesce(p_max_attempts, 0) not between 1 and 20
     or coalesce(p_timeout_ms, 0) not between 1000 and 60000
     or p_signing_secret_prefix !~ '^whsec_[a-z0-9]{8}$'
     or p_signing_secret_digest_sha256 !~ '^[0-9a-f]{64}$'
     or p_encrypted_secret !~ '^v1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$'
     or nullif(trim(p_encryption_key_id), '') is null then
    raise exception using errcode = '22023', message = 'partner_webhook_subscription_invalid';
  end if;

  select subscription.*
  into existing_subscription
  from public.partner_webhook_subscriptions subscription
  where subscription.client_event_id = p_client_event_id;
  if found then
    return jsonb_build_object(
      'subscriptionId', existing_subscription.id,
      'signingSecretPrefix', existing_subscription.signing_secret_prefix,
      'signingSecretVersion', (
        select max(secret.version_number)
        from public.partner_webhook_signing_secrets secret
        where secret.partner_webhook_subscription_id = existing_subscription.id
      ),
      'replayed', true
    );
  end if;

  perform 1
  from public.partner_api_clients client
  where client.id = p_partner_api_client_id
    and client.organization_id = p_organization_id
    and client.client_state = 'active';
  if not found then
    raise exception using errcode = 'P0002', message = 'active_partner_api_client_not_found';
  end if;

  insert into public.partner_webhook_subscriptions (
    organization_id,
    partner_api_client_id,
    endpoint_url,
    event_types,
    signing_secret_prefix,
    signing_secret_digest_sha256,
    max_attempts,
    timeout_ms,
    created_by_user_id,
    client_event_id
  )
  values (
    p_organization_id,
    p_partner_api_client_id,
    trim(p_endpoint_url),
    array(select distinct event_type from unnest(p_event_types) event_type order by event_type),
    p_signing_secret_prefix,
    p_signing_secret_digest_sha256,
    p_max_attempts,
    p_timeout_ms,
    p_actor_user_id,
    p_client_event_id
  )
  returning * into created_subscription;

  insert into public.partner_webhook_signing_secrets (
    partner_webhook_subscription_id,
    version_number,
    signing_secret_prefix,
    signing_secret_digest_sha256,
    encrypted_secret,
    encryption_key_id,
    created_by_user_id,
    client_event_id
  )
  values (
    created_subscription.id,
    1,
    p_signing_secret_prefix,
    p_signing_secret_digest_sha256,
    p_encrypted_secret,
    trim(p_encryption_key_id),
    p_actor_user_id,
    p_client_event_id
  );

  insert into public.audit_log (
    organization_id, actor_user_id, entity_type, entity_id, action, metadata_json
  )
  values (
    p_organization_id,
    p_actor_user_id,
    'partner_webhook_subscription',
    created_subscription.id,
    'partner.webhook_created',
    jsonb_build_object(
      'endpointUrl', created_subscription.endpoint_url,
      'eventTypes', created_subscription.event_types,
      'signingSecretPrefix', p_signing_secret_prefix
    )
  );

  return jsonb_build_object(
    'subscriptionId', created_subscription.id,
    'endpointUrl', created_subscription.endpoint_url,
    'eventTypes', to_jsonb(created_subscription.event_types),
    'signingSecretPrefix', created_subscription.signing_secret_prefix,
    'signingSecretVersion', 1,
    'replayed', false
  );
end
$webhook$;
create or replace function public.service_rotate_partner_webhook_signing_secret(
  p_organization_id uuid,
  p_actor_user_id uuid,
  p_subscription_id uuid,
  p_signing_secret_prefix text,
  p_signing_secret_digest_sha256 text,
  p_encrypted_secret text,
  p_encryption_key_id text,
  p_grace_period_hours integer,
  p_client_event_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $rotate$
declare
  subscription_row public.partner_webhook_subscriptions%rowtype;
  replayed_secret public.partner_webhook_signing_secrets%rowtype;
  next_version integer;
begin
  if not public.service_user_has_organization_permission(
    p_organization_id, p_actor_user_id, 'partners.manage', 'organization', null
  ) then
    raise exception using errcode = '42501', message = 'partner_manage_permission_required';
  end if;
  if p_signing_secret_prefix !~ '^whsec_[a-z0-9]{8}$'
     or p_signing_secret_digest_sha256 !~ '^[0-9a-f]{64}$'
     or p_encrypted_secret !~ '^v1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$'
     or nullif(trim(p_encryption_key_id), '') is null
     or coalesce(p_grace_period_hours, -1) not between 0 and 168 then
    raise exception using errcode = '22023', message = 'partner_webhook_rotation_invalid';
  end if;

  select secret.*
  into replayed_secret
  from public.partner_webhook_signing_secrets secret
  where secret.client_event_id = p_client_event_id;
  if found then
    return jsonb_build_object(
      'subscriptionId', replayed_secret.partner_webhook_subscription_id,
      'signingSecretPrefix', replayed_secret.signing_secret_prefix,
      'signingSecretVersion', replayed_secret.version_number,
      'replayed', true
    );
  end if;

  select subscription.*
  into subscription_row
  from public.partner_webhook_subscriptions subscription
  where subscription.id = p_subscription_id
    and subscription.organization_id = p_organization_id
    and subscription.subscription_state <> 'disabled'
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'partner_webhook_subscription_not_found';
  end if;

  select coalesce(max(secret.version_number), 0) + 1
  into next_version
  from public.partner_webhook_signing_secrets secret
  where secret.partner_webhook_subscription_id = subscription_row.id;

  update public.partner_webhook_signing_secrets secret
  set
    secret_state = case when p_grace_period_hours = 0 then 'retired' else 'retiring' end,
    valid_until = clock_timestamp() + make_interval(hours => p_grace_period_hours)
  where secret.partner_webhook_subscription_id = p_subscription_id
    and secret.secret_state = 'active';

  insert into public.partner_webhook_signing_secrets (
    partner_webhook_subscription_id,
    version_number,
    signing_secret_prefix,
    signing_secret_digest_sha256,
    encrypted_secret,
    encryption_key_id,
    created_by_user_id,
    client_event_id
  )
  values (
    p_subscription_id,
    next_version,
    p_signing_secret_prefix,
    p_signing_secret_digest_sha256,
    p_encrypted_secret,
    trim(p_encryption_key_id),
    p_actor_user_id,
    p_client_event_id
  );

  update public.partner_webhook_subscriptions subscription
  set
    signing_secret_prefix = p_signing_secret_prefix,
    signing_secret_digest_sha256 = p_signing_secret_digest_sha256,
    subscription_state = 'active',
    disabled_at = null
  where subscription.id = p_subscription_id;

  insert into public.audit_log (
    organization_id, actor_user_id, entity_type, entity_id, action, metadata_json
  )
  values (
    p_organization_id,
    p_actor_user_id,
    'partner_webhook_subscription',
    p_subscription_id,
    'partner.webhook_secret_rotated',
    jsonb_build_object(
      'signingSecretPrefix', p_signing_secret_prefix,
      'signingSecretVersion', next_version,
      'gracePeriodHours', p_grace_period_hours
    )
  );

  return jsonb_build_object(
    'subscriptionId', p_subscription_id,
    'signingSecretPrefix', p_signing_secret_prefix,
    'signingSecretVersion', next_version,
    'replayed', false
  );
end
$rotate$;
create or replace function public.service_enqueue_partner_outbox_event(
  p_organization_id uuid,
  p_event_type text,
  p_aggregate_type text,
  p_aggregate_id uuid,
  p_aggregate_version text,
  p_data_json jsonb,
  p_occurred_at timestamptz default clock_timestamp()
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $enqueue$
declare
  event_id uuid := gen_random_uuid();
  payload jsonb;
  payload_digest text;
begin
  if p_event_type !~ '^[a-z][a-z0-9_.:-]{2,119}$'
     or p_aggregate_type !~ '^[a-z][a-z0-9_:-]{1,79}$'
     or jsonb_typeof(coalesce(p_data_json, 'null'::jsonb)) <> 'object' then
    raise exception using errcode = '22023', message = 'partner_outbox_event_invalid';
  end if;
  perform 1 from public.organizations organization where organization.id = p_organization_id;
  if not found then
    raise exception using errcode = 'P0002', message = 'partner_outbox_organization_not_found';
  end if;

  payload := jsonb_build_object(
    'schemaVersion', '2026-07-25',
    'eventId', event_id,
    'eventType', p_event_type,
    'occurredAt', p_occurred_at,
    'tenant', jsonb_build_object('organizationId', p_organization_id),
    'object', jsonb_build_object(
      'type', p_aggregate_type,
      'id', p_aggregate_id,
      'version', p_aggregate_version
    ),
    'data', p_data_json
  );
  payload_digest := encode(public.digest(convert_to(payload::text, 'utf8'), 'sha256'), 'hex');

  insert into public.partner_outbox_events (
    id,
    organization_id,
    event_type,
    aggregate_type,
    aggregate_id,
    payload_json,
    payload_digest_sha256
  )
  values (
    event_id,
    p_organization_id,
    p_event_type,
    p_aggregate_type,
    p_aggregate_id,
    payload,
    payload_digest
  );

  return jsonb_build_object(
    'eventId', event_id,
    'eventType', p_event_type,
    'payloadDigestSha256', payload_digest
  );
end
$enqueue$;
create or replace function public.enqueue_result_publication_partner_event()
returns trigger
language plpgsql
security definer
set search_path = ''
as $result_event$
declare
  organization_id uuid;
begin
  if new.publication_state not in ('official', 'corrected') then
    return new;
  end if;

  select series.organization_id
  into organization_id
  from public.event_categories category
  join public.event_editions edition on edition.id = category.event_edition_id
  join public.event_series series on series.id = edition.event_series_id
  where category.id = new.event_category_id;

  perform public.service_enqueue_partner_outbox_event(
    organization_id,
    case when new.publication_state = 'corrected' then 'result.corrected' else 'result.official' end,
    'result_publication',
    new.id,
    coalesce(new.manifest_digest_sha256, 'legacy'),
    jsonb_build_object(
      'publicationState', new.publication_state,
      'eventCategoryId', new.event_category_id,
      'publishedAt', new.published_at,
      'apiPath', '/api/v1/partner/result-publications/' || new.id::text
    ),
    new.published_at
  );
  return new;
end
$result_event$;
create trigger result_publications_partner_outbox
after insert on public.result_publications
for each row execute function public.enqueue_result_publication_partner_event();
create or replace function public.enqueue_league_standings_partner_event()
returns trigger
language plpgsql
security definer
set search_path = ''
as $standings_event$
declare
  organization_id uuid;
begin
  if new.standings_digest_sha256 is null
     or old.standings_digest_sha256 is not null then
    return new;
  end if;

  select league.organization_id
  into organization_id
  from public.league_seasons season
  join public.leagues league on league.id = season.league_id
  where season.id = new.league_season_id;

  perform public.service_enqueue_partner_outbox_event(
    organization_id,
    'league.standings',
    'league_standings_version',
    new.id,
    new.version_number::text,
    jsonb_build_object(
      'leagueSeasonId', new.league_season_id,
      'publicationState', new.publication_state,
      'standingsDigestSha256', new.standings_digest_sha256,
      'generatedAt', new.generated_at,
      'apiPath', '/api/v1/partner/league-seasons/' || new.league_season_id::text || '/standings'
    ),
    new.generated_at
  );
  return new;
end
$standings_event$;
create trigger league_standings_versions_partner_outbox
after update of standings_digest_sha256 on public.league_standings_versions
for each row execute function public.enqueue_league_standings_partner_event();
create or replace function public.service_claim_partner_webhook_jobs(
  p_worker_id uuid,
  p_limit integer default 25,
  p_lease_seconds integer default 120
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $claim$
declare
  claimed jsonb;
begin
  if p_worker_id is null
     or coalesce(p_limit, 0) not between 1 and 100
     or coalesce(p_lease_seconds, 0) not between 30 and 900 then
    raise exception using errcode = '22023', message = 'partner_webhook_claim_invalid';
  end if;

  update public.partner_webhook_dispatch_jobs job
  set
    job_state = 'pending',
    locked_at = null,
    locked_by_worker_id = null,
    lock_token = null,
    next_attempt_at = clock_timestamp(),
    updated_at = clock_timestamp(),
    last_error_code = 'lease_expired'
  where job.job_state = 'inflight'
    and job.locked_at < clock_timestamp() - make_interval(secs => p_lease_seconds);

  insert into public.partner_webhook_dispatch_jobs (
    partner_webhook_subscription_id,
    outbox_event_id,
    partner_webhook_signing_secret_id
  )
  select
    subscription.id,
    outbox.id,
    secret.id
  from public.partner_outbox_events outbox
  join public.partner_webhook_subscriptions subscription
    on subscription.organization_id = outbox.organization_id
   and subscription.subscription_state = 'active'
   and outbox.event_type = any(subscription.event_types)
   and outbox.created_at >= subscription.created_at
  join public.partner_api_clients client
    on client.id = subscription.partner_api_client_id
   and client.client_state = 'active'
   and (client.expires_at is null or client.expires_at > clock_timestamp())
  join lateral (
    select signing_secret.id
    from public.partner_webhook_signing_secrets signing_secret
    where signing_secret.partner_webhook_subscription_id = subscription.id
      and signing_secret.secret_state = 'active'
    order by signing_secret.version_number desc
    limit 1
  ) secret on true
  where outbox.delivery_state = 'queued'
    and outbox.available_at <= clock_timestamp()
  on conflict (partner_webhook_subscription_id, outbox_event_id) do nothing;

  update public.partner_outbox_events outbox
  set
    delivery_state = 'dispatched',
    dispatched_at = coalesce(outbox.dispatched_at, clock_timestamp())
  where outbox.delivery_state = 'queued'
    and outbox.available_at <= clock_timestamp();

  with candidates as (
    select job.id
    from public.partner_webhook_dispatch_jobs job
    join public.partner_webhook_subscriptions subscription
      on subscription.id = job.partner_webhook_subscription_id
    join public.partner_api_clients client
      on client.id = subscription.partner_api_client_id
    where job.job_state = 'pending'
      and job.next_attempt_at <= clock_timestamp()
      and job.attempt_count < subscription.max_attempts
      and subscription.subscription_state = 'active'
      and client.client_state = 'active'
    order by job.next_attempt_at, job.created_at
    for update of job skip locked
    limit p_limit
  ),
  leased as (
    update public.partner_webhook_dispatch_jobs job
    set
      job_state = 'inflight',
      locked_at = clock_timestamp(),
      locked_by_worker_id = p_worker_id,
      lock_token = gen_random_uuid(),
      updated_at = clock_timestamp()
    from candidates
    where job.id = candidates.id
    returning job.*
  )
  select coalesce(jsonb_agg(
    jsonb_build_object(
      'jobId', job.id,
      'lockToken', job.lock_token,
      'attemptNumber', job.attempt_count + 1,
      'eventId', outbox.id,
      'eventType', outbox.event_type,
      'payload', outbox.payload_json,
      'payloadDigestSha256', outbox.payload_digest_sha256,
      'endpointUrl', subscription.endpoint_url,
      'timeoutMs', subscription.timeout_ms,
      'maxAttempts', subscription.max_attempts,
      'signingSecretPrefix', secret.signing_secret_prefix,
      'signingSecretDigestSha256', secret.signing_secret_digest_sha256,
      'signingSecretVersion', secret.version_number,
      'encryptedSecret', secret.encrypted_secret,
      'encryptionKeyId', secret.encryption_key_id
    )
    order by job.created_at
  ), '[]'::jsonb)
  into claimed
  from leased job
  join public.partner_outbox_events outbox on outbox.id = job.outbox_event_id
  join public.partner_webhook_subscriptions subscription
    on subscription.id = job.partner_webhook_subscription_id
  join public.partner_webhook_signing_secrets secret
    on secret.id = job.partner_webhook_signing_secret_id;

  return claimed;
end
$claim$;
create or replace function public.service_record_partner_webhook_attempt(
  p_job_id uuid,
  p_lock_token uuid,
  p_response_status integer,
  p_response_digest_sha256 text,
  p_duration_ms integer,
  p_error_code text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $record$
declare
  job_row public.partner_webhook_dispatch_jobs%rowtype;
  subscription_row public.partner_webhook_subscriptions%rowtype;
  outbox_row public.partner_outbox_events%rowtype;
  attempt_number integer;
  delivered boolean;
  retryable boolean;
  resolved_state text;
  retry_at timestamptz;
begin
  if p_response_status is not null and p_response_status not between 100 and 599 then
    raise exception using errcode = '22023', message = 'partner_webhook_response_status_invalid';
  end if;
  if p_response_digest_sha256 is not null
     and p_response_digest_sha256 !~ '^[0-9a-f]{64}$' then
    raise exception using errcode = '22023', message = 'partner_webhook_response_digest_invalid';
  end if;
  if coalesce(p_duration_ms, -1) < 0 then
    raise exception using errcode = '22023', message = 'partner_webhook_duration_invalid';
  end if;

  select job.*
  into job_row
  from public.partner_webhook_dispatch_jobs job
  where job.id = p_job_id
    and job.job_state = 'inflight'
    and job.lock_token = p_lock_token
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'partner_webhook_job_lease_not_found';
  end if;

  select subscription.*
  into subscription_row
  from public.partner_webhook_subscriptions subscription
  where subscription.id = job_row.partner_webhook_subscription_id;
  select outbox.*
  into outbox_row
  from public.partner_outbox_events outbox
  where outbox.id = job_row.outbox_event_id;

  attempt_number := job_row.attempt_count + 1;
  delivered := p_response_status between 200 and 299;
  retryable := not delivered
    and attempt_number < subscription_row.max_attempts
    and (
      p_response_status is null
      or p_response_status in (408, 425, 429)
      or p_response_status >= 500
    );
  resolved_state := case
    when delivered then 'delivered'
    when retryable then 'retrying'
    else 'failed'
  end;
  retry_at := case
    when retryable then clock_timestamp()
      + make_interval(secs => least(3600, (30 * power(2, least(attempt_number - 1, 7)))::integer))
    else null
  end;

  insert into public.partner_webhook_deliveries (
    partner_webhook_subscription_id,
    outbox_event_id,
    event_type,
    event_id,
    attempt_number,
    delivery_state,
    payload_digest_sha256,
    response_status,
    response_digest_sha256,
    duration_ms,
    next_attempt_at,
    error_code
  )
  values (
    subscription_row.id,
    outbox_row.id,
    outbox_row.event_type,
    outbox_row.id,
    attempt_number,
    resolved_state,
    outbox_row.payload_digest_sha256,
    p_response_status,
    p_response_digest_sha256,
    p_duration_ms,
    retry_at,
    nullif(trim(p_error_code), '')
  );

  update public.partner_webhook_dispatch_jobs job
  set
    job_state = case
      when delivered then 'delivered'
      when retryable then 'pending'
      else 'failed'
    end,
    attempt_count = attempt_number,
    next_attempt_at = coalesce(retry_at, job.next_attempt_at),
    locked_at = null,
    locked_by_worker_id = null,
    lock_token = null,
    last_error_code = nullif(trim(p_error_code), ''),
    completed_at = case when delivered or not retryable then clock_timestamp() else null end,
    updated_at = clock_timestamp()
  where job.id = job_row.id;

  if not retryable and not delivered then
    update public.partner_outbox_events outbox
    set delivery_state = 'failed'
    where outbox.id = outbox_row.id
      and not exists (
        select 1
        from public.partner_webhook_dispatch_jobs other_job
        where other_job.outbox_event_id = outbox_row.id
          and other_job.job_state in ('pending', 'inflight')
      );
  end if;

  return jsonb_build_object(
    'jobId', job_row.id,
    'eventId', outbox_row.id,
    'attemptNumber', attempt_number,
    'deliveryState', resolved_state,
    'nextAttemptAt', retry_at
  );
end
$record$;
revoke all on function public.service_create_partner_webhook_subscription(
  uuid,uuid,uuid,text,text[],integer,integer,text,text,text,text,uuid
) from public, anon, authenticated;
revoke all on function public.service_rotate_partner_webhook_signing_secret(
  uuid,uuid,uuid,text,text,text,text,integer,uuid
) from public, anon, authenticated;
revoke all on function public.service_enqueue_partner_outbox_event(
  uuid,text,text,uuid,text,jsonb,timestamptz
) from public, anon, authenticated;
revoke all on function public.service_claim_partner_webhook_jobs(uuid,integer,integer)
  from public, anon, authenticated;
revoke all on function public.service_record_partner_webhook_attempt(uuid,uuid,integer,text,integer,text)
  from public, anon, authenticated;
grant execute on function public.service_create_partner_webhook_subscription(
  uuid,uuid,uuid,text,text[],integer,integer,text,text,text,text,uuid
) to service_role;
grant execute on function public.service_rotate_partner_webhook_signing_secret(
  uuid,uuid,uuid,text,text,text,text,integer,uuid
) to service_role;
grant execute on function public.service_enqueue_partner_outbox_event(
  uuid,text,text,uuid,text,jsonb,timestamptz
) to service_role;
grant execute on function public.service_claim_partner_webhook_jobs(uuid,integer,integer)
  to service_role;
grant execute on function public.service_record_partner_webhook_attempt(uuid,uuid,integer,text,integer,text)
  to service_role;
