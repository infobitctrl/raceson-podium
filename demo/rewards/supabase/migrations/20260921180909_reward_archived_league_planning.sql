begin;

-- Demo-only archive visibility. Preserve every draft, source, approval and receipt.
-- Archiving a league/season removes it from planning discovery and blocks reopening,
-- saving and creation. It is not a chain refund, cancellation or ledger deletion.
-- Runtime archive decisions are separate; migration replay archives no data.

create or replace function public.service_list_reward_planning_drafts(p_actor_user_id uuid,p_actor_session_id uuid,p_chain_id integer)
returns jsonb language plpgsql volatile security invoker set search_path='' as $$
declare result jsonb;
begin
  perform app_private.require_reward_account(p_actor_user_id,p_actor_session_id);
  if p_chain_id is null or p_chain_id not in (31337,10143) then raise exception 'invalid_reward_planning_request'; end if;
  select coalesce(jsonb_agg(app_private.reward_planning_document(d) order by d.id),'[]'::jsonb) into result
    from (select d.* from app_private.reward_planning_drafts d where d.chain_id=p_chain_id
      and exists(select 1 from public.league_seasons s join public.leagues l on l.id=s.league_id
        where s.id=d.season_id and l.organization_id=d.organization_id
          and s.status<>'archived' and l.status<>'archived')
      and app_private.reward_planning_authorized(p_actor_user_id,d.organization_id) order by d.id limit 100) d;
  perform app_private.require_reward_account(p_actor_user_id,p_actor_session_id);
  return result;
end $$;
-- A planning draft's stored organization is not perpetual authority over a
-- season that has since moved. Lock the current season/league association for
-- this RPC transaction; do not take a shared draft lock before a save upgrade.
create or replace function public.service_read_reward_planning_draft(p_actor_user_id uuid,p_actor_session_id uuid,p_chain_id integer,p_draft_id uuid)
returns jsonb language plpgsql volatile security invoker set search_path='' as $$
declare d app_private.reward_planning_drafts%rowtype; document jsonb;
begin
  perform app_private.require_reward_account(p_actor_user_id,p_actor_session_id);
  select draft.* into d from app_private.reward_planning_drafts draft
    join public.league_seasons s on s.id=draft.season_id
    join public.leagues l on l.id=s.league_id and l.organization_id=draft.organization_id
    where draft.id=p_draft_id and draft.chain_id=p_chain_id
      and s.status<>'archived' and l.status<>'archived' for share of s,l;
  if not found or not app_private.reward_planning_authorized(p_actor_user_id,d.organization_id) then
    raise exception using errcode='42501',message='reward_planning_not_found';
  end if;
  document:=app_private.reward_planning_document(d);
  if document is null then raise exception 'reward_planning_not_found'; end if;
  perform app_private.require_reward_account(p_actor_user_id,p_actor_session_id);
  return document;
end $$;
create or replace function public.service_save_reward_planning_draft(p_actor_user_id uuid,p_actor_session_id uuid,p_chain_id integer,
  p_draft_id uuid,p_expected_revision integer,p_rules jsonb)
returns jsonb language plpgsql volatile security invoker set search_path='' as $$
declare d app_private.reward_planning_drafts%rowtype;
begin
  perform app_private.require_reward_account(p_actor_user_id,p_actor_session_id);
  -- Reuse season/league scope locks and refuse archived programmes.
  perform public.service_read_reward_planning_draft(p_actor_user_id,p_actor_session_id,p_chain_id,p_draft_id);
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
    raise exception using errcode='P0001',message='reward_planning_revision_changed';
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

-- Creates only unfunded configuration. Source review, V3 policy approval,
-- contract deployment, funding and publication remain separate operations.
create or replace function public.service_reward_programme_creation(p_actor_user_id uuid,p_actor_session_id uuid,p_chain_id integer,
  p_season_id uuid default null,p_draft_id uuid default null,p_budget_mon text default null)
