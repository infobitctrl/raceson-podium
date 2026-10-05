begin;

create or replace function public.create_platform_admin_organizer_workspace(
  workspace_name text,
  workspace_country_code text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := public.request_user_id();
  next_organization public.organizations%rowtype;
  slug_base text;
  slug_candidate text;
  slug_suffix integer := 0;
  normalized_country_code text;
begin
  if current_user_id is null then
    raise exception 'Authenticated user required'
      using errcode = '42501';
  end if;

  if not public.is_platform_administrator() then
    raise exception 'Platform administrator access required'
      using errcode = '42501';
  end if;

  if nullif(trim(workspace_name), '') is null then
    raise exception 'Organization name is required.'
      using errcode = '22023';
  end if;

  normalized_country_code := nullif(trim(upper(workspace_country_code)), '');
  if normalized_country_code is not null and normalized_country_code !~ '^[A-Z]{2}$' then
    raise exception 'Country code must contain exactly two letters.'
      using errcode = '22023';
  end if;

  slug_base := trim(both '-' from regexp_replace(lower(trim(workspace_name)), '[^a-z0-9]+', '-', 'g'));
  if slug_base = '' then
    slug_base := 'organization-' || left(replace(current_user_id::text, '-', ''), 8);
  end if;
  slug_candidate := left(slug_base, 80);

  while exists (
    select 1
    from public.organizations
    where slug = slug_candidate
  ) loop
    slug_suffix := slug_suffix + 1;
    slug_candidate := left(slug_base, greatest(1, 76 - length(slug_suffix::text)))
      || '-' || slug_suffix::text;
  end loop;

  insert into public.organizations (
    slug,
    name,
    country_code,
    status,
    kind
  )
  values (
    slug_candidate,
    trim(workspace_name),
    normalized_country_code,
    'active',
    'organizer'
  )
  returning *
  into next_organization;

  insert into public.organization_memberships (
    organization_id,
    user_id,
    role,
    status,
    invited_by_user_id,
    joined_at,
    membership_type,
    permission_keys,
    expires_at,
    created_by_user_id,
    account_template_key
  )
  values (
    next_organization.id,
    current_user_id,
    'owner',
    'active',
    null,
    now(),
    'permanent',
    '{}'::text[],
    null,
    current_user_id,
    null
  );

  return jsonb_build_object(
    'organization_id', next_organization.id,
    'organization_slug', next_organization.slug,
    'workspace_created', true
  );
end;
$$;

revoke all on function public.create_platform_admin_organizer_workspace(text, text) from public;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    grant execute on function public.create_platform_admin_organizer_workspace(text, text) to authenticated;
  end if;
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function public.create_platform_admin_organizer_workspace(text, text) to service_role;
  end if;
end
$$;

comment on function public.create_platform_admin_organizer_workspace(text, text) is
  'Creates an additional organizer workspace for the authenticated active platform administrator.';

commit;
