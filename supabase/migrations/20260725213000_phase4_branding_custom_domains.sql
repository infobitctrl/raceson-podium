/*
 * Premium brand studio and custom-domain control plane.
 *
 * Brand and edition presentation changes are immutable versions. Domain
 * ownership, certificate, activation, degradation, and disablement transitions
 * retain append-only evidence. Browser roles cannot call service commands or
 * read organizer configuration directly; the API uses the service role and
 * enforces branding.manage.
 */

create table public.organizer_brand_assets (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete restrict,
  label text not null,
  asset_kind text not null,
  object_reference text not null,
  public_url text not null,
  media_type text not null,
  byte_size bigint,
  width_px integer,
  height_px integer,
  alt_text text not null,
  checksum_sha256 text,
  asset_state text not null default 'active',
  created_by_user_id uuid not null,
  retired_by_user_id uuid,
  retired_at timestamptz,
  retirement_reason text,
  client_event_id uuid not null unique,
  created_at timestamptz not null default clock_timestamp(),
  unique (organization_id, object_reference),
  check (length(trim(label)) between 1 and 160),
  check (asset_kind in ('logo', 'favicon', 'cover', 'social', 'sponsor', 'document_mark')),
  check (length(trim(object_reference)) between 1 and 1000),
  check (public_url ~ '^https://'),
  check (media_type in ('image/png', 'image/jpeg', 'image/webp', 'image/svg+xml', 'image/x-icon')),
  check (byte_size is null or byte_size between 1 and 52428800),
  check (width_px is null or width_px between 1 and 20000),
  check (height_px is null or height_px between 1 and 20000),
  check (length(trim(alt_text)) between 1 and 500),
  check (checksum_sha256 is null or checksum_sha256 ~ '^[0-9a-f]{64}$'),
  check (asset_state in ('active', 'retired')),
  check (
    (asset_state = 'active' and retired_by_user_id is null and retired_at is null and retirement_reason is null)
    or
    (
      asset_state = 'retired'
      and retired_by_user_id is not null
      and retired_at is not null
      and length(trim(retirement_reason)) > 0
    )
  )
);
create index organizer_brand_assets_org_state_idx
  on public.organizer_brand_assets (organization_id, asset_state, created_at desc);
create table public.organizer_brand_versions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete restrict,
  version_number integer not null,
  version_name text not null,
  logo_asset_id uuid references public.organizer_brand_assets (id) on delete restrict,
  favicon_asset_id uuid references public.organizer_brand_assets (id) on delete restrict,
  primary_color text not null,
  accent_color text not null,
  background_color text not null,
  foreground_color text not null,
  muted_color text not null,
  success_color text not null,
  heading_font text not null,
  body_font text not null,
  corner_style text not null,
  wordmark text not null,
  footer_text text,
  social_links_json jsonb not null default '{}'::jsonb,
  content_digest_sha256 text not null,
  created_by_user_id uuid not null,
  client_event_id uuid not null unique,
  created_at timestamptz not null default clock_timestamp(),
  unique (organization_id, version_number),
  check (version_number > 0),
  check (length(trim(version_name)) between 1 and 160),
  check (primary_color ~ '^#[0-9A-Fa-f]{6}$'),
  check (accent_color ~ '^#[0-9A-Fa-f]{6}$'),
  check (background_color ~ '^#[0-9A-Fa-f]{6}$'),
  check (foreground_color ~ '^#[0-9A-Fa-f]{6}$'),
  check (muted_color ~ '^#[0-9A-Fa-f]{6}$'),
  check (success_color ~ '^#[0-9A-Fa-f]{6}$'),
  check (heading_font in ('Inter', 'Manrope', 'DM Sans', 'IBM Plex Sans', 'system-ui')),
  check (body_font in ('Inter', 'Manrope', 'DM Sans', 'IBM Plex Sans', 'system-ui')),
  check (corner_style in ('sharp', 'soft', 'rounded')),
  check (length(trim(wordmark)) between 1 and 80),
  check (footer_text is null or length(trim(footer_text)) between 1 and 500),
  check (jsonb_typeof(social_links_json) = 'object'),
  check (content_digest_sha256 ~ '^[0-9a-f]{64}$')
);
create index organizer_brand_versions_org_version_idx
  on public.organizer_brand_versions (organization_id, version_number desc);
create table public.organizer_event_presentation_versions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete restrict,
  event_edition_id uuid not null references public.event_editions (id) on delete restrict,
  version_number integer not null,
  brand_version_id uuid references public.organizer_brand_versions (id) on delete restrict,
  cover_asset_id uuid references public.organizer_brand_assets (id) on delete restrict,
  social_image_asset_id uuid references public.organizer_brand_assets (id) on delete restrict,
  seo_title text,
  seo_description text,
  public_links_json jsonb not null default '[]'::jsonb,
  theme_overrides_json jsonb not null default '{}'::jsonb,
  sponsor_entries_json jsonb not null default '[]'::jsonb,
  content_digest_sha256 text not null,
  created_by_user_id uuid not null,
  client_event_id uuid not null unique,
  created_at timestamptz not null default clock_timestamp(),
  unique (event_edition_id, version_number),
  check (version_number > 0),
  check (seo_title is null or length(trim(seo_title)) between 1 and 70),
  check (seo_description is null or length(trim(seo_description)) between 1 and 180),
  check (jsonb_typeof(public_links_json) = 'array'),
  check (jsonb_array_length(public_links_json) <= 24),
  check (jsonb_typeof(theme_overrides_json) = 'object'),
  check (jsonb_typeof(sponsor_entries_json) = 'array'),
  check (jsonb_array_length(sponsor_entries_json) <= 48),
  check (content_digest_sha256 ~ '^[0-9a-f]{64}$')
);
create index organizer_event_presentation_versions_edition_idx
  on public.organizer_event_presentation_versions (event_edition_id, version_number desc);
create table public.organizer_custom_domains (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete restrict,
  hostname text not null unique,
  target_type text not null,
  event_edition_id uuid references public.event_editions (id) on delete restrict,
  canonical_redirect boolean not null default true,
  domain_state text not null default 'pending_dns',
  ownership_status text not null default 'pending',
  tls_status text not null default 'not_requested',
  verification_record_name text not null,
  verification_record_value text not null,
  routing_cname_target text not null,
  provider_reference text,
  last_checked_at timestamptz,
  ownership_verified_at timestamptz,
  certificate_ready_at timestamptz,
  activated_at timestamptz,
  disabled_at timestamptz,
  disabled_by_user_id uuid,
  disable_reason text,
  created_by_user_id uuid not null,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  check (target_type in ('organization', 'event_edition')),
  check (
    (target_type = 'organization' and event_edition_id is null)
    or
    (target_type = 'event_edition' and event_edition_id is not null)
  ),
  check (domain_state in ('pending_dns', 'verification_failed', 'certificate_pending', 'active', 'degraded', 'disabled')),
  check (ownership_status in ('pending', 'verified', 'failed')),
  check (tls_status in ('not_requested', 'pending', 'ready', 'failed')),
  check (length(hostname) between 4 and 253),
  check (verification_record_name = '_sitrail-verification.' || hostname),
  check (verification_record_value ~ '^sitrail-domain-verification=[0-9a-f]{48}$'),
  check (routing_cname_target ~ '^[a-z0-9][a-z0-9.-]*[a-z0-9]$'),
  check (
    domain_state <> 'active'
    or (
      ownership_status = 'verified'
      and tls_status = 'ready'
      and ownership_verified_at is not null
      and certificate_ready_at is not null
      and activated_at is not null
    )
  ),
  check (
    domain_state <> 'disabled'
    or (
      disabled_at is not null
      and disabled_by_user_id is not null
      and length(trim(disable_reason)) > 0
    )
  )
);
create index organizer_custom_domains_org_state_idx
  on public.organizer_custom_domains (organization_id, domain_state, updated_at desc);
