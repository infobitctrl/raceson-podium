begin;

create table public.platform_integrity_check_actions (
  check_type text not null,
  check_key text not null,
  state text not null,
  acted_by_user_id uuid not null references auth.users (id) on delete restrict,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  primary key (check_type, check_key),
  check (check_type in ('duplicate', 'membership', 'result')),
  check (state in ('acknowledged', 'dismissed')),
  check (length(trim(check_key)) > 0)
);

create index platform_integrity_check_actions_state_idx
  on public.platform_integrity_check_actions (state, check_type, updated_at desc);

create trigger platform_integrity_check_actions_set_updated_at
before update on public.platform_integrity_check_actions
for each row execute function public.set_updated_at();

alter table public.platform_integrity_check_actions enable row level security;
revoke all on table public.platform_integrity_check_actions from public, anon, authenticated;
grant select, insert, update, delete on table public.platform_integrity_check_actions to service_role;

create or replace function public.service_set_platform_integrity_check_state(
  p_actor_user_id uuid,
  p_check_type text,
  p_check_key text,
  p_state text
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if not exists (
    select 1
    from public.platform_administrators administrator
    where administrator.user_id = p_actor_user_id
      and administrator.is_active
      and administrator.platform_role = 'super_admin'
  ) then
    raise exception using errcode = '42501', message = 'super_administrator_required';
  end if;

  if p_check_type not in ('duplicate', 'membership', 'result')
    or p_check_key is null
    or length(trim(p_check_key)) = 0
    or p_state not in ('open', 'acknowledged', 'dismissed') then
    raise exception using errcode = '22023', message = 'invalid_integrity_check_action';
  end if;

  if p_state = 'open' then
    delete from public.platform_integrity_check_actions
    where check_type = p_check_type and check_key = p_check_key;
  else
    insert into public.platform_integrity_check_actions (
      check_type,
      check_key,
      state,
      acted_by_user_id
    ) values (
      p_check_type,
      p_check_key,
      p_state,
      p_actor_user_id
    )
    on conflict (check_type, check_key) do update
    set state = excluded.state,
        acted_by_user_id = excluded.acted_by_user_id,
        updated_at = clock_timestamp();
  end if;

  insert into public.audit_log (
    actor_user_id,
    entity_type,
    action,
    metadata_json
  ) values (
    p_actor_user_id,
    'platform_integrity_check',
    'platform.integrity_check_state_changed',
    jsonb_build_object(
      'checkType', p_check_type,
      'checkKey', p_check_key,
      'state', p_state
    )
  );

  return jsonb_build_object(
    'checkType', p_check_type,
    'checkKey', p_check_key,
    'state', p_state
  );
end;
$$;

revoke all on function public.service_set_platform_integrity_check_state(uuid, text, text, text)
  from public, anon, authenticated;
grant execute on function public.service_set_platform_integrity_check_state(uuid, text, text, text)
  to service_role;

create or replace function public.service_delete_platform_club(
  p_actor_user_id uuid,
  p_club_id uuid
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  club_record public.clubs%rowtype;
  detached_memberships integer;
begin
  if not exists (
    select 1
    from public.platform_administrators administrator
    where administrator.user_id = p_actor_user_id
      and administrator.is_active
      and administrator.platform_role = 'super_admin'
  ) then
    raise exception using errcode = '42501', message = 'super_administrator_required';
  end if;

  select * into club_record
  from public.clubs
  where id = p_club_id
  for update;

  if not found then
    raise exception using errcode = 'P0002', message = 'club_not_found';
  end if;

  if club_record.verification_status = 'merged'
    or exists (
      select 1 from public.registrations registration
      where registration.represented_club_id = p_club_id
    )
    or exists (
      select 1 from public.result_rows result
      where result.represented_club_id = p_club_id
    )
    or exists (
      select 1 from public.club_identity_merges identity_merge
      where identity_merge.source_club_id = p_club_id
         or identity_merge.canonical_club_id = p_club_id
    ) then
    raise exception using errcode = '55000', message = 'club_has_protected_history';
  end if;

  select count(*)::integer into detached_memberships
  from public.club_memberships membership
  where membership.club_id = p_club_id;

  insert into public.audit_log (
    actor_user_id,
    entity_type,
    entity_id,
    action,
    metadata_json
  ) values (
    p_actor_user_id,
    'club',
    p_club_id,
    'platform.club_deleted',
    jsonb_build_object(
      'clubName', club_record.name,
      'clubSlug', club_record.slug,
      'detachedMemberships', detached_memberships
    )
  );

  begin
    delete from public.clubs where id = p_club_id;
  exception
    when foreign_key_violation then
      raise exception using errcode = '55000', message = 'club_has_protected_history';
  end;

  return jsonb_build_object(
    'deleted', true,
    'clubId', p_club_id,
    'detachedMemberships', detached_memberships
  );
end;
$$;

revoke all on function public.service_delete_platform_club(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.service_delete_platform_club(uuid, uuid)
  to service_role;

comment on table public.platform_integrity_check_actions is
  'Audited super-administrator acknowledgement or dismissal of generated platform integrity checks.';
comment on function public.service_delete_platform_club(uuid, uuid) is
  'Deletes an unused club and cascading memberships while preserving athlete profiles and protected result history.';

commit;
