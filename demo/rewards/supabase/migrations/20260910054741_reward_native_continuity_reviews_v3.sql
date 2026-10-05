begin;

-- Isolated demo: immutable sporting links, never account claims or payments.
create table app_private.reward_native_continuity_reviews_v3 (
  id uuid primary key check(id<>'00000000-0000-0000-0000-000000000000'::uuid),
  draft_id uuid not null references app_private.reward_planning_drafts(id),
  previous_review_id uuid,
  context_text text not null check(octet_length(context_text)<=262144),
  context_hash text not null check(context_hash=encode(sha256(convert_to(context_text,'UTF8')),'hex')),
  source_guard_hash text not null check(source_guard_hash ~ '^[0-9a-f]{64}$'),
  selection jsonb not null check(jsonb_typeof(selection)='object' and octet_length(selection::text)<=4194304),
  decision text not null check(decision in ('confirmed','held')),
  reviewed_at timestamptz not null default clock_timestamp(),
  reviewed_by_user_id uuid not null references public.user_profiles(user_id),
  sequence bigint generated always as identity unique,
  unique(draft_id,id),
  foreign key(draft_id,previous_review_id) references app_private.reward_native_continuity_reviews_v3(draft_id,id),
  check(previous_review_id is null or previous_review_id<>id)
);
create index reward_native_continuity_reviews_v3_draft_idx on app_private.reward_native_continuity_reviews_v3(draft_id,sequence desc);
alter table app_private.reward_native_continuity_reviews_v3 enable row level security;
revoke all on app_private.reward_native_continuity_reviews_v3 from public,anon,authenticated,service_role;
grant select,insert on app_private.reward_native_continuity_reviews_v3 to service_role;
create policy reward_native_continuity_reviews_v3_read on app_private.reward_native_continuity_reviews_v3 for select to service_role using(true);
create policy reward_native_continuity_reviews_v3_write on app_private.reward_native_continuity_reviews_v3 for insert to service_role with check(true);
revoke all on sequence app_private.reward_native_continuity_reviews_v3_sequence_seq from public,anon,authenticated,service_role;
grant usage on sequence app_private.reward_native_continuity_reviews_v3_sequence_seq to service_role;
create trigger reward_native_continuity_reviews_v3_immutable before update or delete on app_private.reward_native_continuity_reviews_v3
  for each row execute function app_private.reward_result_review_immutable_v3();

