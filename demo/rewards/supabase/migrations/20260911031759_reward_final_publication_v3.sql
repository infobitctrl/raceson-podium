-- Isolated demo only. Attest existing official source clocks; no new review
-- timer, recipient consent, contract mutation or payment is performed here.
begin;
create table app_private.reward_final_publications_v3 (
  id uuid primary key check(id<>'00000000-0000-0000-0000-000000000000'::uuid),
  upload_id uuid not null unique references app_private.reward_allocation_uploads_v3(id),
  context_hash text not null check(context_hash ~ '^[0-9a-f]{64}$'),
  package_hash text not null check(package_hash ~ '^[0-9a-f]{64}$'),
  document_text text not null check(octet_length(document_text)<=1048576),
  document jsonb generated always as (document_text::jsonb) stored,
  evidence_hash text not null check(evidence_hash=encode(sha256(convert_to(document_text,'UTF8')),'hex')),
  recorded_by_user_id uuid not null references public.user_profiles(user_id),
  recorded_at timestamptz not null default clock_timestamp(),
  check((document_text::jsonb->>'schema'='raceson-final-publication-evidence-v3') is true),
  check((document_text::jsonb->>'uploadId'=upload_id::text) is true),
  check((document_text::jsonb->>'contextHash'=context_hash) is true),
  check((document_text::jsonb->>'packageHash'=package_hash) is true)
);
alter table app_private.reward_final_publications_v3 enable row level security;
revoke all on app_private.reward_final_publications_v3 from public,anon,authenticated,service_role;
grant select,insert on app_private.reward_final_publications_v3 to service_role;
create policy reward_final_publications_v3_read on app_private.reward_final_publications_v3 for select to service_role using(true);
create policy reward_final_publications_v3_insert on app_private.reward_final_publications_v3 for insert to service_role with check(true);
create trigger reward_final_publications_v3_immutable before update or delete on app_private.reward_final_publications_v3
  for each row execute function app_private.reject_reward_ledger_mutation();

