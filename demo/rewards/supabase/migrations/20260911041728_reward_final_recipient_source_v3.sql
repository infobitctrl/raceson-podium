-- Isolated rewards demo only. No production SQL, athlete wallets or new claim authority without current source checks.
begin;
-- Private subject projection: the caller must authorize and lock the source first.
create function app_private.reward_result_review_document_v3(p_category_id uuid)
returns jsonb language plpgsql volatile security invoker set search_path='' set timezone='UTC' as $$
declare org uuid; p app_private.reward_result_review_policies_v3%rowtype;
  c app_private.reward_result_review_clocks_v3%rowtype; latest public.result_publications%rowtype;
  final_record app_private.reward_final_publication_evidence_v3%rowtype;
  held boolean; phase text; observed timestamptz;
begin
  select s.organization_id into org from public.event_categories r join public.event_editions e on e.id=r.event_edition_id
    join public.event_series s on s.id=e.event_series_id where r.id=p_category_id;
  select * into p from app_private.reward_result_review_policies_v3 where event_category_id=p_category_id order by revision desc limit 1;
  select * into c from app_private.reward_result_review_clocks_v3 where event_category_id=p_category_id;
  select * into latest from public.result_publications where event_category_id=p_category_id order by published_at desc,created_at desc,id desc limit 1;
  select * into final_record from app_private.reward_final_publication_evidence_v3 where publication_id=latest.id and policy_id=p.id;
  held:=app_private.reward_result_review_held_v3(p_category_id); observed:=clock_timestamp();
  phase:=case when p.id is null then 'unconfigured' when held then 'held' when c.policy_id is null then 'awaiting_provisional'
    when observed<c.started_at+make_interval(secs=>p.review_seconds) then 'in_review'
    when final_record.publication_id is not null then 'final' else 'awaiting_final' end;
  return jsonb_build_object('schema','raceson-result-review-v3','categoryId',p_category_id,'organizationId',org,'observedAt',observed,
    'state',phase,'revision',coalesce(p.revision,0),'reviewSeconds',p.review_seconds,'policyId',p.id,
    'configuredAt',p.configured_at,'locked',latest.id is not null,'held',held,
    'startedAt',c.started_at,'startedByPublicationId',c.started_by_publication_id,
    'endsAt',c.started_at+make_interval(secs=>p.review_seconds),
    'latestPublicationId',latest.id,'finalPublicationId',case when phase='final' then final_record.publication_id end,
    'officialPublishedAt',case when phase='final' then final_record.official_published_at end,
    'allocationApproved',false);
end $$;

revoke all on function app_private.reward_result_review_document_v3(uuid) from public,anon,authenticated,service_role;
grant execute on function app_private.reward_result_review_document_v3(uuid) to service_role;

-- Called only after actual recipient/operator authorization in the readiness reader.
-- Compose the same source commitment as organizer preparation without borrowing
-- an organizer session or exposing the source document to the recipient.
create function app_private.reward_final_recipient_source_v3(p_upload_id uuid)
returns jsonb language plpgsql volatile security invoker set search_path='' set timezone='UTC' as $$
declare u app_private.reward_allocation_uploads_v3%rowtype; a app_private.reward_allocation_approvals_v3%rowtype;
  d app_private.reward_planning_drafts%rowtype; m app_private.reward_source_mappings_v2%rowtype;
  i app_private.reward_programme_deployment_intents_v3%rowtype; f app_private.reward_programme_approvals_v3%rowtype;
  latest_f app_private.reward_programme_approvals_v3%rowtype; registry app_private.reward_programme_registry_v3%rowtype;
  b app_private.reward_finale_bindings_v3%rowtype; cr app_private.reward_native_continuity_reviews_v3%rowtype;
  pr app_private.reward_league_policy_reviews_v3%rowtype; lp app_private.reward_league_publications_v3%rowtype;
  fp app_private.reward_final_publications_v3%rowtype;
  record jsonb; workspace jsonb; catalogue jsonb; snapshot jsonb; source_hash text; historical jsonb; decisions jsonb;
  reviews jsonb:='{}'::jsonb; pair jsonb; native jsonb; observed_native jsonb; v jsonb; source_context text; funding_context text;
  base_guard text; policy_guard text; source_guard text; context_hash text; intent jsonb; registered jsonb; guard jsonb; current boolean;
