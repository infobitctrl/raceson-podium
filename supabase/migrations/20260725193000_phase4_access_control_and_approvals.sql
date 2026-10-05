/*
 * Premium organization access control and reusable approvals.
 *
 * Adds a versioned permission catalog, organization-defined roles, scoped and
 * time-bound assignments, direct emergency grants, access-review evidence, and
 * multi-stage approval workflows with separation-of-duty controls.
 */

create table public.organization_permission_catalog (
  permission_code text primary key,
  area text not null,
  title text not null,
  description text not null,
  sensitivity text not null default 'standard',
  staff_default boolean not null default false,
  timer_default boolean not null default false,
  is_active boolean not null default true,
  created_at timestamptz not null default clock_timestamp(),
  check (permission_code ~ '^[a-z][a-z0-9_.:-]{2,119}$'),
  check (area ~ '^[a-z][a-z0-9_-]{1,59}$'),
  check (sensitivity in ('standard', 'elevated', 'restricted'))
);
insert into public.organization_permission_catalog (
  permission_code, area, title, description, sensitivity, staff_default, timer_default
)
values
  ('access.manage', 'access', 'Manage access', 'Create roles, assignments, and temporary grants.', 'restricted', false, false),
  ('access.review', 'access', 'Review access', 'Run and decide periodic access reviews.', 'elevated', false, false),
  ('approvals.configure', 'approvals', 'Configure approvals', 'Create versioned multi-stage approval workflows.', 'restricted', false, false),
  ('approvals.request', 'approvals', 'Request approval', 'Submit an immutable approval request.', 'standard', true, false),
  ('approvals.decide', 'approvals', 'Decide approvals', 'Act as a decision maker in approval workflows.', 'elevated', false, false),
  ('approvals.execute', 'approvals', 'Execute approvals', 'Mark an approved command as executed.', 'restricted', false, false),
  ('events.manage', 'events', 'Manage events', 'Create, configure, publish, and archive races.', 'elevated', true, false),
  ('registration.manage', 'registration', 'Manage registration', 'Operate entries, check-in, bibs, and start lists.', 'elevated', true, false),
  ('finance.manage', 'finance', 'Manage finance', 'Operate payment, refund, payout, and close workflows.', 'restricted', false, false),
  ('finance.export', 'finance', 'Export finance', 'Create and download audited financial exports.', 'restricted', false, false),
  ('communications.manage', 'communications', 'Manage communications', 'Build audiences and schedule participant communications.', 'elevated', true, false),
  ('safety.manage', 'safety', 'Manage safety', 'Operate safety plans and incident command.', 'restricted', true, false),
  ('safety.restricted.read', 'safety', 'Read restricted safety data', 'Access restricted medical and incident evidence.', 'restricted', false, false),
  ('workforce.manage', 'workforce', 'Manage workforce', 'Assign staff, logistics tasks, and inventory.', 'elevated', true, false),
  ('timing.configure', 'timing', 'Configure timing', 'Configure devices, providers, and timing plans.', 'elevated', true, false),
  ('timing.operate', 'timing', 'Operate timing', 'Record and reconcile race timing observations.', 'elevated', true, true),
  ('results.compute', 'results', 'Compute results', 'Run the deterministic result engine and anomaly review.', 'elevated', true, true),
  ('results.adjudication.manage', 'results', 'Manage adjudication', 'Decide result cases, penalties, protests, and appeals.', 'restricted', true, false),
  ('results.publication.approve', 'results', 'Approve publication', 'Approve an exact official or corrected result proposal.', 'restricted', false, false),
  ('results.publish', 'results', 'Publish results', 'Publish and sign official or corrected results.', 'restricted', false, false),
  ('results.credentials.issue', 'results', 'Issue credentials', 'Issue, revoke, and reissue result credentials.', 'restricted', true, false),
  ('analytics.view', 'analytics', 'View analytics', 'View organizer analytical dashboards.', 'standard', true, false),
  ('analytics.export', 'analytics', 'Export analytics', 'Export governed analytical datasets.', 'elevated', false, false),
  ('branding.manage', 'branding', 'Manage branding', 'Manage brand, domain, and public event presentation.', 'elevated', true, false),
  ('leagues.manage', 'leagues', 'Manage leagues', 'Configure seasons, scoring, rounds, and standings.', 'elevated', true, false);
create table public.organization_custom_roles (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null
    references public.organizations (id) on delete cascade,
  role_key text not null,
  role_state text not null default 'active',
  created_by_user_id uuid not null,
  created_at timestamptz not null default clock_timestamp(),
  archived_at timestamptz,
  unique (organization_id, role_key),
  check (role_key ~ '^[a-z][a-z0-9_-]{1,79}$'),
  check (role_state in ('active', 'archived'))
);
create table public.organization_custom_role_versions (
  id uuid primary key default gen_random_uuid(),
  organization_custom_role_id uuid not null
    references public.organization_custom_roles (id) on delete restrict,
  version_number integer not null,
  version_state text not null default 'active',
  title text not null,
  description text not null,
  permission_digest_sha256 text not null,
  created_by_user_id uuid not null,
  client_event_id uuid not null unique,
  created_at timestamptz not null default clock_timestamp(),
  unique (organization_custom_role_id, version_number),
  check (version_number > 0),
  check (version_state in ('active', 'superseded', 'archived')),
  check (length(trim(title)) > 0),
  check (length(trim(description)) > 0),
  check (permission_digest_sha256 ~ '^[0-9a-f]{64}$')
);
create unique index organization_custom_role_versions_active_idx
  on public.organization_custom_role_versions (organization_custom_role_id)
  where version_state = 'active';
create table public.organization_custom_role_permissions (
  organization_custom_role_version_id uuid not null
    references public.organization_custom_role_versions (id) on delete restrict,
  permission_code text not null
    references public.organization_permission_catalog (permission_code) on delete restrict,
  created_at timestamptz not null default clock_timestamp(),
  primary key (organization_custom_role_version_id, permission_code)
);
create table public.organization_member_role_assignments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null
    references public.organizations (id) on delete cascade,
  user_id uuid not null,
  organization_custom_role_id uuid not null
    references public.organization_custom_roles (id) on delete restrict,
  scope_type text not null default 'organization',
  scope_id uuid,
  assignment_state text not null default 'active',
  starts_at timestamptz not null default clock_timestamp(),
  ends_at timestamptz,
  assigned_by_user_id uuid not null,
  revoked_by_user_id uuid,
  revoked_at timestamptz,
  revocation_reason text,
  client_event_id uuid not null unique,
  created_at timestamptz not null default clock_timestamp(),
  check (scope_type in ('organization', 'event_edition', 'event_category')),
  check (
    (scope_type = 'organization' and scope_id is null)
    or (scope_type <> 'organization' and scope_id is not null)
  ),
  check (assignment_state in ('active', 'revoked', 'expired')),
  check (ends_at is null or ends_at > starts_at),
  check (
    assignment_state = 'active'
    or (
      revoked_by_user_id is not null
      and revoked_at is not null
      and length(trim(revocation_reason)) > 0
    )
  )
);
create unique index organization_member_role_assignments_active_idx
  on public.organization_member_role_assignments (
    organization_id,
    user_id,
    organization_custom_role_id,
    scope_type,
    coalesce(scope_id, '00000000-0000-0000-0000-000000000000'::uuid)
  )
  where assignment_state = 'active';
create table public.organization_direct_permission_grants (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null
    references public.organizations (id) on delete cascade,
  user_id uuid not null,
  permission_code text not null
    references public.organization_permission_catalog (permission_code) on delete restrict,
  scope_type text not null default 'organization',
  scope_id uuid,
  grant_state text not null default 'active',
  reason text not null,
  starts_at timestamptz not null default clock_timestamp(),
  ends_at timestamptz not null,
  granted_by_user_id uuid not null,
  revoked_by_user_id uuid,
  revoked_at timestamptz,
  revocation_reason text,
  client_event_id uuid not null unique,
  created_at timestamptz not null default clock_timestamp(),
  check (scope_type in ('organization', 'event_edition', 'event_category')),
  check (
    (scope_type = 'organization' and scope_id is null)
    or (scope_type <> 'organization' and scope_id is not null)
  ),
  check (grant_state in ('active', 'revoked', 'expired')),
  check (length(trim(reason)) > 0),
  check (ends_at > starts_at),
  check (
    grant_state = 'active'
    or (
      revoked_by_user_id is not null
      and revoked_at is not null
      and length(trim(revocation_reason)) > 0
    )
  )
);
create index organization_direct_permission_grants_user_idx
  on public.organization_direct_permission_grants
  (organization_id, user_id, grant_state, ends_at);
