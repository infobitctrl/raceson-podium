begin;

-- Isolated demo league-table publication, not allocation or payment authority.
-- All five source reviews are prerequisites; no second timed review is invented.
create table app_private.reward_league_publications_v3 (
  id uuid primary key check(id<>'00000000-0000-0000-0000-000000000000'::uuid),
  draft_id uuid not null references app_private.reward_planning_drafts(id),
  previous_publication_id uuid,
  source_guard_hash text not null check(source_guard_hash ~ '^[0-9a-f]{64}$'),
  document_text text not null check(octet_length(document_text)<=8388608),
  document_hash text not null check(document_hash=encode(sha256(convert_to(document_text,'UTF8')),'hex')),
  decision text not null check(decision in ('published','held')),
  published_at timestamptz not null default clock_timestamp(),
  published_by_user_id uuid not null references public.user_profiles(user_id),
  evidence_hash text not null check(evidence_hash ~ '^[0-9a-f]{64}$'),
  sequence bigint generated always as identity unique,
  unique(draft_id,id),
  foreign key(draft_id,previous_publication_id) references app_private.reward_league_publications_v3(draft_id,id),
  check(previous_publication_id is null or previous_publication_id<>id)
);
create index reward_league_publications_v3_draft_idx on app_private.reward_league_publications_v3(draft_id,sequence desc);
create index reward_league_publications_v3_actor_idx on app_private.reward_league_publications_v3(published_by_user_id);
alter table app_private.reward_league_publications_v3 enable row level security;
revoke all on app_private.reward_league_publications_v3 from public,anon,authenticated,service_role;
grant select,insert on app_private.reward_league_publications_v3 to service_role;
create policy reward_league_publications_v3_read on app_private.reward_league_publications_v3 for select to service_role using(true);
create policy reward_league_publications_v3_insert on app_private.reward_league_publications_v3 for insert to service_role with check(true);
revoke all on sequence app_private.reward_league_publications_v3_sequence_seq from public,anon,authenticated,service_role;
grant usage on sequence app_private.reward_league_publications_v3_sequence_seq to service_role;
create trigger reward_league_publications_v3_immutable before update or delete on app_private.reward_league_publications_v3
  for each row execute function app_private.reject_reward_ledger_mutation();

create function app_private.reward_league_publication_document_v3(p app_private.reward_league_publications_v3)
returns jsonb language sql stable security invoker set search_path='' as $$
  select case when p.id is null then 'null'::jsonb else jsonb_build_object('id',p.id,'draftId',p.draft_id,
    'previousPublicationId',p.previous_publication_id,'sourceGuardHash',p.source_guard_hash,'documentHash',p.document_hash,
    'document',p.document_text::jsonb,'decision',p.decision,'publishedAt',p.published_at,
    'publishedByUserId',p.published_by_user_id,'evidenceHash',p.evidence_hash) end
$$;

create function app_private.reward_league_publication_guard_v3(v jsonb)
returns text language sql immutable security invoker set search_path='' as $$
  select encode(sha256(convert_to(jsonb_build_object('sourceGuard',v->'guardHash','policyReview',v->'review')::text,'UTF8')),'hex')
$$;

create function public.service_reward_league_publication_v3(p_actor_user_id uuid,p_actor_session_id uuid,p_chain_id integer,p_draft_id uuid,
  p_request_id uuid,p_decision text,p_previous_publication_id uuid,p_source_guard_hash text,p_document_text text)
returns jsonb language plpgsql volatile security invoker set search_path='' as $$
declare v jsonb; fresh jsonb; d jsonb; c jsonb; source jsonb; row jsonb; g text; stamp timestamptz;
  latest app_private.reward_league_publications_v3%rowtype; saved app_private.reward_league_publications_v3%rowtype;