create function app_private.reward_native_continuity_decision_v3(p app_private.reward_native_continuity_reviews_v3)
returns jsonb language sql stable security invoker set search_path='' as $$
  select case when p.id is null then 'null'::jsonb else jsonb_build_object('id',p.id,'previousReviewId',p.previous_review_id,
    'contextHash',p.context_hash,'selection',p.selection,'decision',p.decision,
    'reviewedAt',to_char(p.reviewed_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')) end
$$;

create function public.service_read_reward_native_continuity_v3(p_actor_user_id uuid,p_actor_session_id uuid,p_chain_id integer,p_draft_id uuid,p_request_id uuid)
returns jsonb language plpgsql volatile security invoker set search_path='' as $$
declare h jsonb; n jsonb; again jsonb; g text; labels jsonb; latest app_private.reward_native_continuity_reviews_v3%rowtype;
  saved app_private.reward_native_continuity_reviews_v3%rowtype;
begin
  -- Native reader holds membership/org/draft/category locks until this outer
  -- transaction ends. Recheck the stable projections, not observation times.
  n:=public.service_read_reward_native_finale_v3(p_actor_user_id,p_actor_session_id,p_chain_id,p_draft_id);
  h:=public.service_read_reward_historical_source_v3(p_actor_user_id,p_actor_session_id,p_chain_id,p_draft_id);
  again:=public.service_read_reward_native_finale_v3(p_actor_user_id,p_actor_session_id,p_chain_id,p_draft_id);
  if n->'document' is distinct from again->'document' then raise exception 'reward_planning_revision_changed'; end if;
  n:=again;
  -- Display names only, scoped to represented native IDs. No contact/DOB/account
  -- or wallet data. Labels are not automatic identity evidence.
  select jsonb_build_object('athletes',coalesce((select jsonb_agg(jsonb_build_object('id',a.id,'name',a.display_name) order by a.id)
    from public.athlete_profiles a where a.id::text in (select rr->>'athleteId' from jsonb_array_elements(n#>'{document,races}') race,
      jsonb_array_elements(race->'rows') rr)),'[]'::jsonb),
    'clubs',coalesce((select jsonb_agg(jsonb_build_object('id',c.id,'name',c.name) order by c.id)
    from public.clubs c where c.id::text in (select rr->>'clubId' from jsonb_array_elements(n#>'{document,races}') race,
      jsonb_array_elements(race->'rows') rr)),'[]'::jsonb)) into labels;
  if h-'observedAt' is distinct from public.service_read_reward_historical_source_v3(p_actor_user_id,p_actor_session_id,p_chain_id,p_draft_id)-'observedAt'
    then raise exception 'reward_planning_revision_changed'; end if;
  -- This SQL CAS fence is separate from the canonical cross-language commitment.
  -- Historical decisions affect their own slots, not finale identity continuity.
  g:=encode(sha256(convert_to(jsonb_build_object('historical',h-array['observedAt','decisions','recordedDecision'],
    'native',n->'document')::text,'UTF8')),'hex');
  select * into latest from app_private.reward_native_continuity_reviews_v3 where draft_id=p_draft_id order by sequence desc limit 1;
  if p_request_id is not null then
    select * into saved from app_private.reward_native_continuity_reviews_v3 where id=p_request_id;
    if found and (saved.draft_id<>p_draft_id or saved.reviewed_by_user_id<>p_actor_user_id) then raise exception 'reward_continuity_conflict'; end if;
  end if;
  perform app_private.require_reward_account(p_actor_user_id,p_actor_session_id);
  if not app_private.reward_planning_authorized(p_actor_user_id,(h#>>'{record,organizationId}')::uuid) then raise exception 'reward_planning_not_found'; end if;
  return jsonb_build_object('historical',h,'native',n,'guardHash',g,'labels',labels,
    'review',app_private.reward_native_continuity_decision_v3(latest),'recordedReview',app_private.reward_native_continuity_decision_v3(saved));
end $$;

create function public.service_review_reward_native_continuity_v3(p_actor_user_id uuid,p_actor_session_id uuid,p_chain_id integer,p_draft_id uuid,
  p_request_id uuid,p_expected_review_id uuid,p_context_text text,p_source_guard_hash text,p_selection jsonb,p_decision text)
returns jsonb language plpgsql volatile security invoker set search_path='' as $$
declare v jsonb; after_v jsonb; c jsonb; h text; a jsonb; r jsonb; entry jsonb; source_ids jsonb; old_ids jsonb;
  family text; id_key text; row_key text; target_id text; old app_private.reward_native_continuity_reviews_v3%rowtype;
begin
  v:=public.service_read_reward_native_continuity_v3(p_actor_user_id,p_actor_session_id,p_chain_id,p_draft_id,p_request_id);
  if p_request_id is null or p_request_id='00000000-0000-0000-0000-000000000000'::uuid or p_context_text is null
    or octet_length(p_context_text)>262144 or p_source_guard_hash is null or p_source_guard_hash !~ '^[0-9a-f]{64}$'
    or p_decision is null or p_decision not in ('confirmed','held') then raise exception 'invalid_reward_finale_continuity'; end if;
  c:=p_context_text::jsonb; h:=encode(sha256(convert_to(p_context_text,'UTF8')),'hex');
  select * into old from app_private.reward_native_continuity_reviews_v3 where id=p_request_id;
  if found then
    if old.context_text<>p_context_text or old.source_guard_hash<>p_source_guard_hash or old.selection is distinct from p_selection
      or old.decision<>p_decision or old.previous_review_id is distinct from p_expected_review_id then raise exception 'reward_continuity_conflict'; end if;
    return v; -- exact replay cannot undo a later hold
  end if;
  if v->>'guardHash'<>p_source_guard_hash then raise exception 'reward_planning_revision_changed'; end if;
  if (v#>>'{review,id}')::uuid is distinct from p_expected_review_id then raise exception 'reward_continuity_conflict'; end if;
  if c->>'schema' is distinct from 'raceson-native-finale-continuity-context-v3'
    or c->>'draftId' is distinct from p_draft_id::text or c->>'chainId' is distinct from p_chain_id::text
    or c->>'organizationId' is distinct from v#>>'{historical,record,organizationId}'
    or c->>'seasonId' is distinct from v#>>'{historical,record,seasonId}'
    or c->>'rulesRevision' is distinct from v#>>'{historical,record,revision}'
    or c->'rules' is distinct from v#>'{historical,record,rules}' or c->'mapping' is distinct from v#>'{historical,workspace,mapping}'
    or c->>'historicalContextHash' is distinct from v#>>'{historical,contextHash}'
    or c->>'sourceLeagueId' is distinct from v#>>'{historical,snapshot,sourceLeagueId}'
    or c->>'sourceSeasonId' is distinct from v#>>'{historical,snapshot,sourceSeasonId}' then raise exception 'reward_planning_revision_changed'; end if;
  if jsonb_typeof(p_selection) is distinct from 'object' or p_selection->>'schema' is distinct from 'raceson-native-finale-continuity-v3'
    or p_selection-array['schema','athletes','clubs','classifications']<>'{}'::jsonb then raise exception 'invalid_reward_finale_continuity'; end if;
  foreach family in array array['athletes','clubs','classifications'] loop
    a:=p_selection->family;
    if jsonb_typeof(a) is distinct from 'array' or jsonb_array_length(a)>10000 then raise exception 'invalid_reward_finale_continuity'; end if;
    id_key:=case family when 'athletes' then 'nativeAthleteId' when 'clubs' then 'nativeClubId' else 'resultId' end;
    if (select count(distinct e->>id_key) from jsonb_array_elements(a) e)<>jsonb_array_length(a) then raise exception 'invalid_reward_finale_continuity'; end if;
    if family='classifications' then
      for entry in select value from jsonb_array_elements(a) loop
        if jsonb_typeof(entry) is distinct from 'object' or entry-array['resultId','categoryId']<>'{}'::jsonb or not exists(
          select 1 from jsonb_array_elements(v#>'{native,document,races}') race, jsonb_array_elements(race->'rows') rr,
            jsonb_array_elements(v#>'{historical,snapshot,catalogue,categories}') category
          where rr->>'id'=entry->>'resultId' and category->>'id'=entry->>'categoryId' and category->>'target'='individual'
            and category->>'competitionId'=race->>'competitionId') then raise exception 'invalid_reward_finale_continuity'; end if;
      end loop;
    else
      row_key:=case family when 'athletes' then 'athleteId' else 'clubId' end;
      select coalesce(jsonb_agg(distinct rr->>row_key) filter(where rr->>row_key is not null),'[]'::jsonb) into source_ids
        from jsonb_array_elements(v#>'{native,document,races}') race,jsonb_array_elements(race->'rows') rr;
      select coalesce(jsonb_agg(distinct ids.id),'[]'::jsonb) into old_ids from (
        select rr->>row_key as id from jsonb_array_elements(v#>'{historical,snapshot,results}') rr where rr->>row_key is not null
        union select club->>'clubId' from jsonb_array_elements(v#>'{historical,snapshot,clubs}') club where family='clubs') ids;
      if (select count(distinct e#>>'{target,beneficiaryId}') from jsonb_array_elements(a) e)<>jsonb_array_length(a) then raise exception 'invalid_reward_finale_continuity'; end if;
      for entry in select value from jsonb_array_elements(a) loop
        target_id:=entry#>>'{target,beneficiaryId}';
        if jsonb_typeof(entry) is distinct from 'object' or entry-array[id_key,'target']<>'{}'::jsonb
          or jsonb_typeof(entry->'target') is distinct from 'object' or (entry->'target')-array['kind','beneficiaryId']<>'{}'::jsonb
          or not coalesce(source_ids ? (entry->>id_key),false) or target_id is null
          or not coalesce(case entry#>>'{target,kind}' when 'historical' then old_ids ? target_id
            when 'new_native' then target_id=entry->>id_key and not old_ids ? target_id else false end,false)
          then raise exception 'invalid_reward_finale_continuity'; end if;
      end loop;
      if p_decision='confirmed' and jsonb_array_length(a)<>jsonb_array_length(source_ids) then raise exception 'reward_continuity_not_ready'; end if;
    end if;
  end loop;
  if p_decision='confirmed' then
    if v#>'{native,document,binding}'='null'::jsonb or jsonb_array_length(v#>'{native,document,races}')=0
      or v#>>'{native,document,edition,status}'<>'completed' then raise exception 'reward_continuity_not_ready'; end if;
    for r in select value from jsonb_array_elements(v#>'{native,document,races}') loop
      if r->>'status'<>'completed' or r#>>'{review,state}' is distinct from 'final'
        or coalesce(r#>>'{publication,state}','') not in ('official','corrected') or r#>>'{run,status}' is distinct from 'succeeded'
        or jsonb_array_length(r->'rows')<>(r->>'expectedResultCount')::integer
        or exists(select 1 from jsonb_array_elements(r->'rows') rr where rr->>'participationStatus'='finished'
          and not exists(select 1 from jsonb_array_elements(p_selection->'classifications') cc where cc->>'resultId'=rr->>'id'))
        then raise exception 'reward_continuity_not_ready'; end if;
    end loop;
  end if;
  insert into app_private.reward_native_continuity_reviews_v3(id,draft_id,previous_review_id,context_text,context_hash,source_guard_hash,selection,decision,reviewed_by_user_id)
    values(p_request_id,p_draft_id,p_expected_review_id,p_context_text,h,p_source_guard_hash,p_selection,p_decision,p_actor_user_id);
  after_v:=public.service_read_reward_native_continuity_v3(p_actor_user_id,p_actor_session_id,p_chain_id,p_draft_id,p_request_id);
  if after_v->>'guardHash'<>p_source_guard_hash then raise exception 'reward_planning_revision_changed'; end if;
  return after_v;
end $$;
revoke all on function app_private.reward_native_continuity_decision_v3(app_private.reward_native_continuity_reviews_v3),
  public.service_read_reward_native_continuity_v3(uuid,uuid,integer,uuid,uuid),
  public.service_review_reward_native_continuity_v3(uuid,uuid,integer,uuid,uuid,uuid,text,text,jsonb,text) from public,anon,authenticated,service_role;
grant execute on function app_private.reward_native_continuity_decision_v3(app_private.reward_native_continuity_reviews_v3),
  public.service_read_reward_native_continuity_v3(uuid,uuid,integer,uuid,uuid),
  public.service_review_reward_native_continuity_v3(uuid,uuid,integer,uuid,uuid,uuid,text,text,jsonb,text) to service_role;
commit;