create table public.organization_access_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null
    references public.organizations (id) on delete cascade,
  subject_user_id uuid,
  entity_type text not null,
  entity_id uuid not null,
  action_type text not null,
  note text not null,
  metadata_json jsonb not null default '{}'::jsonb,
  actor_user_id uuid not null,
  client_event_id uuid unique,
  created_at timestamptz not null default clock_timestamp(),
  check (entity_type in ('custom_role', 'role_assignment', 'direct_grant', 'access_review')),
  check (
    action_type in (
      'role_version_created', 'role_assigned', 'assignment_revoked',
      'grant_created', 'grant_revoked', 'review_created', 'review_decided'
    )
  ),
  check (length(trim(note)) > 0),
  check (jsonb_typeof(metadata_json) = 'object')
);
create table public.organization_access_review_campaigns (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null
    references public.organizations (id) on delete cascade,
  name text not null,
  review_state text not null default 'open',
  due_at timestamptz not null,
  snapshot_digest_sha256 text not null,
  created_by_user_id uuid not null,
  client_event_id uuid not null unique,
  created_at timestamptz not null default clock_timestamp(),
  completed_at timestamptz,
  check (length(trim(name)) > 0),
  check (review_state in ('open', 'completed', 'cancelled')),
  check (due_at > created_at),
  check (snapshot_digest_sha256 ~ '^[0-9a-f]{64}$')
);
create table public.organization_access_review_items (
  id uuid primary key default gen_random_uuid(),
  organization_access_review_campaign_id uuid not null
    references public.organization_access_review_campaigns (id) on delete restrict,
  user_id uuid not null,
  access_snapshot_json jsonb not null,
  decision_state text not null default 'pending',
  decision_note text,
  decided_by_user_id uuid,
  decided_at timestamptz,
  client_event_id uuid unique,
  created_at timestamptz not null default clock_timestamp(),
  unique (organization_access_review_campaign_id, user_id),
  check (jsonb_typeof(access_snapshot_json) = 'object'),
  check (decision_state in ('pending', 'retain', 'revoke_custom_access')),
  check (
    decision_state = 'pending'
    or (
      length(trim(decision_note)) > 0
      and decided_by_user_id is not null
      and decided_at is not null
    )
  )
);
create table public.approval_workflows (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null
    references public.organizations (id) on delete cascade,
  workflow_key text not null,
  workflow_state text not null default 'active',
  created_by_user_id uuid not null,
  created_at timestamptz not null default clock_timestamp(),
  archived_at timestamptz,
  unique (organization_id, workflow_key),
  check (workflow_key ~ '^[a-z][a-z0-9_.:-]{1,99}$'),
  check (workflow_state in ('active', 'archived'))
);
create table public.approval_workflow_versions (
  id uuid primary key default gen_random_uuid(),
  approval_workflow_id uuid not null
    references public.approval_workflows (id) on delete restrict,
  version_number integer not null,
  version_state text not null default 'active',
  name text not null,
  subject_type text not null,
  description text not null,
  expiry_minutes integer not null default 1440,
  prevent_requester_approval boolean not null default true,
  prevent_cross_stage_actor boolean not null default true,
  definition_digest_sha256 text not null,
  created_by_user_id uuid not null,
  client_event_id uuid not null unique,
  created_at timestamptz not null default clock_timestamp(),
  unique (approval_workflow_id, version_number),
  check (version_number > 0),
  check (version_state in ('active', 'superseded', 'archived')),
  check (subject_type ~ '^[a-z][a-z0-9_.:-]{1,99}$'),
  check (expiry_minutes between 15 and 43200),
  check (length(trim(name)) > 0),
  check (length(trim(description)) > 0),
  check (definition_digest_sha256 ~ '^[0-9a-f]{64}$')
);
create unique index approval_workflow_versions_active_idx
  on public.approval_workflow_versions (approval_workflow_id)
  where version_state = 'active';
create table public.approval_workflow_stages (
  id uuid primary key default gen_random_uuid(),
  approval_workflow_version_id uuid not null
    references public.approval_workflow_versions (id) on delete restrict,
  stage_number smallint not null,
  name text not null,
  required_approvals smallint not null,
  required_permission_code text not null
    references public.organization_permission_catalog (permission_code) on delete restrict,
  allow_requester boolean not null default false,
  allow_previous_stage_actor boolean not null default false,
  created_at timestamptz not null default clock_timestamp(),
  unique (approval_workflow_version_id, stage_number),
  check (stage_number between 1 and 20),
  check (required_approvals between 1 and 10),
  check (length(trim(name)) > 0)
);
create table public.approval_requests (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null
    references public.organizations (id) on delete cascade,
  approval_workflow_version_id uuid not null
    references public.approval_workflow_versions (id) on delete restrict,
  subject_type text not null,
  subject_id uuid not null,
  request_state text not null default 'pending',
  current_stage_number smallint not null default 1,
  payload_json jsonb not null,
  payload_digest_sha256 text not null,
  requested_by_user_id uuid not null,
  client_event_id uuid not null unique,
  requested_at timestamptz not null default clock_timestamp(),
  due_at timestamptz not null,
  decided_at timestamptz,
  executed_at timestamptz,
  check (request_state in ('pending', 'approved', 'rejected', 'cancelled', 'expired', 'executed')),
  check (current_stage_number between 1 and 20),
  check (jsonb_typeof(payload_json) = 'object'),
  check (payload_digest_sha256 ~ '^[0-9a-f]{64}$'),
  check (due_at > requested_at)
);
create index approval_requests_org_state_due_idx
  on public.approval_requests (organization_id, request_state, due_at);
create table public.approval_request_decisions (
  id uuid primary key default gen_random_uuid(),
  approval_request_id uuid not null
    references public.approval_requests (id) on delete restrict,
  stage_number smallint not null,
  decision text not null,
  decision_note text not null,
  actor_user_id uuid not null,
  client_event_id uuid not null unique,
  created_at timestamptz not null default clock_timestamp(),
  unique (approval_request_id, stage_number, actor_user_id),
  check (stage_number between 1 and 20),
  check (decision in ('approved', 'rejected')),
  check (length(trim(decision_note)) > 0)
);
create table public.approval_request_events (
  id uuid primary key default gen_random_uuid(),
  approval_request_id uuid not null
    references public.approval_requests (id) on delete restrict,
  sequence_number integer not null,
  action_type text not null,
  note text not null,
  metadata_json jsonb not null default '{}'::jsonb,
  actor_user_id uuid not null,
  client_event_id uuid unique,
  created_at timestamptz not null default clock_timestamp(),
  unique (approval_request_id, sequence_number),
  check (action_type in ('requested', 'decision', 'stage_advanced', 'approved', 'rejected', 'cancelled', 'expired', 'executed')),
  check (length(trim(note)) > 0),
  check (jsonb_typeof(metadata_json) = 'object')
);
create or replace function public.prevent_access_control_evidence_change()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception using errcode = '55000', message = 'access_control_evidence_is_append_only';
end;
$$;
create trigger organization_custom_role_permissions_immutable
before update or delete on public.organization_custom_role_permissions
for each row execute function public.prevent_access_control_evidence_change();
create trigger organization_access_events_immutable
before update or delete on public.organization_access_events
for each row execute function public.prevent_access_control_evidence_change();
create trigger approval_workflow_stages_immutable
before update or delete on public.approval_workflow_stages
for each row execute function public.prevent_access_control_evidence_change();
create trigger approval_request_decisions_immutable
before update or delete on public.approval_request_decisions
for each row execute function public.prevent_access_control_evidence_change();
create trigger approval_request_events_immutable
before update or delete on public.approval_request_events
for each row execute function public.prevent_access_control_evidence_change();
create or replace function public.protect_versioned_access_definition()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    raise exception using errcode = '55000', message = 'access_control_evidence_is_append_only';
  end if;
  if (to_jsonb(new) - 'version_state')
       is distinct from (to_jsonb(old) - 'version_state')
     or old.version_state <> 'active'
     or new.version_state not in ('superseded', 'archived') then
    raise exception using errcode = '55000', message = 'access_control_version_is_immutable';
  end if;
  return new;
end;
$$;
create trigger organization_custom_role_versions_protected
before update or delete on public.organization_custom_role_versions
for each row execute function public.protect_versioned_access_definition();
create trigger approval_workflow_versions_protected
before update or delete on public.approval_workflow_versions
for each row execute function public.protect_versioned_access_definition();
create or replace function public.service_user_has_organization_permission(
  p_organization_id uuid,
  p_user_id uuid,
  p_permission_code text,
  p_scope_type text default 'organization',
  p_scope_id uuid default null,
  p_effective_at timestamptz default clock_timestamp()
)
returns boolean
language plpgsql
security definer
stable
set search_path = ''
as $$
declare
  membership_role public.organization_membership_role;
  catalog_row public.organization_permission_catalog%rowtype;
