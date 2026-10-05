/*
 * Premium participant communications control.
 *
 * Adds multilingual/channel-aware templates, audience previews, test-send
 * evidence, frozen or dynamic audience semantics, cancellation windows,
 * emergency authorization/follow-up, and immutable campaign timelines.
 */

alter table public.communication_templates
  drop constraint if exists communication_templates_channel_check;
alter table public.communication_templates
  add column locale text not null default 'en',
  add column sensitivity text not null default 'standard',
  add column secure_link_only boolean not null default false,
  add constraint communication_templates_channel_check check (
    channel in ('email', 'sms', 'push', 'in_app')
  ),
  add constraint communication_templates_locale_check check (
    locale ~ '^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$'
  ),
  add constraint communication_templates_sensitivity_check check (
    sensitivity in ('standard', 'restricted')
  );
drop index if exists public.communication_templates_active_name_idx;
create unique index communication_templates_active_name_channel_locale_idx
  on public.communication_templates (
    organization_id,
    lower(name),
    channel,
    lower(locale)
  )
  where status = 'active';
alter table public.communication_campaigns
  drop constraint if exists communication_campaigns_channel_check;
alter table public.communication_campaigns
  drop constraint if exists communication_campaigns_state_check;
alter table public.communication_campaigns
  add column purpose text not null default 'operational',
  add column locale text not null default 'en',
  add column audience_mode text not null default 'frozen',
  add column audience_preview_id uuid,
  add column audience_digest_sha256 text,
  add column cancellation_deadline timestamptz,
  add column approval_state text not null default 'approved',
  add column authorized_by_user_id uuid,
  add column authorization_reason text,
  add column follow_up_required boolean not null default false,
  add column follow_up_completed_at timestamptz,
  add constraint communication_campaigns_channel_check check (
    channel in ('email', 'sms', 'push', 'in_app')
  ),
  add constraint communication_campaigns_state_check check (
    state in (
      'draft', 'approval_required', 'scheduled', 'queued', 'processing',
      'completed', 'partially_failed', 'cancelled', 'failed', 'archived'
    )
  ),
  add constraint communication_campaigns_purpose_check check (
    purpose in ('transactional', 'operational', 'essential_service', 'emergency', 'marketing')
  ),
  add constraint communication_campaigns_locale_check check (
    locale ~ '^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$'
  ),
  add constraint communication_campaigns_audience_mode_check check (
    audience_mode in ('frozen', 'dynamic')
  ),
  add constraint communication_campaigns_approval_state_check check (
    approval_state in ('not_required', 'pending', 'approved', 'rejected')
  ),
  add constraint communication_campaigns_audience_digest_check check (
    audience_digest_sha256 is null or audience_digest_sha256 ~ '^[0-9a-f]{64}$'
  );
alter table public.communication_deliveries
  add column channel text not null default 'email',
  add column locale text not null default 'en',
  add column suppression_reason text,
  add constraint communication_deliveries_channel_check check (
    channel in ('email', 'sms', 'push', 'in_app')
  );
create table public.communication_channel_preferences (
  athlete_profile_id uuid primary key references public.athlete_profiles (id) on delete cascade,
  email_enabled boolean not null default true,
  sms_enabled boolean not null default false,
  push_enabled boolean not null default false,
  in_app_enabled boolean not null default true,
  locale text,
  updated_by_user_id uuid,
  updated_at timestamptz not null default clock_timestamp(),
  check (locale is null or locale ~ '^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$')
);
create table public.communication_audience_previews (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  event_edition_id uuid not null references public.event_editions (id) on delete cascade,
  channel text not null,
  purpose text not null,
  locale text not null,
  audience_mode text not null,
  criteria_json jsonb not null,
  recipient_snapshot_json jsonb not null,
  eligible_count integer not null,
  suppressed_count integer not null,
  missing_address_count integer not null,
  preference_suppressed_count integer not null,
  audience_digest_sha256 text not null,
  created_by_user_id uuid,
  client_event_id uuid not null unique,
  created_at timestamptz not null default clock_timestamp(),
  expires_at timestamptz not null,
  check (channel in ('email', 'sms', 'push', 'in_app')),
  check (purpose in ('transactional', 'operational', 'essential_service', 'emergency', 'marketing')),
  check (locale ~ '^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$'),
  check (audience_mode in ('frozen', 'dynamic')),
  check (jsonb_typeof(criteria_json) = 'object'),
  check (jsonb_typeof(recipient_snapshot_json) = 'object'),
  check (eligible_count >= 0),
  check (suppressed_count >= 0),
  check (missing_address_count >= 0),
  check (preference_suppressed_count >= 0),
  check (audience_digest_sha256 ~ '^[0-9a-f]{64}$'),
  check (expires_at > created_at)
);
create index communication_audience_previews_edition_created_idx
  on public.communication_audience_previews (event_edition_id, created_at desc);