create table public.organizer_custom_domain_events (
  id uuid primary key default gen_random_uuid(),
  custom_domain_id uuid not null references public.organizer_custom_domains (id) on delete restrict,
  sequence_number integer not null,
  event_type text not null,
  note text not null,
  evidence_json jsonb not null default '{}'::jsonb,
  actor_user_id uuid,
  client_event_id uuid unique,
  created_at timestamptz not null default clock_timestamp(),
  unique (custom_domain_id, sequence_number),
  check (event_type in (
    'verification_requested',
    'verification_failed',
    'ownership_verified',
    'certificate_pending',
    'certificate_ready',
    'certificate_failed',
    'activated',
    'disabled'
  )),
  check (length(trim(note)) between 1 and 2000),
  check (jsonb_typeof(evidence_json) = 'object')
);
create index organizer_custom_domain_events_domain_sequence_idx
  on public.organizer_custom_domain_events (custom_domain_id, sequence_number desc);
create or replace function public.prevent_brand_version_or_domain_event_change()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception using errcode = '55000', message = 'brand_or_domain_evidence_is_append_only';
end;
$$;
create trigger organizer_brand_versions_immutable
before update or delete on public.organizer_brand_versions
for each row execute function public.prevent_brand_version_or_domain_event_change();
create trigger organizer_event_presentation_versions_immutable
before update or delete on public.organizer_event_presentation_versions
for each row execute function public.prevent_brand_version_or_domain_event_change();
create trigger organizer_custom_domain_events_immutable
before update or delete on public.organizer_custom_domain_events
for each row execute function public.prevent_brand_version_or_domain_event_change();
create or replace function public.protect_brand_asset()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    raise exception using errcode = '55000', message = 'brand_asset_delete_forbidden';
  end if;
  if new.organization_id is distinct from old.organization_id
     or new.label is distinct from old.label
     or new.asset_kind is distinct from old.asset_kind
     or new.object_reference is distinct from old.object_reference
     or new.public_url is distinct from old.public_url
     or new.media_type is distinct from old.media_type
     or new.byte_size is distinct from old.byte_size
     or new.width_px is distinct from old.width_px
     or new.height_px is distinct from old.height_px
     or new.alt_text is distinct from old.alt_text
     or new.checksum_sha256 is distinct from old.checksum_sha256
     or new.created_by_user_id is distinct from old.created_by_user_id
     or new.client_event_id is distinct from old.client_event_id
     or new.created_at is distinct from old.created_at then
    raise exception using errcode = '55000', message = 'brand_asset_identity_is_immutable';
  end if;
  if old.asset_state = 'retired' and new is distinct from old then
    raise exception using errcode = '55000', message = 'retired_brand_asset_is_immutable';
  end if;
  if old.asset_state = 'active' and new.asset_state not in ('active', 'retired') then
    raise exception using errcode = '55000', message = 'brand_asset_transition_invalid';
  end if;
  return new;
end;
$$;
create trigger organizer_brand_assets_protected
before update or delete on public.organizer_brand_assets
for each row execute function public.protect_brand_asset();
create or replace function public.protect_custom_domain_identity()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    raise exception using errcode = '55000', message = 'custom_domain_delete_forbidden';
  end if;
  if new.organization_id is distinct from old.organization_id
     or new.hostname is distinct from old.hostname
     or new.target_type is distinct from old.target_type
     or new.event_edition_id is distinct from old.event_edition_id
     or new.created_by_user_id is distinct from old.created_by_user_id
     or new.created_at is distinct from old.created_at then
    raise exception using errcode = '55000', message = 'custom_domain_identity_is_immutable';
  end if;
  if old.domain_state = 'active'
     and new.domain_state not in ('active', 'degraded', 'disabled') then
    raise exception using errcode = '55000', message = 'custom_domain_transition_invalid';
  end if;
  if old.domain_state = 'disabled' and new.domain_state not in ('disabled', 'pending_dns') then
    raise exception using errcode = '55000', message = 'custom_domain_transition_invalid';
  end if;
  return new;
end;
$$;
create trigger organizer_custom_domains_protected
before update or delete on public.organizer_custom_domains
for each row execute function public.protect_custom_domain_identity();
create or replace function public.normalize_custom_domain_hostname(p_hostname text)
returns text
language sql
immutable
strict
set search_path = ''
as $$
  select lower(regexp_replace(trim(p_hostname), '\.+$', ''));
$$;
create or replace function public.brand_asset_json(p_asset_id uuid)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select case
    when asset.id is null then null
    else jsonb_build_object(
      'id', asset.id,
      'label', asset.label,
      'kind', asset.asset_kind,
      'url', asset.public_url,
      'mediaType', asset.media_type,
      'widthPx', asset.width_px,
      'heightPx', asset.height_px,
      'altText', asset.alt_text,
      'checksumSha256', asset.checksum_sha256,
      'state', asset.asset_state
    )
  end
  from (select 1) anchor
  left join public.organizer_brand_assets asset on asset.id = p_asset_id;