begin
  select * into u from app_private.reward_allocation_uploads_v3 where id=p_upload_id;
  select * into a from app_private.reward_allocation_approvals_v3 where id=u.approval_id;
  select * into d from app_private.reward_planning_drafts where id=a.draft_id;
  select * into i from app_private.reward_programme_deployment_intents_v3 where draft_id=d.id;
  if d.id is null or i.id is null or a.slot not in (5,6) or a.document->>'schema' is distinct from 'raceson-allocation-document-v3.2'
    then raise exception 'reward_readiness_scope_required'; end if;
  select * into m from app_private.reward_source_mappings_v2 where draft_id=d.id;
  select * into f from app_private.reward_programme_approvals_v3 where id=i.approval_id;
  select * into latest_f from app_private.reward_programme_approvals_v3 where draft_id=d.id order by sequence desc limit 1;
  select r.* into registry from app_private.reward_programme_registry_v3 r join app_private.reward_programme_jobs_v3 j on j.id=r.job_id
    where r.intent_id=i.id and j.state='confirmed';
  select * into b from app_private.reward_finale_bindings_v3 where draft_id=d.id order by sequence desc limit 1;
  -- The parent reader already owns the organization/draft locks; native review
  -- writers serialize on these category rows. The same order is used by organizer reads.
  for pair in select value from jsonb_array_elements(coalesce(b.races,'[]'::jsonb)) order by value->>'raceId' loop
    perform 1 from public.event_categories where id=(pair->>'raceId')::uuid for update;
    v:=app_private.reward_result_review_document_v3((pair->>'raceId')::uuid);
    reviews:=reviews||jsonb_build_object(pair->>'raceId',v-'observedAt');
  end loop;
  native:=app_private.reward_native_finale_document_v3(d.id,reviews);
  if octet_length(native::text)>8388608 or (select coalesce(sum((r->>'expectedResultCount')::bigint),0)
    from jsonb_array_elements(native->'races') r)>10000 then raise exception 'reward_readiness_scope_required'; end if;
  record:=app_private.reward_planning_document(d); catalogue:=app_private.reward_planning_catalogue_v3(d.id);
  workspace:=jsonb_build_object('draftId',d.id,'revision',coalesce(m.revision,0),'rulesRevision',d.revision,
    'catalogueHash',encode(sha256(convert_to(catalogue::text,'UTF8')),'hex'),'boundCatalogueHash',m.catalogue_hash,
    'mapping',m.mapping,'catalogue',catalogue);
  select s.payload,s.source_hash into snapshot,source_hash from app_private.reward_public_snapshots_v2 s
    where s.season_id=d.season_id and s.organization_id=d.organization_id;
  historical:=jsonb_build_object('record',record,'workspace',workspace,'snapshot',snapshot,'sourceHash',source_hash);
  source_context:=encode(sha256(convert_to(app_private.reward_historical_source_context_v3(historical)::text,'UTF8')),'hex');
  select coalesce(jsonb_agg(app_private.reward_historical_source_decision_v3(r,source_context) order by r.slot),'[]'::jsonb) into decisions
    from (select distinct on(slot) * from app_private.reward_historical_source_reviews_v3 where draft_id=d.id order by slot,sequence desc) r;
  historical:=historical||jsonb_build_object('contextHash',source_context);
  base_guard:=encode(sha256(convert_to(jsonb_build_object('historical',historical,'native',native)::text,'UTF8')),'hex');
  select * into cr from app_private.reward_native_continuity_reviews_v3 where draft_id=d.id order by sequence desc limit 1;
  policy_guard:=encode(sha256(convert_to(jsonb_build_object('baseGuard',base_guard,'historicalDecisions',decisions,
    'continuityReview',app_private.reward_native_continuity_decision_v3(cr))::text,'UTF8')),'hex');
  select * into pr from app_private.reward_league_policy_reviews_v3 where draft_id=d.id order by sequence desc limit 1;
  source_guard:=app_private.reward_league_publication_guard_v3(jsonb_build_object('guardHash',policy_guard,
    'review',app_private.reward_league_policy_decision_v3(pr)));
  select * into lp from app_private.reward_league_publications_v3 where draft_id=d.id order by sequence desc limit 1;
  funding_context:=encode(sha256(convert_to(app_private.reward_programme_context_v3(record,workspace)::text,'UTF8')),'hex');
  intent:=jsonb_build_object('id',i.id,'approvalId',i.approval_id,'contextHash',f.context_hash,'rules',f.context->'rules','terms',f.terms,
    'chainId',i.chain_id,'operatorAddress',i.operator_address,'nonce',i.nonce::text,'maximumGasCostWei',i.maximum_gas_cost_wei::text,
    'creationCodeHash','0x'||encode(i.creation_code_hash,'hex'),'createdByUserId',i.created_by_user_id,'createdAt',i.created_at,
    'current',f.context_hash=funding_context and latest_f.id=f.id);
  registered:=case when registry.job_id is not null then jsonb_build_object('jobId',registry.job_id,'intentId',registry.intent_id,
    'attemptId',registry.attempt_id,'provenance',registry.provenance,'recordedAt',registry.recorded_at) end;
  context_hash:=encode(sha256(convert_to(jsonb_build_object('schema','raceson-final-allocation-context-v3','slot',a.slot,
    'sourceGuardHash',source_guard,'publication',case when a.slot=6 then app_private.reward_league_publication_document_v3(lp)-'document' else 'null'::jsonb end,
    'intent',intent,'registry',registered)::text,'UTF8')),'hex');
  select * into fp from app_private.reward_final_publications_v3 where upload_id=u.id;
  current:=coalesce(source_hash is not null and m.draft_id is not null and context_hash=a.context_hash and u.context_hash=a.context_hash
    and u.document_hash=a.document_hash and a.document#>>'{sourceReview,guardHash}'=source_guard
    and intent->>'current'='true' and registered is not null
    and a.document#>>'{binding,intentId}'=i.id::text and a.document#>>'{binding,fundingApprovalId}'=i.approval_id::text
    and a.document#>>'{binding,programmeAddress}'=registry.provenance->>'contractAddress'
    and fp.id is not null and fp.context_hash=u.context_hash and fp.package_hash=u.package_hash
    and fp.document->>'documentHash'=u.document_hash and fp.document->'sourceReview'=a.document->'sourceReview'
    and fp.document->'reviewPeriod'=u.package->'reviewPeriod' and fp.document->>'approvalId'=a.id::text
    and (a.slot=5 or lp.decision='published' and lp.source_guard_hash=source_guard)
    and not exists(select 1 from app_private.reward_allocation_approvals_v3 newer where newer.draft_id=d.id and newer.slot=a.slot and newer.sequence>a.sequence)
    and app_private.reward_planning_authorized(i.created_by_user_id,d.organization_id)
    and exists(select 1 from public.user_profiles where user_id=i.created_by_user_id and status='active')
    and exists(select 1 from public.event_editions e join public.event_series s on s.id=e.event_series_id where e.id=b.edition_id and s.organization_id=d.organization_id),false);
  guard:=jsonb_build_object('schema','raceson-final-recipient-source-v3','contextHash',context_hash,'sourceGuardHash',source_guard,
    'publicationId',fp.id,'publicationEvidenceHash',fp.evidence_hash,'approvalId',a.id,'uploadId',u.id,'packageHash',u.package_hash);
  return jsonb_build_object('draftId',d.id,'chainId',d.chain_id,'uploadId',u.id,'approvalId',a.id,'slot',a.slot,
    'operatorUserId',i.created_by_user_id,'operatorAddress',i.operator_address,'current',current,
    'sourceGuardHash',encode(sha256(convert_to(guard::text,'UTF8')),'hex'));
