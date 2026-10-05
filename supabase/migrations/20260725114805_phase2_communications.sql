/*
 * Versioned operational email templates and recipient-snapshotted campaigns.
 * Provider delivery is intentionally asynchronous through notification_jobs so
 * event commands never depend on an email vendor being available.
 */

create table public.communication_templates (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  name text not null,
  communication_type text not null,
  channel text not null default 'email',
  version_number integer not null,
  status text not null default 'active',
  subject_template text not null,
  body_markdown text not null,
  supersedes_template_id uuid references public.communication_templates (id) on delete restrict,
  created_by_user_id uuid,
  created_at timestamptz not null default now(),
  archived_at timestamptz,
  unique (organization_id, name, version_number),
  check (length(trim(name)) between 1 and 120),
  check (communication_type in ('transactional', 'operational')),
  check (channel = 'email'),
  check (version_number > 0),
  check (status in ('active', 'archived')),
  check (length(trim(subject_template)) between 1 and 200),
  check (length(trim(body_markdown)) between 1 and 20000)
);

create unique index communication_templates_active_name_idx
  on public.communication_templates (organization_id, lower(name))
  where status = 'active';

create table public.communication_campaigns (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  event_edition_id uuid not null references public.event_editions (id) on delete cascade,
  template_id uuid not null references public.communication_templates (id) on delete restrict,
  name text not null,
  communication_type text not null,
  channel text not null,
  state text not null,
  audience_json jsonb not null,
  subject_snapshot text not null,
  body_snapshot text not null,
  scheduled_at timestamptz not null,
  recipient_count integer not null default 0,
  queued_at timestamptz,
  cancelled_at timestamptz,
  completed_at timestamptz,
  created_by_user_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (length(trim(name)) between 1 and 160),
  check (communication_type in ('transactional', 'operational')),
  check (channel = 'email'),
  check (state in ('scheduled', 'queued', 'processing', 'completed', 'cancelled', 'failed')),
  check (jsonb_typeof(audience_json) = 'object'),
  check (recipient_count >= 0)
);

create index communication_campaigns_edition_schedule_idx
  on public.communication_campaigns (event_edition_id, scheduled_at desc);
create index communication_campaigns_state_schedule_idx
  on public.communication_campaigns (state, scheduled_at)
  where state in ('scheduled', 'queued', 'processing');

create trigger communication_campaigns_set_updated_at
before update on public.communication_campaigns
for each row execute function public.set_updated_at();

create table public.communication_deliveries (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.communication_campaigns (id) on delete cascade,
  registration_id uuid not null references public.registrations (id) on delete restrict,
  athlete_profile_id uuid not null references public.athlete_profiles (id) on delete restrict,
  recipient_address citext not null,
  recipient_address_hash text not null,
  personalization_json jsonb not null default '{}'::jsonb,
  state text not null default 'queued',
  provider_message_id text,
  attempt_count integer not null default 0,
  last_attempt_at timestamptz,
  sent_at timestamptz,
  delivered_at timestamptz,
  failed_at timestamptz,
  failure_code text,
  failure_message text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (campaign_id, registration_id),
  check (recipient_address_hash ~ '^[a-f0-9]{64}$'),
  check (jsonb_typeof(personalization_json) = 'object'),
  check (state in ('queued', 'processing', 'sent', 'delivered', 'failed', 'suppressed', 'cancelled')),
  check (attempt_count >= 0)
);

create index communication_deliveries_campaign_state_idx
  on public.communication_deliveries (campaign_id, state);

create trigger communication_deliveries_set_updated_at
before update on public.communication_deliveries
for each row execute function public.set_updated_at();

alter table public.notification_jobs
  add column organization_id uuid references public.organizations (id) on delete cascade,
  add column event_edition_id uuid references public.event_editions (id) on delete cascade,
  add column communication_campaign_id uuid references public.communication_campaigns (id) on delete cascade,
  add column idempotency_key text,
  add column attempt_count integer not null default 0,
  add column next_attempt_at timestamptz,
  add column last_error text;

create unique index notification_jobs_campaign_unique_idx
  on public.notification_jobs (communication_campaign_id)
  where communication_campaign_id is not null;

