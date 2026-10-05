/*
 * SiTrail V2 registration commerce aggregates.
 *
 * Money is stored as integer minor units. Browser roles have no table grants:
 * all commands and private reads cross the authenticated API/service boundary.
 */

create table public.registration_quotes (
  id uuid primary key default gen_random_uuid(),
  registration_id uuid not null references public.registrations (id) on delete cascade,
  event_category_id uuid not null references public.event_categories (id) on delete cascade,
  organization_id uuid not null references public.organizations (id) on delete cascade,
  version integer not null default 1,
  state text not null default 'active',
  currency char(3) not null,
  subtotal_cents integer not null,
  discount_cents integer not null default 0,
  tax_cents integer not null default 0,
  platform_fee_cents integer not null default 0,
  total_cents integer not null,
  line_items_json jsonb not null default '[]'::jsonb,
  pricing_snapshot_json jsonb not null default '{}'::jsonb,
  expires_at timestamptz not null,
  accepted_at timestamptz,
  invalidated_at timestamptz,
  created_at timestamptz not null default now(),
  check (state in ('active', 'accepted', 'expired', 'superseded', 'cancelled')),
  check (currency ~ '^[A-Z]{3}$'),
  check (subtotal_cents >= 0),
  check (discount_cents >= 0),
  check (tax_cents >= 0),
  check (platform_fee_cents >= 0),
  check (total_cents >= 0),
  check (subtotal_cents - discount_cents + tax_cents + platform_fee_cents = total_cents),
  check (jsonb_typeof(line_items_json) = 'array'),
  unique (registration_id, version)
);

create unique index registration_quotes_one_active_per_registration_uidx
  on public.registration_quotes (registration_id)
  where state = 'active';
create index registration_quotes_expiry_idx
  on public.registration_quotes (expires_at)
  where state = 'active';

create table public.capacity_reservations (
  id uuid primary key default gen_random_uuid(),
  registration_id uuid not null references public.registrations (id) on delete cascade,
  event_category_id uuid not null references public.event_categories (id) on delete cascade,
  quote_id uuid references public.registration_quotes (id) on delete set null,
  state text not null default 'active',
  source text not null default 'registration',
  expires_at timestamptz not null,
  consumed_at timestamptz,
  released_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (state in ('active', 'consumed', 'released', 'expired')),
  check (source in ('registration', 'waitlist_offer', 'organizer')),
  check (
    (state = 'active' and consumed_at is null and released_at is null)
    or (state = 'consumed' and consumed_at is not null)
    or (state in ('released', 'expired') and released_at is not null)
  )
);

create unique index capacity_reservations_one_active_per_registration_uidx
  on public.capacity_reservations (registration_id)
  where state = 'active';
create index capacity_reservations_category_active_idx
  on public.capacity_reservations (event_category_id, expires_at)
  where state = 'active';

create table public.registration_waitlist_entries (
  id uuid primary key default gen_random_uuid(),
  registration_id uuid not null references public.registrations (id) on delete cascade,
  event_category_id uuid not null references public.event_categories (id) on delete cascade,
  queue_position bigint not null,
  state text not null default 'queued',
  offered_at timestamptz,
  offer_expires_at timestamptz,
  accepted_at timestamptz,
  withdrawn_at timestamptz,
  expired_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (queue_position > 0),
  check (state in ('queued', 'offered', 'accepted', 'expired', 'withdrawn')),
  unique (event_category_id, queue_position),
  unique (registration_id)
);

create index registration_waitlist_queue_idx
  on public.registration_waitlist_entries (event_category_id, state, queue_position);

create table public.organization_payment_accounts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  provider text not null,
  provider_account_id text,
  status text not null default 'not_started',
  charges_enabled boolean not null default false,
  payouts_enabled boolean not null default false,
  onboarding_state_json jsonb not null default '{}'::jsonb,
  requirements_snapshot_json jsonb not null default '{}'::jsonb,
  last_synced_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (provider in ('stripe', 'manual')),
  check (status in ('not_started', 'onboarding', 'restricted', 'active', 'disabled')),
  unique (organization_id, provider),
  unique (provider, provider_account_id)
);