$$;
create or replace function public.service_register_brand_asset(
  p_organization_id uuid,
  p_actor_user_id uuid,
  p_label text,
  p_asset_kind text,
  p_object_reference text,
  p_public_url text,
  p_media_type text,
  p_byte_size bigint,
  p_width_px integer,
  p_height_px integer,
  p_alt_text text,
  p_checksum_sha256 text,
  p_client_event_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  asset_row public.organizer_brand_assets%rowtype;
begin
  if not public.service_user_has_organization_permission(
    p_organization_id, p_actor_user_id, 'branding.manage', 'organization', null, clock_timestamp()
  ) then
    raise exception using errcode = '42501', message = 'organization_permission_required';
  end if;
  if p_client_event_id is null then
    raise exception using errcode = '22023', message = 'brand_asset_input_invalid';
  end if;

  select * into asset_row
  from public.organizer_brand_assets
  where client_event_id = p_client_event_id;
  if found then
    if asset_row.organization_id <> p_organization_id
       or asset_row.object_reference <> trim(p_object_reference) then
      raise exception using errcode = '23505', message = 'idempotency_key_reused';
    end if;
    return public.brand_asset_json(asset_row.id) || jsonb_build_object('replayed', true);
  end if;

  insert into public.organizer_brand_assets (
    organization_id, label, asset_kind, object_reference, public_url, media_type,
    byte_size, width_px, height_px, alt_text, checksum_sha256,
    created_by_user_id, client_event_id
  )
  values (
    p_organization_id, trim(p_label), p_asset_kind, trim(p_object_reference), trim(p_public_url),
    p_media_type, p_byte_size, p_width_px, p_height_px, trim(p_alt_text),
    nullif(lower(trim(p_checksum_sha256)), ''), p_actor_user_id, p_client_event_id
  )
  returning * into asset_row;

  insert into public.audit_log (
    organization_id, actor_user_id, entity_type, entity_id, action, metadata_json
  )
  values (
    p_organization_id, p_actor_user_id, 'brand_asset', asset_row.id,
    'branding.asset_registered',
    jsonb_build_object('kind', asset_row.asset_kind, 'objectReference', asset_row.object_reference)
  );

  return public.brand_asset_json(asset_row.id) || jsonb_build_object('replayed', false);
exception
  when check_violation or not_null_violation then
    raise exception using errcode = '22023', message = 'brand_asset_input_invalid';
end;
$$;
create or replace function public.service_retire_brand_asset(
  p_asset_id uuid,
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
  asset_row public.organizer_brand_assets%rowtype;
begin
  select * into asset_row
  from public.organizer_brand_assets
  where id = p_asset_id
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'brand_asset_not_found';
  end if;
  if not public.service_user_has_organization_permission(
    asset_row.organization_id, p_actor_user_id, 'branding.manage', 'organization', null, clock_timestamp()
  ) then
    raise exception using errcode = '42501', message = 'organization_permission_required';
  end if;
  if p_reason is null or length(trim(p_reason)) < 3 or p_client_event_id is null then
    raise exception using errcode = '22023', message = 'brand_asset_retirement_input_invalid';
  end if;
  if exists (
    select 1 from public.audit_log audit
    where audit.entity_type = 'brand_asset'
      and audit.entity_id = p_asset_id
      and audit.action = 'branding.asset_retired'
      and audit.metadata_json->>'clientEventId' = p_client_event_id::text
  ) then
    return public.brand_asset_json(p_asset_id) || jsonb_build_object('replayed', true);
  end if;
  if asset_row.asset_state = 'retired' then
    raise exception using errcode = '55000', message = 'brand_asset_already_retired';
  end if;

  update public.organizer_brand_assets
  set asset_state = 'retired',
      retired_by_user_id = p_actor_user_id,
      retired_at = clock_timestamp(),
      retirement_reason = trim(p_reason)
  where id = p_asset_id;

  insert into public.audit_log (
    organization_id, actor_user_id, entity_type, entity_id, action, metadata_json
  )
  values (
    asset_row.organization_id, p_actor_user_id, 'brand_asset', p_asset_id,
    'branding.asset_retired',
    jsonb_build_object('reason', trim(p_reason), 'clientEventId', p_client_event_id)
  );

  return public.brand_asset_json(p_asset_id) || jsonb_build_object('replayed', false);
end;
$$;
create or replace function public.service_save_brand_version(
  p_organization_id uuid,
  p_actor_user_id uuid,
  p_version_name text,
  p_logo_asset_id uuid,
  p_favicon_asset_id uuid,
  p_primary_color text,
  p_accent_color text,
  p_background_color text,
  p_foreground_color text,
  p_muted_color text,
  p_success_color text,
  p_heading_font text,
  p_body_font text,
  p_corner_style text,
  p_wordmark text,
  p_footer_text text,
  p_social_links_json jsonb,
  p_client_event_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  version_row public.organizer_brand_versions%rowtype;
  next_version integer;
  content_json jsonb;
begin
  if not public.service_user_has_organization_permission(
    p_organization_id, p_actor_user_id, 'branding.manage', 'organization', null, clock_timestamp()
  ) then
    raise exception using errcode = '42501', message = 'organization_permission_required';
  end if;
  if p_client_event_id is null
     or coalesce(jsonb_typeof(p_social_links_json), '') <> 'object'
     or exists (
       select 1
       from jsonb_each_text(p_social_links_json) social_link
       where social_link.key not in ('website', 'instagram', 'facebook', 'youtube', 'linkedin')
          or social_link.value !~ '^https://'
          or length(social_link.value) > 1000
     )
     or exists (
       select 1
       from unnest(array[p_logo_asset_id, p_favicon_asset_id]) requested_id
       join public.organizer_brand_assets asset on asset.id = requested_id
       where requested_id is not null
         and (asset.organization_id <> p_organization_id or asset.asset_state <> 'active')
     )
     or exists (
       select 1
       from unnest(array[p_logo_asset_id, p_favicon_asset_id]) requested_id
       where requested_id is not null
         and not exists (
           select 1 from public.organizer_brand_assets asset where asset.id = requested_id
         )
     ) then
    raise exception using errcode = '22023', message = 'brand_version_input_invalid';
  end if;

  select * into version_row
  from public.organizer_brand_versions
  where client_event_id = p_client_event_id;
  if found then
    if version_row.organization_id <> p_organization_id then
      raise exception using errcode = '23505', message = 'idempotency_key_reused';
    end if;
    return jsonb_build_object(
      'id', version_row.id,
      'versionNumber', version_row.version_number,
      'contentDigestSha256', version_row.content_digest_sha256,
      'replayed', true
    );
  end if;

  perform pg_advisory_xact_lock(hashtextextended('brand-version:' || p_organization_id::text, 0));
  select coalesce(max(version_number), 0) + 1 into next_version
  from public.organizer_brand_versions
  where organization_id = p_organization_id;

  content_json := jsonb_build_object(
    'versionName', trim(p_version_name),
    'logoAssetId', p_logo_asset_id,
    'faviconAssetId', p_favicon_asset_id,
    'primaryColor', upper(trim(p_primary_color)),
    'accentColor', upper(trim(p_accent_color)),
    'backgroundColor', upper(trim(p_background_color)),
    'foregroundColor', upper(trim(p_foreground_color)),
    'mutedColor', upper(trim(p_muted_color)),
    'successColor', upper(trim(p_success_color)),
    'headingFont', p_heading_font,
    'bodyFont', p_body_font,
    'cornerStyle', p_corner_style,
    'wordmark', trim(p_wordmark),
    'footerText', nullif(trim(p_footer_text), ''),
    'socialLinks', coalesce(p_social_links_json, '{}'::jsonb)
  );

  insert into public.organizer_brand_versions (
    organization_id, version_number, version_name, logo_asset_id, favicon_asset_id,
    primary_color, accent_color, background_color, foreground_color, muted_color,
    success_color, heading_font, body_font, corner_style, wordmark, footer_text,
    social_links_json, content_digest_sha256, created_by_user_id, client_event_id
  )
  values (
    p_organization_id, next_version, trim(p_version_name), p_logo_asset_id, p_favicon_asset_id,
    upper(trim(p_primary_color)), upper(trim(p_accent_color)), upper(trim(p_background_color)),
    upper(trim(p_foreground_color)), upper(trim(p_muted_color)), upper(trim(p_success_color)),
    p_heading_font, p_body_font, p_corner_style, trim(p_wordmark), nullif(trim(p_footer_text), ''),
    coalesce(p_social_links_json, '{}'::jsonb),
    encode(public.digest(convert_to(content_json::text, 'utf8'), 'sha256'), 'hex'),
    p_actor_user_id, p_client_event_id
  )
  returning * into version_row;

  insert into public.audit_log (
    organization_id, actor_user_id, entity_type, entity_id, action, metadata_json
  )
  values (
    p_organization_id, p_actor_user_id, 'brand_version', version_row.id,
    'branding.version_created',
    jsonb_build_object(
      'versionNumber', version_row.version_number,
      'contentDigestSha256', version_row.content_digest_sha256
    )
  );

  return jsonb_build_object(
    'id', version_row.id,
    'versionNumber', version_row.version_number,
    'contentDigestSha256', version_row.content_digest_sha256,
    'replayed', false
  );
exception
  when check_violation or not_null_violation then
    raise exception using errcode = '22023', message = 'brand_version_input_invalid';
end;
$$;
create or replace function public.service_save_event_presentation_version(
  p_organization_id uuid,
  p_actor_user_id uuid,
  p_event_edition_id uuid,
  p_brand_version_id uuid,
  p_cover_asset_id uuid,
  p_social_image_asset_id uuid,
  p_seo_title text,
  p_seo_description text,
  p_public_links_json jsonb,
  p_theme_overrides_json jsonb,
  p_sponsor_entries_json jsonb,
  p_client_event_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  presentation_row public.organizer_event_presentation_versions%rowtype;
  next_version integer;
  content_json jsonb;
begin
  if not public.service_user_has_organization_permission(
    p_organization_id, p_actor_user_id, 'branding.manage', 'event_edition',
    p_event_edition_id, clock_timestamp()
  ) then
    raise exception using errcode = '42501', message = 'organization_permission_required';
  end if;
  if not exists (
    select 1
    from public.event_editions edition
    join public.event_series series on series.id = edition.event_series_id
    where edition.id = p_event_edition_id
      and series.organization_id = p_organization_id
  ) then
    raise exception using errcode = '22023', message = 'event_presentation_scope_invalid';
  end if;
  if p_client_event_id is null
     or coalesce(jsonb_typeof(p_public_links_json), '') <> 'array'
     or coalesce(jsonb_typeof(p_theme_overrides_json), '') <> 'object'
     or coalesce(jsonb_typeof(p_sponsor_entries_json), '') <> 'array'
     or jsonb_array_length(p_public_links_json) > 24
     or jsonb_array_length(p_sponsor_entries_json) > 48
     or exists (
       select 1 from jsonb_object_keys(p_theme_overrides_json) key
       where key not in (
         'primaryColor', 'accentColor', 'backgroundColor', 'foregroundColor',
         'mutedColor', 'successColor', 'headingFont', 'bodyFont', 'cornerStyle'
       )
     )
     or exists (
       select 1
       from jsonb_each_text(p_theme_overrides_json) override
       where override.key like '%Color'
       and override.value !~ '^#[0-9A-Fa-f]{6}$'
     )
     or exists (
       select 1
       from jsonb_array_elements(p_public_links_json) link
       where jsonb_typeof(link) <> 'object'
          or length(trim(coalesce(link->>'label', ''))) not between 1 and 80
          or coalesce(link->>'url', '') !~ '^https://'
     )
     or exists (
       select 1
       from jsonb_array_elements(p_sponsor_entries_json) sponsor
       where jsonb_typeof(sponsor) <> 'object'
          or length(trim(coalesce(sponsor->>'name', ''))) not between 1 and 160
          or coalesce(sponsor->>'tier', '') not in ('presenting', 'official', 'supporting', 'community')
          or length(trim(coalesce(sponsor->>'altText', ''))) not between 1 and 500
          or (
            nullif(sponsor->>'websiteUrl', '') is not null
            and sponsor->>'websiteUrl' !~ '^https://'
          )
          or (
            nullif(sponsor->>'logoAssetId', '') is not null
            and (
              sponsor->>'logoAssetId' !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$'
              or not exists (
                select 1
                from public.organizer_brand_assets asset
                where asset.id = case
                    when sponsor->>'logoAssetId' ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$'
                      then (sponsor->>'logoAssetId')::uuid
                    else null
                  end
                  and asset.organization_id = p_organization_id
                  and asset.asset_state = 'active'
                  and asset.asset_kind = 'sponsor'
              )
            )
          )
     )
     or (
       p_brand_version_id is not null
       and not exists (
         select 1 from public.organizer_brand_versions version
         where version.id = p_brand_version_id
           and version.organization_id = p_organization_id
       )
     )
     or exists (
       select 1
       from unnest(array[p_cover_asset_id, p_social_image_asset_id]) requested_id
       where requested_id is not null
         and not exists (
           select 1 from public.organizer_brand_assets asset
           where asset.id = requested_id
             and asset.organization_id = p_organization_id
             and asset.asset_state = 'active'
         )
     ) then
    raise exception using errcode = '22023', message = 'event_presentation_input_invalid';
  end if;

  select * into presentation_row
  from public.organizer_event_presentation_versions
  where client_event_id = p_client_event_id;
  if found then
    if presentation_row.organization_id <> p_organization_id
       or presentation_row.event_edition_id <> p_event_edition_id then
      raise exception using errcode = '23505', message = 'idempotency_key_reused';
    end if;
    return jsonb_build_object(
      'id', presentation_row.id,
      'versionNumber', presentation_row.version_number,
      'contentDigestSha256', presentation_row.content_digest_sha256,
      'replayed', true
    );
  end if;

  perform pg_advisory_xact_lock(hashtextextended('presentation-version:' || p_event_edition_id::text, 0));
  select coalesce(max(version_number), 0) + 1 into next_version
  from public.organizer_event_presentation_versions
  where event_edition_id = p_event_edition_id;

  content_json := jsonb_build_object(
    'brandVersionId', p_brand_version_id,
    'coverAssetId', p_cover_asset_id,
    'socialImageAssetId', p_social_image_asset_id,
    'seoTitle', nullif(trim(p_seo_title), ''),
    'seoDescription', nullif(trim(p_seo_description), ''),
    'publicLinks', coalesce(p_public_links_json, '[]'::jsonb),
    'themeOverrides', coalesce(p_theme_overrides_json, '{}'::jsonb),
    'sponsorEntries', coalesce(p_sponsor_entries_json, '[]'::jsonb)
  );

  insert into public.organizer_event_presentation_versions (
    organization_id, event_edition_id, version_number, brand_version_id,
    cover_asset_id, social_image_asset_id, seo_title, seo_description,
    public_links_json, theme_overrides_json, sponsor_entries_json,
    content_digest_sha256, created_by_user_id, client_event_id
  )
  values (
    p_organization_id, p_event_edition_id, next_version, p_brand_version_id,
    p_cover_asset_id, p_social_image_asset_id, nullif(trim(p_seo_title), ''),
    nullif(trim(p_seo_description), ''), coalesce(p_public_links_json, '[]'::jsonb),
    coalesce(p_theme_overrides_json, '{}'::jsonb),
    coalesce(p_sponsor_entries_json, '[]'::jsonb),
    encode(public.digest(convert_to(content_json::text, 'utf8'), 'sha256'), 'hex'),
    p_actor_user_id, p_client_event_id
  )
  returning * into presentation_row;

  insert into public.audit_log (
    organization_id, actor_user_id, entity_type, entity_id, action, metadata_json
  )
  values (
    p_organization_id, p_actor_user_id, 'event_presentation_version', presentation_row.id,
    'branding.event_presentation_version_created',
    jsonb_build_object(
      'eventEditionId', p_event_edition_id,
      'versionNumber', presentation_row.version_number,
      'contentDigestSha256', presentation_row.content_digest_sha256
    )
  );

  return jsonb_build_object(
    'id', presentation_row.id,
    'versionNumber', presentation_row.version_number,
    'contentDigestSha256', presentation_row.content_digest_sha256,
    'replayed', false
  );
exception
  when check_violation or not_null_violation then
    raise exception using errcode = '22023', message = 'event_presentation_input_invalid';
end;
$$;
create or replace function public.service_get_branding_workspace(
  p_organization_id uuid,
  p_actor_user_id uuid
)
returns jsonb
language plpgsql
security definer
stable
set search_path = ''
as $$
declare
  organization_row public.organizations%rowtype;
begin
  if not public.service_user_has_organization_permission(
    p_organization_id, p_actor_user_id, 'branding.manage', 'organization', null, clock_timestamp()
  ) then
    raise exception using errcode = '42501', message = 'organization_permission_required';
  end if;
  select * into organization_row
  from public.organizations
  where id = p_organization_id;
  if not found then
    raise exception using errcode = 'P0002', message = 'organization_not_found';
  end if;

  return jsonb_build_object(
    'organization', jsonb_build_object(
      'id', organization_row.id,
      'name', organization_row.name,
      'slug', organization_row.slug
    ),
    'capabilities', jsonb_build_object('canManageBranding', true, 'canManageDomains', true),
    'assets', coalesce((
      select jsonb_agg(
        public.brand_asset_json(asset.id)
        || jsonb_build_object(
          'objectReference', asset.object_reference,
          'byteSize', asset.byte_size,
          'createdAt', asset.created_at,
          'retiredAt', asset.retired_at,
          'retirementReason', asset.retirement_reason
        )
        order by asset.created_at desc
      )
      from public.organizer_brand_assets asset
      where asset.organization_id = p_organization_id
    ), '[]'::jsonb),
    'brandVersions', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', version.id,
        'versionNumber', version.version_number,
        'versionName', version.version_name,
        'logoAssetId', version.logo_asset_id,
        'faviconAssetId', version.favicon_asset_id,
        'primaryColor', version.primary_color,
        'accentColor', version.accent_color,
        'backgroundColor', version.background_color,
        'foregroundColor', version.foreground_color,
        'mutedColor', version.muted_color,
        'successColor', version.success_color,
        'headingFont', version.heading_font,
        'bodyFont', version.body_font,
        'cornerStyle', version.corner_style,
        'wordmark', version.wordmark,
        'footerText', version.footer_text,
        'socialLinks', version.social_links_json,
        'contentDigestSha256', version.content_digest_sha256,
        'createdAt', version.created_at
      ) order by version.version_number desc)
      from public.organizer_brand_versions version
      where version.organization_id = p_organization_id
    ), '[]'::jsonb),
    'editions', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', edition.id,
        'name', edition.name,
        'slug', edition.slug,
        'status', edition.status,
        'startDate', edition.start_date,
        'timezone', edition.timezone,
        'presentation', presentation.payload
      ) order by edition.start_date desc)
      from public.event_editions edition
      join public.event_series series on series.id = edition.event_series_id
      left join lateral (
        select jsonb_build_object(
          'id', revision.id,
          'versionNumber', revision.version_number,
          'brandVersionId', revision.brand_version_id,
          'coverAssetId', revision.cover_asset_id,
          'socialImageAssetId', revision.social_image_asset_id,
          'seoTitle', revision.seo_title,
          'seoDescription', revision.seo_description,
          'publicLinks', revision.public_links_json,
          'themeOverrides', revision.theme_overrides_json,
          'sponsorEntries', revision.sponsor_entries_json,
          'contentDigestSha256', revision.content_digest_sha256,
          'createdAt', revision.created_at
        ) as payload
        from public.organizer_event_presentation_versions revision
        where revision.event_edition_id = edition.id
        order by revision.version_number desc
        limit 1
      ) presentation on true
      where series.organization_id = p_organization_id
    ), '[]'::jsonb),
    'domains', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', domain.id,
        'hostname', domain.hostname,
        'targetType', domain.target_type,
        'eventEditionId', domain.event_edition_id,
        'canonicalRedirect', domain.canonical_redirect,
        'state', domain.domain_state,
        'ownershipStatus', domain.ownership_status,
        'tlsStatus', domain.tls_status,
        'verificationRecordName', domain.verification_record_name,
        'verificationRecordValue', domain.verification_record_value,
        'routingCnameTarget', domain.routing_cname_target,
        'providerReference', domain.provider_reference,
        'lastCheckedAt', domain.last_checked_at,
        'ownershipVerifiedAt', domain.ownership_verified_at,
        'certificateReadyAt', domain.certificate_ready_at,
        'activatedAt', domain.activated_at,
        'disabledAt', domain.disabled_at,
        'disableReason', domain.disable_reason,
        'createdAt', domain.created_at,
        'updatedAt', domain.updated_at,
        'events', coalesce((
          select jsonb_agg(jsonb_build_object(
            'id', event.id,
            'sequenceNumber', event.sequence_number,
            'eventType', event.event_type,
            'note', event.note,
            'evidence', event.evidence_json,
            'actorUserId', event.actor_user_id,
            'createdAt', event.created_at
          ) order by event.sequence_number desc)
          from public.organizer_custom_domain_events event
          where event.custom_domain_id = domain.id
        ), '[]'::jsonb)
      ) order by domain.created_at desc)
      from public.organizer_custom_domains domain
      where domain.organization_id = p_organization_id
    ), '[]'::jsonb)
  );