alter table public.communication_campaigns
  add constraint communication_campaigns_audience_preview_fk
  foreign key (audience_preview_id)
  references public.communication_audience_previews (id)
  on delete restrict;
create table public.communication_audience_preview_events (
  id uuid primary key default gen_random_uuid(),
  communication_audience_preview_id uuid not null
    references public.communication_audience_previews (id) on delete restrict,
  sequence_number integer not null,
  action_type text not null,
  note text not null,
  metadata_json jsonb not null default '{}'::jsonb,
  actor_user_id uuid,
  client_event_id uuid not null unique,
  created_at timestamptz not null default clock_timestamp(),
  unique (communication_audience_preview_id, sequence_number),
  check (action_type in ('previewed', 'test_queued')),
  check (length(trim(note)) > 0),
  check (jsonb_typeof(metadata_json) = 'object')
);
create table public.communication_campaign_events (
  id uuid primary key default gen_random_uuid(),
  communication_campaign_id uuid not null
    references public.communication_campaigns (id) on delete restrict,
  sequence_number integer not null,
  action_type text not null,
  note text not null,
  metadata_json jsonb not null default '{}'::jsonb,
  actor_user_id uuid,
  client_event_id uuid not null unique,
  created_at timestamptz not null default clock_timestamp(),
  unique (communication_campaign_id, sequence_number),
  check (
    action_type in (
      'authorized', 'scheduled', 'cancelled', 'delivery_summary',
      'follow_up', 'archived', 'note'
    )
  ),
  check (length(trim(note)) > 0),
  check (jsonb_typeof(metadata_json) = 'object')
);
create index communication_campaign_events_campaign_sequence_idx
  on public.communication_campaign_events (communication_campaign_id, sequence_number desc);
create or replace function public.prevent_communication_evidence_change()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception using errcode = '55000', message = 'communication_evidence_is_append_only';
end;
$$;
create trigger communication_audience_previews_immutable
before update or delete on public.communication_audience_previews
for each row execute function public.prevent_communication_evidence_change();
create trigger communication_audience_preview_events_immutable
before update or delete on public.communication_audience_preview_events
for each row execute function public.prevent_communication_evidence_change();
create trigger communication_campaign_events_immutable
before update or delete on public.communication_campaign_events
for each row execute function public.prevent_communication_evidence_change();
create or replace function public.enforce_communication_campaign_cancellation_window()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.state = 'cancelled'
     and old.state <> 'cancelled'
     and old.cancellation_deadline is not null
     and clock_timestamp() > old.cancellation_deadline then
    raise exception using errcode = 'P0001', message = 'communication_cancellation_window_closed';
  end if;
  return new;