create table public.payment_intents (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  registration_id uuid not null references public.registrations (id) on delete cascade,
  quote_id uuid not null references public.registration_quotes (id) on delete restrict,
  provider text not null,
  provider_checkout_session_id text,
  provider_payment_intent_id text,
  status text not null default 'created',
  amount_cents integer not null,
  currency char(3) not null,
  idempotency_key_hash text not null,
  checkout_url text,
  expires_at timestamptz,
  failure_code text,
  failure_message text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz,
  check (provider in ('stripe', 'manual')),
  check (status in ('created', 'checkout_ready', 'processing', 'succeeded', 'failed', 'cancelled', 'expired')),
  check (amount_cents >= 0),
  check (currency ~ '^[A-Z]{3}$'),
  unique (provider, idempotency_key_hash),
  unique (provider, provider_checkout_session_id),
  unique (provider, provider_payment_intent_id)
);

create index payment_intents_registration_idx
  on public.payment_intents (registration_id, created_at desc);

create table public.payment_provider_events (
  id uuid primary key default gen_random_uuid(),
  provider text not null,
  provider_event_id text not null,
  event_type text not null,
  signature_verified boolean not null,
  livemode boolean not null default false,
  payload_json jsonb not null,
  processing_status text not null default 'received',
  process_attempts integer not null default 0,
  process_error text,
  registration_id uuid references public.registrations (id) on delete set null,
  payment_intent_id uuid references public.payment_intents (id) on delete set null,
  received_at timestamptz not null default now(),
  processed_at timestamptz,
  check (provider in ('stripe')),
  check (processing_status in ('received', 'processed', 'ignored', 'failed')),
  check (process_attempts >= 0),
  unique (provider, provider_event_id)
);

create index payment_provider_events_processing_idx
  on public.payment_provider_events (processing_status, received_at);

create table public.financial_ledger_entries (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete restrict,
  registration_id uuid references public.registrations (id) on delete restrict,
  payment_intent_id uuid references public.payment_intents (id) on delete restrict,
  provider_event_id uuid references public.payment_provider_events (id) on delete restrict,
  entry_type text not null,
  amount_cents bigint not null,
  currency char(3) not null,
  external_reference text,
  description text not null,
  metadata_json jsonb not null default '{}'::jsonb,
  effective_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  check (entry_type in ('charge', 'refund', 'platform_fee', 'processor_fee', 'adjustment', 'dispute', 'payout')),
  check (amount_cents <> 0),
  check (currency ~ '^[A-Z]{3}$')
);

create unique index financial_ledger_provider_event_type_uidx
  on public.financial_ledger_entries (provider_event_id, entry_type)
  where provider_event_id is not null;
create index financial_ledger_org_effective_idx
  on public.financial_ledger_entries (organization_id, effective_at desc);
create index financial_ledger_registration_idx
  on public.financial_ledger_entries (registration_id, effective_at desc);

create table public.payment_refunds (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete restrict,
  registration_id uuid not null references public.registrations (id) on delete restrict,
  payment_intent_id uuid not null references public.payment_intents (id) on delete restrict,
  provider text not null,
  provider_refund_id text,
  status text not null default 'pending',
  amount_cents integer not null,
  currency char(3) not null,
  reason text not null,
  organizer_note text,
  requested_by_user_id uuid,
  idempotency_key_hash text not null,
  failure_message text,
  requested_at timestamptz not null default now(),
  completed_at timestamptz,
  updated_at timestamptz not null default now(),
  check (provider in ('stripe', 'manual')),
  check (status in ('pending', 'succeeded', 'failed', 'cancelled')),
  check (amount_cents > 0),
  check (currency ~ '^[A-Z]{3}$'),
  unique (provider, idempotency_key_hash),
  unique (provider, provider_refund_id)
);

