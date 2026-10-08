-- Demo-only custom reviewer authorization: honor the saved permission subset.
-- No additional table/function grants and no changes to sporting facts.
begin;
CREATE OR REPLACE FUNCTION public.service_user_has_organization_permission(p_organization_id uuid, p_user_id uuid, p_permission_code text, p_scope_type text DEFAULT 'organization'::text, p_scope_id uuid DEFAULT NULL::uuid, p_effective_at timestamp with time zone DEFAULT clock_timestamp())
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
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

  if public.is_active_platform_administrator(p_user_id) then
    return true;
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
    -- Custom admin membership must honor its saved role instead of inheriting
    -- every legacy owner/admin permission. Regular owner/admin behavior stays.
    if membership_role = 'admin' and exists (
      select 1 from public.organization_memberships membership
      where membership.organization_id = p_organization_id
        and membership.user_id = p_user_id and membership.status = 'active'
        and membership.custom_role_id is not null
    ) then
      return exists (
        select 1 from public.organization_memberships membership
        join public.organization_custom_roles custom_role
          on custom_role.id = membership.custom_role_id
         and custom_role.organization_id = membership.organization_id
         and custom_role.role_state = 'active'
        join public.organization_custom_role_versions role_version
          on role_version.organization_custom_role_id = custom_role.id
         and role_version.version_state = 'active'
        join public.organization_custom_role_permissions role_permission
          on role_permission.organization_custom_role_version_id = role_version.id
         and role_permission.permission_code = p_permission_code
        where membership.organization_id = p_organization_id
          and membership.user_id = p_user_id and membership.status = 'active'
          and membership.membership_type = 'permanent'
          and (membership.expires_at is null or membership.expires_at > p_effective_at)
          and p_permission_code = any(membership.permission_keys)
      );
    end if;
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
$function$;

commit;