create or replace function public.service_save_communication_template(
  p_organization_id uuid,
  p_actor_user_id uuid,
  p_name text,
  p_communication_type text,
  p_subject_template text,
  p_body_markdown text
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
  if nullif(trim(p_name), '') is null
     or p_communication_type not in ('transactional', 'operational')
     or length(trim(coalesce(p_subject_template, ''))) not between 1 and 200
     or length(trim(coalesce(p_body_markdown, ''))) not between 1 and 20000 then
    raise exception using errcode = '22023', message = 'communication_template_input_invalid';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended('communication-template:' || p_organization_id::text || ':' || lower(trim(p_name)), 0)
  );

  select template.*
  into previous_template
  from public.communication_templates template
  where template.organization_id = p_organization_id
    and lower(template.name) = lower(trim(p_name))
    and template.status = 'active'
  for update;

  select coalesce(max(template.version_number), 0) + 1
  into next_version
  from public.communication_templates template
  where template.organization_id = p_organization_id
    and lower(template.name) = lower(trim(p_name));

  if previous_template.id is not null then
    update public.communication_templates
    set status = 'archived', archived_at = now()
    where id = previous_template.id;
  end if;

  insert into public.communication_templates (
    organization_id,
    name,
    communication_type,
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
    next_version,
    trim(p_subject_template),
    trim(p_body_markdown),
    previous_template.id,
    p_actor_user_id
  )
  returning * into saved_template;

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
    'communication_template',
    saved_template.id,
    'communication_template.saved',
    jsonb_build_object(
      'name', saved_template.name,
      'versionNumber', saved_template.version_number,
      'communicationType', saved_template.communication_type
    )
  );

  return jsonb_build_object(
    'id', saved_template.id,
    'organizationId', saved_template.organization_id,
    'name', saved_template.name,
    'communicationType', saved_template.communication_type,
    'channel', saved_template.channel,
    'versionNumber', saved_template.version_number,
    'status', saved_template.status,
    'subjectTemplate', saved_template.subject_template,
    'bodyMarkdown', saved_template.body_markdown,
    'createdAt', saved_template.created_at
  );
end;
$$;

create or replace function public.service_schedule_communication_campaign(
  p_event_edition_id uuid,
  p_actor_user_id uuid,
  p_template_id uuid,
  p_name text,
  p_registration_statuses text[],
  p_event_category_ids uuid[],
  p_scheduled_at timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  resolved_organization_id uuid;
  edition_row public.event_editions%rowtype;
  template_row public.communication_templates%rowtype;
  campaign_row public.communication_campaigns%rowtype;
  recipient_total integer;
  normalized_statuses text[];
  normalized_category_ids uuid[];
begin
  normalized_statuses := coalesce(
    p_registration_statuses,
    array['confirmed']::text[]
  );
  normalized_category_ids := coalesce(p_event_category_ids, array[]::uuid[]);

  if nullif(trim(p_name), '') is null
     or cardinality(normalized_statuses) = 0
     or exists (
       select 1
       from unnest(normalized_statuses) status_value
       where status_value not in ('pending', 'confirmed', 'waitlisted', 'offered', 'cancelled')
     )
     or p_scheduled_at is null
     or p_scheduled_at < now() - interval '5 minutes' then
    raise exception using errcode = '22023', message = 'communication_campaign_input_invalid';
  end if;

  select edition.*
  into edition_row
  from public.event_editions edition
  where edition.id = p_event_edition_id;
  if not found then
    raise exception using errcode = 'P0002', message = 'edition_not_found';
  end if;

  select series.organization_id
  into resolved_organization_id
  from public.event_series series
  where series.id = edition_row.event_series_id;

  select template.*
  into template_row
  from public.communication_templates template
  where template.id = p_template_id
    and template.organization_id = resolved_organization_id
    and template.status = 'active';
  if not found then
    raise exception using errcode = 'P0002', message = 'communication_template_not_found';
  end if;

  if cardinality(normalized_category_ids) > 0 and exists (
    select 1
    from unnest(normalized_category_ids) requested_category_id
    left join public.event_categories category on category.id = requested_category_id
    where category.id is null
      or category.event_edition_id <> p_event_edition_id
  ) then
    raise exception using errcode = '22023', message = 'communication_audience_invalid';
  end if;

  insert into public.communication_campaigns (
    organization_id,
    event_edition_id,
    template_id,
    name,
    communication_type,
    channel,
    state,
    audience_json,
    subject_snapshot,
    body_snapshot,
    scheduled_at,
    queued_at,
    created_by_user_id
  )
  values (
    resolved_organization_id,
    p_event_edition_id,
    template_row.id,
    trim(p_name),
    template_row.communication_type,
    template_row.channel,
    case when p_scheduled_at <= now() then 'queued' else 'scheduled' end,
    jsonb_build_object(
      'registrationStatuses', to_jsonb(normalized_statuses),
      'eventCategoryIds', to_jsonb(normalized_category_ids)
    ),
    template_row.subject_template,
    template_row.body_markdown,
    p_scheduled_at,
    case when p_scheduled_at <= now() then now() else null end,
    p_actor_user_id
  )
  returning * into campaign_row;

  insert into public.communication_deliveries (
    campaign_id,
    registration_id,
    athlete_profile_id,
    recipient_address,
    recipient_address_hash,
    personalization_json
  )
  select
    campaign_row.id,
    registration.id,
    athlete.id,
    athlete.primary_email,
    encode(
      public.digest(convert_to(lower(athlete.primary_email::text), 'UTF8'), 'sha256'),
      'hex'
    ),
    jsonb_build_object(
      'firstName', athlete.first_name,
      'displayName', athlete.display_name,
      'eventName', edition_row.name,
      'raceName', category.name,
      'bibNumber', bib.bib_number,
      'startTime', category.start_at,
      'registrationStatus', registration.status
    )
  from public.registrations registration
  join public.event_categories category on category.id = registration.event_category_id
  join public.athlete_profiles athlete on athlete.id = registration.athlete_profile_id
  left join public.bib_assignments bib
    on bib.registration_id = registration.id
   and bib.revoked_at is null
  where category.event_edition_id = p_event_edition_id
    and registration.status::text = any(normalized_statuses)
    and athlete.primary_email is not null
    and (
      cardinality(normalized_category_ids) = 0
      or registration.event_category_id = any(normalized_category_ids)
    );

  get diagnostics recipient_total = row_count;

  update public.communication_campaigns
  set recipient_count = recipient_total
  where id = campaign_row.id
  returning * into campaign_row;

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
    'email',
    'communication_campaign',
    case when p_scheduled_at <= now() then 'queued' else 'scheduled' end,
    jsonb_build_object('campaignId', campaign_row.id),
    p_scheduled_at,
    resolved_organization_id,
    p_event_edition_id,
    campaign_row.id,
    'communication-campaign:' || campaign_row.id::text,
    p_scheduled_at
  );

  insert into public.audit_log (
    organization_id,
    actor_user_id,
    entity_type,
    entity_id,
    action,
    metadata_json
  )
  values (
    resolved_organization_id,
    p_actor_user_id,
    'communication_campaign',
    campaign_row.id,
    'communication_campaign.scheduled',
    jsonb_build_object(
      'recipientCount', recipient_total,
      'scheduledAt', p_scheduled_at,
      'templateId', template_row.id
    )
  );

  return jsonb_build_object(
    'id', campaign_row.id,
    'eventEditionId', campaign_row.event_edition_id,
    'name', campaign_row.name,
    'state', campaign_row.state,
    'recipientCount', campaign_row.recipient_count,
    'scheduledAt', campaign_row.scheduled_at,
    'createdAt', campaign_row.created_at
  );
