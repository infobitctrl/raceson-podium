begin;

-- Unfunded planning state, deliberately separate from the v1 immutable award
-- ledger. A save is not a sporting review, programme activation or transaction.
create table app_private.reward_planning_drafts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id),
  season_id uuid not null references public.league_seasons(id),
  chain_id integer not null check (chain_id in (31337,10143)),
  revision integer not null default 1 check (revision > 0),
  rules jsonb not null check (jsonb_typeof(rules) = 'object' and octet_length(rules::text) <= 16384
    and rules->>'version' = '2' and rules->>'network' = 'monad-testnet' and rules->>'reviewSeconds' = '86400'),
  updated_at timestamptz not null default clock_timestamp(),
  updated_by_user_id uuid not null references public.user_profiles(user_id),
  unique(season_id,chain_id)
);
create table app_private.reward_planning_revisions (
  draft_id uuid not null references app_private.reward_planning_drafts(id),
  revision integer not null,
  rules jsonb not null,
  saved_at timestamptz not null default clock_timestamp(),
  saved_by_user_id uuid not null references public.user_profiles(user_id),
  primary key(draft_id,revision)
);
alter table app_private.reward_planning_drafts enable row level security;
alter table app_private.reward_planning_revisions enable row level security;
revoke all on app_private.reward_planning_drafts,app_private.reward_planning_revisions from public,anon,authenticated,service_role;
grant select,insert,update on app_private.reward_planning_drafts to service_role;
grant select,insert on app_private.reward_planning_revisions to service_role;

create function app_private.reward_planning_authorized(p_user_id uuid,p_organization_id uuid)
returns boolean language sql volatile security invoker set search_path='' as $$
  select exists(select 1 from public.organization_memberships m join public.organizations o on o.id=m.organization_id
    where o.id=p_organization_id and o.status='active' and o.kind='organizer'
      and m.user_id=p_user_id and m.status='active' and m.membership_type='permanent'
      and (m.expires_at is null or m.expires_at>clock_timestamp())
      and (m.role='owner' or (m.role='admin' and 'events.manage'=any(m.permission_keys))))
$$;
create function app_private.reward_planning_document(d app_private.reward_planning_drafts)
returns jsonb language sql stable security invoker set search_path='' set timezone='UTC' as $$
  select jsonb_build_object('draftId',d.id,'organizationId',d.organization_id,'seasonId',d.season_id,
    'chainId',d.chain_id,'revision',d.revision,'rules',d.rules,'updatedAt',d.updated_at,
    'organizationName',o.name,'seasonName',l.name || ' · ' || s.year::text)
  from public.league_seasons s join public.leagues l on l.id=s.league_id
    join public.organizations o on o.id=l.organization_id
  where s.id=d.season_id and o.id=d.organization_id
$$;
create function public.service_list_reward_planning_drafts(p_actor_user_id uuid,p_actor_session_id uuid,p_chain_id integer)
returns jsonb language plpgsql volatile security invoker set search_path='' as $$
declare result jsonb;
begin
  perform app_private.require_reward_account(p_actor_user_id,p_actor_session_id);
  if p_chain_id is null or p_chain_id not in (31337,10143) then raise exception 'invalid_reward_planning_request'; end if;
  select coalesce(jsonb_agg(app_private.reward_planning_document(d) order by d.id),'[]'::jsonb) into result
    from (select d.* from app_private.reward_planning_drafts d where d.chain_id=p_chain_id
      and app_private.reward_planning_authorized(p_actor_user_id,d.organization_id) order by d.id limit 100) d;
  perform app_private.require_reward_account(p_actor_user_id,p_actor_session_id);
  return result;