end $$;
revoke all on function app_private.reward_final_recipient_source_v3(uuid) from public,anon,authenticated,service_role;
grant execute on function app_private.reward_final_recipient_source_v3(uuid) to service_role;

create or replace function app_private.reward_recipient_source_v3(p_upload_id uuid)
returns jsonb language plpgsql volatile security invoker set search_path='' as $$
declare u app_private.reward_allocation_uploads_v3%rowtype; a app_private.reward_allocation_approvals_v3%rowtype;
  d app_private.reward_planning_drafts%rowtype; m app_private.reward_source_mappings_v2%rowtype;
  i app_private.reward_programme_deployment_intents_v3%rowtype; f app_private.reward_programme_approvals_v3%rowtype;
  h app_private.reward_historical_source_reviews_v3%rowtype; record jsonb; workspace jsonb; catalogue jsonb;
  source_hash text; source_context text; funding_context text; guard jsonb; current boolean;
begin
  select * into u from app_private.reward_allocation_uploads_v3 where id=p_upload_id;
  select * into a from app_private.reward_allocation_approvals_v3 where id=u.approval_id;
  if a.slot in (5,6) then return app_private.reward_final_recipient_source_v3(p_upload_id); end if;
  if a.slot not between 1 and 4 or a.document->>'schema' is distinct from 'raceson-allocation-document-v3.1' then raise exception 'reward_readiness_scope_required'; end if;
  select * into d from app_private.reward_planning_drafts where id=a.draft_id;
  select * into m from app_private.reward_source_mappings_v2 where draft_id=d.id;
  select * into i from app_private.reward_programme_deployment_intents_v3 where draft_id=d.id;
  select * into f from app_private.reward_programme_approvals_v3 where draft_id=d.id order by sequence desc limit 1;
  select * into h from app_private.reward_historical_source_reviews_v3 where draft_id=d.id and slot=a.slot order by sequence desc limit 1;
  if d.id is null or i.id is null or m.draft_id is null then raise exception 'reward_readiness_scope_required'; end if;
  record:=app_private.reward_planning_document(d);
  catalogue:=app_private.reward_planning_catalogue_v3(d.id);
  workspace:=jsonb_build_object('draftId',d.id,'revision',m.revision,'rulesRevision',d.revision,
    'catalogueHash',encode(sha256(convert_to(catalogue::text,'UTF8')),'hex'),'boundCatalogueHash',m.catalogue_hash,
    'mapping',m.mapping,'catalogue',catalogue);
  select s.source_hash into source_hash from app_private.reward_public_snapshots_v2 s where s.season_id=d.season_id and s.organization_id=d.organization_id;
  source_context:=encode(sha256(convert_to(app_private.reward_historical_source_context_v3(
    jsonb_build_object('record',record,'workspace',workspace,'sourceHash',source_hash))::text,'UTF8')),'hex');
  funding_context:=encode(sha256(convert_to(app_private.reward_programme_context_v3(record,workspace)::text,'UTF8')),'hex');
  current:=coalesce(source_hash is not null and h.context_hash=source_context and h.decision='confirmed_final'
    and a.document->>'sourceContextHash'=source_context and a.document#>>'{decision,id}'=h.id::text
    and f.id=i.approval_id and f.context_hash=funding_context and u.context_hash=a.context_hash
    and a.document#>>'{binding,intentId}'=i.id::text and a.document#>>'{binding,fundingApprovalId}'=i.approval_id::text
    and exists(select 1 from app_private.reward_programme_registry_v3 r where r.intent_id=i.id
      and r.provenance->>'contractAddress'=a.document#>>'{binding,programmeAddress}')
    and not exists(select 1 from app_private.reward_allocation_approvals_v3 newer where newer.draft_id=d.id and newer.slot=a.slot and newer.sequence>a.sequence)
    and app_private.reward_planning_authorized(i.created_by_user_id,d.organization_id)
    and exists(select 1 from public.user_profiles where user_id=i.created_by_user_id and status='active'),false);
  guard:=jsonb_build_object('sourceContextHash',source_context,'sourceDecisionId',h.id,'fundingContextHash',funding_context,
    'fundingApprovalId',f.id,'programmeIntentId',i.id,'approvalId',a.id,'uploadId',u.id,'packageHash',u.package_hash);
  return jsonb_build_object('draftId',d.id,'chainId',d.chain_id,'uploadId',u.id,'approvalId',a.id,'slot',a.slot,
    'operatorUserId',i.created_by_user_id,'operatorAddress',i.operator_address,'current',current,
    'sourceGuardHash',encode(sha256(convert_to(guard::text,'UTF8')),'hex'));
end $$;


create or replace function public.service_read_reward_readiness_v3(p_actor_user_id uuid,p_actor_session_id uuid,p_chain_id integer,
  p_upload_id uuid,p_destination_id uuid,p_role text)
returns jsonb language plpgsql volatile security invoker set search_path='' as $$
declare d app_private.reward_planning_drafts%rowtype; n app_private.reward_athlete_destination_requests%rowtype;
  i app_private.reward_programme_deployment_intents_v3%rowtype; a app_private.reward_allocation_approvals_v3%rowtype;
  c app_private.reward_wallet_challenges%rowtype; p public.athlete_profiles%rowtype;
  r app_private.reward_athlete_readiness_v3%rowtype; source jsonb; destination jsonb; fingerprint text; state text; today date;
begin
  perform app_private.require_reward_account(p_actor_user_id,p_actor_session_id);
  select ap.* into a from app_private.reward_allocation_approvals_v3 ap join app_private.reward_allocation_uploads_v3 u on u.approval_id=ap.id where u.id=p_upload_id;
  select * into d from app_private.reward_planning_drafts where id=a.draft_id;
  select * into i from app_private.reward_programme_deployment_intents_v3 where draft_id=d.id;
  select * into n from app_private.reward_athlete_destination_requests where id=p_destination_id;
  if d.chain_id is distinct from p_chain_id or p_chain_id not in (31337,10143) or n.id is null or i.id is null
    or p_role is null or p_role not in ('recipient','operator')
    or (p_role='operator' and (p_actor_user_id<>i.created_by_user_id or not app_private.reward_planning_authorized(p_actor_user_id,d.organization_id)))
    or (p_role='recipient' and p_actor_user_id<>n.user_id)
    or not exists(select 1 from app_private.reward_allocation_recipients_v3 where approval_id=a.id
      and beneficiary_kind='athlete' and source_beneficiary_id=n.athlete_profile_id) then raise exception 'reward_readiness_scope_required'; end if;
  perform 1 from public.organization_memberships where organization_id=d.organization_id and user_id=i.created_by_user_id for share;
  perform 1 from public.organizations where id=d.organization_id for share;
  if a.slot in (5,6) then perform 1 from app_private.reward_planning_drafts where id=d.id for update;
  else perform 1 from app_private.reward_planning_drafts where id=d.id for share; end if;
  source:=app_private.reward_recipient_source_v3(p_upload_id);
  perform pg_advisory_xact_lock(hashtextextended('reward-wallet-account:'||n.user_id::text,0));
  perform 1 from public.user_profiles where user_id in (i.created_by_user_id,n.user_id) order by user_id for share;
  select * into p from public.athlete_profiles where id=n.athlete_profile_id for share;
  if p_role='recipient' and (p.claimed_by_user_id is distinct from n.user_id or not p.is_claimed or p.status<>'active'
    or p.merged_into_athlete_profile_id is not null) then raise exception 'reward_readiness_scope_required'; end if;
  destination:=app_private.reward_athlete_destination_document(n);
  select ch.* into c from app_private.reward_wallet_challenges ch join app_private.reward_wallet_proofs proof on proof.challenge_id=ch.id where proof.id=n.proof_id;
  if c.chain_id is distinct from p_chain_id or c.user_id is distinct from n.user_id or c.session_id is distinct from n.session_id
    then raise exception 'reward_readiness_scope_required'; end if;
  fingerprint:=app_private.reward_athlete_profile_fingerprint(p.id);
  select * into r from app_private.reward_athlete_readiness_v3 where upload_id=p_upload_id and destination_id=p_destination_id order by sequence desc limit 1;
  today:=(clock_timestamp() at time zone 'Europe/Zagreb')::date;
  state:=case when destination->>'status'='withdrawn' then 'request_withdrawn'
    when destination->>'status'='identity_hold' or not exists(select 1 from public.user_profiles where user_id=n.user_id and status='active') then 'identity_hold'
    when p.date_of_birth is null or p.date_of_birth>today or p.date_of_birth>today-interval '18 years'
      or (p.birth_year is not null and p.birth_year<>extract(year from p.date_of_birth)) then 'age_hold'
    when source->>'current'<>'true' then 'source_hold'
    when r.id is null then 'unreviewed'
    when exists(select 1 from app_private.reward_athlete_readiness_revocations_v3 where review_id=r.id) then 'revoked'
    when r.profile_fingerprint is distinct from fingerprint then 'profile_changed'
    when r.source_guard_hash is distinct from source->>'sourceGuardHash' then 'source_hold'
    else 'reviewed' end;
  if source is distinct from app_private.reward_recipient_source_v3(p_upload_id) then raise exception 'reward_planning_revision_changed'; end if;
  perform app_private.require_reward_account(p_actor_user_id,p_actor_session_id);
  if p_role='operator' and not app_private.reward_planning_authorized(p_actor_user_id,d.organization_id) then raise exception 'reward_readiness_scope_required'; end if;
  return jsonb_build_object('schema','raceson-athlete-readiness-private-v3','actorUserId',p_actor_user_id,'role',p_role,
    'source',source,'destination',destination,'challenge',app_private.reward_wallet_challenge_document(c),
    'profileFingerprint',fingerprint,'dateOfBirth',p.date_of_birth,'birthYear',p.birth_year,'state',state,
    'review',app_private.reward_readiness_document_v3(r));
end $$;


-- Discovery remains an own-profile, non-executable projection. Holds preserve shares.
create or replace function public.service_read_own_reward_allocations_v3(
  p_user_id uuid,p_session_id uuid,p_chain_id integer,p_after_id text default null)
returns jsonb language plpgsql volatile security invoker set search_path='' as $$
declare result jsonb; today date:=(clock_timestamp() at time zone 'Europe/Zagreb')::date;
begin
  perform app_private.require_reward_account(p_user_id,p_session_id);
  if p_chain_id is null or p_chain_id not in (31337,10143)
    or (p_after_id is not null and p_after_id !~ '^0x[0-9a-f]{64}$') then
    raise exception 'invalid_reward_allocation_query';
  end if;
  perform 1 from public.user_profiles where user_id=p_user_id for share;
  perform 1 from public.athlete_profiles where claimed_by_user_id=p_user_id order by id for share;
  with own as (
    select r.*,a.draft_id,a.slot,a.document,a.approved_at,p.date_of_birth,p.birth_year
    from public.athlete_profiles p
    join app_private.reward_allocation_recipients_v3 r on r.source_beneficiary_id=p.id and r.beneficiary_kind='athlete'
    join app_private.reward_allocation_approvals_v3 a on a.id=r.approval_id
    where p.claimed_by_user_id=p_user_id and p.is_claimed and p.status='active' and p.merged_into_athlete_profile_id is null
      and ((a.slot between 1 and 4 and a.document->>'schema'='raceson-allocation-document-v3.1')
        or (a.slot in (5,6) and a.document->>'schema'='raceson-allocation-document-v3.2'))
      and (a.document#>>'{record,chainId}')::integer=p_chain_id
      and (p_after_id is null or r.entitlement_id>decode(substr(p_after_id,3),'hex'))
      and not exists(select 1 from app_private.reward_allocation_approvals_v3 newer
        where newer.draft_id=a.draft_id and newer.slot=a.slot and newer.sequence>a.sequence)
    order by r.entitlement_id limit 51
  ), page as (select * from own order by entitlement_id limit 50)
  select jsonb_build_object('schema','raceson-own-allocations-v3','chainId',p_chain_id,'items',coalesce((select jsonb_agg(
    jsonb_build_object('entitlementId','0x'||encode(entitlement_id,'hex'),'approvalId',approval_id,
      'draftId',draft_id,'slot',slot,'athleteProfileId',source_beneficiary_id,'chainId',p_chain_id,
      'sourceKind',case when slot=5 then 'native_finale' when slot=6 then 'final_league' else document#>>'{source,kind}' end,'amountWei',amount_wei::text,
      'campaignAddress',document#>>'{binding,campaignAddress}',
      'recordedAt',to_char(approved_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
      'ageStatus',case
        when date_of_birth is not null and (date_of_birth>today or (birth_year is not null and birth_year<>extract(year from date_of_birth))) then 'unknown'
        when date_of_birth is not null and date_of_birth>today-interval '18 years' then 'minor'
        when date_of_birth is null then 'unknown' else 'unverified_adult' end)
    order by entitlement_id) from page),'[]'::jsonb),
    'nextCursor',case when (select count(*) from own)>50 then
      (select '0x'||encode(entitlement_id,'hex') from page order by entitlement_id desc limit 1) else null end) into result;
  perform app_private.require_reward_account(p_user_id,p_session_id);
  return result;
end $$;

commit;