begin
  if p_organization_id is null
     or p_user_id is null
     or p_permission_code is null
     or p_scope_type not in ('organization', 'event_edition', 'event_category') then
    return false;
  end if;

  select membership.role
  into membership_role
  from public.organization_memberships membership
  where membership.organization_id = p_organization_id
    and membership.user_id = p_user_id
    and membership.status = 'active';
  if not found then
    return false;
  end if;

  if membership_role in ('owner', 'admin') then
    return true;
  end if;

  select *
  into catalog_row
  from public.organization_permission_catalog permission
  where permission.permission_code = p_permission_code
    and permission.is_active;
  if not found then
    return false;
  end if;

  if membership_role = 'staff' and catalog_row.staff_default then
    return true;
  end if;
  if membership_role = 'timer' and catalog_row.timer_default then
    return true;
  end if;

  if exists (
    select 1
    from public.organization_member_role_assignments assignment
    join public.organization_custom_roles custom_role
      on custom_role.id = assignment.organization_custom_role_id
    join public.organization_custom_role_versions role_version
      on role_version.organization_custom_role_id = custom_role.id
     and role_version.version_state = 'active'
    join public.organization_custom_role_permissions role_permission
      on role_permission.organization_custom_role_version_id = role_version.id
    where assignment.organization_id = p_organization_id
      and assignment.user_id = p_user_id
      and assignment.assignment_state = 'active'
      and assignment.starts_at <= p_effective_at
      and (assignment.ends_at is null or assignment.ends_at > p_effective_at)
      and custom_role.role_state = 'active'
      and role_permission.permission_code = p_permission_code
      and (
        assignment.scope_type = 'organization'
        or (
          assignment.scope_type = p_scope_type
          and assignment.scope_id = p_scope_id
        )
      )
  ) then
    return true;
  end if;

  return exists (
    select 1
    from public.organization_direct_permission_grants direct_grant
    where direct_grant.organization_id = p_organization_id
      and direct_grant.user_id = p_user_id
      and direct_grant.permission_code = p_permission_code
      and direct_grant.grant_state = 'active'
      and direct_grant.starts_at <= p_effective_at
      and direct_grant.ends_at > p_effective_at
      and (
        direct_grant.scope_type = 'organization'
        or (
          direct_grant.scope_type = p_scope_type
          and direct_grant.scope_id = p_scope_id
        )
      )
  );