end $$;
create function public.service_read_reward_planning_draft(p_actor_user_id uuid,p_actor_session_id uuid,p_chain_id integer,p_draft_id uuid)
returns jsonb language plpgsql volatile security invoker set search_path='' as $$
declare d app_private.reward_planning_drafts%rowtype;
begin
  perform app_private.require_reward_account(p_actor_user_id,p_actor_session_id);
  select * into d from app_private.reward_planning_drafts where id=p_draft_id and chain_id=p_chain_id;
  if not found or not app_private.reward_planning_authorized(p_actor_user_id,d.organization_id) then
    raise exception using errcode='42501',message='reward_planning_not_found';
  end if;
  return app_private.reward_planning_document(d);
end $$;
create function public.service_save_reward_planning_draft(p_actor_user_id uuid,p_actor_session_id uuid,p_chain_id integer,
  p_draft_id uuid,p_expected_revision integer,p_rules jsonb)
returns jsonb language plpgsql volatile security invoker set search_path='' as $$
declare d app_private.reward_planning_drafts%rowtype;
begin
  perform app_private.require_reward_account(p_actor_user_id,p_actor_session_id);
  select * into d from app_private.reward_planning_drafts where id=p_draft_id and chain_id=p_chain_id;
  if not found or not app_private.reward_planning_authorized(p_actor_user_id,d.organization_id) then
    raise exception using errcode='42501',message='reward_planning_not_found';
  end if;
  -- Lock the current role and organization, not a JWT role or browser claim.
  perform 1 from public.organization_memberships where user_id=p_actor_user_id and organization_id=d.organization_id for share;
  perform 1 from public.organizations where id=d.organization_id for share;
  select * into d from app_private.reward_planning_drafts where id=p_draft_id for update;
  perform app_private.require_reward_account(p_actor_user_id,p_actor_session_id);
  if not app_private.reward_planning_authorized(p_actor_user_id,d.organization_id) then
    raise exception using errcode='42501',message='reward_planning_not_found';
  end if;
  if p_expected_revision is null or d.revision<>p_expected_revision then
    raise exception using errcode='40001',message='reward_planning_revision_changed';
  end if;
  if p_rules is null or jsonb_typeof(p_rules)<>'object' or octet_length(p_rules::text)>16384
    or p_rules->>'version' is distinct from '2' or p_rules->>'network' is distinct from 'monad-testnet'
    or p_rules->>'reviewSeconds' is distinct from '86400' then
    raise exception 'invalid_reward_planning_request';
  end if;
  -- Identical saves do not inflate revisions. Stale writes still conflict.
  if d.rules=p_rules then return app_private.reward_planning_document(d); end if;
  insert into app_private.reward_planning_revisions(draft_id,revision,rules,saved_at,saved_by_user_id)
    values(d.id,d.revision,d.rules,d.updated_at,d.updated_by_user_id) on conflict do nothing;
  update app_private.reward_planning_drafts set rules=p_rules,revision=revision+1,
    updated_at=clock_timestamp(),updated_by_user_id=p_actor_user_id where id=d.id returning * into d;
  insert into app_private.reward_planning_revisions(draft_id,revision,rules,saved_at,saved_by_user_id)
    values(d.id,d.revision,d.rules,d.updated_at,d.updated_by_user_id);
  perform app_private.require_reward_account(p_actor_user_id,p_actor_session_id);
  return app_private.reward_planning_document(d);
end $$;
revoke all on function app_private.reward_planning_authorized(uuid,uuid),
  app_private.reward_planning_document(app_private.reward_planning_drafts),
  public.service_list_reward_planning_drafts(uuid,uuid,integer),
  public.service_read_reward_planning_draft(uuid,uuid,integer,uuid),
  public.service_save_reward_planning_draft(uuid,uuid,integer,uuid,integer,jsonb) from public,anon,authenticated,service_role;
grant execute on function app_private.reward_planning_authorized(uuid,uuid),
  app_private.reward_planning_document(app_private.reward_planning_drafts),
  public.service_list_reward_planning_drafts(uuid,uuid,integer),
  public.service_read_reward_planning_draft(uuid,uuid,integer,uuid),
  public.service_save_reward_planning_draft(uuid,uuid,integer,uuid,integer,jsonb) to service_role;

commit;