-- Atomic writer witness. v and u come from the source-locked readers below,
-- not from HTTP. Policies, clocks and IDs are selected from actual native rows.
create function app_private.reward_final_publication_evidence_v3(v jsonb,u jsonb)
returns jsonb language plpgsql stable security invoker set search_path='' set timezone='UTC' as $$
declare d jsonb:=u->'document'; n jsonb:=v#>'{source,policy,facts,native,document}';
  p jsonb:=v#>'{source,publication}'; race jsonb; clocks jsonb:='[]'::jsonb;
  period integer:=(u#>>'{prepared,package,reviewPeriod}')::integer;
  final_period integer:=(v#>>'{registry,context,intent,terms,reviewPeriods,4}')::integer;
  latest_start timestamptz; latest_official timestamptz; official timestamptz; start_at timestamptz; kind text;
begin
  if u->'current' is distinct from 'true'::jsonb or v#>'{approval,current}' is distinct from 'true'::jsonb
    or v#>'{registry,context,intent,current}' is distinct from 'true'::jsonb
    or v#>>'{approval,id}' is distinct from u->>'approvalId' or v->>'contextHash' is distinct from u->>'contextHash'
    or u#>>'{prepared,contextHash}' is distinct from u->>'contextHash'
    or d->>'schema' is distinct from 'raceson-allocation-document-v3.2' or d->>'slot' not in ('5','6')
    or d#>>'{sourceReview,guardHash}' is distinct from v#>>'{source,guardHash}'
    or n#>>'{edition,status}' is distinct from 'completed' or jsonb_array_length(n->'races') not between 1 and 64
    then raise exception 'reward_final_publication_not_ready'; end if;
  if period is null or final_period is null or period not between 0 and 2592000 or final_period not between 0 and 2592000
    or (d->>'slot'='5' and period<>final_period) or (d->>'slot'='6' and period not in (0,final_period))
    then raise exception 'reward_final_review_policy_mismatch'; end if;
  for race in select value from jsonb_array_elements(n->'races') order by value->>'raceId' loop
    if race#>>'{review,reviewSeconds}' is distinct from final_period::text then raise exception 'reward_final_review_policy_mismatch'; end if;
    if race->>'status' is distinct from 'completed' or race#>>'{review,state}' is distinct from 'final'
      or race#>>'{review,finalPublicationId}' is distinct from race#>>'{publication,id}'
      or race#>>'{review,policyId}' is null or race#>>'{review,startedByPublicationId}' is null
      or race#>>'{review,startedAt}' is null or race#>>'{review,officialPublishedAt}' is null
      or (race#>>'{review,configuredAt}')::timestamptz>(race#>>'{review,startedAt}')::timestamptz
      or (race#>>'{review,endsAt}')::timestamptz is distinct from (race#>>'{review,startedAt}')::timestamptz+make_interval(secs=>final_period)
      or (race#>>'{review,officialPublishedAt}')::timestamptz<(race#>>'{review,endsAt}')::timestamptz
      then raise exception 'reward_final_publication_not_ready'; end if;
    latest_start:=greatest(latest_start,(race#>>'{review,startedAt}')::timestamptz);
    latest_official:=greatest(latest_official,(race#>>'{review,officialPublishedAt}')::timestamptz);
    clocks:=clocks||jsonb_build_array(jsonb_build_object('raceId',race->'raceId','competitionId',race->'competitionId',
      'policyId',race#>'{review,policyId}','reviewSeconds',race#>>'{review,reviewSeconds}','configuredAt',race#>'{review,configuredAt}',
      'startedByPublicationId',race#>'{review,startedByPublicationId}','startedAt',race#>'{review,startedAt}','endsAt',race#>'{review,endsAt}',
      'finalPublicationId',race#>'{review,finalPublicationId}','officialPublishedAt',race#>'{review,officialPublishedAt}'));
  end loop;
  if d->>'slot'='6' then
    if p->>'decision' is distinct from 'published' or p->>'id' is distinct from d#>>'{sourceReview,publicationId}'
      or p->>'sourceGuardHash' is distinct from v#>>'{source,guardHash}'
      or p->>'documentHash' is distinct from d#>>'{sourceReview,publicationDocumentHash}'
      or p->>'evidenceHash' is distinct from d#>>'{sourceReview,evidenceHash}'
      or date_trunc('milliseconds',(p->>'publishedAt')::timestamptz) is distinct from (d#>>'{sourceReview,publishedAt}')::timestamptz
      or (p->>'publishedAt')::timestamptz<latest_official then raise exception 'reward_final_publication_not_ready'; end if;
    official:=(d#>>'{sourceReview,publishedAt}')::timestamptz;
    kind:=case when period=0 then 'explicit_zero_league_review' else 'final_round_review' end;
  else official:=latest_official;kind:='native_round_review'; end if;
  start_at:=case when kind='explicit_zero_league_review' then official else latest_start end;
  if floor(extract(epoch from start_at))<1 or floor(extract(epoch from official))<floor(extract(epoch from start_at))+period
    then raise exception 'reward_final_publication_not_ready'; end if;
  return jsonb_build_object('schema','raceson-final-publication-evidence-v3','chainId',d#>'{record,chainId}',
    'draftId',d#>'{record,draftId}','slot',d->'slot','approvalId',u->'approvalId','uploadId',u#>'{prepared,id}',
    'contextHash',u->'contextHash','documentHash',u->'documentHash','packageHash',u#>'{prepared,packageHash}',
    'sourceReview',d->'sourceReview','finalRoundReviewPeriod',final_period::text,'reviewPeriod',period::text,'nativeRaces',clocks,
    'clockKind',kind,'reviewStartedAt',floor(extract(epoch from start_at))::bigint::text,
    'officialPublishedAt',floor(extract(epoch from official))::bigint::text);
end $$;

create function public.service_reward_final_publication_v3(p_actor_user_id uuid,p_actor_session_id uuid,p_chain_id integer,p_draft_id uuid,
  p_slot integer,p_approval_id uuid,p_upload_id uuid,p_request_id uuid,p_context_hash text,p_package_hash text,p_document_text text)
returns jsonb language plpgsql volatile security invoker set search_path='' set timezone='UTC' as $$
declare v jsonb; u jsonb; fresh jsonb; expected jsonb; saved app_private.reward_final_publications_v3%rowtype;
begin
  if p_slot is null or p_slot not in(5,6) then raise exception 'invalid_reward_final_publication'; end if;
  perform app_private.lock_reward_programme_lifecycle_v3(p_actor_user_id,p_actor_session_id,p_chain_id,p_draft_id);
  v:=public.service_read_reward_final_allocation_v3(p_actor_user_id,p_actor_session_id,p_chain_id,p_draft_id,p_slot,null);
  u:=public.service_read_reward_final_allocation_upload_v3(p_actor_user_id,p_actor_session_id,p_chain_id,p_draft_id,p_slot,p_approval_id);
  if p_upload_id is null or u#>>'{prepared,id}' is distinct from p_upload_id::text then raise exception 'reward_allocation_upload_not_found'; end if;
  if v#>>'{registry,context,intent,createdByUserId}' is distinct from p_actor_user_id::text then raise exception 'reward_programme_not_verified'; end if;
  select * into saved from app_private.reward_final_publications_v3 where upload_id=p_upload_id;
  if p_request_id is null then
    if p_context_hash is not null or p_package_hash is not null or p_document_text is not null then raise exception 'invalid_reward_final_publication'; end if;
  else
    if p_request_id='00000000-0000-0000-0000-000000000000'::uuid or p_context_hash is null or p_package_hash is null
      or p_document_text is null or octet_length(p_document_text)>1048576 then raise exception 'invalid_reward_final_publication'; end if;
    if saved.id is not null then
      if saved.id<>p_request_id or saved.context_hash<>p_context_hash or saved.package_hash<>p_package_hash
        or saved.document_text<>p_document_text or saved.recorded_by_user_id<>p_actor_user_id
        then raise exception 'reward_final_publication_conflict'; end if;
    else
      if exists(select 1 from app_private.reward_final_publications_v3 where id=p_request_id) then raise exception 'reward_final_publication_conflict'; end if;
      if u->>'contextHash'<>p_context_hash or u#>>'{prepared,packageHash}'<>p_package_hash then raise exception 'reward_planning_revision_changed'; end if;
      expected:=app_private.reward_final_publication_evidence_v3(v,u);
      if p_document_text::jsonb is distinct from expected then raise exception 'invalid_reward_final_publication'; end if;
      insert into app_private.reward_final_publications_v3(id,upload_id,context_hash,package_hash,document_text,evidence_hash,recorded_by_user_id)
        values(p_request_id,p_upload_id,p_context_hash,p_package_hash,p_document_text,encode(sha256(convert_to(p_document_text,'UTF8')),'hex'),p_actor_user_id) returning * into saved;
      fresh:=public.service_read_reward_final_allocation_v3(p_actor_user_id,p_actor_session_id,p_chain_id,p_draft_id,p_slot,null);
      if fresh->>'contextHash' is distinct from v->>'contextHash' or fresh#>'{approval,current}' is distinct from 'true'::jsonb
        then raise exception 'reward_planning_revision_changed'; end if;
      v:=fresh;
    end if;
  end if;
  fresh:=public.service_read_reward_final_allocation_upload_v3(p_actor_user_id,p_actor_session_id,p_chain_id,p_draft_id,p_slot,p_approval_id);
  if fresh is distinct from u then raise exception 'reward_planning_revision_changed'; end if;
  perform app_private.require_reward_account(p_actor_user_id,p_actor_session_id);
  return jsonb_build_object('schema','raceson-final-publication-private-v3','source',v->'source','registry',v->'registry','upload',u,
    'publication',case when saved.id is null then null else jsonb_build_object('id',saved.id,'uploadId',saved.upload_id,
      'contextHash',saved.context_hash,'packageHash',saved.package_hash,'evidenceHash',saved.evidence_hash,'document',saved.document,
      'recordedAt',saved.recorded_at,'recordedByUserId',saved.recorded_by_user_id) end);
end $$;
revoke all on function app_private.reward_final_publication_evidence_v3(jsonb,jsonb) from public,anon,authenticated,service_role;
grant execute on function app_private.reward_final_publication_evidence_v3(jsonb,jsonb) to service_role;
revoke all on function public.service_reward_final_publication_v3(uuid,uuid,integer,uuid,integer,uuid,uuid,uuid,text,text,text) from public,anon,authenticated,service_role;
grant execute on function public.service_reward_final_publication_v3(uuid,uuid,integer,uuid,integer,uuid,uuid,uuid,text,text,text) to service_role;

-- Historical publication semantics are unchanged. The final branch reads a
-- saved aggregate attestation even after a hold, enabling receipt recovery.
create or replace function app_private.reward_programme_publication_binding_v3(p_upload uuid)
returns jsonb language plpgsql stable security invoker set search_path='' as $$
declare r app_private.reward_round_reviews_v3%rowtype; f app_private.reward_round_publications_v3%rowtype;
  u app_private.reward_allocation_uploads_v3%rowtype; document jsonb; f_final app_private.reward_final_publications_v3%rowtype;
begin
  select * into u from app_private.reward_allocation_uploads_v3 where id=p_upload;
  select a.document into document from app_private.reward_allocation_approvals_v3 a where a.id=u.approval_id;
  if document->>'schema'='raceson-allocation-document-v3.2' and document->>'slot' in ('5','6') then
    select * into f_final from app_private.reward_final_publications_v3 where upload_id=p_upload;
    if f_final.id is null or f_final.context_hash is distinct from u.context_hash or f_final.package_hash is distinct from u.package_hash
      or f_final.document->'sourceReview' is distinct from document->'sourceReview'
      or f_final.document->'reviewPeriod' is distinct from u.package->'reviewPeriod'
      or f_final.document->>'approvalId' is distinct from u.approval_id::text
      or f_final.document->>'documentHash' is distinct from u.document_hash
      or f_final.document->'slot' is distinct from document->'slot'
      then raise exception 'reward_final_publication_required'; end if;
    return jsonb_build_object('reviewId',f_final.id,'publicationId',f_final.id,
      'reviewPeriod',f_final.document->'reviewPeriod','reviewStartedAt',f_final.document->'reviewStartedAt',
      'officialPublishedAt',f_final.document->'officialPublishedAt','publicationEvidenceHash','0x'||f_final.evidence_hash);
  end if;
  select * into r from app_private.reward_round_reviews_v3 where upload_id=p_upload;
  select * into f from app_private.reward_round_publications_v3 where review_id=r.id;
  if f.id is null or r.package_hash is distinct from u.package_hash or r.context_hash is distinct from u.context_hash
    or u.package->>'chainId' is distinct from '31337' or document#>>'{source,kind}' is distinct from 'synthetic_rehearsal'
    or r.review_seconds::text is distinct from u.package->>'reviewPeriod' or extract(epoch from r.started_at)<1
    or f.published_at<r.started_at+make_interval(secs=>r.review_seconds)
    then raise exception 'reward_round_publication_required'; end if;
  return jsonb_build_object('reviewId',r.id,'publicationId',f.id,'reviewPeriod',r.review_seconds::text,
    'reviewStartedAt',floor(extract(epoch from r.started_at))::bigint::text,
    'officialPublishedAt',floor(extract(epoch from f.published_at))::bigint::text,'publicationEvidenceHash',f.evidence_hash);
end $$;

alter table app_private.reward_programme_lifecycle_intents_v3 drop constraint reward_final_execution_upload_only_v3;
alter table app_private.reward_programme_lifecycle_intents_v3 add constraint reward_final_execution_publication_v3
  check(slot<=4 or (body->>'action' in ('complete_funding','upload_awards','stage_allocation','activate')) is true);

create or replace function app_private.guard_reward_execution_source_v3()
returns trigger language plpgsql security invoker set search_path='' as $$
declare d jsonb; p jsonb; slot integer;
begin
  select a.document,u.package,a.slot into d,p,slot from app_private.reward_allocation_uploads_v3 u
    join app_private.reward_allocation_approvals_v3 a on a.id=u.approval_id where u.id=new.upload_id;
  if slot is distinct from new.slot or d->>'slot' is distinct from new.slot::text
    or d->>'schema' is distinct from (case when new.slot<=4 then 'raceson-allocation-document-v3.1' else 'raceson-allocation-document-v3.2' end)
    or p->>'enabledPot' is distinct from (case when new.slot=6 then '1' else '0' end)
    then raise exception 'invalid_reward_programme_lifecycle'; end if;
  if new.slot in (5,6) and new.body->>'action' in ('stage_allocation','activate') then
    if new.body->'publication' is distinct from app_private.reward_programme_publication_binding_v3(new.upload_id)
      then raise exception 'reward_round_publication_conflict'; end if;
  end if;
  return new;
end $$;

-- Keep confirmed predecessors, original exact binding and all old V3 guards.
create or replace function app_private.guard_reward_programme_activation_intent_v3()
returns trigger language plpgsql security invoker set search_path='' as $$
declare previous app_private.reward_programme_lifecycle_intents_v3%rowtype; u jsonb; publication jsonb; n integer;
begin
  if new.body->>'action'='complete_funding' then return new; end if;
  select * into previous from app_private.reward_programme_lifecycle_intents_v3 where id=new.predecessor_id;
  if new.body->>'action'='upload_awards' then
    if previous.body->>'action' not in('complete_funding','upload_awards')
      then raise exception 'invalid_reward_programme_lifecycle'; end if;
    return new;
  end if;
  if new.body->>'action' not in('stage_allocation','activate') or new.body->>'action' is null
    then raise exception 'invalid_reward_programme_lifecycle'; end if;
  select package into u from app_private.reward_allocation_uploads_v3 where id=new.upload_id;
  publication:=app_private.reward_programme_publication_binding_v3(new.upload_id);
  if (new.slot<=4 and new.chain_id<>31337) or new.body->'publication' is distinct from publication
    or publication->'reviewPeriod' is distinct from u->'reviewPeriod'
    or previous.programme_intent_id is distinct from new.programme_intent_id
    or previous.upload_id is distinct from new.upload_id or previous.slot is distinct from new.slot
    or new.step<>previous.step+1 or new.body->'batchStart' is distinct from 'null'::jsonb
    or new.body->'batchSize' is distinct from 'null'::jsonb
    then raise exception 'reward_round_publication_conflict'; end if;
  if not exists(select 1 from app_private.reward_programme_lifecycle_jobs_v3 j
    join app_private.reward_programme_lifecycle_receipts_v3 c on c.job_id=j.id
    where j.intent_id=previous.id and j.state='confirmed')
    then raise exception 'reward_programme_lifecycle_predecessor_required'; end if;
  n:=jsonb_array_length(u->'awards');
  if new.body->>'action'='stage_allocation' then
    if not((n=0 and previous.body->>'action'='complete_funding')
      or (previous.body->>'action'='upload_awards' and (previous.body->>'batchStart')::integer+(previous.body->>'batchSize')::integer=n))
      then raise exception 'reward_programme_lifecycle_predecessor_required'; end if;
  elsif previous.body->>'action' is distinct from 'stage_allocation' or previous.body->'publication' is distinct from publication then
    raise exception 'reward_programme_lifecycle_predecessor_required';
  end if;
  return new;
end $$;

commit;