end;
$$;
create or replace function public.service_save_organization_custom_role(
  p_organization_id uuid,
  p_actor_user_id uuid,
  p_role_key text,
  p_title text,
  p_description text,
  p_permission_codes text[],
  p_client_event_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  custom_role public.organization_custom_roles%rowtype;
  role_version public.organization_custom_role_versions%rowtype;
  replayed_version public.organization_custom_role_versions%rowtype;
  normalized_permissions text[];
  next_version integer;
  permission_digest text;
begin
  select *
  into replayed_version
  from public.organization_custom_role_versions
  where client_event_id = p_client_event_id;
  if found then
    return jsonb_build_object(
      'id', replayed_version.organization_custom_role_id,
      'versionId', replayed_version.id,
      'versionNumber', replayed_version.version_number,
      'permissionDigestSha256', replayed_version.permission_digest_sha256,
      'replayed', true
    );
  end if;

  if not public.service_user_has_organization_permission(
    p_organization_id, p_actor_user_id, 'access.manage'
  ) then
    raise exception using errcode = '42501', message = 'organization_permission_required';
  end if;

  select coalesce(array_agg(distinct trim(permission_code) order by trim(permission_code)), array[]::text[])
  into normalized_permissions
  from unnest(coalesce(p_permission_codes, array[]::text[])) permission_code
  where nullif(trim(permission_code), '') is not null;

  if p_role_key !~ '^[a-z][a-z0-9_-]{1,79}$'
     or nullif(trim(p_title), '') is null
     or nullif(trim(p_description), '') is null
     or cardinality(normalized_permissions) = 0
     or exists (
       select 1
       from unnest(normalized_permissions) requested_permission
       where not exists (
         select 1
         from public.organization_permission_catalog catalog
         where catalog.permission_code = requested_permission
           and catalog.is_active
       )
     ) then
    raise exception using errcode = '22023', message = 'organization_custom_role_input_invalid';
  end if;

  insert into public.organization_custom_roles (
    organization_id, role_key, created_by_user_id
  )
  values (
    p_organization_id, p_role_key, p_actor_user_id
  )
  on conflict (organization_id, role_key) do update
  set role_key = excluded.role_key
  returning * into custom_role;

  if custom_role.role_state <> 'active' then
    raise exception using errcode = 'P0001', message = 'organization_custom_role_archived';
  end if;

  select coalesce(max(version.version_number), 0) + 1
  into next_version
  from public.organization_custom_role_versions version
  where version.organization_custom_role_id = custom_role.id;

  permission_digest := encode(
    public.digest(
      convert_to(
        jsonb_build_object(
          'roleKey', custom_role.role_key,
          'title', trim(p_title),
          'description', trim(p_description),
          'permissions', to_jsonb(normalized_permissions),
          'versionNumber', next_version
        )::text,
        'UTF8'
      ),
      'sha256'
    ),
    'hex'
  );

  update public.organization_custom_role_versions
  set version_state = 'superseded'
  where organization_custom_role_id = custom_role.id
    and version_state = 'active';

  insert into public.organization_custom_role_versions (
    organization_custom_role_id,
    version_number,
    title,
    description,
    permission_digest_sha256,
    created_by_user_id,
    client_event_id
  )
  values (
    custom_role.id,
    next_version,
    trim(p_title),
    trim(p_description),
    permission_digest,
    p_actor_user_id,
    p_client_event_id
  )
  returning * into role_version;

  insert into public.organization_custom_role_permissions (
    organization_custom_role_version_id, permission_code
  )
  select role_version.id, permission_code
  from unnest(normalized_permissions) permission_code;

  insert into public.organization_access_events (
    organization_id,
    entity_type,
    entity_id,
    action_type,
    note,
    metadata_json,
    actor_user_id,
    client_event_id
  )
  values (
    p_organization_id,
    'custom_role',
    custom_role.id,
    'role_version_created',
    'Custom role version ' || next_version || ' created.',
    jsonb_build_object(
      'roleKey', custom_role.role_key,
      'versionId', role_version.id,
      'permissionCodes', normalized_permissions,
      'permissionDigestSha256', permission_digest
    ),
    p_actor_user_id,
    p_client_event_id
  );

  return jsonb_build_object(
    'id', custom_role.id,
    'roleKey', custom_role.role_key,
    'versionId', role_version.id,
    'versionNumber', role_version.version_number,
    'title', role_version.title,
    'description', role_version.description,
    'permissionCodes', to_jsonb(normalized_permissions),
    'permissionDigestSha256', permission_digest,
    'replayed', false
  );
end;
$$;
create or replace function public.service_assign_organization_custom_role(
  p_organization_id uuid,
  p_actor_user_id uuid,
  p_user_id uuid,
  p_organization_custom_role_id uuid,
  p_scope_type text,
  p_scope_id uuid,
  p_starts_at timestamptz,
  p_ends_at timestamptz,
  p_client_event_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  assignment public.organization_member_role_assignments%rowtype;
  replayed_assignment public.organization_member_role_assignments%rowtype;
  actor_membership_role public.organization_membership_role;
begin
  select *
  into replayed_assignment
  from public.organization_member_role_assignments
  where client_event_id = p_client_event_id;
  if found then
    return jsonb_build_object(
      'id', replayed_assignment.id,
      'assignmentState', replayed_assignment.assignment_state,
      'replayed', true
    );
  end if;

  if not public.service_user_has_organization_permission(
    p_organization_id, p_actor_user_id, 'access.manage'
  ) then
    raise exception using errcode = '42501', message = 'organization_permission_required';
  end if;

  select membership.role
  into actor_membership_role
  from public.organization_memberships membership
  where membership.organization_id = p_organization_id
    and membership.user_id = p_actor_user_id
    and membership.status = 'active';

  if p_user_id = p_actor_user_id and actor_membership_role <> 'owner' then
    raise exception using errcode = '42501', message = 'self_privilege_escalation_forbidden';
  end if;

  if p_scope_type not in ('organization', 'event_edition', 'event_category')
     or (p_scope_type = 'organization' and p_scope_id is not null)
     or (p_scope_type <> 'organization' and p_scope_id is null)
     or coalesce(p_starts_at, clock_timestamp()) >= coalesce(p_ends_at, 'infinity'::timestamptz)
     or not exists (
       select 1
       from public.organization_memberships membership
       where membership.organization_id = p_organization_id
         and membership.user_id = p_user_id
         and membership.status = 'active'
     )
     or not exists (
       select 1
       from public.organization_custom_roles custom_role
       where custom_role.id = p_organization_custom_role_id
         and custom_role.organization_id = p_organization_id
         and custom_role.role_state = 'active'
     ) then
    raise exception using errcode = '22023', message = 'organization_role_assignment_input_invalid';
  end if;

  if p_scope_type = 'event_edition' and not exists (
    select 1
    from public.event_editions edition
    join public.event_series series on series.id = edition.event_series_id
    where edition.id = p_scope_id
      and series.organization_id = p_organization_id
  ) then
    raise exception using errcode = '22023', message = 'organization_access_scope_invalid';
  end if;
  if p_scope_type = 'event_category' and not exists (
    select 1
    from public.event_categories category
    join public.event_editions edition on edition.id = category.event_edition_id
    join public.event_series series on series.id = edition.event_series_id
    where category.id = p_scope_id
      and series.organization_id = p_organization_id
  ) then
    raise exception using errcode = '22023', message = 'organization_access_scope_invalid';
  end if;

  insert into public.organization_member_role_assignments (
    organization_id,
    user_id,
    organization_custom_role_id,
    scope_type,
    scope_id,
    starts_at,
    ends_at,
    assigned_by_user_id,
    client_event_id
  )
  values (
    p_organization_id,
    p_user_id,
    p_organization_custom_role_id,
    p_scope_type,
    p_scope_id,
    coalesce(p_starts_at, clock_timestamp()),
    p_ends_at,
    p_actor_user_id,
    p_client_event_id
  )
  returning * into assignment;

  insert into public.organization_access_events (
    organization_id,
    subject_user_id,
    entity_type,
    entity_id,
    action_type,
    note,
    metadata_json,
    actor_user_id,
    client_event_id
  )
  values (
    p_organization_id,
    p_user_id,
    'role_assignment',
    assignment.id,
    'role_assigned',
    'Custom role assigned.',
    jsonb_build_object(
      'customRoleId', p_organization_custom_role_id,
      'scopeType', p_scope_type,
      'scopeId', p_scope_id,
      'startsAt', assignment.starts_at,
      'endsAt', assignment.ends_at
    ),
    p_actor_user_id,
    p_client_event_id
  );

  return jsonb_build_object(
    'id', assignment.id,
    'userId', assignment.user_id,
    'customRoleId', assignment.organization_custom_role_id,
    'scopeType', assignment.scope_type,
    'scopeId', assignment.scope_id,
    'startsAt', assignment.starts_at,
    'endsAt', assignment.ends_at,
    'assignmentState', assignment.assignment_state,
    'replayed', false
  );
end;
$$;
create or replace function public.service_revoke_organization_custom_role_assignment(
  p_assignment_id uuid,
  p_actor_user_id uuid,
  p_reason text,
  p_client_event_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  assignment public.organization_member_role_assignments%rowtype;
begin
  select *
  into assignment
  from public.organization_member_role_assignments
  where id = p_assignment_id
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'organization_role_assignment_not_found';
  end if;
  if not public.service_user_has_organization_permission(
    assignment.organization_id, p_actor_user_id, 'access.manage'
  ) then
    raise exception using errcode = '42501', message = 'organization_permission_required';
  end if;
  if nullif(trim(p_reason), '') is null then
    raise exception using errcode = '22023', message = 'organization_access_revocation_reason_required';
  end if;
  if assignment.assignment_state <> 'active' then
    return jsonb_build_object(
      'id', assignment.id,
      'assignmentState', assignment.assignment_state,
      'replayed', true
    );
  end if;

  update public.organization_member_role_assignments
  set assignment_state = 'revoked',
      revoked_by_user_id = p_actor_user_id,
      revoked_at = clock_timestamp(),
      revocation_reason = trim(p_reason)
  where id = assignment.id;

  insert into public.organization_access_events (
    organization_id,
    subject_user_id,
    entity_type,
    entity_id,
    action_type,
    note,
    actor_user_id,
    client_event_id
  )
  values (
    assignment.organization_id,
    assignment.user_id,
    'role_assignment',
    assignment.id,
    'assignment_revoked',
    trim(p_reason),
    p_actor_user_id,
    p_client_event_id
  );

  return jsonb_build_object(
    'id', assignment.id,
    'assignmentState', 'revoked',
    'revocationReason', trim(p_reason),
    'replayed', false
  );
end;
$$;
create or replace function public.service_grant_temporary_organization_permission(
  p_organization_id uuid,
  p_actor_user_id uuid,
  p_user_id uuid,
  p_permission_code text,
  p_scope_type text,
  p_scope_id uuid,
  p_reason text,
  p_starts_at timestamptz,
  p_ends_at timestamptz,
  p_client_event_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  direct_grant public.organization_direct_permission_grants%rowtype;
  replayed_grant public.organization_direct_permission_grants%rowtype;
  actor_membership_role public.organization_membership_role;
begin
  select *
  into replayed_grant
  from public.organization_direct_permission_grants
  where client_event_id = p_client_event_id;
  if found then
    return jsonb_build_object(
      'id', replayed_grant.id,
      'userId', replayed_grant.user_id,
      'permissionCode', replayed_grant.permission_code,
      'scopeType', replayed_grant.scope_type,
      'scopeId', replayed_grant.scope_id,
      'startsAt', replayed_grant.starts_at,
      'endsAt', replayed_grant.ends_at,
      'grantState', replayed_grant.grant_state,
      'replayed', true
    );
  end if;

  if not public.service_user_has_organization_permission(
    p_organization_id, p_actor_user_id, 'access.manage'
  ) then
    raise exception using errcode = '42501', message = 'organization_permission_required';
  end if;

  select membership.role
  into actor_membership_role
  from public.organization_memberships membership
  where membership.organization_id = p_organization_id
    and membership.user_id = p_actor_user_id
    and membership.status = 'active';
  if p_user_id = p_actor_user_id and actor_membership_role <> 'owner' then
    raise exception using errcode = '42501', message = 'self_privilege_escalation_forbidden';
  end if;

  if not exists (
       select 1
       from public.organization_memberships membership
       where membership.organization_id = p_organization_id
         and membership.user_id = p_user_id
         and membership.status = 'active'
     )
     or not exists (
       select 1
       from public.organization_permission_catalog catalog
       where catalog.permission_code = p_permission_code
         and catalog.is_active
     )
     or p_scope_type not in ('organization', 'event_edition', 'event_category')
     or (p_scope_type = 'organization' and p_scope_id is not null)
     or (p_scope_type <> 'organization' and p_scope_id is null)
     or nullif(trim(p_reason), '') is null
     or coalesce(p_starts_at, clock_timestamp()) >= p_ends_at
     or p_ends_at > clock_timestamp() + interval '30 days' then
    raise exception using errcode = '22023', message = 'organization_temporary_grant_input_invalid';
  end if;

  insert into public.organization_direct_permission_grants (
    organization_id,
    user_id,
    permission_code,
    scope_type,
    scope_id,
    reason,
    starts_at,
    ends_at,
    granted_by_user_id,
    client_event_id
  )
  values (
    p_organization_id,
    p_user_id,
    p_permission_code,
    p_scope_type,
    p_scope_id,
    trim(p_reason),
    coalesce(p_starts_at, clock_timestamp()),
    p_ends_at,
    p_actor_user_id,
    p_client_event_id
  )
  returning * into direct_grant;

  insert into public.organization_access_events (
    organization_id,
    subject_user_id,
    entity_type,
    entity_id,
    action_type,
    note,
    metadata_json,
    actor_user_id,
    client_event_id
  )
  values (
    p_organization_id,
    p_user_id,
    'direct_grant',
    direct_grant.id,
    'grant_created',
    trim(p_reason),
    jsonb_build_object(
      'permissionCode', p_permission_code,
      'scopeType', p_scope_type,
      'scopeId', p_scope_id,
      'startsAt', direct_grant.starts_at,
      'endsAt', direct_grant.ends_at
    ),
    p_actor_user_id,
    p_client_event_id
  );

  return jsonb_build_object(
    'id', direct_grant.id,
    'userId', direct_grant.user_id,
    'permissionCode', direct_grant.permission_code,
    'scopeType', direct_grant.scope_type,
    'scopeId', direct_grant.scope_id,
    'startsAt', direct_grant.starts_at,
    'endsAt', direct_grant.ends_at,
    'grantState', direct_grant.grant_state,
    'replayed', false
  );
end;
$$;
create or replace function public.service_revoke_temporary_organization_permission(
  p_grant_id uuid,
  p_actor_user_id uuid,
  p_reason text,
  p_client_event_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  direct_grant public.organization_direct_permission_grants%rowtype;
begin
  select *
  into direct_grant
  from public.organization_direct_permission_grants
  where id = p_grant_id
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'organization_temporary_grant_not_found';
  end if;
  if not public.service_user_has_organization_permission(
    direct_grant.organization_id, p_actor_user_id, 'access.manage'
  ) then
    raise exception using errcode = '42501', message = 'organization_permission_required';
  end if;
  if nullif(trim(p_reason), '') is null then
    raise exception using errcode = '22023', message = 'organization_access_revocation_reason_required';
  end if;
  if direct_grant.grant_state <> 'active' then
    return jsonb_build_object(
      'id', direct_grant.id,
      'grantState', direct_grant.grant_state,
      'replayed', true
    );
  end if;

  update public.organization_direct_permission_grants
  set grant_state = 'revoked',
      revoked_by_user_id = p_actor_user_id,
      revoked_at = clock_timestamp(),
      revocation_reason = trim(p_reason)
  where id = direct_grant.id;

  insert into public.organization_access_events (
    organization_id,
    subject_user_id,
    entity_type,
    entity_id,
    action_type,
    note,
    actor_user_id,
    client_event_id
  )
  values (
    direct_grant.organization_id,
    direct_grant.user_id,
    'direct_grant',
    direct_grant.id,
    'grant_revoked',
    trim(p_reason),
    p_actor_user_id,
    p_client_event_id
  );

  return jsonb_build_object(
    'id', direct_grant.id,
    'grantState', 'revoked',
    'revocationReason', trim(p_reason),
    'replayed', false
  );
end;
$$;
create or replace function public.service_create_organization_access_review(
  p_organization_id uuid,
  p_actor_user_id uuid,
  p_name text,
  p_due_at timestamptz,
  p_client_event_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  review_row public.organization_access_review_campaigns%rowtype;
  replayed_review public.organization_access_review_campaigns%rowtype;
  access_snapshot jsonb;
  snapshot_digest text;
  item_count integer;
begin
  select *
  into replayed_review
  from public.organization_access_review_campaigns
  where client_event_id = p_client_event_id;
  if found then
    select count(*)::integer
    into item_count
    from public.organization_access_review_items review_item
    where review_item.organization_access_review_campaign_id = replayed_review.id;
    return jsonb_build_object(
      'id', replayed_review.id,
      'name', replayed_review.name,
      'reviewState', replayed_review.review_state,
      'itemCount', item_count,
      'dueAt', replayed_review.due_at,
      'snapshotDigestSha256', replayed_review.snapshot_digest_sha256,
      'replayed', true
    );
  end if;

  if not public.service_user_has_organization_permission(
    p_organization_id, p_actor_user_id, 'access.review'
  ) then
    raise exception using errcode = '42501', message = 'organization_permission_required';
  end if;
  if nullif(trim(p_name), '') is null
     or p_due_at <= clock_timestamp()
     or p_due_at > clock_timestamp() + interval '180 days' then
    raise exception using errcode = '22023', message = 'organization_access_review_input_invalid';
  end if;

  select jsonb_build_object(
    'organizationId', p_organization_id,
    'capturedAt', clock_timestamp(),
    'members', coalesce(
      jsonb_agg(
        jsonb_build_object(
          'userId', membership.user_id,
          'builtInRole', membership.role,
          'customAssignments', (
            select coalesce(jsonb_agg(jsonb_build_object(
              'id', assignment.id,
              'customRoleId', assignment.organization_custom_role_id,
              'scopeType', assignment.scope_type,
              'scopeId', assignment.scope_id,
              'startsAt', assignment.starts_at,
              'endsAt', assignment.ends_at
            ) order by assignment.created_at), '[]'::jsonb)
            from public.organization_member_role_assignments assignment
            where assignment.organization_id = p_organization_id
              and assignment.user_id = membership.user_id
              and assignment.assignment_state = 'active'
          ),
          'directGrants', (
            select coalesce(jsonb_agg(jsonb_build_object(
              'id', direct_grant.id,
              'permissionCode', direct_grant.permission_code,
              'scopeType', direct_grant.scope_type,
              'scopeId', direct_grant.scope_id,
              'endsAt', direct_grant.ends_at
            ) order by direct_grant.created_at), '[]'::jsonb)
            from public.organization_direct_permission_grants direct_grant
            where direct_grant.organization_id = p_organization_id
              and direct_grant.user_id = membership.user_id
              and direct_grant.grant_state = 'active'
              and direct_grant.ends_at > clock_timestamp()
          )
        )
        order by membership.user_id
      ),
      '[]'::jsonb
    )
  )
  into access_snapshot
  from public.organization_memberships membership
  where membership.organization_id = p_organization_id
    and membership.status = 'active';

  snapshot_digest := encode(
    public.digest(convert_to(access_snapshot::text, 'UTF8'), 'sha256'),
    'hex'
  );

  insert into public.organization_access_review_campaigns (
    organization_id,
    name,
    due_at,
    snapshot_digest_sha256,
    created_by_user_id,
    client_event_id
  )
  values (
    p_organization_id,
    trim(p_name),
    p_due_at,
    snapshot_digest,
    p_actor_user_id,
    p_client_event_id
  )
  returning * into review_row;

  insert into public.organization_access_review_items (
    organization_access_review_campaign_id,
    user_id,
    access_snapshot_json
  )
  select
    review_row.id,
    (member->>'userId')::uuid,
    member
  from jsonb_array_elements(access_snapshot->'members') member;
  get diagnostics item_count = row_count;

  insert into public.organization_access_events (
    organization_id,
    entity_type,
    entity_id,
    action_type,
    note,
    metadata_json,
    actor_user_id,
    client_event_id
  )
  values (
    p_organization_id,
    'access_review',
    review_row.id,
    'review_created',
    trim(p_name),
    jsonb_build_object(
      'itemCount', item_count,
      'dueAt', p_due_at,
      'snapshotDigestSha256', snapshot_digest
    ),
    p_actor_user_id,
    p_client_event_id
  );

  return jsonb_build_object(
    'id', review_row.id,
    'name', review_row.name,
    'reviewState', review_row.review_state,
    'itemCount', item_count,
    'dueAt', review_row.due_at,
    'snapshotDigestSha256', snapshot_digest,
    'replayed', false
  );
end;
$$;
create or replace function public.service_decide_organization_access_review_item(
  p_review_item_id uuid,
  p_actor_user_id uuid,
  p_decision_state text,
  p_decision_note text,
  p_client_event_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  item_row public.organization_access_review_items%rowtype;
  replayed_item public.organization_access_review_items%rowtype;
  campaign_row public.organization_access_review_campaigns%rowtype;
  pending_count integer;
begin
  select *
  into replayed_item
  from public.organization_access_review_items
  where client_event_id = p_client_event_id;
  if found then
    select *
    into campaign_row
    from public.organization_access_review_campaigns
    where id = replayed_item.organization_access_review_campaign_id;
    select count(*)::integer
    into pending_count
    from public.organization_access_review_items review_item
    where review_item.organization_access_review_campaign_id = campaign_row.id
      and review_item.decision_state = 'pending';
    return jsonb_build_object(
      'id', replayed_item.id,
      'decisionState', replayed_item.decision_state,
      'pendingCount', pending_count,
      'campaignState', campaign_row.review_state,
      'replayed', true
    );
  end if;

  select *
  into item_row
  from public.organization_access_review_items
  where id = p_review_item_id
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'organization_access_review_item_not_found';
  end if;
  select *
  into campaign_row
  from public.organization_access_review_campaigns
  where id = item_row.organization_access_review_campaign_id
  for update;

  if not public.service_user_has_organization_permission(
    campaign_row.organization_id, p_actor_user_id, 'access.review'
  ) then
    raise exception using errcode = '42501', message = 'organization_permission_required';
  end if;
  if campaign_row.review_state <> 'open'
     or item_row.decision_state <> 'pending'
     or p_decision_state not in ('retain', 'revoke_custom_access')
     or nullif(trim(p_decision_note), '') is null then
    raise exception using errcode = 'P0001', message = 'organization_access_review_decision_invalid';
  end if;

  update public.organization_access_review_items
  set decision_state = p_decision_state,
      decision_note = trim(p_decision_note),
      decided_by_user_id = p_actor_user_id,
      decided_at = clock_timestamp(),
      client_event_id = p_client_event_id
  where id = item_row.id;

  if p_decision_state = 'revoke_custom_access' then
    update public.organization_member_role_assignments
    set assignment_state = 'revoked',
        revoked_by_user_id = p_actor_user_id,
        revoked_at = clock_timestamp(),
        revocation_reason = 'Access review ' || campaign_row.id::text
          || ': ' || trim(p_decision_note)
    where organization_id = campaign_row.organization_id
      and user_id = item_row.user_id
      and assignment_state = 'active';

    update public.organization_direct_permission_grants
    set grant_state = 'revoked',
        revoked_by_user_id = p_actor_user_id,
        revoked_at = clock_timestamp(),
        revocation_reason = 'Access review ' || campaign_row.id::text
          || ': ' || trim(p_decision_note)
    where organization_id = campaign_row.organization_id
      and user_id = item_row.user_id
      and grant_state = 'active';
  end if;

  select count(*)::integer
  into pending_count
  from public.organization_access_review_items review_item
  where review_item.organization_access_review_campaign_id = campaign_row.id
    and review_item.decision_state = 'pending';

  if pending_count = 0 then
    update public.organization_access_review_campaigns
    set review_state = 'completed',
        completed_at = clock_timestamp()
    where id = campaign_row.id;
  end if;

  insert into public.organization_access_events (
    organization_id,
    subject_user_id,
    entity_type,
    entity_id,
    action_type,
    note,
    metadata_json,
    actor_user_id,
    client_event_id
  )
  values (
    campaign_row.organization_id,
    item_row.user_id,
    'access_review',
    campaign_row.id,
    'review_decided',
    trim(p_decision_note),
    jsonb_build_object(
      'reviewItemId', item_row.id,
      'decisionState', p_decision_state,
      'pendingCount', pending_count
    ),
    p_actor_user_id,
    p_client_event_id
  );

  return jsonb_build_object(
    'id', item_row.id,
    'decisionState', p_decision_state,
    'pendingCount', pending_count,
    'campaignState', case when pending_count = 0 then 'completed' else 'open' end,
    'replayed', false
  );
end;
$$;
create or replace function public.service_save_approval_workflow(
  p_organization_id uuid,
  p_actor_user_id uuid,
  p_workflow_key text,
  p_name text,
  p_subject_type text,
  p_description text,
  p_expiry_minutes integer,
  p_prevent_requester_approval boolean,
  p_prevent_cross_stage_actor boolean,
  p_stages_json jsonb,
  p_client_event_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  workflow_row public.approval_workflows%rowtype;
  workflow_version public.approval_workflow_versions%rowtype;
  replayed_version public.approval_workflow_versions%rowtype;
  stage_value jsonb;
  stage_number integer := 0;
  next_version integer;
  definition_digest text;
begin
  select *
  into replayed_version
  from public.approval_workflow_versions
  where client_event_id = p_client_event_id;
  if found then
    return jsonb_build_object(
      'id', replayed_version.approval_workflow_id,
      'versionId', replayed_version.id,
      'versionNumber', replayed_version.version_number,
      'definitionDigestSha256', replayed_version.definition_digest_sha256,
      'replayed', true
    );
  end if;

  if not public.service_user_has_organization_permission(
    p_organization_id, p_actor_user_id, 'approvals.configure'
  ) then
    raise exception using errcode = '42501', message = 'organization_permission_required';
  end if;

  if p_workflow_key !~ '^[a-z][a-z0-9_.:-]{1,99}$'
     or nullif(trim(p_name), '') is null
     or p_subject_type !~ '^[a-z][a-z0-9_.:-]{1,99}$'
     or nullif(trim(p_description), '') is null
     or p_expiry_minutes not between 15 and 43200
     or jsonb_typeof(p_stages_json) <> 'array'
     or jsonb_array_length(p_stages_json) not between 1 and 20 then
    raise exception using errcode = '22023', message = 'approval_workflow_input_invalid';
  end if;

  for stage_value in select value from jsonb_array_elements(p_stages_json)
  loop
    stage_number := stage_number + 1;
    if jsonb_typeof(stage_value) <> 'object'
       or nullif(trim(stage_value->>'name'), '') is null
       or coalesce((stage_value->>'requiredApprovals')::integer, 0) not between 1 and 10
       or not exists (
         select 1
         from public.organization_permission_catalog catalog
         where catalog.permission_code = stage_value->>'requiredPermissionCode'
           and catalog.is_active
       ) then
      raise exception using errcode = '22023', message = 'approval_workflow_stage_input_invalid';
    end if;
  end loop;

  definition_digest := encode(
    public.digest(
      convert_to(
        jsonb_build_object(
          'workflowKey', p_workflow_key,
          'name', trim(p_name),
          'subjectType', p_subject_type,
          'description', trim(p_description),
          'expiryMinutes', p_expiry_minutes,
          'preventRequesterApproval', coalesce(p_prevent_requester_approval, true),
          'preventCrossStageActor', coalesce(p_prevent_cross_stage_actor, true),
          'stages', p_stages_json
        )::text,
        'UTF8'
      ),
      'sha256'
    ),
    'hex'
  );

  insert into public.approval_workflows (
    organization_id, workflow_key, created_by_user_id
  )
  values (
    p_organization_id, p_workflow_key, p_actor_user_id
  )
  on conflict (organization_id, workflow_key) do update
  set workflow_key = excluded.workflow_key
  returning * into workflow_row;

  if workflow_row.workflow_state <> 'active' then
    raise exception using errcode = 'P0001', message = 'approval_workflow_archived';
  end if;

  select coalesce(max(version.version_number), 0) + 1
  into next_version
  from public.approval_workflow_versions version
  where version.approval_workflow_id = workflow_row.id;

  update public.approval_workflow_versions
  set version_state = 'superseded'
  where approval_workflow_id = workflow_row.id
    and version_state = 'active';

  insert into public.approval_workflow_versions (
    approval_workflow_id,
    version_number,
    name,
    subject_type,
    description,
    expiry_minutes,
    prevent_requester_approval,
    prevent_cross_stage_actor,
    definition_digest_sha256,
    created_by_user_id,
    client_event_id
  )
  values (
    workflow_row.id,
    next_version,
    trim(p_name),
    p_subject_type,
    trim(p_description),
    p_expiry_minutes,
    coalesce(p_prevent_requester_approval, true),
    coalesce(p_prevent_cross_stage_actor, true),
    definition_digest,
    p_actor_user_id,
    p_client_event_id
  )
  returning * into workflow_version;

  stage_number := 0;
  for stage_value in select value from jsonb_array_elements(p_stages_json)
  loop
    stage_number := stage_number + 1;
    insert into public.approval_workflow_stages (
      approval_workflow_version_id,
      stage_number,
      name,
      required_approvals,
      required_permission_code,
      allow_requester,
      allow_previous_stage_actor
    )
    values (
      workflow_version.id,
      stage_number,
      trim(stage_value->>'name'),
      (stage_value->>'requiredApprovals')::smallint,
      stage_value->>'requiredPermissionCode',
      coalesce((stage_value->>'allowRequester')::boolean, false),
      coalesce((stage_value->>'allowPreviousStageActor')::boolean, false)
    );
  end loop;

  return jsonb_build_object(
    'id', workflow_row.id,
    'workflowKey', workflow_row.workflow_key,
    'versionId', workflow_version.id,
    'versionNumber', workflow_version.version_number,
    'name', workflow_version.name,
    'subjectType', workflow_version.subject_type,
    'stageCount', jsonb_array_length(p_stages_json),
    'definitionDigestSha256', definition_digest,
    'replayed', false
  );
end;
$$;
create or replace function public.service_create_approval_request(
  p_organization_id uuid,
  p_actor_user_id uuid,
  p_workflow_key text,
  p_subject_type text,
  p_subject_id uuid,
  p_payload_json jsonb,
  p_client_event_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  workflow_version public.approval_workflow_versions%rowtype;
  request_row public.approval_requests%rowtype;
  replayed_request public.approval_requests%rowtype;
  payload_digest text;
begin
  select *
  into replayed_request
  from public.approval_requests
  where client_event_id = p_client_event_id;
  if found then
    return jsonb_build_object(
      'id', replayed_request.id,
      'requestState', replayed_request.request_state,
      'payloadDigestSha256', replayed_request.payload_digest_sha256,
      'replayed', true
    );
  end if;

  if not public.service_user_has_organization_permission(
    p_organization_id, p_actor_user_id, 'approvals.request'
  ) then
    raise exception using errcode = '42501', message = 'organization_permission_required';
  end if;

  select version.*
  into workflow_version
  from public.approval_workflows workflow
  join public.approval_workflow_versions version
    on version.approval_workflow_id = workflow.id
   and version.version_state = 'active'
  where workflow.organization_id = p_organization_id
    and workflow.workflow_key = p_workflow_key
    and workflow.workflow_state = 'active';

  if not found
     or workflow_version.subject_type is distinct from p_subject_type
     or p_subject_id is null
     or jsonb_typeof(coalesce(p_payload_json, '{}'::jsonb)) <> 'object' then
    raise exception using errcode = '22023', message = 'approval_request_input_invalid';
  end if;

  payload_digest := encode(
    public.digest(
      convert_to(
        jsonb_build_object(
          'workflowVersionId', workflow_version.id,
          'subjectType', p_subject_type,
          'subjectId', p_subject_id,
          'payload', coalesce(p_payload_json, '{}'::jsonb)
        )::text,
        'UTF8'
      ),
      'sha256'
    ),
    'hex'
  );

  insert into public.approval_requests (
    organization_id,
    approval_workflow_version_id,
    subject_type,
    subject_id,
    payload_json,
    payload_digest_sha256,
    requested_by_user_id,
    client_event_id,
    due_at
  )
  values (
    p_organization_id,
    workflow_version.id,
    p_subject_type,
    p_subject_id,
    coalesce(p_payload_json, '{}'::jsonb),
    payload_digest,
    p_actor_user_id,
    p_client_event_id,
    clock_timestamp() + make_interval(mins => workflow_version.expiry_minutes)
  )
  returning * into request_row;

  insert into public.approval_request_events (
    approval_request_id,
    sequence_number,
    action_type,
    note,
    metadata_json,
    actor_user_id,
    client_event_id
  )
  values (
    request_row.id,
    1,
    'requested',
    'Approval requested.',
    jsonb_build_object(
      'workflowVersionId', workflow_version.id,
      'payloadDigestSha256', payload_digest,
      'dueAt', request_row.due_at
    ),
    p_actor_user_id,
    p_client_event_id
  );

  return jsonb_build_object(
    'id', request_row.id,
    'requestState', request_row.request_state,
    'currentStageNumber', request_row.current_stage_number,
    'payloadDigestSha256', request_row.payload_digest_sha256,
    'dueAt', request_row.due_at,
    'replayed', false
  );
end;
$$;
create or replace function public.service_decide_approval_request(
  p_approval_request_id uuid,
  p_actor_user_id uuid,
  p_decision text,
  p_decision_note text,
  p_client_event_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  request_row public.approval_requests%rowtype;
  workflow_version public.approval_workflow_versions%rowtype;
  stage_row public.approval_workflow_stages%rowtype;
  replayed_decision public.approval_request_decisions%rowtype;
  replayed_event public.approval_request_events%rowtype;
  approval_count integer;
  next_stage_number integer;
  next_sequence integer;
  resulting_state text;
begin
  select *
  into replayed_event
  from public.approval_request_events
  where client_event_id = p_client_event_id;
  if found then
    select *
    into request_row
    from public.approval_requests
    where id = replayed_event.approval_request_id;
    return jsonb_build_object(
      'requestId', request_row.id,
      'requestState', request_row.request_state,
      'currentStageNumber', request_row.current_stage_number,
      'actionType', replayed_event.action_type,
      'replayed', true
    );
  end if;

  select *
  into replayed_decision
  from public.approval_request_decisions
  where client_event_id = p_client_event_id;
  if found then
    return jsonb_build_object(
      'id', replayed_decision.id,
      'requestId', replayed_decision.approval_request_id,
      'stageNumber', replayed_decision.stage_number,
      'decision', replayed_decision.decision,
      'replayed', true
    );
  end if;

  select *
  into request_row
  from public.approval_requests
  where id = p_approval_request_id
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'approval_request_not_found';
  end if;

  select *
  into workflow_version
  from public.approval_workflow_versions
  where id = request_row.approval_workflow_version_id;
  select *
  into stage_row
  from public.approval_workflow_stages
  where approval_workflow_version_id = workflow_version.id
    and stage_number = request_row.current_stage_number;

  if request_row.request_state <> 'pending' then
    raise exception using errcode = 'P0001', message = 'approval_request_not_pending';
  end if;
  if request_row.due_at <= clock_timestamp() then
    update public.approval_requests
    set request_state = 'expired',
        decided_at = clock_timestamp()
    where id = request_row.id;
    select coalesce(max(event.sequence_number), 0) + 1
    into next_sequence
    from public.approval_request_events event
    where event.approval_request_id = request_row.id;
    insert into public.approval_request_events (
      approval_request_id,
      sequence_number,
      action_type,
      note,
      actor_user_id,
      client_event_id
    )
    values (
      request_row.id,
      next_sequence,
      'expired',
      'Approval request expired before a decision could be recorded.',
      p_actor_user_id,
      p_client_event_id
    );
    return jsonb_build_object(
      'requestId', request_row.id,
      'requestState', 'expired',
      'currentStageNumber', request_row.current_stage_number,
      'replayed', false
    );
  end if;
  if p_decision not in ('approved', 'rejected')
     or nullif(trim(p_decision_note), '') is null then
    raise exception using errcode = '22023', message = 'approval_decision_input_invalid';
  end if;
  if not public.service_user_has_organization_permission(
    request_row.organization_id,
    p_actor_user_id,
    stage_row.required_permission_code
  ) then
    raise exception using errcode = '42501', message = 'approval_stage_permission_required';
  end if;
  if workflow_version.prevent_requester_approval
     and not stage_row.allow_requester
     and request_row.requested_by_user_id = p_actor_user_id then
    raise exception using errcode = '42501', message = 'approval_requester_cannot_decide';
  end if;
  if workflow_version.prevent_cross_stage_actor
     and not stage_row.allow_previous_stage_actor
     and exists (
       select 1
       from public.approval_request_decisions previous_decision
       where previous_decision.approval_request_id = request_row.id
         and previous_decision.stage_number < request_row.current_stage_number
         and previous_decision.actor_user_id = p_actor_user_id
     ) then
    raise exception using errcode = '42501', message = 'approval_cross_stage_actor_forbidden';
  end if;

  begin
    insert into public.approval_request_decisions (
      approval_request_id,
      stage_number,
      decision,
      decision_note,
      actor_user_id,
      client_event_id
    )
    values (
      request_row.id,
      request_row.current_stage_number,
      p_decision,
      trim(p_decision_note),
      p_actor_user_id,
      p_client_event_id
    );
  exception
    when unique_violation then
      raise exception using errcode = 'P0001', message = 'approval_actor_already_decided_stage';
  end;

  select coalesce(max(event.sequence_number), 0) + 1
  into next_sequence
  from public.approval_request_events event
  where event.approval_request_id = request_row.id;
  insert into public.approval_request_events (
    approval_request_id,
    sequence_number,
    action_type,
    note,
    metadata_json,
    actor_user_id,
    client_event_id
  )
  values (
    request_row.id,
    next_sequence,
    'decision',
    trim(p_decision_note),
    jsonb_build_object(
      'stageNumber', request_row.current_stage_number,
      'decision', p_decision
    ),
    p_actor_user_id,
    p_client_event_id
  );

  if p_decision = 'rejected' then
    update public.approval_requests
    set request_state = 'rejected',
        decided_at = clock_timestamp()
    where id = request_row.id;
    resulting_state := 'rejected';
  else
    select count(*)::integer
    into approval_count
    from public.approval_request_decisions decision
    where decision.approval_request_id = request_row.id
      and decision.stage_number = request_row.current_stage_number
      and decision.decision = 'approved';

    if approval_count >= stage_row.required_approvals then
      select min(stage.stage_number)::integer
      into next_stage_number
      from public.approval_workflow_stages stage
      where stage.approval_workflow_version_id = workflow_version.id
        and stage.stage_number > request_row.current_stage_number;

      if next_stage_number is null then
        update public.approval_requests
        set request_state = 'approved',
            decided_at = clock_timestamp()
        where id = request_row.id;
        resulting_state := 'approved';
      else
        update public.approval_requests
        set current_stage_number = next_stage_number
        where id = request_row.id;
        resulting_state := 'pending';
      end if;
    else
      resulting_state := 'pending';
    end if;
  end if;

  if resulting_state in ('approved', 'rejected')
     or (
       resulting_state = 'pending'
       and next_stage_number is not null
       and next_stage_number <> request_row.current_stage_number
     ) then
    select coalesce(max(event.sequence_number), 0) + 1
    into next_sequence
    from public.approval_request_events event
    where event.approval_request_id = request_row.id;
    insert into public.approval_request_events (
      approval_request_id,
      sequence_number,
      action_type,
      note,
      metadata_json,
      actor_user_id
    )
    values (
      request_row.id,
      next_sequence,
      case
        when resulting_state = 'approved' then 'approved'
        when resulting_state = 'rejected' then 'rejected'
        else 'stage_advanced'
      end,
      case
        when resulting_state = 'approved' then 'All approval stages completed.'
        when resulting_state = 'rejected' then 'Approval request rejected.'
        else 'Approval advanced to stage ' || next_stage_number || '.'
      end,
      jsonb_build_object(
        'fromStage', request_row.current_stage_number,
        'toStage', next_stage_number,
        'requestState', resulting_state
      ),
      p_actor_user_id
    );
  end if;

  return jsonb_build_object(
    'requestId', request_row.id,
    'stageNumber', request_row.current_stage_number,
    'decision', p_decision,
    'requestState', resulting_state,
    'currentStageNumber', coalesce(next_stage_number, request_row.current_stage_number),
    'replayed', false
  );
end;
$$;
create or replace function public.service_execute_approval_request(
  p_approval_request_id uuid,
  p_actor_user_id uuid,
  p_execution_note text,
  p_client_event_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  request_row public.approval_requests%rowtype;
  next_sequence integer;
begin
  select *
  into request_row
  from public.approval_requests
  where id = p_approval_request_id
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'approval_request_not_found';
  end if;
  if not public.service_user_has_organization_permission(
    request_row.organization_id, p_actor_user_id, 'approvals.execute'
  ) then
    raise exception using errcode = '42501', message = 'organization_permission_required';
  end if;
  if request_row.request_state = 'executed' then
    return jsonb_build_object(
      'id', request_row.id,
      'requestState', request_row.request_state,
      'replayed', true
    );
  end if;
  if request_row.request_state <> 'approved'
     or nullif(trim(p_execution_note), '') is null then
    raise exception using errcode = 'P0001', message = 'approved_request_execution_required';
  end if;

  update public.approval_requests
  set request_state = 'executed',
      executed_at = clock_timestamp()
  where id = request_row.id;

  select coalesce(max(event.sequence_number), 0) + 1
  into next_sequence
  from public.approval_request_events event
  where event.approval_request_id = request_row.id;
  insert into public.approval_request_events (
    approval_request_id,
    sequence_number,
    action_type,
    note,
    actor_user_id,
    client_event_id
  )
  values (
    request_row.id,
    next_sequence,
    'executed',
    trim(p_execution_note),
    p_actor_user_id,
    p_client_event_id
  );

  return jsonb_build_object(
    'id', request_row.id,
    'requestState', 'executed',
    'executedAt', clock_timestamp(),
    'replayed', false
  );
end;
$$;
create or replace function public.enforce_result_publication_actor_permissions()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_table_name = 'result_publication_approvals' then
    if not public.service_user_has_organization_permission(
      new.organization_id,
      new.actor_user_id,
      'results.publication.approve'
    ) then
      raise exception using errcode = '42501', message = 'result_publication_approval_permission_required';
    end if;
  elsif new.publication_state in ('official', 'corrected') then
    if not public.service_user_has_organization_permission(
      (
        select series.organization_id
        from public.event_categories category
        join public.event_editions edition on edition.id = category.event_edition_id
        join public.event_series series on series.id = edition.event_series_id
        where category.id = new.event_category_id
      ),
      new.published_by_user_id,
      'results.publish'
    ) then
      raise exception using errcode = '42501', message = 'result_publication_permission_required';
    end if;
  end if;
  return new;
end;
$$;
create trigger result_publication_approvals_actor_permission
before insert on public.result_publication_approvals
for each row execute function public.enforce_result_publication_actor_permissions();
create trigger result_publications_actor_permission
before insert on public.result_publications
for each row execute function public.enforce_result_publication_actor_permissions();
alter table public.organization_permission_catalog enable row level security;
alter table public.organization_custom_roles enable row level security;
alter table public.organization_custom_role_versions enable row level security;
alter table public.organization_custom_role_permissions enable row level security;
alter table public.organization_member_role_assignments enable row level security;
alter table public.organization_direct_permission_grants enable row level security;
alter table public.organization_access_events enable row level security;
alter table public.organization_access_review_campaigns enable row level security;
alter table public.organization_access_review_items enable row level security;
alter table public.approval_workflows enable row level security;
alter table public.approval_workflow_versions enable row level security;
alter table public.approval_workflow_stages enable row level security;
alter table public.approval_requests enable row level security;
alter table public.approval_request_decisions enable row level security;
alter table public.approval_request_events enable row level security;
revoke all on table public.organization_permission_catalog from public, anon, authenticated;
revoke all on table public.organization_custom_roles from public, anon, authenticated;
revoke all on table public.organization_custom_role_versions from public, anon, authenticated;
revoke all on table public.organization_custom_role_permissions from public, anon, authenticated;
revoke all on table public.organization_member_role_assignments from public, anon, authenticated;
revoke all on table public.organization_direct_permission_grants from public, anon, authenticated;
revoke all on table public.organization_access_events from public, anon, authenticated;
revoke all on table public.organization_access_review_campaigns from public, anon, authenticated;
revoke all on table public.organization_access_review_items from public, anon, authenticated;
revoke all on table public.approval_workflows from public, anon, authenticated;
revoke all on table public.approval_workflow_versions from public, anon, authenticated;
revoke all on table public.approval_workflow_stages from public, anon, authenticated;
revoke all on table public.approval_requests from public, anon, authenticated;
revoke all on table public.approval_request_decisions from public, anon, authenticated;
revoke all on table public.approval_request_events from public, anon, authenticated;
grant all on table public.organization_permission_catalog to service_role;
grant all on table public.organization_custom_roles to service_role;
grant all on table public.organization_custom_role_versions to service_role;
grant all on table public.organization_custom_role_permissions to service_role;
grant all on table public.organization_member_role_assignments to service_role;
grant all on table public.organization_direct_permission_grants to service_role;
grant all on table public.organization_access_events to service_role;
grant all on table public.organization_access_review_campaigns to service_role;
grant all on table public.organization_access_review_items to service_role;
grant all on table public.approval_workflows to service_role;
grant all on table public.approval_workflow_versions to service_role;
grant all on table public.approval_workflow_stages to service_role;
grant all on table public.approval_requests to service_role;
grant all on table public.approval_request_decisions to service_role;
grant all on table public.approval_request_events to service_role;
revoke all on function public.service_user_has_organization_permission(
  uuid, uuid, text, text, uuid, timestamptz
) from public, anon, authenticated;
revoke all on function public.service_save_organization_custom_role(
  uuid, uuid, text, text, text, text[], uuid
) from public, anon, authenticated;
revoke all on function public.service_assign_organization_custom_role(
  uuid, uuid, uuid, uuid, text, uuid, timestamptz, timestamptz, uuid
) from public, anon, authenticated;
revoke all on function public.service_revoke_organization_custom_role_assignment(
  uuid, uuid, text, uuid
) from public, anon, authenticated;
revoke all on function public.service_grant_temporary_organization_permission(
  uuid, uuid, uuid, text, text, uuid, text, timestamptz, timestamptz, uuid
) from public, anon, authenticated;
revoke all on function public.service_revoke_temporary_organization_permission(
  uuid, uuid, text, uuid
) from public, anon, authenticated;
revoke all on function public.service_create_organization_access_review(
  uuid, uuid, text, timestamptz, uuid
) from public, anon, authenticated;
revoke all on function public.service_decide_organization_access_review_item(
  uuid, uuid, text, text, uuid
) from public, anon, authenticated;
revoke all on function public.service_save_approval_workflow(
  uuid, uuid, text, text, text, text, integer, boolean, boolean, jsonb, uuid
) from public, anon, authenticated;
revoke all on function public.service_create_approval_request(
  uuid, uuid, text, text, uuid, jsonb, uuid
) from public, anon, authenticated;
revoke all on function public.service_decide_approval_request(
  uuid, uuid, text, text, uuid
) from public, anon, authenticated;
revoke all on function public.service_execute_approval_request(
  uuid, uuid, text, uuid
) from public, anon, authenticated;
grant execute on function public.service_user_has_organization_permission(
  uuid, uuid, text, text, uuid, timestamptz
) to service_role;
grant execute on function public.service_save_organization_custom_role(
  uuid, uuid, text, text, text, text[], uuid
) to service_role;
grant execute on function public.service_assign_organization_custom_role(
  uuid, uuid, uuid, uuid, text, uuid, timestamptz, timestamptz, uuid
) to service_role;
grant execute on function public.service_revoke_organization_custom_role_assignment(
  uuid, uuid, text, uuid
) to service_role;
grant execute on function public.service_grant_temporary_organization_permission(
  uuid, uuid, uuid, text, text, uuid, text, timestamptz, timestamptz, uuid
) to service_role;
grant execute on function public.service_revoke_temporary_organization_permission(
  uuid, uuid, text, uuid
) to service_role;
grant execute on function public.service_create_organization_access_review(
  uuid, uuid, text, timestamptz, uuid
) to service_role;
grant execute on function public.service_decide_organization_access_review_item(
  uuid, uuid, text, text, uuid
) to service_role;
grant execute on function public.service_save_approval_workflow(
  uuid, uuid, text, text, text, text, integer, boolean, boolean, jsonb, uuid
) to service_role;
grant execute on function public.service_create_approval_request(
  uuid, uuid, text, text, uuid, jsonb, uuid
) to service_role;
grant execute on function public.service_decide_approval_request(
  uuid, uuid, text, text, uuid
) to service_role;
grant execute on function public.service_execute_approval_request(
  uuid, uuid, text, uuid
) to service_role;
