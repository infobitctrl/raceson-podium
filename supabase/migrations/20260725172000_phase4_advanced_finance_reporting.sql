/*
 * Premium finance reporting and accounting exports.
 *
 * The financial ledger remains canonical and append-only. Reports and exports
 * are immutable, checksummed snapshots so a later ledger correction creates a
 * new artifact instead of silently rewriting a statement already supplied to
 * an organizer, accountant, auditor, or tax authority.
 */

create table public.organization_finance_reporting_profiles (
  organization_id uuid primary key references public.organizations (id) on delete cascade,
  reporting_currency char(3) not null,
  tax_jurisdiction text,
  tax_identifier_reference text,
  accounting_provider text,
  chart_of_accounts_json jsonb not null default '{}'::jsonb,
  export_retention_days integer not null default 90,
  version_number integer not null default 1,
  last_client_event_id uuid not null unique,
  updated_by_user_id uuid,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  check (reporting_currency ~ '^[A-Z]{3}$'),
  check (tax_jurisdiction is null or length(trim(tax_jurisdiction)) > 0),
  check (tax_identifier_reference is null or length(trim(tax_identifier_reference)) > 0),
  check (accounting_provider is null or length(trim(accounting_provider)) > 0),
  check (jsonb_typeof(chart_of_accounts_json) = 'object'),
  check (export_retention_days between 7 and 2555),
  check (version_number > 0)
);
create table public.finance_report_snapshots (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete restrict,
  event_edition_id uuid references public.event_editions (id) on delete restrict,
  report_type text not null,
  report_state text not null default 'finalized',
  period_start date not null,
  period_end date not null,
  currency char(3) not null,
  summary_json jsonb not null,
  ledger_entry_count integer not null,
  ledger_digest_sha256 text not null,
  profile_version integer,
  generated_by_user_id uuid,
  client_event_id uuid not null unique,
  generated_at timestamptz not null default clock_timestamp(),
  check (report_type in ('payout_statement', 'fee_breakdown', 'tax_summary', 'close_report')),
  check (report_state in ('finalized', 'superseded')),
  check (period_end >= period_start),
  check (currency ~ '^[A-Z]{3}$'),
  check (jsonb_typeof(summary_json) = 'object'),
  check (ledger_entry_count >= 0),
  check (ledger_digest_sha256 ~ '^[0-9a-f]{64}$'),
  check (profile_version is null or profile_version > 0)
);
create index finance_report_snapshots_org_period_idx
  on public.finance_report_snapshots (organization_id, period_end desc, generated_at desc);
create index finance_report_snapshots_edition_idx
  on public.finance_report_snapshots (event_edition_id, generated_at desc)
  where event_edition_id is not null;
create table public.finance_export_jobs (
  id uuid primary key,
  organization_id uuid not null references public.organizations (id) on delete restrict,
  finance_report_snapshot_id uuid references public.finance_report_snapshots (id) on delete restrict,
  event_edition_id uuid references public.event_editions (id) on delete restrict,
  export_type text not null,
  export_format text not null,
  export_state text not null default 'ready',
  filters_json jsonb not null default '{}'::jsonb,
  payload_json jsonb not null,
  row_count integer not null,
  object_reference text not null,
  checksum_sha256 text not null,
  requested_by_user_id uuid,
  client_event_id uuid not null unique,
  requested_at timestamptz not null default clock_timestamp(),
  ready_at timestamptz not null default clock_timestamp(),
  expires_at timestamptz not null,
  check (
    export_type in (
      'ledger',
      'payout_statement',
      'fee_breakdown',
      'tax_summary',
      'refund_register',
      'invoice_register'
    )
  ),
  check (export_format in ('csv', 'json')),
  check (export_state in ('ready', 'expired')),
  check (jsonb_typeof(filters_json) = 'object'),
  check (jsonb_typeof(payload_json) in ('array', 'object')),
  check (row_count >= 0),
  check (length(trim(object_reference)) > 0),
  check (checksum_sha256 ~ '^[0-9a-f]{64}$'),
  check (expires_at > ready_at)
);
create index finance_export_jobs_org_requested_idx
  on public.finance_export_jobs (organization_id, requested_at desc);