end;
$$;
create or replace function public.service_request_custom_domain(
  p_organization_id uuid,
  p_actor_user_id uuid,
  p_hostname text,
  p_target_type text,
  p_event_edition_id uuid,
  p_canonical_redirect boolean,
  p_client_event_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  normalized_hostname text;
  domain_row public.organizer_custom_domains%rowtype;
  existing_event public.organizer_custom_domain_events%rowtype;
  label text;
  next_sequence integer;
  verification_value text;
begin
  if not public.service_user_has_organization_permission(
    p_organization_id, p_actor_user_id, 'branding.manage',
    case when p_target_type = 'event_edition' then 'event_edition' else 'organization' end,
    p_event_edition_id, clock_timestamp()
  ) then
    raise exception using errcode = '42501', message = 'organization_permission_required';
  end if;
  normalized_hostname := public.normalize_custom_domain_hostname(p_hostname);
  if p_client_event_id is null
     or p_target_type not in ('organization', 'event_edition')
     or (p_target_type = 'organization' and p_event_edition_id is not null)
     or (p_target_type = 'event_edition' and p_event_edition_id is null)
     or length(normalized_hostname) not between 4 and 253
     or normalized_hostname !~ '^[a-z0-9][a-z0-9.-]*[a-z0-9]$'
     or position('.' in normalized_hostname) = 0
     or normalized_hostname like '%..%'
     or normalized_hostname like '%.localhost'
     or normalized_hostname like '%.local'
     or normalized_hostname like '%.internal'
     or normalized_hostname like '%.test'
     or normalized_hostname like '%.invalid'
     or normalized_hostname like '%.example'
     or normalized_hostname = 'localhost'
     or normalized_hostname = 'sitrail.app'
     or normalized_hostname like '%.sitrail.app'
     or normalized_hostname ~ '^[0-9.]+$'
     or exists (
       select 1
       from unnest(string_to_array(normalized_hostname, '.')) hostname_label
       where length(hostname_label) not between 1 and 63
         or hostname_label like '-%'
         or hostname_label like '%-'
     )
     or (
       p_target_type = 'event_edition'
       and not exists (
         select 1
         from public.event_editions edition
         join public.event_series series on series.id = edition.event_series_id
         where edition.id = p_event_edition_id
           and series.organization_id = p_organization_id
       )
     ) then
    raise exception using errcode = '22023', message = 'custom_domain_input_invalid';
  end if;

  select * into existing_event
  from public.organizer_custom_domain_events
  where client_event_id = p_client_event_id;
  if found then
    select * into domain_row
    from public.organizer_custom_domains
    where id = existing_event.custom_domain_id;
    if domain_row.organization_id <> p_organization_id
       or domain_row.hostname <> normalized_hostname then
      raise exception using errcode = '23505', message = 'idempotency_key_reused';
    end if;
    return jsonb_build_object(
      'id', domain_row.id,
      'hostname', domain_row.hostname,
      'state', domain_row.domain_state,
      'ownershipStatus', domain_row.ownership_status,
      'tlsStatus', domain_row.tls_status,
      'verificationRecordName', domain_row.verification_record_name,
      'verificationRecordValue', domain_row.verification_record_value,
      'routingCnameTarget', domain_row.routing_cname_target,
      'replayed', true
    );
  end if;

  select * into domain_row
  from public.organizer_custom_domains
  where hostname = normalized_hostname
  for update;
  if found and domain_row.organization_id <> p_organization_id then
    raise exception using errcode = '23505', message = 'custom_domain_hostname_unavailable';
  end if;
  if found and (
    domain_row.target_type <> p_target_type
    or domain_row.event_edition_id is distinct from p_event_edition_id
  ) then
    raise exception using errcode = '23505', message = 'custom_domain_target_conflict';
  end if;
  if found and domain_row.domain_state = 'active' then
    raise exception using errcode = '55000', message = 'custom_domain_already_active';
  end if;

  verification_value := 'sitrail-domain-verification='
    || encode(public.gen_random_bytes(24), 'hex');

  if not found then
    insert into public.organizer_custom_domains (
      organization_id, hostname, target_type, event_edition_id, canonical_redirect,
      verification_record_name, verification_record_value, routing_cname_target,
      created_by_user_id
    )
    values (
      p_organization_id, normalized_hostname, p_target_type, p_event_edition_id,
      coalesce(p_canonical_redirect, true), '_sitrail-verification.' || normalized_hostname,
      verification_value, 'edge.sitrail.app', p_actor_user_id
    )
    returning * into domain_row;
    next_sequence := 1;
  else
    update public.organizer_custom_domains
    set canonical_redirect = coalesce(p_canonical_redirect, canonical_redirect),
        domain_state = 'pending_dns',
        ownership_status = 'pending',
        tls_status = 'not_requested',
        verification_record_value = verification_value,
        provider_reference = null,
        last_checked_at = null,
        ownership_verified_at = null,
        certificate_ready_at = null,
        activated_at = null,
        disabled_at = null,
        disabled_by_user_id = null,
        disable_reason = null,
        updated_at = clock_timestamp()
    where id = domain_row.id
    returning * into domain_row;
    select coalesce(max(sequence_number), 0) + 1 into next_sequence
    from public.organizer_custom_domain_events
    where custom_domain_id = domain_row.id;
  end if;

  insert into public.organizer_custom_domain_events (
    custom_domain_id, sequence_number, event_type, note, evidence_json,
    actor_user_id, client_event_id
  )
  values (
    domain_row.id, next_sequence, 'verification_requested',
    'DNS ownership verification requested.',
    jsonb_build_object(
      'recordType', 'TXT',
      'recordName', domain_row.verification_record_name,
      'recordValue', domain_row.verification_record_value,
      'routingRecordType', 'CNAME',
      'routingTarget', domain_row.routing_cname_target
    ),
    p_actor_user_id, p_client_event_id
  );

  insert into public.audit_log (
    organization_id, actor_user_id, entity_type, entity_id, action, metadata_json
  )
  values (
    p_organization_id, p_actor_user_id, 'custom_domain', domain_row.id,
    'branding.domain_verification_requested',
    jsonb_build_object('hostname', domain_row.hostname, 'targetType', domain_row.target_type)
  );

  return jsonb_build_object(
    'id', domain_row.id,
    'hostname', domain_row.hostname,
    'state', domain_row.domain_state,
    'ownershipStatus', domain_row.ownership_status,
    'tlsStatus', domain_row.tls_status,
    'verificationRecordName', domain_row.verification_record_name,
    'verificationRecordValue', domain_row.verification_record_value,
    'routingCnameTarget', domain_row.routing_cname_target,
    'replayed', false
  );
end;
$$;
create or replace function public.service_record_custom_domain_verification(
  p_custom_domain_id uuid,
  p_actor_user_id uuid,
  p_observed_txt_values text[],
  p_observed_cname_values text[],
  p_client_event_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  domain_row public.organizer_custom_domains%rowtype;
  existing_event public.organizer_custom_domain_events%rowtype;
  next_sequence integer;
  ownership_matches boolean;
  routing_matches boolean;
begin
  select * into domain_row
  from public.organizer_custom_domains
  where id = p_custom_domain_id
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'custom_domain_not_found';
  end if;
  if not public.service_user_has_organization_permission(
    domain_row.organization_id, p_actor_user_id, 'branding.manage',
    case when domain_row.target_type = 'event_edition' then 'event_edition' else 'organization' end,
    domain_row.event_edition_id, clock_timestamp()
  ) then
    raise exception using errcode = '42501', message = 'organization_permission_required';
  end if;
  if p_client_event_id is null
     or p_observed_txt_values is null
     or p_observed_cname_values is null
     or domain_row.domain_state = 'disabled' then
    raise exception using errcode = '22023', message = 'custom_domain_verification_input_invalid';
  end if;
  select * into existing_event
  from public.organizer_custom_domain_events
  where client_event_id = p_client_event_id;
  if found then
    if existing_event.custom_domain_id <> p_custom_domain_id then
      raise exception using errcode = '23505', message = 'idempotency_key_reused';
    end if;
    return jsonb_build_object(
      'id', domain_row.id,
      'state', domain_row.domain_state,
      'ownershipStatus', domain_row.ownership_status,
      'tlsStatus', domain_row.tls_status,
      'replayed', true
    );
  end if;

  ownership_matches := domain_row.verification_record_value = any(p_observed_txt_values);
  routing_matches := domain_row.routing_cname_target = any(
    select public.normalize_custom_domain_hostname(value)
    from unnest(p_observed_cname_values) value
  );
  select coalesce(max(sequence_number), 0) + 1 into next_sequence
  from public.organizer_custom_domain_events
  where custom_domain_id = p_custom_domain_id;

  if ownership_matches then
    update public.organizer_custom_domains
    set domain_state = 'certificate_pending',
        ownership_status = 'verified',
        tls_status = 'pending',
        last_checked_at = clock_timestamp(),
        ownership_verified_at = coalesce(ownership_verified_at, clock_timestamp()),
        updated_at = clock_timestamp()
    where id = p_custom_domain_id
    returning * into domain_row;

    insert into public.organizer_custom_domain_events (
      custom_domain_id, sequence_number, event_type, note, evidence_json,
      actor_user_id, client_event_id
    )
    values (
      p_custom_domain_id, next_sequence, 'ownership_verified',
      'DNS ownership proof matched and certificate provisioning was requested.',
      jsonb_build_object(
        'txtMatched', true,
        'routingMatched', routing_matches,
        'observedTxtCount', cardinality(p_observed_txt_values),
        'observedCnameCount', cardinality(p_observed_cname_values)
      ),
      p_actor_user_id, p_client_event_id
    );
    insert into public.organizer_custom_domain_events (
      custom_domain_id, sequence_number, event_type, note, evidence_json,
      actor_user_id
    )
    values (
      p_custom_domain_id, next_sequence + 1, 'certificate_pending',
      'Managed certificate provisioning is pending.',
      jsonb_build_object('routingMatched', routing_matches),
      p_actor_user_id
    );
  else
    update public.organizer_custom_domains
    set domain_state = 'verification_failed',
        ownership_status = 'failed',
        tls_status = 'not_requested',
        last_checked_at = clock_timestamp(),
        updated_at = clock_timestamp()
    where id = p_custom_domain_id
    returning * into domain_row;

    insert into public.organizer_custom_domain_events (
      custom_domain_id, sequence_number, event_type, note, evidence_json,
      actor_user_id, client_event_id
    )
    values (
      p_custom_domain_id, next_sequence, 'verification_failed',
      'DNS ownership proof was not observed.',
      jsonb_build_object(
        'txtMatched', false,
        'routingMatched', routing_matches,
        'observedTxtCount', cardinality(p_observed_txt_values),
        'observedCnameCount', cardinality(p_observed_cname_values)
      ),
      p_actor_user_id, p_client_event_id
    );
  end if;

  insert into public.audit_log (
    organization_id, actor_user_id, entity_type, entity_id, action, metadata_json
  )
  values (
    domain_row.organization_id, p_actor_user_id, 'custom_domain', p_custom_domain_id,
    case when ownership_matches
      then 'branding.domain_ownership_verified'
      else 'branding.domain_verification_failed'
    end,
    jsonb_build_object('hostname', domain_row.hostname, 'routingMatched', routing_matches)
  );

  return jsonb_build_object(
    'id', domain_row.id,
    'state', domain_row.domain_state,
    'ownershipStatus', domain_row.ownership_status,
    'tlsStatus', domain_row.tls_status,
    'routingMatched', routing_matches,
    'replayed', false
  );
end;
$$;
create or replace function public.service_record_custom_domain_tls_status(
  p_custom_domain_id uuid,
  p_actor_user_id uuid,
  p_tls_status text,
  p_provider_reference text,
  p_note text,
  p_client_event_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  domain_row public.organizer_custom_domains%rowtype;
  existing_event public.organizer_custom_domain_events%rowtype;
  next_sequence integer;
begin
  select * into domain_row
  from public.organizer_custom_domains
  where id = p_custom_domain_id
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'custom_domain_not_found';
  end if;
  if p_actor_user_id is not null and not public.service_user_has_organization_permission(
    domain_row.organization_id, p_actor_user_id, 'branding.manage',
    case when domain_row.target_type = 'event_edition' then 'event_edition' else 'organization' end,
    domain_row.event_edition_id, clock_timestamp()
  ) then
    raise exception using errcode = '42501', message = 'organization_permission_required';
  end if;
  if p_client_event_id is null
     or p_tls_status not in ('ready', 'failed')
     or p_note is null
     or length(trim(p_note)) < 3
     or domain_row.ownership_status <> 'verified'
     or domain_row.domain_state not in ('certificate_pending', 'degraded') then
    raise exception using errcode = '22023', message = 'custom_domain_tls_transition_invalid';
  end if;
  select * into existing_event
  from public.organizer_custom_domain_events
  where client_event_id = p_client_event_id;
  if found then
    if existing_event.custom_domain_id <> p_custom_domain_id then
      raise exception using errcode = '23505', message = 'idempotency_key_reused';
    end if;
    return jsonb_build_object(
      'id', domain_row.id,
      'state', domain_row.domain_state,
      'ownershipStatus', domain_row.ownership_status,
      'tlsStatus', domain_row.tls_status,
      'replayed', true
    );
  end if;

  select coalesce(max(sequence_number), 0) + 1 into next_sequence
  from public.organizer_custom_domain_events
  where custom_domain_id = p_custom_domain_id;

  if p_tls_status = 'ready' then
    update public.organizer_custom_domains
    set domain_state = 'active',
        tls_status = 'ready',
        provider_reference = nullif(trim(p_provider_reference), ''),
        certificate_ready_at = clock_timestamp(),
        activated_at = clock_timestamp(),
        updated_at = clock_timestamp()
    where id = p_custom_domain_id
    returning * into domain_row;
    insert into public.organizer_custom_domain_events (
      custom_domain_id, sequence_number, event_type, note, evidence_json,
      actor_user_id, client_event_id
    )
    values (
      p_custom_domain_id, next_sequence, 'certificate_ready', trim(p_note),
      jsonb_build_object('providerReference', nullif(trim(p_provider_reference), '')),
      p_actor_user_id, p_client_event_id
    );
    insert into public.organizer_custom_domain_events (
      custom_domain_id, sequence_number, event_type, note, evidence_json,
      actor_user_id
    )
    values (
      p_custom_domain_id, next_sequence + 1, 'activated',
      'Custom domain routing is active.',
      jsonb_build_object('hostname', domain_row.hostname),
      p_actor_user_id
    );
  else
    update public.organizer_custom_domains
    set domain_state = 'degraded',
        tls_status = 'failed',
        provider_reference = nullif(trim(p_provider_reference), ''),
        updated_at = clock_timestamp()
    where id = p_custom_domain_id
    returning * into domain_row;
    insert into public.organizer_custom_domain_events (
      custom_domain_id, sequence_number, event_type, note, evidence_json,
      actor_user_id, client_event_id
    )
    values (
      p_custom_domain_id, next_sequence, 'certificate_failed', trim(p_note),
      jsonb_build_object('providerReference', nullif(trim(p_provider_reference), '')),
      p_actor_user_id, p_client_event_id
    );
  end if;

  insert into public.audit_log (
    organization_id, actor_user_id, entity_type, entity_id, action, metadata_json
  )
  values (
    domain_row.organization_id, p_actor_user_id, 'custom_domain', p_custom_domain_id,
    case when p_tls_status = 'ready'
      then 'branding.domain_activated'
      else 'branding.domain_certificate_failed'
    end,
    jsonb_build_object('hostname', domain_row.hostname, 'providerReference', domain_row.provider_reference)
  );

  return jsonb_build_object(
    'id', domain_row.id,
    'state', domain_row.domain_state,
    'ownershipStatus', domain_row.ownership_status,
    'tlsStatus', domain_row.tls_status,
    'activatedAt', domain_row.activated_at,
    'replayed', false
  );
end;
$$;
create or replace function public.service_disable_custom_domain(
  p_custom_domain_id uuid,
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
  domain_row public.organizer_custom_domains%rowtype;
  existing_event public.organizer_custom_domain_events%rowtype;
  next_sequence integer;
begin
  select * into domain_row
  from public.organizer_custom_domains
  where id = p_custom_domain_id
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'custom_domain_not_found';
  end if;
  if not public.service_user_has_organization_permission(
    domain_row.organization_id, p_actor_user_id, 'branding.manage',
    case when domain_row.target_type = 'event_edition' then 'event_edition' else 'organization' end,
    domain_row.event_edition_id, clock_timestamp()
  ) then
    raise exception using errcode = '42501', message = 'organization_permission_required';
  end if;
  if p_client_event_id is null or p_reason is null or length(trim(p_reason)) < 3 then
    raise exception using errcode = '22023', message = 'custom_domain_disable_input_invalid';
  end if;
  select * into existing_event
  from public.organizer_custom_domain_events
  where client_event_id = p_client_event_id;
  if found then
    if existing_event.custom_domain_id <> p_custom_domain_id then
      raise exception using errcode = '23505', message = 'idempotency_key_reused';
    end if;
    return jsonb_build_object('id', domain_row.id, 'state', domain_row.domain_state, 'replayed', true);
  end if;
  if domain_row.domain_state = 'disabled' then
    raise exception using errcode = '55000', message = 'custom_domain_already_disabled';
  end if;

  update public.organizer_custom_domains
  set domain_state = 'disabled',
      disabled_at = clock_timestamp(),
      disabled_by_user_id = p_actor_user_id,
      disable_reason = trim(p_reason),
      updated_at = clock_timestamp()
  where id = p_custom_domain_id
  returning * into domain_row;

  select coalesce(max(sequence_number), 0) + 1 into next_sequence
  from public.organizer_custom_domain_events
  where custom_domain_id = p_custom_domain_id;
  insert into public.organizer_custom_domain_events (
    custom_domain_id, sequence_number, event_type, note, evidence_json,
    actor_user_id, client_event_id
  )
  values (
    p_custom_domain_id, next_sequence, 'disabled', trim(p_reason),
    jsonb_build_object('previousTlsStatus', domain_row.tls_status),
    p_actor_user_id, p_client_event_id
  );

  insert into public.audit_log (
    organization_id, actor_user_id, entity_type, entity_id, action, metadata_json
  )
  values (
    domain_row.organization_id, p_actor_user_id, 'custom_domain', p_custom_domain_id,
    'branding.domain_disabled',
    jsonb_build_object('hostname', domain_row.hostname, 'reason', trim(p_reason))
  );

  return jsonb_build_object(
    'id', domain_row.id,
    'state', domain_row.domain_state,
    'disabledAt', domain_row.disabled_at,
    'replayed', false
  );
end;
$$;
create or replace function public.service_resolve_public_site_context(p_hostname text)
returns jsonb
language plpgsql
security definer
stable
set search_path = ''
as $$
declare
  normalized_hostname text;
  domain_row public.organizer_custom_domains%rowtype;
  organization_row public.organizations%rowtype;
  edition_row public.event_editions%rowtype;
  series_row public.event_series%rowtype;
  presentation_row public.organizer_event_presentation_versions%rowtype;
  brand_row public.organizer_brand_versions%rowtype;
  resolved_theme jsonb;
begin
  normalized_hostname := public.normalize_custom_domain_hostname(p_hostname);
  select * into domain_row
  from public.organizer_custom_domains
  where hostname = normalized_hostname
    and domain_state = 'active'
    and ownership_status = 'verified'
    and tls_status = 'ready';
  if not found then
    return null;
  end if;

  select * into organization_row
  from public.organizations
  where id = domain_row.organization_id
    and status = 'active';
  if not found then
    return null;
  end if;

  if domain_row.event_edition_id is not null then
    select * into edition_row
    from public.event_editions
    where id = domain_row.event_edition_id;
    select * into series_row
    from public.event_series
    where id = edition_row.event_series_id;
    select * into presentation_row
    from public.organizer_event_presentation_versions
    where event_edition_id = edition_row.id
    order by version_number desc
    limit 1;
  end if;

  if presentation_row.brand_version_id is not null then
    select * into brand_row
    from public.organizer_brand_versions
    where id = presentation_row.brand_version_id;
  else
    select * into brand_row
    from public.organizer_brand_versions
    where organization_id = domain_row.organization_id
    order by version_number desc
    limit 1;
  end if;

  if brand_row.id is null then
    resolved_theme := '{}'::jsonb;
  else
    resolved_theme := jsonb_build_object(
      'primaryColor', brand_row.primary_color,
      'accentColor', brand_row.accent_color,
      'backgroundColor', brand_row.background_color,
      'foregroundColor', brand_row.foreground_color,
      'mutedColor', brand_row.muted_color,
      'successColor', brand_row.success_color,
      'headingFont', brand_row.heading_font,
      'bodyFont', brand_row.body_font,
      'cornerStyle', brand_row.corner_style
    );
  end if;
  if presentation_row.id is not null then
    resolved_theme := resolved_theme || presentation_row.theme_overrides_json;
  end if;

  return jsonb_build_object(
    'hostname', domain_row.hostname,
    'organizationId', organization_row.id,
    'organizationName', organization_row.name,
    'organizationSlug', organization_row.slug,
    'targetType', domain_row.target_type,
    'canonicalRedirect', domain_row.canonical_redirect,
    'eventEditionId', domain_row.event_edition_id,
    'eventName', edition_row.name,
    'eventSlug', edition_row.slug,
    'eventSeriesSlug', series_row.slug,
    'routePath', case
      when edition_row.id is null then '/'
      else '/races/' || edition_row.slug
    end,
    'wordmark', coalesce(brand_row.wordmark, organization_row.name),
    'footerText', brand_row.footer_text,
    'logo', public.brand_asset_json(brand_row.logo_asset_id),
    'favicon', public.brand_asset_json(brand_row.favicon_asset_id),
    'cover', public.brand_asset_json(presentation_row.cover_asset_id),
    'socialImage', public.brand_asset_json(presentation_row.social_image_asset_id),
    'theme', resolved_theme,
    'seo', jsonb_build_object(
      'title', presentation_row.seo_title,
      'description', presentation_row.seo_description
    ),
    'publicLinks', coalesce(presentation_row.public_links_json, '[]'::jsonb),
    'sponsors', coalesce((
      select jsonb_agg(
        sponsor
        || jsonb_build_object(
          'logo',
          case
            when nullif(sponsor->>'logoAssetId', '') is null then null
            else public.brand_asset_json((sponsor->>'logoAssetId')::uuid)
          end
        )
      )
      from jsonb_array_elements(coalesce(presentation_row.sponsor_entries_json, '[]'::jsonb)) sponsor
    ), '[]'::jsonb),
    'brandVersionId', brand_row.id,
    'brandVersionNumber', brand_row.version_number,
    'presentationVersionId', presentation_row.id,
    'presentationVersionNumber', presentation_row.version_number
  );
end;
$$;
alter table public.organizer_brand_assets enable row level security;
alter table public.organizer_brand_versions enable row level security;
alter table public.organizer_event_presentation_versions enable row level security;
alter table public.organizer_custom_domains enable row level security;
alter table public.organizer_custom_domain_events enable row level security;
revoke all on table public.organizer_brand_assets from public, anon, authenticated;
revoke all on table public.organizer_brand_versions from public, anon, authenticated;
revoke all on table public.organizer_event_presentation_versions from public, anon, authenticated;
revoke all on table public.organizer_custom_domains from public, anon, authenticated;
revoke all on table public.organizer_custom_domain_events from public, anon, authenticated;
grant all on table public.organizer_brand_assets to service_role;
grant all on table public.organizer_brand_versions to service_role;
grant all on table public.organizer_event_presentation_versions to service_role;
grant all on table public.organizer_custom_domains to service_role;
grant all on table public.organizer_custom_domain_events to service_role;
revoke all on function public.normalize_custom_domain_hostname(text) from public, anon, authenticated;
revoke all on function public.brand_asset_json(uuid) from public, anon, authenticated;
revoke all on function public.service_register_brand_asset(uuid, uuid, text, text, text, text, text, bigint, integer, integer, text, text, uuid) from public, anon, authenticated;
revoke all on function public.service_retire_brand_asset(uuid, uuid, text, uuid) from public, anon, authenticated;
revoke all on function public.service_save_brand_version(uuid, uuid, text, uuid, uuid, text, text, text, text, text, text, text, text, text, text, text, jsonb, uuid) from public, anon, authenticated;
revoke all on function public.service_save_event_presentation_version(uuid, uuid, uuid, uuid, uuid, uuid, text, text, jsonb, jsonb, jsonb, uuid) from public, anon, authenticated;
revoke all on function public.service_get_branding_workspace(uuid, uuid) from public, anon, authenticated;
revoke all on function public.service_request_custom_domain(uuid, uuid, text, text, uuid, boolean, uuid) from public, anon, authenticated;
revoke all on function public.service_record_custom_domain_verification(uuid, uuid, text[], text[], uuid) from public, anon, authenticated;
revoke all on function public.service_record_custom_domain_tls_status(uuid, uuid, text, text, text, uuid) from public, anon, authenticated;
revoke all on function public.service_disable_custom_domain(uuid, uuid, text, uuid) from public, anon, authenticated;
revoke all on function public.service_resolve_public_site_context(text) from public, anon, authenticated;
grant execute on function public.normalize_custom_domain_hostname(text) to service_role;
grant execute on function public.brand_asset_json(uuid) to service_role;
grant execute on function public.service_register_brand_asset(uuid, uuid, text, text, text, text, text, bigint, integer, integer, text, text, uuid) to service_role;
grant execute on function public.service_retire_brand_asset(uuid, uuid, text, uuid) to service_role;
grant execute on function public.service_save_brand_version(uuid, uuid, text, uuid, uuid, text, text, text, text, text, text, text, text, text, text, text, jsonb, uuid) to service_role;
grant execute on function public.service_save_event_presentation_version(uuid, uuid, uuid, uuid, uuid, uuid, text, text, jsonb, jsonb, jsonb, uuid) to service_role;
grant execute on function public.service_get_branding_workspace(uuid, uuid) to service_role;
grant execute on function public.service_request_custom_domain(uuid, uuid, text, text, uuid, boolean, uuid) to service_role;
grant execute on function public.service_record_custom_domain_verification(uuid, uuid, text[], text[], uuid) to service_role;
grant execute on function public.service_record_custom_domain_tls_status(uuid, uuid, text, text, text, uuid) to service_role;
grant execute on function public.service_disable_custom_domain(uuid, uuid, text, uuid) to service_role;
grant execute on function public.service_resolve_public_site_context(text) to service_role;
