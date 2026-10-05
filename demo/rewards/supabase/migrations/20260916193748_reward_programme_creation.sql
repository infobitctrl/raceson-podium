begin;
-- Creates only unfunded configuration. Source review, V3 policy approval,
-- contract deployment, funding and publication remain separate operations.
create function public.service_reward_programme_creation(p_actor_user_id uuid,p_actor_session_id uuid,p_chain_id integer,
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
      where app_private.reward_planning_authorized(p_actor_user_id,o.id)
      order by l.name,s.id limit 100
    ) x;
    perform app_private.require_reward_account(p_actor_user_id,p_actor_session_id);
    return result;
  end if;
  if p_season_id is null or p_draft_id is null or p_season_id='00000000-0000-0000-0000-000000000000'::uuid
    or p_draft_id='00000000-0000-0000-0000-000000000000'::uuid or p_budget_mon is null
    or p_budget_mon !~ '^[1-9][0-9]{0,6}$' or p_budget_mon::numeric>1000000 then raise exception 'invalid_reward_planning_request';end if;
  select l.organization_id into org from public.league_seasons s join public.leagues l on l.id=s.league_id
    where s.id=p_season_id for share of s,l;
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