begin
  -- Existing private source adapter checks current Auth/org and holds shared
  -- source/category locks. Its draft lock serializes all review/publication CAS.
  v:=public.service_read_reward_league_policy_v3(p_actor_user_id,p_actor_session_id,p_chain_id,p_draft_id,null);
  g:=app_private.reward_league_publication_guard_v3(v);
  select * into latest from app_private.reward_league_publications_v3 where draft_id=p_draft_id order by sequence desc limit 1;
  if p_request_id is not null then
    select * into saved from app_private.reward_league_publications_v3 where id=p_request_id;
    if found and (saved.draft_id<>p_draft_id or saved.published_by_user_id<>p_actor_user_id)
      then raise exception 'reward_league_publication_conflict'; end if;
  end if;
  if p_decision is null then
    if p_previous_publication_id is not null or p_source_guard_hash is not null or p_document_text is not null
      then raise exception 'invalid_reward_league_publication'; end if;
  else
    if p_decision not in ('published','held') or p_request_id is null or p_request_id='00000000-0000-0000-0000-000000000000'::uuid
      or p_source_guard_hash is null or p_source_guard_hash !~ '^[0-9a-f]{64}$' or p_document_text is null
      or octet_length(p_document_text)>8388608 then raise exception 'invalid_reward_league_publication'; end if;
    d:=p_document_text::jsonb;
    if saved.id is not null then
      if saved.previous_publication_id is distinct from p_previous_publication_id or saved.source_guard_hash<>p_source_guard_hash
        or saved.decision<>p_decision or saved.document_text<>p_document_text then raise exception 'reward_league_publication_conflict'; end if;
    else
      if latest.id is distinct from p_previous_publication_id then raise exception 'reward_league_publication_conflict'; end if;
      if g<>p_source_guard_hash then raise exception 'reward_planning_revision_changed'; end if;
      if p_decision='held' then
        if latest.id is null or latest.document_text<>p_document_text then raise exception 'reward_league_publication_conflict'; end if;
      else
        c:=app_private.reward_league_policy_context_v3(v->'facts');source:=d->'source';
        if d->>'schema' is distinct from 'raceson-league-publication-document-v3'
          or d-array['schema','draftId','chainId','policyContext','policyReview','source','proposal']<>'{}'::jsonb
          or d->>'draftId' is distinct from p_draft_id::text or d->>'chainId' is distinct from p_chain_id::text
          or d->'policyContext' is distinct from c or d->'policyReview' is distinct from v->'review'
          or v#>>'{review,decision}' is distinct from 'selected' or d#>>'{proposal,state}' is distinct from 'unapproved_proposal'
          or d#>'{proposal,policy}' is distinct from v#>'{review,policy}' or d#>'{proposal,holds}' is distinct from '[]'::jsonb
          or d#>'{proposal,finalPublished}' is distinct from 'false'::jsonb or d#>'{proposal,allocationApproved}' is distinct from 'false'::jsonb
          or d#>>'{proposal,payableWei}' is distinct from '0' then raise exception 'reward_league_publication_not_ready'; end if;
        if source->>'sourceLeagueId' is distinct from c->>'sourceLeagueId' or source->>'sourceSeasonId' is distinct from c->>'sourceSeasonId'
          or jsonb_typeof(source->'rounds') is distinct from 'array' or jsonb_array_length(source->'rounds')<>5
          or source->'league' is distinct from 'null'::jsonb or (source->>'capturedAt')::timestamptz>clock_timestamp()
          then raise exception 'reward_league_publication_not_ready'; end if;
        for row in select value from jsonb_array_elements(source->'rounds') loop
          if row#>'{evidence,held}' is distinct from 'false'::jsonb or row->'resultsComplete' is distinct from 'true'::jsonb
            or jsonb_typeof(row->'results') is distinct from 'array' or (row->>'expectedResultCount')::integer<>jsonb_array_length(row->'results')
            then raise exception 'reward_league_publication_not_ready'; end if;
        end loop;
        -- Native official publication already enforces its announced review.
        -- These source facts are not caller-supplied timestamps or flags.
        if v#>>'{facts,review,decision}' is distinct from 'confirmed'
          or v#>>'{facts,native,document,edition,status}' is distinct from 'completed'
          or jsonb_array_length(v#>'{facts,native,document,races}')=0 then raise exception 'reward_league_publication_not_ready'; end if;
        for row in select value from jsonb_array_elements(v#>'{facts,native,document,races}') loop
          if row#>>'{review,state}' is distinct from 'final' or row->>'status' is distinct from 'completed'
            or row#>>'{review,finalPublicationId}' is distinct from row#>>'{publication,id}'
            then raise exception 'reward_league_publication_not_ready'; end if;
        end loop;
        for i in 1..4 loop
          if not exists(select 1 from jsonb_array_elements(v#>'{facts,historical,decisions}') x
            where x->>'slot'=i::text and x->>'decision'='confirmed_final' and x->'current'='true'::jsonb)
            then raise exception 'reward_league_publication_not_ready'; end if;
        end loop;
      end if;
      stamp:=clock_timestamp();
      insert into app_private.reward_league_publications_v3(id,draft_id,previous_publication_id,source_guard_hash,document_text,document_hash,
        decision,published_at,published_by_user_id,evidence_hash)
      values(p_request_id,p_draft_id,p_previous_publication_id,p_source_guard_hash,p_document_text,encode(sha256(convert_to(p_document_text,'UTF8')),'hex'),
        p_decision,stamp,p_actor_user_id,encode(sha256(convert_to(jsonb_build_object('schema','raceson-league-publication-evidence-v3',
          'id',p_request_id,'documentHash',encode(sha256(convert_to(p_document_text,'UTF8')),'hex'),'decision',p_decision,'publishedAt',stamp)::text,'UTF8')),'hex'))
      returning * into saved;
      latest:=saved;
    end if;
  end if;
  fresh:=public.service_read_reward_league_policy_v3(p_actor_user_id,p_actor_session_id,p_chain_id,p_draft_id,null);
  if app_private.reward_league_publication_guard_v3(fresh)<>g then raise exception 'reward_planning_revision_changed'; end if;
  return jsonb_build_object('policy',fresh,'guardHash',g,'publication',app_private.reward_league_publication_document_v3(latest),
    'recorded',app_private.reward_league_publication_document_v3(saved),'observedAt',clock_timestamp());
end $$;
revoke all on function app_private.reward_league_publication_document_v3(app_private.reward_league_publications_v3),
  app_private.reward_league_publication_guard_v3(jsonb),public.service_reward_league_publication_v3(uuid,uuid,integer,uuid,uuid,text,uuid,text,text)
  from public,anon,authenticated,service_role;
grant execute on function app_private.reward_league_publication_document_v3(app_private.reward_league_publications_v3),
  app_private.reward_league_publication_guard_v3(jsonb),public.service_reward_league_publication_v3(uuid,uuid,integer,uuid,uuid,text,uuid,text,text)
  to service_role;
commit;