create table public.finance_export_events (
  id uuid primary key default gen_random_uuid(),
  finance_export_job_id uuid not null references public.finance_export_jobs (id) on delete restrict,
  sequence_number integer not null,
  action_type text not null,
  note text not null,
  metadata_json jsonb not null default '{}'::jsonb,
  actor_user_id uuid,
  client_event_id uuid not null unique,
  created_at timestamptz not null default clock_timestamp(),
  unique (finance_export_job_id, sequence_number),
  check (action_type in ('requested', 'generated', 'downloaded', 'expired')),
  check (length(trim(note)) > 0),
  check (jsonb_typeof(metadata_json) = 'object')
);
create index finance_export_events_job_sequence_idx
  on public.finance_export_events (finance_export_job_id, sequence_number desc);
create or replace function public.prevent_finance_reporting_evidence_change()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception using errcode = '55000', message = 'finance_reporting_evidence_is_append_only';
end;
$$;
create trigger finance_report_snapshots_immutable
before update or delete on public.finance_report_snapshots
for each row execute function public.prevent_finance_reporting_evidence_change();
create trigger finance_export_jobs_immutable
before update or delete on public.finance_export_jobs
for each row execute function public.prevent_finance_reporting_evidence_change();
create trigger finance_export_events_immutable
before update or delete on public.finance_export_events
for each row execute function public.prevent_finance_reporting_evidence_change();
create or replace function public.service_save_finance_reporting_profile(
  p_organization_id uuid,
  p_actor_user_id uuid,
  p_reporting_currency text,
  p_tax_jurisdiction text,
  p_tax_identifier_reference text,
  p_accounting_provider text,
  p_chart_of_accounts_json jsonb,
  p_export_retention_days integer,
  p_client_event_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  profile_row public.organization_finance_reporting_profiles%rowtype;
begin
  if p_organization_id is null
     or p_actor_user_id is null
     or p_client_event_id is null
     or upper(trim(coalesce(p_reporting_currency, ''))) !~ '^[A-Z]{3}$'
     or coalesce(jsonb_typeof(p_chart_of_accounts_json), 'object') <> 'object'
     or p_export_retention_days not between 7 and 2555 then
    raise exception using errcode = '22023', message = 'finance_reporting_profile_input_invalid';
  end if;

  select profile.*
  into profile_row
  from public.organization_finance_reporting_profiles profile
  where profile.last_client_event_id = p_client_event_id;
  if found then
    if profile_row.organization_id <> p_organization_id then
      raise exception using errcode = '23505', message = 'idempotency_key_reused';
    end if;
    return jsonb_build_object(
      'organizationId', profile_row.organization_id,
      'versionNumber', profile_row.version_number,
      'reportingCurrency', trim(profile_row.reporting_currency),
      'replayed', true
    );
  end if;

  insert into public.organization_finance_reporting_profiles (
    organization_id,
    reporting_currency,
    tax_jurisdiction,
    tax_identifier_reference,
    accounting_provider,
    chart_of_accounts_json,
    export_retention_days,
    version_number,
    last_client_event_id,
    updated_by_user_id
  )
  values (
    p_organization_id,
    upper(trim(p_reporting_currency)),
    nullif(trim(p_tax_jurisdiction), ''),
    nullif(trim(p_tax_identifier_reference), ''),
    nullif(trim(p_accounting_provider), ''),
    coalesce(p_chart_of_accounts_json, '{}'::jsonb),
    p_export_retention_days,
    1,
    p_client_event_id,
    p_actor_user_id
  )
  on conflict (organization_id)
  do update set
    reporting_currency = excluded.reporting_currency,
    tax_jurisdiction = excluded.tax_jurisdiction,
    tax_identifier_reference = excluded.tax_identifier_reference,
    accounting_provider = excluded.accounting_provider,
    chart_of_accounts_json = excluded.chart_of_accounts_json,
    export_retention_days = excluded.export_retention_days,
    version_number = public.organization_finance_reporting_profiles.version_number + 1,
    last_client_event_id = excluded.last_client_event_id,
    updated_by_user_id = excluded.updated_by_user_id,
    updated_at = clock_timestamp()
  returning * into profile_row;

  insert into public.audit_log (
    organization_id,
    actor_user_id,
    entity_type,
    entity_id,
    action,
    metadata_json
  )
  values (
    p_organization_id,
    p_actor_user_id,
    'finance_reporting_profile',
    p_organization_id,
    'finance.reporting_profile_saved',
    jsonb_build_object(
      'versionNumber', profile_row.version_number,
      'reportingCurrency', trim(profile_row.reporting_currency),
      'accountingProvider', profile_row.accounting_provider,
      'exportRetentionDays', profile_row.export_retention_days
    )
  );

  return jsonb_build_object(
    'organizationId', profile_row.organization_id,
    'versionNumber', profile_row.version_number,
    'reportingCurrency', trim(profile_row.reporting_currency),
    'replayed', false
  );
end;
$$;
create or replace function public.service_generate_finance_report(
  p_organization_id uuid,
  p_event_edition_id uuid,
  p_actor_user_id uuid,
  p_period_start date,
  p_period_end date,
  p_report_type text,
  p_client_event_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  existing_snapshot public.finance_report_snapshots%rowtype;
  created_snapshot public.finance_report_snapshots%rowtype;
  profile_row public.organization_finance_reporting_profiles%rowtype;
  reporting_currency text;
  entry_count integer;
  ledger_digest text;
  summary_value jsonb;
begin
  if p_organization_id is null
     or p_actor_user_id is null
     or p_client_event_id is null
     or p_period_start is null
     or p_period_end is null
     or p_period_end < p_period_start
     or p_period_end - p_period_start > 1095
     or p_report_type not in ('payout_statement', 'fee_breakdown', 'tax_summary', 'close_report') then
    raise exception using errcode = '22023', message = 'finance_report_input_invalid';
  end if;

  select snapshot.*
  into existing_snapshot
  from public.finance_report_snapshots snapshot
  where snapshot.client_event_id = p_client_event_id;
  if found then
    if existing_snapshot.organization_id <> p_organization_id
       or existing_snapshot.event_edition_id is distinct from p_event_edition_id
       or existing_snapshot.period_start <> p_period_start
       or existing_snapshot.period_end <> p_period_end
       or existing_snapshot.report_type <> p_report_type then
      raise exception using errcode = '23505', message = 'idempotency_key_reused';
    end if;
    return jsonb_build_object(
      'id', existing_snapshot.id,
      'reportType', existing_snapshot.report_type,
      'ledgerEntryCount', existing_snapshot.ledger_entry_count,
      'ledgerDigestSha256', existing_snapshot.ledger_digest_sha256,
      'replayed', true
    );
  end if;

  if p_event_edition_id is not null and not exists (
    select 1
    from public.event_editions edition
    join public.event_series series on series.id = edition.event_series_id
    where edition.id = p_event_edition_id
      and series.organization_id = p_organization_id
  ) then
    raise exception using errcode = '22023', message = 'finance_report_scope_invalid';
  end if;

  select profile.*
  into profile_row
  from public.organization_finance_reporting_profiles profile
  where profile.organization_id = p_organization_id;
  reporting_currency := coalesce(trim(profile_row.reporting_currency), 'EUR');

  with scoped_entries as (
    select ledger.*
    from public.financial_ledger_entries ledger
    left join public.registrations registration on registration.id = ledger.registration_id
    left join public.event_categories category on category.id = registration.event_category_id
    where ledger.organization_id = p_organization_id
      and ledger.currency = reporting_currency
      and ledger.effective_at >= p_period_start::timestamptz
      and ledger.effective_at < (p_period_end + 1)::timestamptz
      and (
        p_event_edition_id is null
        or category.event_edition_id = p_event_edition_id
        or ledger.metadata_json->>'eventEditionId' = p_event_edition_id::text
      )
  )
  select
    count(*)::integer,
    encode(
      public.digest(
        convert_to(
          coalesce(
            string_agg(
              entry.id::text || ':' || entry.entry_type || ':' || entry.amount_cents::text
                || ':' || trim(entry.currency) || ':' || entry.effective_at::text,
              '|' order by entry.effective_at, entry.id
            ),
            ''
          ),
          'utf8'
        ),
        'sha256'
      ),
      'hex'
    ),
    jsonb_build_object(
      'salesCollectedCents', coalesce(sum(entry.amount_cents) filter (where entry.entry_type = 'charge'), 0),
      'discountsReportedCents', coalesce(sum(
        case when entry.entry_type = 'charge'
          then greatest(coalesce((entry.metadata_json->>'discountCents')::bigint, 0), 0)
          else 0
        end
      ), 0),
      'taxReportedCents', coalesce(sum(
        case when entry.entry_type = 'charge'
          then greatest(coalesce((entry.metadata_json->>'taxCents')::bigint, 0), 0)
          else 0
        end
      ), 0),
      'processorFeesCents', abs(coalesce(sum(entry.amount_cents) filter (where entry.entry_type = 'processor_fee'), 0)),
      'platformFeesCents', abs(coalesce(sum(entry.amount_cents) filter (where entry.entry_type = 'platform_fee'), 0)),
      'refundsCents', abs(coalesce(sum(entry.amount_cents) filter (where entry.entry_type = 'refund'), 0)),
      'disputesCents', abs(coalesce(sum(entry.amount_cents) filter (where entry.entry_type = 'dispute'), 0)),
      'payoutsRecordedCents', abs(coalesce(sum(entry.amount_cents) filter (where entry.entry_type = 'payout'), 0)),
      'adjustmentsCents', coalesce(sum(entry.amount_cents) filter (where entry.entry_type = 'adjustment'), 0),
      'netLedgerCents', coalesce(sum(entry.amount_cents), 0),
      'currency', reporting_currency,
      'scope', case when p_event_edition_id is null then 'organization' else 'event_edition' end,
      'freshness', 'finalized_snapshot',
      'periodStart', p_period_start,
      'periodEnd', p_period_end
    )
  into entry_count, ledger_digest, summary_value
  from scoped_entries entry;

  insert into public.finance_report_snapshots (
    organization_id,
    event_edition_id,
    report_type,
    report_state,
    period_start,
    period_end,
    currency,
    summary_json,
    ledger_entry_count,
    ledger_digest_sha256,
    profile_version,
    generated_by_user_id,
    client_event_id
  )
  values (
    p_organization_id,
    p_event_edition_id,
    p_report_type,
    'finalized',
    p_period_start,
    p_period_end,
    reporting_currency,
    summary_value,
    entry_count,
    ledger_digest,
    profile_row.version_number,
    p_actor_user_id,
    p_client_event_id
  )
  returning * into created_snapshot;

  insert into public.audit_log (
    organization_id,
    actor_user_id,
    entity_type,
    entity_id,
    action,
    metadata_json
  )
  values (
    p_organization_id,
    p_actor_user_id,
    'finance_report_snapshot',
    created_snapshot.id,
    'finance.report_finalized',
    jsonb_build_object(
      'reportType', created_snapshot.report_type,
      'eventEditionId', created_snapshot.event_edition_id,
      'periodStart', created_snapshot.period_start,
      'periodEnd', created_snapshot.period_end,
      'ledgerEntryCount', created_snapshot.ledger_entry_count,
      'ledgerDigestSha256', created_snapshot.ledger_digest_sha256
    )
  );

  return jsonb_build_object(
    'id', created_snapshot.id,
    'reportType', created_snapshot.report_type,
    'ledgerEntryCount', created_snapshot.ledger_entry_count,
    'ledgerDigestSha256', created_snapshot.ledger_digest_sha256,
    'summary', created_snapshot.summary_json,
    'replayed', false
  );
exception
  when invalid_text_representation then
    raise exception using errcode = '22023', message = 'finance_ledger_metadata_invalid';
end;
$$;
create or replace function public.service_request_finance_export(
  p_organization_id uuid,
  p_finance_report_snapshot_id uuid,
  p_actor_user_id uuid,
  p_export_type text,
  p_export_format text,
  p_filters_json jsonb,
  p_client_event_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  existing_job public.finance_export_jobs%rowtype;
  snapshot_row public.finance_report_snapshots%rowtype;
  profile_row public.organization_finance_reporting_profiles%rowtype;
  export_id uuid := gen_random_uuid();
  export_payload jsonb;
  export_row_count integer;
  export_checksum text;
  retention_days integer;
begin
  if p_organization_id is null
     or p_finance_report_snapshot_id is null
     or p_actor_user_id is null
     or p_client_event_id is null
     or p_export_type not in (
       'ledger', 'payout_statement', 'fee_breakdown', 'tax_summary',
       'refund_register', 'invoice_register'
     )
     or p_export_format not in ('csv', 'json')
     or coalesce(jsonb_typeof(p_filters_json), 'object') <> 'object' then
    raise exception using errcode = '22023', message = 'finance_export_input_invalid';
  end if;

  select job.*
  into existing_job
  from public.finance_export_jobs job
  where job.client_event_id = p_client_event_id;
  if found then
    if existing_job.organization_id <> p_organization_id
       or existing_job.finance_report_snapshot_id <> p_finance_report_snapshot_id
       or existing_job.export_type <> p_export_type
       or existing_job.export_format <> p_export_format then
      raise exception using errcode = '23505', message = 'idempotency_key_reused';
    end if;
    return jsonb_build_object(
      'id', existing_job.id,
      'exportState', existing_job.export_state,
      'checksumSha256', existing_job.checksum_sha256,
      'replayed', true
    );
  end if;

  select snapshot.*
  into snapshot_row
  from public.finance_report_snapshots snapshot
  where snapshot.id = p_finance_report_snapshot_id
    and snapshot.organization_id = p_organization_id;
  if not found then
    raise exception using errcode = 'P0002', message = 'finance_report_not_found';
  end if;

  select profile.*
  into profile_row
  from public.organization_finance_reporting_profiles profile
  where profile.organization_id = p_organization_id;
  retention_days := coalesce(profile_row.export_retention_days, 90);

  if p_export_type = 'ledger' then
    select
      coalesce(
        jsonb_agg(
          jsonb_build_object(
            'entryId', ledger.id,
            'registrationId', ledger.registration_id,
            'paymentIntentId', ledger.payment_intent_id,
            'entryType', ledger.entry_type,
            'amountCents', ledger.amount_cents,
            'currency', trim(ledger.currency),
            'externalReference', ledger.external_reference,
            'description', ledger.description,
            'effectiveAt', ledger.effective_at,
            'metadata', ledger.metadata_json
          )
          order by ledger.effective_at, ledger.id
        ),
        '[]'::jsonb
      ),
      count(*)::integer
    into export_payload, export_row_count
    from public.financial_ledger_entries ledger
    left join public.registrations registration on registration.id = ledger.registration_id
    left join public.event_categories category on category.id = registration.event_category_id
    where ledger.organization_id = p_organization_id
      and ledger.currency = snapshot_row.currency
      and ledger.effective_at >= snapshot_row.period_start::timestamptz
      and ledger.effective_at < (snapshot_row.period_end + 1)::timestamptz
      and (
        snapshot_row.event_edition_id is null
        or category.event_edition_id = snapshot_row.event_edition_id
        or ledger.metadata_json->>'eventEditionId' = snapshot_row.event_edition_id::text
      );
  elsif p_export_type = 'refund_register' then
    select
      coalesce(
        jsonb_agg(
          jsonb_build_object(
            'refundId', refund.id,
            'registrationId', refund.registration_id,
            'status', refund.status,
            'amountCents', refund.amount_cents,
            'currency', trim(refund.currency),
            'reason', refund.reason,
            'providerReference', refund.provider_refund_id,
            'requestedAt', refund.requested_at,
            'completedAt', refund.completed_at
          )
          order by refund.requested_at, refund.id
        ),
        '[]'::jsonb
      ),
      count(*)::integer
    into export_payload, export_row_count
    from public.payment_refunds refund
    where refund.organization_id = p_organization_id
      and refund.currency = snapshot_row.currency
      and refund.requested_at >= snapshot_row.period_start::timestamptz
      and refund.requested_at < (snapshot_row.period_end + 1)::timestamptz;
  else
    export_payload := jsonb_build_object(
      'reportId', snapshot_row.id,
      'reportType', snapshot_row.report_type,
      'reportState', snapshot_row.report_state,
      'eventEditionId', snapshot_row.event_edition_id,
      'periodStart', snapshot_row.period_start,
      'periodEnd', snapshot_row.period_end,
      'currency', trim(snapshot_row.currency),
      'ledgerEntryCount', snapshot_row.ledger_entry_count,
      'ledgerDigestSha256', snapshot_row.ledger_digest_sha256,
      'summary', snapshot_row.summary_json,
      'filters', coalesce(p_filters_json, '{}'::jsonb)
    );
    export_row_count := 1;
  end if;

  export_checksum := encode(
    public.digest(convert_to(export_payload::text, 'utf8'), 'sha256'),
    'hex'
  );

  insert into public.finance_export_jobs (
    id,
    organization_id,
    finance_report_snapshot_id,
    event_edition_id,
    export_type,
    export_format,
    export_state,
    filters_json,
    payload_json,
    row_count,
    object_reference,
    checksum_sha256,
    requested_by_user_id,
    client_event_id,
    expires_at
  )
  values (
    export_id,
    p_organization_id,
    snapshot_row.id,
    snapshot_row.event_edition_id,
    p_export_type,
    p_export_format,
    'ready',
    coalesce(p_filters_json, '{}'::jsonb),
    export_payload,
    export_row_count,
    'finance-export://' || export_id::text,
    export_checksum,
    p_actor_user_id,
    p_client_event_id,
    clock_timestamp() + make_interval(days => retention_days)
  );

  insert into public.finance_export_events (
    finance_export_job_id,
    sequence_number,
    action_type,
    note,
    metadata_json,
    actor_user_id,
    client_event_id
  )
  values
    (
      export_id,
      1,
      'requested',
      'Finance export requested.',
      jsonb_build_object('exportType', p_export_type, 'exportFormat', p_export_format),
      p_actor_user_id,
      gen_random_uuid()
    ),
    (
      export_id,
      2,
      'generated',
      'Checksummed finance export generated from a finalized report snapshot.',
      jsonb_build_object('rowCount', export_row_count, 'checksumSha256', export_checksum),
      p_actor_user_id,
      gen_random_uuid()
    );

  return jsonb_build_object(
    'id', export_id,
    'exportState', 'ready',
    'rowCount', export_row_count,
    'checksumSha256', export_checksum,
    'expiresAt', clock_timestamp() + make_interval(days => retention_days),
    'replayed', false
  );
end;
$$;
create or replace function public.service_record_finance_export_download(
  p_finance_export_job_id uuid,
  p_actor_user_id uuid,
  p_delivery_channel text,
  p_client_event_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  export_row public.finance_export_jobs%rowtype;
  existing_event public.finance_export_events%rowtype;
  next_sequence integer;
  created_event public.finance_export_events%rowtype;
begin
  if p_finance_export_job_id is null
     or p_actor_user_id is null
     or p_client_event_id is null
     or p_delivery_channel not in ('browser_download', 'accounting_adapter', 'secure_support') then
    raise exception using errcode = '22023', message = 'finance_export_download_input_invalid';
  end if;

  select event.*
  into existing_event
  from public.finance_export_events event
  where event.client_event_id = p_client_event_id;
  if found then
    if existing_event.finance_export_job_id <> p_finance_export_job_id then
      raise exception using errcode = '23505', message = 'idempotency_key_reused';
    end if;
    return jsonb_build_object(
      'id', existing_event.id,
      'sequenceNumber', existing_event.sequence_number,
      'replayed', true
    );
  end if;

  select job.*
  into export_row
  from public.finance_export_jobs job
  where job.id = p_finance_export_job_id;
  if not found then
    raise exception using errcode = 'P0002', message = 'finance_export_not_found';
  end if;
  if export_row.expires_at <= clock_timestamp() then
    raise exception using errcode = 'P0001', message = 'finance_export_expired';
  end if;

  select coalesce(max(event.sequence_number), 0) + 1
  into next_sequence
  from public.finance_export_events event
  where event.finance_export_job_id = p_finance_export_job_id;

  insert into public.finance_export_events (
    finance_export_job_id,
    sequence_number,
    action_type,
    note,
    metadata_json,
    actor_user_id,
    client_event_id
  )
  values (
    p_finance_export_job_id,
    next_sequence,
    'downloaded',
    'Finance export delivered through an authorized channel.',
    jsonb_build_object(
      'deliveryChannel', p_delivery_channel,
      'checksumSha256', export_row.checksum_sha256
    ),
    p_actor_user_id,
    p_client_event_id
  )
  returning * into created_event;

  return jsonb_build_object(
    'id', created_event.id,
    'sequenceNumber', created_event.sequence_number,
    'checksumSha256', export_row.checksum_sha256,
    'replayed', false
  );
end;
$$;
alter table public.organization_finance_reporting_profiles enable row level security;
alter table public.finance_report_snapshots enable row level security;
alter table public.finance_export_jobs enable row level security;
alter table public.finance_export_events enable row level security;
revoke all on table
  public.organization_finance_reporting_profiles,
  public.finance_report_snapshots,
  public.finance_export_jobs,
  public.finance_export_events
from anon, authenticated;
grant all on table
  public.organization_finance_reporting_profiles,
  public.finance_report_snapshots,
  public.finance_export_jobs,
  public.finance_export_events
to service_role;
revoke all on function public.service_save_finance_reporting_profile(
  uuid, uuid, text, text, text, text, jsonb, integer, uuid
) from public, anon, authenticated;
revoke all on function public.service_generate_finance_report(
  uuid, uuid, uuid, date, date, text, uuid
) from public, anon, authenticated;
revoke all on function public.service_request_finance_export(
  uuid, uuid, uuid, text, text, jsonb, uuid
) from public, anon, authenticated;
revoke all on function public.service_record_finance_export_download(
  uuid, uuid, text, uuid
) from public, anon, authenticated;
grant execute on function public.service_save_finance_reporting_profile(
  uuid, uuid, text, text, text, text, jsonb, integer, uuid
) to service_role;
grant execute on function public.service_generate_finance_report(
  uuid, uuid, uuid, date, date, text, uuid
) to service_role;
grant execute on function public.service_request_finance_export(
  uuid, uuid, uuid, text, text, jsonb, uuid
) to service_role;
grant execute on function public.service_record_finance_export_download(
  uuid, uuid, text, uuid
) to service_role;