end;
$$;
create trigger communication_campaign_cancellation_window
before update of state on public.communication_campaigns
for each row execute function public.enforce_communication_campaign_cancellation_window();
create or replace function public.service_save_premium_communication_template(
  p_organization_id uuid,
  p_actor_user_id uuid,
  p_name text,
  p_communication_type text,
  p_channel text,
  p_locale text,
  p_subject_template text,
  p_body_markdown text,
  p_sensitivity text,
  p_secure_link_only boolean
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  previous_template public.communication_templates%rowtype;
  saved_template public.communication_templates%rowtype;
  next_version integer;
begin
  if p_organization_id is null
     or p_actor_user_id is null
     or nullif(trim(p_name), '') is null
     or p_communication_type not in ('transactional', 'operational')
     or p_channel not in ('email', 'sms', 'push', 'in_app')
     or coalesce(p_locale, '') !~ '^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$'
     or p_sensitivity not in ('standard', 'restricted')
     or length(trim(coalesce(p_subject_template, ''))) not between 1 and 200
     or length(trim(coalesce(p_body_markdown, ''))) not between 1 and 20000
     or (
       p_sensitivity = 'restricted'
       and coalesce(p_secure_link_only, false) is not true
     ) then
    raise exception using errcode = '22023', message = 'premium_communication_template_input_invalid';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended(
      'premium-communication-template:' || p_organization_id::text || ':'
        || lower(trim(p_name)) || ':' || p_channel || ':' || lower(p_locale),
      0
    )
  );

  select template.*
  into previous_template
  from public.communication_templates template
  where template.organization_id = p_organization_id
    and lower(template.name) = lower(trim(p_name))
    and template.channel = p_channel
    and lower(template.locale) = lower(p_locale)
    and template.status = 'active'
  for update;

  select coalesce(max(template.version_number), 0) + 1
  into next_version
  from public.communication_templates template
  where template.organization_id = p_organization_id
    and lower(template.name) = lower(trim(p_name))
    and template.channel = p_channel
    and lower(template.locale) = lower(p_locale);

  if previous_template.id is not null then
    update public.communication_templates
    set status = 'archived', archived_at = clock_timestamp()
    where id = previous_template.id;
  end if;

  insert into public.communication_templates (
    organization_id,
    name,
    communication_type,
    channel,
    locale,
    sensitivity,
    secure_link_only,
    version_number,
    subject_template,
    body_markdown,
    supersedes_template_id,
    created_by_user_id
  )
  values (
    p_organization_id,
    trim(p_name),
    p_communication_type,
    p_channel,
    p_locale,
    p_sensitivity,
    coalesce(p_secure_link_only, false),
    next_version,
    trim(p_subject_template),
    trim(p_body_markdown),
    previous_template.id,
    p_actor_user_id
  )
  returning * into saved_template;

  return jsonb_build_object(
    'id', saved_template.id,
    'organizationId', saved_template.organization_id,
    'name', saved_template.name,
    'communicationType', saved_template.communication_type,
    'channel', saved_template.channel,
    'locale', saved_template.locale,
    'sensitivity', saved_template.sensitivity,
    'secureLinkOnly', saved_template.secure_link_only,
    'versionNumber', saved_template.version_number,
    'status', saved_template.status,
    'subjectTemplate', saved_template.subject_template,
    'bodyMarkdown', saved_template.body_markdown,
    'createdAt', saved_template.created_at
  );
