begin;

-- Demo-only policy choices. This is not official final-table publication,
-- allocation approval, profile claiming, funding or payment authority.
create table app_private.reward_league_policy_reviews_v3 (
  id uuid primary key check(id<>'00000000-0000-0000-0000-000000000000'::uuid),
  draft_id uuid not null references app_private.reward_planning_drafts(id),
  previous_review_id uuid,
  context_text text not null check(octet_length(context_text)<=262144),
  context_hash text not null check(context_hash=encode(sha256(convert_to(context_text,'UTF8')),'hex')),
  source_guard_hash text not null check(source_guard_hash ~ '^[0-9a-f]{64}$'),
  policy jsonb not null check(jsonb_typeof(policy)='object' and octet_length(policy::text)<=262144),
  decision text not null check(decision in ('selected','held')),
  reviewed_at timestamptz not null default clock_timestamp(),
  reviewed_by_user_id uuid not null references public.user_profiles(user_id),
  sequence bigint generated always as identity unique,
  unique(draft_id,id),
  foreign key(draft_id,previous_review_id) references app_private.reward_league_policy_reviews_v3(draft_id,id),
  check(previous_review_id is null or previous_review_id<>id)
);
create index reward_league_policy_reviews_v3_draft_idx on app_private.reward_league_policy_reviews_v3(draft_id,sequence desc);
alter table app_private.reward_league_policy_reviews_v3 enable row level security;
revoke all on app_private.reward_league_policy_reviews_v3 from public,anon,authenticated,service_role;
grant select,insert on app_private.reward_league_policy_reviews_v3 to service_role;
create policy reward_league_policy_reviews_v3_read on app_private.reward_league_policy_reviews_v3 for select to service_role using(true);
create policy reward_league_policy_reviews_v3_write on app_private.reward_league_policy_reviews_v3 for insert to service_role with check(true);
revoke all on sequence app_private.reward_league_policy_reviews_v3_sequence_seq from public,anon,authenticated,service_role;
grant usage on sequence app_private.reward_league_policy_reviews_v3_sequence_seq to service_role;
create trigger reward_league_policy_reviews_v3_immutable before update or delete on app_private.reward_league_policy_reviews_v3
  for each row execute function app_private.reward_result_review_immutable_v3();