returns jsonb language plpgsql volatile security invoker set search_path='' as $$
declare org uuid; result jsonb; d app_private.reward_planning_drafts%rowtype; initial_rules jsonb;
begin
  perform app_private.require_reward_account(p_actor_user_id,p_actor_session_id);
  if p_chain_id is null or p_chain_id not in (31337,10143) then raise exception 'invalid_reward_planning_request'; end if;
  if p_season_id is null and p_draft_id is null and p_budget_mon is null then
    select coalesce(jsonb_agg(x.doc order by x.title,x.season),'[]'::jsonb) into result from (
      select s.id season,l.name title,jsonb_build_object('seasonId',s.id,'seasonName',l.name||' · '||s.year::text,
        'organizationId',o.id,'organizationName',o.name,'draftId',existing.id) doc
      from public.league_seasons s join public.leagues l on l.id=s.league_id join public.organizations o on o.id=l.organization_id
      left join app_private.reward_planning_drafts existing on existing.season_id=s.id and existing.chain_id=p_chain_id
      where s.status<>'archived' and l.status<>'archived'
        and app_private.reward_planning_authorized(p_actor_user_id,o.id)
      order by l.name,s.id limit 100
    ) x;
    perform app_private.require_reward_account(p_actor_user_id,p_actor_session_id);
    return result;
  end if;
  if p_season_id is null or p_draft_id is null or p_season_id='00000000-0000-0000-0000-000000000000'::uuid
    or p_draft_id='00000000-0000-0000-0000-000000000000'::uuid or p_budget_mon is null
    or p_budget_mon !~ '^[1-9][0-9]{0,6}$' or p_budget_mon::numeric>1000000 then raise exception 'invalid_reward_planning_request';end if;
  select l.organization_id into org from public.league_seasons s join public.leagues l on l.id=s.league_id
    where s.id=p_season_id and s.status<>'archived' and l.status<>'archived' for share of s,l;
  if org is null or not app_private.reward_planning_authorized(p_actor_user_id,org) then raise exception 'reward_planning_not_found';end if;
  perform 1 from public.organization_memberships where user_id=p_actor_user_id and organization_id=org for share;
  perform 1 from public.organizations where id=org for share;
  perform pg_advisory_xact_lock(hashtextextended('reward-create:'||p_season_id::text||':'||p_chain_id::text,0));
  perform app_private.require_reward_account(p_actor_user_id,p_actor_session_id);
  if not app_private.reward_planning_authorized(p_actor_user_id,org) then raise exception 'reward_planning_not_found';end if;
  initial_rules:=jsonb_build_object('version',2,'network','monad-testnet','budgetMon',p_budget_mon,'reviewSeconds',86400,
    'leagueShareBps',5000,'roundSharesBps','[1000,1000,1000,1000,1000]'::jsonb,
    'raceFamilySharesBps','{"athleteStandings":8000,"clubStandings":2000}'::jsonb,
    'leagueFamilySharesBps','{"athleteStandings":5000,"clubStandings":2000,"participationMetres":3000}'::jsonb,
    'raceRankWeights','[3500,2000,1500,800,600,500,400,300,250,150]'::jsonb,
    'leagueRankWeights','[759,506,253,88,84,80,76,72,68,64,60,56,52,48,44,40,36,32,28,24,20,16,12,8,4]'::jsonb);
  select * into d from app_private.reward_planning_drafts where season_id=p_season_id and chain_id=p_chain_id;
  if found then
    if d.id<>p_draft_id or not exists(select 1 from app_private.reward_planning_revisions r where r.draft_id=d.id and r.revision=1 and r.rules=initial_rules)
      then raise exception 'reward_programme_exists';end if;
  else
    begin
      insert into app_private.reward_planning_drafts(id,organization_id,season_id,chain_id,rules,updated_by_user_id)
        values(p_draft_id,org,p_season_id,p_chain_id,initial_rules,p_actor_user_id) returning * into d;
      insert into app_private.reward_planning_revisions(draft_id,revision,rules,saved_at,saved_by_user_id)
        values(d.id,d.revision,d.rules,d.updated_at,p_actor_user_id);
    exception when unique_violation then raise exception 'reward_programme_exists';end;
  end if;
  perform app_private.require_reward_account(p_actor_user_id,p_actor_session_id);
  if not app_private.reward_planning_authorized(p_actor_user_id,org) then raise exception 'reward_planning_not_found';end if;
  return public.service_read_reward_planning_draft(p_actor_user_id,p_actor_session_id,p_chain_id,d.id);
end $$;
revoke all on function public.service_reward_programme_creation(uuid,uuid,integer,uuid,uuid,text) from public,anon,authenticated,service_role;
grant execute on function public.service_reward_programme_creation(uuid,uuid,integer,uuid,uuid,text) to service_role;

commit;