end;
$$;
create or replace function public.service_preview_communication_audience(
  p_event_edition_id uuid,
  p_actor_user_id uuid,
  p_channel text,
  p_purpose text,
  p_locale text,
  p_audience_mode text,
  p_registration_statuses text[],
  p_event_category_ids uuid[],
  p_client_event_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  resolved_organization_id uuid;
  existing_preview public.communication_audience_previews%rowtype;
  created_preview public.communication_audience_previews%rowtype;
  normalized_statuses text[] := coalesce(p_registration_statuses, array['confirmed']::text[]);
  normalized_category_ids uuid[] := coalesce(p_event_category_ids, array[]::uuid[]);
  recipient_snapshot jsonb;
  eligible_total integer;
  suppressed_total integer;
  missing_total integer;
  preference_total integer;
  audience_digest text;
begin
  if p_event_edition_id is null
     or p_actor_user_id is null
     or p_client_event_id is null
     or p_channel not in ('email', 'sms', 'push', 'in_app')
     or p_purpose not in ('transactional', 'operational', 'essential_service', 'emergency', 'marketing')
     or coalesce(p_locale, '') !~ '^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$'
     or p_audience_mode not in ('frozen', 'dynamic')
     or cardinality(normalized_statuses) = 0
     or exists (
       select 1 from unnest(normalized_statuses) status_value
       where status_value not in ('pending', 'confirmed', 'waitlisted', 'offered', 'cancelled')
     ) then
    raise exception using errcode = '22023', message = 'communication_audience_preview_input_invalid';
  end if;

  select preview.*
  into existing_preview
  from public.communication_audience_previews preview
  where preview.client_event_id = p_client_event_id;
  if found then
    if existing_preview.event_edition_id <> p_event_edition_id
       or existing_preview.channel <> p_channel
       or existing_preview.purpose <> p_purpose then
      raise exception using errcode = '23505', message = 'idempotency_key_reused';
    end if;
    return jsonb_build_object(
      'id', existing_preview.id,
      'eligibleCount', existing_preview.eligible_count,
      'suppressedCount', existing_preview.suppressed_count,
      'audienceDigestSha256', existing_preview.audience_digest_sha256,
      'replayed', true
    );
  end if;

  select series.organization_id
  into resolved_organization_id
  from public.event_editions edition
  join public.event_series series on series.id = edition.event_series_id
  where edition.id = p_event_edition_id;
  if resolved_organization_id is null then
    raise exception using errcode = 'P0002', message = 'edition_not_found';
  end if;

  if cardinality(normalized_category_ids) > 0 and exists (
    select 1
    from unnest(normalized_category_ids) category_id
    left join public.event_categories category on category.id = category_id
    where category.id is null or category.event_edition_id <> p_event_edition_id
  ) then
    raise exception using errcode = '22023', message = 'communication_audience_invalid';
  end if;

  with audience as (
    select
      registration.id as registration_id,
      athlete.id as athlete_profile_id,
      athlete.first_name,
      athlete.display_name,
      category.name as race_name,
      coalesce(preference.locale, p_locale) as recipient_locale,
      case p_channel
        when 'email' then athlete.primary_email::text
        when 'sms' then nullif(trim(registration_profile.phone), '')
        when 'in_app' then case
          when exists (
            select 1 from public.athlete_identities identity
            where identity.athlete_profile_id = athlete.id
              and identity.user_id is not null
          ) then athlete.id::text
          else null
        end
        else null
      end as recipient_address,
      case p_channel
        when 'email' then coalesce(preference.email_enabled, true)
        when 'sms' then coalesce(preference.sms_enabled, false)
        when 'push' then coalesce(preference.push_enabled, false)
        when 'in_app' then coalesce(preference.in_app_enabled, true)
        else false
      end as preference_enabled
    from public.registrations registration
    join public.event_categories category on category.id = registration.event_category_id
    join public.athlete_profiles athlete on athlete.id = registration.athlete_profile_id
    left join public.athlete_registration_profiles registration_profile
      on registration_profile.athlete_profile_id = athlete.id
    left join public.communication_channel_preferences preference
      on preference.athlete_profile_id = athlete.id
    where category.event_edition_id = p_event_edition_id
      and registration.status::text = any(normalized_statuses)
      and (
        cardinality(normalized_category_ids) = 0
        or registration.event_category_id = any(normalized_category_ids)
      )
  ),
  classified as (
    select
      audience.*,
      audience.recipient_address is not null as has_address,
      (
        p_purpose in ('transactional', 'essential_service', 'emergency')
        or audience.preference_enabled
      ) as preference_allows
    from audience
  ),
  eligible as (
    select *
    from classified
    where has_address and preference_allows
  )
  select
    jsonb_build_object(
      'recipients',
      coalesce(
        (
          select jsonb_agg(
            jsonb_build_object(
              'registrationId', eligible.registration_id,
              'athleteProfileId', eligible.athlete_profile_id,
              'recipientAddress', eligible.recipient_address,
              'recipientAddressHash', encode(
                public.digest(convert_to(lower(eligible.recipient_address), 'utf8'), 'sha256'),
                'hex'
              ),
              'firstName', eligible.first_name,
              'displayName', eligible.display_name,
              'raceName', eligible.race_name,
              'locale', eligible.recipient_locale
            )
            order by eligible.registration_id
          )
          from eligible
        ),
        '[]'::jsonb
      ),
      'sampleRecipients',
      coalesce(
        (
          select jsonb_agg(sample)
          from (
            select jsonb_build_object(
              'displayName', eligible.display_name,
              'raceName', eligible.race_name,
              'locale', eligible.recipient_locale
            ) as sample
            from eligible
            order by eligible.registration_id
            limit 5
          ) sampled
        ),
        '[]'::jsonb
      )
    ),
    (select count(*)::integer from eligible),
    (select count(*)::integer from classified where not (has_address and preference_allows)),
    (select count(*)::integer from classified where not has_address),
    (select count(*)::integer from classified where has_address and not preference_allows)
  into recipient_snapshot, eligible_total, suppressed_total, missing_total, preference_total;

  audience_digest := encode(
    public.digest(
      convert_to(
        p_channel || ':' || p_purpose || ':' || p_locale || ':'
          || (recipient_snapshot->'recipients')::text,
        'utf8'
      ),
      'sha256'
    ),
    'hex'
  );

  insert into public.communication_audience_previews (
    organization_id,
    event_edition_id,
    channel,
    purpose,
    locale,
    audience_mode,
    criteria_json,
    recipient_snapshot_json,
    eligible_count,
    suppressed_count,
    missing_address_count,
    preference_suppressed_count,
    audience_digest_sha256,
    created_by_user_id,
    client_event_id,
    expires_at
  )
  values (
    resolved_organization_id,
    p_event_edition_id,
    p_channel,
    p_purpose,
    p_locale,
    p_audience_mode,
    jsonb_build_object(
      'registrationStatuses', normalized_statuses,
      'eventCategoryIds', normalized_category_ids
    ),
    recipient_snapshot,
    eligible_total,
    suppressed_total,
    missing_total,
    preference_total,
    audience_digest,
    p_actor_user_id,
    p_client_event_id,
    clock_timestamp() + interval '30 minutes'
  )
  returning * into created_preview;

  insert into public.communication_audience_preview_events (
    communication_audience_preview_id,
    sequence_number,
    action_type,
    note,
    metadata_json,
    actor_user_id,
    client_event_id
  )
  values (
    created_preview.id,
    1,
    'previewed',
    'Audience eligibility, exclusions, and sample recipients evaluated.',
    jsonb_build_object(
      'eligibleCount', eligible_total,
      'suppressedCount', suppressed_total,
      'missingAddressCount', missing_total,
      'preferenceSuppressedCount', preference_total,
      'audienceDigestSha256', audience_digest
    ),
    p_actor_user_id,
    gen_random_uuid()
  );

  return jsonb_build_object(
    'id', created_preview.id,
    'eligibleCount', created_preview.eligible_count,
    'suppressedCount', created_preview.suppressed_count,
    'missingAddressCount', created_preview.missing_address_count,
    'preferenceSuppressedCount', created_preview.preference_suppressed_count,
    'sampleRecipients', created_preview.recipient_snapshot_json->'sampleRecipients',
    'audienceDigestSha256', created_preview.audience_digest_sha256,
    'expiresAt', created_preview.expires_at,
    'replayed', false
  );
end;
$$;
create or replace function public.service_queue_communication_preview_test(
  p_communication_audience_preview_id uuid,
  p_actor_user_id uuid,
  p_test_recipient_address text,
  p_note text,
  p_client_event_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  preview_row public.communication_audience_previews%rowtype;
  existing_event public.communication_audience_preview_events%rowtype;
  created_event public.communication_audience_preview_events%rowtype;
  next_sequence integer;
  address_hash text;
begin
  if p_communication_audience_preview_id is null
     or p_actor_user_id is null
     or p_client_event_id is null
     or nullif(trim(p_test_recipient_address), '') is null
     or nullif(trim(p_note), '') is null then
    raise exception using errcode = '22023', message = 'communication_preview_test_input_invalid';
  end if;

  select event.*
  into existing_event
  from public.communication_audience_preview_events event
  where event.client_event_id = p_client_event_id;
  if found then
    if existing_event.communication_audience_preview_id <> p_communication_audience_preview_id then
      raise exception using errcode = '23505', message = 'idempotency_key_reused';
    end if;
    return jsonb_build_object('id', existing_event.id, 'replayed', true);
  end if;

  select preview.*
  into preview_row
  from public.communication_audience_previews preview
  where preview.id = p_communication_audience_preview_id;
  if not found then
    raise exception using errcode = 'P0002', message = 'communication_audience_preview_not_found';
  end if;
  if preview_row.expires_at <= clock_timestamp() then
    raise exception using errcode = 'P0001', message = 'communication_audience_preview_expired';
  end if;

  address_hash := encode(
    public.digest(convert_to(lower(trim(p_test_recipient_address)), 'utf8'), 'sha256'),
    'hex'
  );
  select coalesce(max(event.sequence_number), 0) + 1
  into next_sequence
  from public.communication_audience_preview_events event
  where event.communication_audience_preview_id = preview_row.id;

  insert into public.notification_jobs (
    channel,
    notification_type,
    status,
    payload_json,
    scheduled_at,
    organization_id,
    event_edition_id,
    idempotency_key,
    next_attempt_at
  )
  values (
    preview_row.channel,
    'communication_preview_test',
    'queued',
    jsonb_build_object(
      'audiencePreviewId', preview_row.id,
      'testRecipientAddress', trim(p_test_recipient_address),
      'testRecipientAddressHash', address_hash
    ),
    clock_timestamp(),
    preview_row.organization_id,
    preview_row.event_edition_id,
    'communication-preview-test:' || p_client_event_id::text,
    clock_timestamp()
  );

  insert into public.communication_audience_preview_events (
    communication_audience_preview_id,
    sequence_number,
    action_type,
    note,
    metadata_json,
    actor_user_id,
    client_event_id
  )
  values (
    preview_row.id,
    next_sequence,
    'test_queued',
    trim(p_note),
    jsonb_build_object('testRecipientAddressHash', address_hash, 'channel', preview_row.channel),
    p_actor_user_id,
    p_client_event_id
  )
  returning * into created_event;

  return jsonb_build_object(
    'id', created_event.id,
    'sequenceNumber', created_event.sequence_number,
    'testRecipientAddressHash', address_hash,
    'replayed', false
  );
end;
$$;
create or replace function public.service_schedule_premium_communication_campaign(
  p_communication_audience_preview_id uuid,
  p_template_id uuid,
  p_actor_user_id uuid,
  p_name text,
  p_scheduled_at timestamptz,
  p_authorization_reason text,
  p_client_event_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  preview_row public.communication_audience_previews%rowtype;
  template_row public.communication_templates%rowtype;
  existing_campaign public.communication_campaigns%rowtype;
  created_campaign public.communication_campaigns%rowtype;
  recipient jsonb;
  cancellation_at timestamptz;
begin
  if p_communication_audience_preview_id is null
     or p_template_id is null
     or p_actor_user_id is null
     or p_client_event_id is null
     or nullif(trim(p_name), '') is null
     or p_scheduled_at is null
     or p_scheduled_at < clock_timestamp() - interval '2 minutes' then
    raise exception using errcode = '22023', message = 'premium_communication_campaign_input_invalid';
  end if;

  select campaign.*
  into existing_campaign
  from public.communication_campaigns campaign
  where campaign.id = p_client_event_id;
  if found then
    if existing_campaign.audience_preview_id <> p_communication_audience_preview_id
       or existing_campaign.template_id <> p_template_id then
      raise exception using errcode = '23505', message = 'idempotency_key_reused';
    end if;
    return jsonb_build_object(
      'id', existing_campaign.id,
      'state', existing_campaign.state,
      'recipientCount', existing_campaign.recipient_count,
      'replayed', true
    );
  end if;

  select preview.*
  into preview_row
  from public.communication_audience_previews preview
  where preview.id = p_communication_audience_preview_id;
  if not found then
    raise exception using errcode = 'P0002', message = 'communication_audience_preview_not_found';
  end if;
  if preview_row.expires_at <= clock_timestamp() then
    raise exception using errcode = 'P0001', message = 'communication_audience_preview_expired';
  end if;
  if not exists (
    select 1
    from public.communication_audience_preview_events event
    where event.communication_audience_preview_id = preview_row.id
      and event.action_type = 'test_queued'
  ) then
    raise exception using errcode = 'P0001', message = 'communication_preview_test_required';
  end if;
  if preview_row.purpose = 'emergency'
     and nullif(trim(p_authorization_reason), '') is null then
    raise exception using errcode = '22023', message = 'emergency_communication_authorization_required';
  end if;

  select template.*
  into template_row
  from public.communication_templates template
  where template.id = p_template_id
    and template.organization_id = preview_row.organization_id
    and template.channel = preview_row.channel
    and lower(template.locale) = lower(preview_row.locale)
    and template.status = 'active';
  if not found then
    raise exception using errcode = 'P0002', message = 'communication_template_not_found';
  end if;

  cancellation_at := greatest(clock_timestamp(), p_scheduled_at - interval '2 minutes');
  insert into public.communication_campaigns (
    id,
    organization_id,
    event_edition_id,
    template_id,
    name,
    communication_type,
    channel,
    state,
    purpose,
    locale,
    audience_mode,
    audience_preview_id,
    audience_digest_sha256,
    audience_json,
    subject_snapshot,
    body_snapshot,
    scheduled_at,
    recipient_count,
    queued_at,
    cancellation_deadline,
    approval_state,
    authorized_by_user_id,
    authorization_reason,
    follow_up_required,
    created_by_user_id
  )
  values (
    p_client_event_id,
    preview_row.organization_id,
    preview_row.event_edition_id,
    template_row.id,
    trim(p_name),
    template_row.communication_type,
    template_row.channel,
    case when p_scheduled_at <= clock_timestamp() then 'queued' else 'scheduled' end,
    preview_row.purpose,
    preview_row.locale,
    preview_row.audience_mode,
    preview_row.id,
    preview_row.audience_digest_sha256,
    preview_row.criteria_json,
    template_row.subject_template,
    template_row.body_markdown,
    p_scheduled_at,
    preview_row.eligible_count,
    case when p_scheduled_at <= clock_timestamp() then clock_timestamp() else null end,
    cancellation_at,
    'approved',
    p_actor_user_id,
    nullif(trim(p_authorization_reason), ''),
    preview_row.purpose = 'emergency',
    p_actor_user_id
  )
  returning * into created_campaign;

  if preview_row.audience_mode = 'frozen' then
    for recipient in
      select value from jsonb_array_elements(preview_row.recipient_snapshot_json->'recipients')
    loop
      insert into public.communication_deliveries (
        campaign_id,
        registration_id,
        athlete_profile_id,
        recipient_address,
        recipient_address_hash,
        personalization_json,
        channel,
        locale
      )
      values (
        created_campaign.id,
        (recipient->>'registrationId')::uuid,
        (recipient->>'athleteProfileId')::uuid,
        recipient->>'recipientAddress',
        recipient->>'recipientAddressHash',
        jsonb_build_object(
          'firstName', recipient->>'firstName',
          'displayName', recipient->>'displayName',
          'raceName', recipient->>'raceName'
        ),
        created_campaign.channel,
        recipient->>'locale'
      );
    end loop;
  end if;

  insert into public.notification_jobs (
    channel,
    notification_type,
    status,
    payload_json,
    scheduled_at,
    organization_id,
    event_edition_id,
    communication_campaign_id,
    idempotency_key,
    next_attempt_at
  )
  values (
    created_campaign.channel,
    case when created_campaign.purpose = 'emergency'
      then 'emergency_communication_campaign'
      else 'premium_communication_campaign'
    end,
    case when p_scheduled_at <= clock_timestamp() then 'queued' else 'scheduled' end,
    jsonb_build_object(
      'campaignId', created_campaign.id,
      'audienceMode', created_campaign.audience_mode,
      'audiencePreviewId', preview_row.id,
      'audienceDigestSha256', preview_row.audience_digest_sha256,
      'reevaluateAudienceAtQueueTime', created_campaign.audience_mode = 'dynamic'
    ),
    p_scheduled_at,
    created_campaign.organization_id,
    created_campaign.event_edition_id,
    created_campaign.id,
    'premium-communication-campaign:' || created_campaign.id::text,
    p_scheduled_at
  );

  insert into public.communication_campaign_events (
    communication_campaign_id,
    sequence_number,
    action_type,
    note,
    metadata_json,
    actor_user_id,
    client_event_id
  )
  values (
    created_campaign.id,
    1,
    'authorized',
    case when preview_row.purpose = 'emergency'
      then trim(p_authorization_reason)
      else 'Campaign authorized after audience preview and test delivery.'
    end,
    jsonb_build_object(
      'purpose', created_campaign.purpose,
      'audienceDigestSha256', preview_row.audience_digest_sha256
    ),
    p_actor_user_id,
    gen_random_uuid()
  ), (
    created_campaign.id,
    2,
    'scheduled',
    'Campaign scheduled with an explicit cancellation deadline.',
    jsonb_build_object(
      'scheduledAt', created_campaign.scheduled_at,
      'cancellationDeadline', created_campaign.cancellation_deadline,
      'recipientCount', created_campaign.recipient_count,
      'audienceMode', created_campaign.audience_mode
    ),
    p_actor_user_id,
    gen_random_uuid()
  );

  return jsonb_build_object(
    'id', created_campaign.id,
    'state', created_campaign.state,
    'purpose', created_campaign.purpose,
    'recipientCount', created_campaign.recipient_count,
    'audienceMode', created_campaign.audience_mode,
    'cancellationDeadline', created_campaign.cancellation_deadline,
    'followUpRequired', created_campaign.follow_up_required,
    'replayed', false
  );
end;
$$;
create or replace function public.service_append_communication_campaign_event(
  p_communication_campaign_id uuid,
  p_actor_user_id uuid,
  p_action_type text,
  p_note text,
  p_metadata_json jsonb,
  p_client_event_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  campaign_row public.communication_campaigns%rowtype;
  existing_event public.communication_campaign_events%rowtype;
  created_event public.communication_campaign_events%rowtype;
  next_sequence integer;
begin
  if p_communication_campaign_id is null
     or p_actor_user_id is null
     or p_client_event_id is null
     or p_action_type not in ('delivery_summary', 'follow_up', 'archived', 'note')
     or nullif(trim(p_note), '') is null
     or coalesce(jsonb_typeof(p_metadata_json), 'object') <> 'object' then
    raise exception using errcode = '22023', message = 'communication_campaign_event_input_invalid';
  end if;

  select event.*
  into existing_event
  from public.communication_campaign_events event
  where event.client_event_id = p_client_event_id;
  if found then
    if existing_event.communication_campaign_id <> p_communication_campaign_id then
      raise exception using errcode = '23505', message = 'idempotency_key_reused';
    end if;
    return jsonb_build_object(
      'id', existing_event.id,
      'sequenceNumber', existing_event.sequence_number,
      'replayed', true
    );
  end if;

  select campaign.*
  into campaign_row
  from public.communication_campaigns campaign
  where campaign.id = p_communication_campaign_id
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'communication_campaign_not_found';
  end if;
  if p_action_type = 'follow_up' and campaign_row.purpose <> 'emergency' then
    raise exception using errcode = '22023', message = 'communication_follow_up_scope_invalid';
  end if;

  select coalesce(max(event.sequence_number), 0) + 1
  into next_sequence
  from public.communication_campaign_events event
  where event.communication_campaign_id = campaign_row.id;

  insert into public.communication_campaign_events (
    communication_campaign_id,
    sequence_number,
    action_type,
    note,
    metadata_json,
    actor_user_id,
    client_event_id
  )
  values (
    campaign_row.id,
    next_sequence,
    p_action_type,
    trim(p_note),
    coalesce(p_metadata_json, '{}'::jsonb),
    p_actor_user_id,
    p_client_event_id
  )
  returning * into created_event;

  if p_action_type = 'follow_up' then
    update public.communication_campaigns
    set follow_up_completed_at = clock_timestamp()
    where id = campaign_row.id;
  elsif p_action_type = 'archived' then
    if campaign_row.follow_up_required and campaign_row.follow_up_completed_at is null then
      raise exception using errcode = 'P0001', message = 'emergency_communication_follow_up_required';
    end if;
    update public.communication_campaigns
    set state = 'archived'
    where id = campaign_row.id;
  end if;

  return jsonb_build_object(
    'id', created_event.id,
    'sequenceNumber', created_event.sequence_number,
    'actionType', created_event.action_type,
    'replayed', false
  );
end;
$$;
alter table public.communication_channel_preferences enable row level security;
alter table public.communication_audience_previews enable row level security;
alter table public.communication_audience_preview_events enable row level security;
alter table public.communication_campaign_events enable row level security;
revoke all on table
  public.communication_channel_preferences,
  public.communication_audience_previews,
  public.communication_audience_preview_events,
  public.communication_campaign_events
from public, anon, authenticated;
grant all on table
  public.communication_channel_preferences,
  public.communication_audience_previews,
  public.communication_audience_preview_events,
  public.communication_campaign_events
to service_role;
revoke all on function public.service_save_premium_communication_template(
  uuid, uuid, text, text, text, text, text, text, text, boolean
) from public, anon, authenticated;
revoke all on function public.service_preview_communication_audience(
  uuid, uuid, text, text, text, text, text[], uuid[], uuid
) from public, anon, authenticated;
revoke all on function public.service_queue_communication_preview_test(
  uuid, uuid, text, text, uuid
) from public, anon, authenticated;
revoke all on function public.service_schedule_premium_communication_campaign(
  uuid, uuid, uuid, text, timestamptz, text, uuid
) from public, anon, authenticated;
revoke all on function public.service_append_communication_campaign_event(
  uuid, uuid, text, text, jsonb, uuid
) from public, anon, authenticated;
grant execute on function public.service_save_premium_communication_template(
  uuid, uuid, text, text, text, text, text, text, text, boolean
) to service_role;
grant execute on function public.service_preview_communication_audience(
  uuid, uuid, text, text, text, text, text[], uuid[], uuid
) to service_role;
grant execute on function public.service_queue_communication_preview_test(
  uuid, uuid, text, text, uuid
) to service_role;
grant execute on function public.service_schedule_premium_communication_campaign(
  uuid, uuid, uuid, text, timestamptz, text, uuid
) to service_role;
grant execute on function public.service_append_communication_campaign_event(
  uuid, uuid, text, text, jsonb, uuid
) to service_role;