create function app_private.reward_league_policy_decision_v3(p app_private.reward_league_policy_reviews_v3)
returns jsonb language sql stable security invoker set search_path='' as $$
  select case when p.id is null then 'null'::jsonb else jsonb_build_object('id',p.id,'previousReviewId',p.previous_review_id,
    'contextHash',p.context_hash,'policy',p.policy,'decision',p.decision,
    'reviewedAt',to_char(p.reviewed_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')) end
$$;

create function app_private.reward_league_policy_context_v3(f jsonb)
returns jsonb language sql immutable security invoker set search_path='' as $$
  select jsonb_build_object('schema','raceson-league-policy-context-v3',
    'draftId',f#>'{historical,record,draftId}','organizationId',f#>'{historical,record,organizationId}',
    'chainId',f#>'{historical,record,chainId}','rulesRevision',f#>'{historical,record,revision}',
    'rules',f#>'{historical,record,rules}','mapping',f#>'{historical,workspace,mapping}',
    'sourceLeagueId',f#>'{historical,snapshot,sourceLeagueId}','sourceSeasonId',f#>'{historical,snapshot,sourceSeasonId}',
    'categories',(select coalesce(jsonb_agg(jsonb_build_object('id',c->'id','competitionId',c->'competitionId','target',c->'target') order by c->>'id'),'[]'::jsonb)
      from jsonb_array_elements(f#>'{historical,workspace,catalogue,categories}') c),
    'rounds',(select coalesce(jsonb_agg(jsonb_build_object('id',r->'id','slot',r->'slot','editionId',r->'editionId',
      'races',(select coalesce(jsonb_agg(jsonb_build_object('id',race->'id','competitionId',race->'competitionId') order by race->>'id'),'[]'::jsonb)
        from jsonb_array_elements(r->'races') race)) order by (r->>'slot')::integer),'[]'::jsonb)
      from jsonb_array_elements(f#>'{historical,workspace,catalogue,rounds}') r))
$$;

create function public.service_read_reward_league_policy_v3(p_actor_user_id uuid,p_actor_session_id uuid,p_chain_id integer,p_draft_id uuid,p_request_id uuid)
returns jsonb language plpgsql volatile security invoker set search_path='' as $$
declare f jsonb; latest app_private.reward_league_policy_reviews_v3%rowtype; saved app_private.reward_league_policy_reviews_v3%rowtype; g text;
begin
  -- Reuses actual current-session/org/draft/category locks and source rechecks.
  f:=public.service_read_reward_native_continuity_v3(p_actor_user_id,p_actor_session_id,p_chain_id,p_draft_id,null);
  g:=encode(sha256(convert_to(jsonb_build_object('baseGuard',f->'guardHash','historicalDecisions',f#>'{historical,decisions}',
    'continuityReview',f->'review')::text,'UTF8')),'hex');
  select * into latest from app_private.reward_league_policy_reviews_v3 where draft_id=p_draft_id order by sequence desc limit 1;
  if p_request_id is not null then
    select * into saved from app_private.reward_league_policy_reviews_v3 where id=p_request_id;
    if found and (saved.draft_id<>p_draft_id or saved.reviewed_by_user_id<>p_actor_user_id) then raise exception 'reward_league_policy_conflict'; end if;
  end if;
  perform app_private.require_reward_account(p_actor_user_id,p_actor_session_id);
  if not app_private.reward_planning_authorized(p_actor_user_id,(f#>>'{historical,record,organizationId}')::uuid) then raise exception 'reward_planning_not_found'; end if;
  return jsonb_build_object('facts',f,'guardHash',g,'review',app_private.reward_league_policy_decision_v3(latest),
    'recordedReview',app_private.reward_league_policy_decision_v3(saved));
end $$;

create function public.service_review_reward_league_policy_v3(p_actor_user_id uuid,p_actor_session_id uuid,p_chain_id integer,p_draft_id uuid,
  p_request_id uuid,p_expected_review_id uuid,p_context_text text,p_source_guard_hash text,p_policy jsonb,p_decision text)
returns jsonb language plpgsql volatile security invoker set search_path='' as $$
declare v jsonb; after_v jsonb; c jsonb; p jsonb; points jsonb; cats jsonb; old app_private.reward_league_policy_reviews_v3%rowtype;
begin
  v:=public.service_read_reward_league_policy_v3(p_actor_user_id,p_actor_session_id,p_chain_id,p_draft_id,p_request_id);
  if p_request_id is null or p_request_id='00000000-0000-0000-0000-000000000000'::uuid or p_context_text is null
    or octet_length(p_context_text)>262144 or p_source_guard_hash is null or p_source_guard_hash !~ '^[0-9a-f]{64}$'
    or p_decision is null or p_decision not in ('selected','held') then raise exception 'invalid_reward_league_policy'; end if;
  c:=p_context_text::jsonb;
  select * into old from app_private.reward_league_policy_reviews_v3 where id=p_request_id;
  if found then
    if old.context_text<>p_context_text or old.source_guard_hash<>p_source_guard_hash or old.policy is distinct from p_policy
      or old.decision<>p_decision or old.previous_review_id is distinct from p_expected_review_id then raise exception 'reward_league_policy_conflict'; end if;
    return v; -- Historical acknowledgement must never undo a later hold.
  end if;
  if v->>'guardHash'<>p_source_guard_hash or c is distinct from app_private.reward_league_policy_context_v3(v->'facts')
    then raise exception 'reward_planning_revision_changed'; end if;
  if (v#>>'{review,id}')::uuid is distinct from p_expected_review_id then raise exception 'reward_league_policy_conflict'; end if;
  if jsonb_typeof(p_policy) is distinct from 'object' or p_policy->>'schema' is distinct from 'raceson-league-scoring-policy-v3'
    or p_policy-array['schema','categories','club']<>'{}'::jsonb or octet_length(p_policy::text)>262144
    or jsonb_typeof(p_policy->'categories') is distinct from 'array' or jsonb_typeof(p_policy->'club') is distinct from 'object'
    then raise exception 'invalid_reward_league_policy'; end if;
  cats:=v#>'{facts,historical,workspace,catalogue,categories}';
  if jsonb_array_length(p_policy->'categories')<1 or jsonb_array_length(p_policy->'categories')>64
    or (select count(distinct x->>'categoryId') from jsonb_array_elements(p_policy->'categories') x)<>jsonb_array_length(p_policy->'categories')
    or (select count(*) from jsonb_array_elements(cats) x where x->>'target'='individual')<>jsonb_array_length(p_policy->'categories')
    or (select count(*) from jsonb_array_elements(cats) x where x->>'target'='club')<>1
    then raise exception 'invalid_reward_league_policy'; end if;
  for p in select value from jsonb_array_elements(p_policy->'categories') loop
    if jsonb_typeof(p) is distinct from 'object' or p-array['categoryId','points','participationPoints','bestN','minimumRounds','tieBreak']<>'{}'::jsonb
      or not exists(select 1 from jsonb_array_elements(cats) x where x->>'id'=p->>'categoryId' and x->>'target'='individual')
      or not coalesce(p->>'tieBreak' in ('best_finish','most_wins','last_round'),false)
      or not coalesce(jsonb_typeof(p->'bestN')='number' and p->>'bestN' ~ '^[1-5]$',false)
      or not coalesce(jsonb_typeof(p->'minimumRounds')='number' and p->>'minimumRounds' ~ '^[0-5]$',false)
      or not coalesce(jsonb_typeof(p->'participationPoints')='number' and p->>'participationPoints' ~ '^(0|[1-9][0-9]{0,6})$',false)
      or jsonb_typeof(p->'points') is distinct from 'array' then raise exception 'invalid_reward_league_policy'; end if;
    if (p->>'minimumRounds')::integer>(p->>'bestN')::integer or (p->>'participationPoints')::integer>1000000
      or jsonb_array_length(p->'points')<1 or jsonb_array_length(p->'points')>256 then raise exception 'invalid_reward_league_policy'; end if;
    for points in select value from jsonb_array_elements(p->'points') loop
      if jsonb_typeof(points)<>'number' or points::text !~ '^(0|[1-9][0-9]{0,6})$' then raise exception 'invalid_reward_league_policy'; end if;
      if points::text::integer>1000000 then raise exception 'invalid_reward_league_policy'; end if;
    end loop;
  end loop;
  p:=p_policy->'club';
  if p-array['categoryId','membersPerRound']<>'{}'::jsonb
    or not exists(select 1 from jsonb_array_elements(cats) x where x->>'target'='club' and x->>'id'=p->>'categoryId')
    or not coalesce(jsonb_typeof(p->'membersPerRound')='number' and p->>'membersPerRound' ~ '^([1-9]|10)$',false)
    then raise exception 'invalid_reward_league_policy'; end if;
  insert into app_private.reward_league_policy_reviews_v3(id,draft_id,previous_review_id,context_text,context_hash,source_guard_hash,policy,decision,reviewed_by_user_id)
    values(p_request_id,p_draft_id,p_expected_review_id,p_context_text,encode(sha256(convert_to(p_context_text,'UTF8')),'hex'),p_source_guard_hash,p_policy,p_decision,p_actor_user_id);
  after_v:=public.service_read_reward_league_policy_v3(p_actor_user_id,p_actor_session_id,p_chain_id,p_draft_id,p_request_id);
  if after_v->>'guardHash'<>p_source_guard_hash then raise exception 'reward_planning_revision_changed'; end if;
  return after_v;
end $$;
revoke all on function app_private.reward_league_policy_decision_v3(app_private.reward_league_policy_reviews_v3),
  app_private.reward_league_policy_context_v3(jsonb),public.service_read_reward_league_policy_v3(uuid,uuid,integer,uuid,uuid),
  public.service_review_reward_league_policy_v3(uuid,uuid,integer,uuid,uuid,uuid,text,text,jsonb,text) from public,anon,authenticated,service_role;
grant execute on function app_private.reward_league_policy_decision_v3(app_private.reward_league_policy_reviews_v3),
  app_private.reward_league_policy_context_v3(jsonb),public.service_read_reward_league_policy_v3(uuid,uuid,integer,uuid,uuid),
  public.service_review_reward_league_policy_v3(uuid,uuid,integer,uuid,uuid,uuid,text,text,jsonb,text) to service_role;
commit;