end;
$$;

create or replace function public.service_cancel_communication_campaign(
  p_campaign_id uuid,
  p_actor_user_id uuid,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  campaign_row public.communication_campaigns%rowtype;
begin
  if nullif(trim(p_reason), '') is null then
    raise exception using errcode = '22023', message = 'communication_cancel_reason_required';
  end if;

  select campaign.*
  into campaign_row
  from public.communication_campaigns campaign
  where campaign.id = p_campaign_id
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'communication_campaign_not_found';
  end if;
  if campaign_row.state = 'cancelled' then
    return jsonb_build_object('id', campaign_row.id, 'state', 'cancelled', 'replayed', true);
  end if;
  if campaign_row.state not in ('scheduled', 'queued')
     or exists (
       select 1
       from public.communication_deliveries delivery
       where delivery.campaign_id = campaign_row.id
         and delivery.state not in ('queued', 'cancelled')
     ) then
    raise exception using errcode = 'P0001', message = 'communication_campaign_cannot_cancel';
  end if;

  update public.communication_campaigns
  set state = 'cancelled', cancelled_at = now()
  where id = campaign_row.id;
  update public.communication_deliveries
  set state = 'cancelled'
  where campaign_id = campaign_row.id and state = 'queued';
  update public.notification_jobs
  set status = 'cancelled'
  where communication_campaign_id = campaign_row.id
    and status in ('scheduled', 'queued');

  insert into public.audit_log (
    organization_id,
    actor_user_id,
    entity_type,
    entity_id,
    action,
    metadata_json
  )
  values (
    campaign_row.organization_id,
    p_actor_user_id,
    'communication_campaign',
    campaign_row.id,
    'communication_campaign.cancelled',
    jsonb_build_object('reason', trim(p_reason))
  );

  return jsonb_build_object('id', campaign_row.id, 'state', 'cancelled', 'replayed', false);
end;
$$;

alter table public.communication_templates enable row level security;
alter table public.communication_campaigns enable row level security;
alter table public.communication_deliveries enable row level security;

revoke all on table
  public.communication_templates,
  public.communication_campaigns,
  public.communication_deliveries
from public, anon, authenticated;
grant all on table
  public.communication_templates,
  public.communication_campaigns,
  public.communication_deliveries
to service_role;

revoke all on function public.service_save_communication_template(
  uuid, uuid, text, text, text, text
) from public, anon, authenticated;
revoke all on function public.service_schedule_communication_campaign(
  uuid, uuid, uuid, text, text[], uuid[], timestamptz
) from public, anon, authenticated;
revoke all on function public.service_cancel_communication_campaign(
  uuid, uuid, text
) from public, anon, authenticated;

grant execute on function public.service_save_communication_template(
  uuid, uuid, text, text, text, text
) to service_role;
grant execute on function public.service_schedule_communication_campaign(
  uuid, uuid, uuid, text, text[], uuid[], timestamptz
) to service_role;
grant execute on function public.service_cancel_communication_campaign(
  uuid, uuid, text
) to service_role;