create table public.payment_reconciliation_runs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  provider text not null,
  status text not null default 'running',
  requested_by_user_id uuid,
  checked_intent_count integer not null default 0,
  discrepancy_count integer not null default 0,
  summary_json jsonb not null default '{}'::jsonb,
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  check (provider in ('stripe', 'manual', 'all')),
  check (status in ('running', 'completed', 'failed'))
);

create table public.payment_reconciliation_items (
  id uuid primary key default gen_random_uuid(),
  reconciliation_run_id uuid not null references public.payment_reconciliation_runs (id) on delete cascade,
  registration_id uuid references public.registrations (id) on delete set null,
  payment_intent_id uuid references public.payment_intents (id) on delete set null,
  discrepancy_type text not null,
  severity text not null default 'error',
  expected_json jsonb not null default '{}'::jsonb,
  actual_json jsonb not null default '{}'::jsonb,
  resolution_status text not null default 'open',
  resolution_note text,
  resolved_by_user_id uuid,
  resolved_at timestamptz,
  created_at timestamptz not null default now(),
  check (severity in ('info', 'warning', 'error', 'critical')),
  check (resolution_status in ('open', 'resolved', 'ignored'))
);

alter table public.registrations
  add column current_quote_id uuid references public.registration_quotes (id) on delete set null,
  add column paid_at timestamptz,
  add column refunded_at timestamptz;

create or replace function public.prevent_immutable_financial_row_change()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'Financial ledger rows are append-only'
    using errcode = '55000';
end;
$$;

create trigger financial_ledger_entries_immutable
before update or delete on public.financial_ledger_entries
for each row execute function public.prevent_immutable_financial_row_change();

create or replace function public.protect_payment_provider_event_evidence()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.provider is distinct from old.provider
     or new.provider_event_id is distinct from old.provider_event_id
     or new.event_type is distinct from old.event_type
     or new.signature_verified is distinct from old.signature_verified
     or new.livemode is distinct from old.livemode
     or new.payload_json is distinct from old.payload_json
     or new.received_at is distinct from old.received_at then
    raise exception 'Provider event evidence is immutable'
      using errcode = '55000';
  end if;
  return new;
end;
$$;

create trigger payment_provider_events_evidence_immutable
before update on public.payment_provider_events
for each row execute function public.protect_payment_provider_event_evidence();

create trigger capacity_reservations_set_updated_at
before update on public.capacity_reservations
for each row execute function public.set_updated_at();
create trigger registration_waitlist_entries_set_updated_at
before update on public.registration_waitlist_entries
for each row execute function public.set_updated_at();
create trigger organization_payment_accounts_set_updated_at
before update on public.organization_payment_accounts
for each row execute function public.set_updated_at();
create trigger payment_intents_set_updated_at
before update on public.payment_intents
for each row execute function public.set_updated_at();
create trigger payment_refunds_set_updated_at
before update on public.payment_refunds
for each row execute function public.set_updated_at();

alter table public.registration_quotes enable row level security;
alter table public.capacity_reservations enable row level security;
alter table public.registration_waitlist_entries enable row level security;
alter table public.organization_payment_accounts enable row level security;
alter table public.payment_intents enable row level security;
alter table public.payment_provider_events enable row level security;
alter table public.financial_ledger_entries enable row level security;
alter table public.payment_refunds enable row level security;
alter table public.payment_reconciliation_runs enable row level security;
alter table public.payment_reconciliation_items enable row level security;

revoke all on table
  public.registration_quotes,
  public.capacity_reservations,
  public.registration_waitlist_entries,
  public.organization_payment_accounts,
  public.payment_intents,
  public.payment_provider_events,
  public.financial_ledger_entries,
  public.payment_refunds,
  public.payment_reconciliation_runs,
  public.payment_reconciliation_items
from public, anon, authenticated;

grant all on table
  public.registration_quotes,
  public.capacity_reservations,
  public.registration_waitlist_entries,
  public.organization_payment_accounts,
  public.payment_intents,
  public.payment_provider_events,
  public.financial_ledger_entries,
  public.payment_refunds,
  public.payment_reconciliation_runs,
  public.payment_reconciliation_items
to service_role;
