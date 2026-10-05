-- Demo-only award review. Master authority does not grant sporting writes,
-- planning changes, wallet consent, signing, or arbitrary organization membership.
begin;
create function app_private.reward_master_award_reviewer(p_user_id uuid,p_organization_id uuid)
returns boolean language sql volatile security invoker set search_path='' as $$
 select exists(select 1 from public.platform_administrators a
 join public.user_profiles p on p.user_id=a.user_id
 join public.organizations o on o.id=p_organization_id
 where a.user_id=p_user_id and a.is_active and a.platform_role='super_admin'
 and p.status='active' and o.status='active' and o.kind='organizer')
$$;
create function app_private.reward_award_review_authorized(p_user_id uuid,p_organization_id uuid)
returns boolean language sql volatile security invoker set search_path='' as $$
 select app_private.reward_planning_authorized(p_user_id,p_organization_id)
 or app_private.reward_master_award_reviewer(p_user_id,p_organization_id)
$$;
revoke all on function app_private.reward_master_award_reviewer(uuid,uuid),app_private.reward_award_review_authorized(uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function app_private.reward_master_award_reviewer(uuid,uuid),app_private.reward_award_review_authorized(uuid,uuid) to service_role;

-- Private award-read adapters retain source freshness and current-session checks.
-- Sporting writer RPCs continue to call their original organization-only readers.

CREATE OR REPLACE FUNCTION app_private.award_read_reward_planning_draft(p_actor_user_id uuid, p_actor_session_id uuid, p_chain_id integer, p_draft_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare d app_private.reward_planning_drafts%rowtype; document jsonb;
begin
  perform app_private.require_reward_account(p_actor_user_id,p_actor_session_id);
  perform 1 from public.platform_administrators where user_id=p_actor_user_id and is_active and platform_role='super_admin' for share;
  select draft.* into d from app_private.reward_planning_drafts draft
    join public.league_seasons s on s.id=draft.season_id
    join public.leagues l on l.id=s.league_id and l.organization_id=draft.organization_id
    where draft.id=p_draft_id and draft.chain_id=p_chain_id
      and s.status<>'archived' and l.status<>'archived' for share of s,l;
  if not found or not app_private.reward_award_review_authorized(p_actor_user_id,d.organization_id) then
    raise exception using errcode='42501',message='reward_planning_not_found';
  end if;
  document:=app_private.reward_planning_document(d);
  if document is null then raise exception 'reward_planning_not_found'; end if;
  perform app_private.require_reward_account(p_actor_user_id,p_actor_session_id);
  return document;
end $function$;

revoke all on function app_private.award_read_reward_planning_draft(uuid,uuid,integer,uuid) from public,anon,authenticated,service_role;
grant execute on function app_private.award_read_reward_planning_draft(uuid,uuid,integer,uuid) to service_role;

CREATE OR REPLACE FUNCTION app_private.award_read_reward_mapping_v2(p_actor_user_id uuid, p_actor_session_id uuid, p_chain_id integer, p_draft_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare d app_private.reward_planning_drafts%rowtype; m app_private.reward_source_mappings_v2%rowtype; catalogue jsonb; empty_mapping jsonb;
begin
  perform app_private.award_read_reward_planning_draft(p_actor_user_id,p_actor_session_id,p_chain_id,p_draft_id);
  select * into d from app_private.reward_planning_drafts where id=p_draft_id;
  select * into m from app_private.reward_source_mappings_v2 where draft_id=p_draft_id;
  catalogue:=app_private.reward_planning_catalogue_v3(d.id);
  select jsonb_build_object('version',2,'leagueCategories','[]'::jsonb,'rounds',jsonb_agg(
    jsonb_build_object('slot',i,'roundId',null,'categories','[]'::jsonb) order by i)) into empty_mapping from generate_series(1,5) i;
  perform app_private.require_reward_account(p_actor_user_id,p_actor_session_id);
  if not app_private.reward_award_review_authorized(p_actor_user_id,d.organization_id) then raise exception 'reward_planning_not_found'; end if;
  return jsonb_build_object('draftId',d.id,'revision',coalesce(m.revision,0),'rulesRevision',d.revision,
    'catalogueHash',encode(sha256(convert_to(catalogue::text,'UTF8')),'hex'),
    'boundCatalogueHash',m.catalogue_hash,'mapping',coalesce(m.mapping,empty_mapping),'catalogue',catalogue);
end $function$;

revoke all on function app_private.award_read_reward_mapping_v2(uuid,uuid,integer,uuid) from public,anon,authenticated,service_role;
grant execute on function app_private.award_read_reward_mapping_v2(uuid,uuid,integer,uuid) to service_role;

CREATE OR REPLACE FUNCTION app_private.award_read_reward_published_preview_v2(p_actor_user_id uuid, p_actor_session_id uuid, p_chain_id integer, p_draft_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare d app_private.reward_planning_drafts%rowtype; record jsonb; workspace jsonb; snapshot jsonb; source_hash text;
begin
  perform app_private.award_read_reward_planning_draft(p_actor_user_id,p_actor_session_id,p_chain_id,p_draft_id);
  select * into d from app_private.reward_planning_drafts where id=p_draft_id for share;
  -- Rules and mapping writers take an exclusive lock on this same draft row.
  record:=app_private.award_read_reward_planning_draft(p_actor_user_id,p_actor_session_id,p_chain_id,p_draft_id);
  workspace:=app_private.award_read_reward_mapping_v2(p_actor_user_id,p_actor_session_id,p_chain_id,p_draft_id);
  select s.payload,s.source_hash into snapshot,source_hash from app_private.reward_public_snapshots_v2 s
    where s.season_id=d.season_id and s.organization_id=d.organization_id;
  perform app_private.require_reward_account(p_actor_user_id,p_actor_session_id);
  if not app_private.reward_award_review_authorized(p_actor_user_id,d.organization_id) then raise exception 'reward_planning_not_found'; end if;
  return jsonb_build_object('record',record,'workspace',workspace,'snapshot',snapshot,'sourceHash',source_hash);
end $function$;

revoke all on function app_private.award_read_reward_published_preview_v2(uuid,uuid,integer,uuid) from public,anon,authenticated,service_role;
grant execute on function app_private.award_read_reward_published_preview_v2(uuid,uuid,integer,uuid) to service_role;

CREATE OR REPLACE FUNCTION app_private.award_read_reward_historical_source_v3(p_actor_user_id uuid, p_actor_session_id uuid, p_chain_id integer, p_draft_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
 SET "TimeZone" TO 'UTC'
AS $function$
declare v jsonb; h text; decisions jsonb;
begin
  -- Reuses the atomic imported-snapshot reader, not a new external source fetch.
  v:=app_private.award_read_reward_published_preview_v2(p_actor_user_id,p_actor_session_id,p_chain_id,p_draft_id);
  if v->'snapshot'='null'::jsonb or v->>'sourceHash' is null then raise exception 'reward_historical_source_missing'; end if;
  h:=encode(sha256(convert_to(app_private.reward_historical_source_context_v3(v)::text,'UTF8')),'hex');
  select coalesce(jsonb_agg(app_private.reward_historical_source_decision_v3(r,h) order by r.slot),'[]'::jsonb) into decisions
    from (select distinct on(slot) * from app_private.reward_historical_source_reviews_v3 where draft_id=p_draft_id order by slot,sequence desc) r;
  perform app_private.require_reward_account(p_actor_user_id,p_actor_session_id);
  if not app_private.reward_award_review_authorized(p_actor_user_id,(v#>>'{record,organizationId}')::uuid) then raise exception 'reward_planning_not_found'; end if;
  return v || jsonb_build_object('contextHash',h,'decisions',decisions,'observedAt',clock_timestamp(),'recordedDecision',null);
end $function$;

revoke all on function app_private.award_read_reward_historical_source_v3(uuid,uuid,integer,uuid) from public,anon,authenticated,service_role;
grant execute on function app_private.award_read_reward_historical_source_v3(uuid,uuid,integer,uuid) to service_role;

CREATE OR REPLACE FUNCTION app_private.award_read_reward_result_review_v3(p_actor_user_id uuid, p_actor_session_id uuid, p_category_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
 SET "TimeZone" TO 'UTC'
AS $function$
declare org uuid; p app_private.reward_result_review_policies_v3%rowtype;
  c app_private.reward_result_review_clocks_v3%rowtype; latest public.result_publications%rowtype;
  final_record app_private.reward_final_publication_evidence_v3%rowtype;
  held boolean; phase text; observed timestamptz;
begin
  perform app_private.require_reward_account(p_actor_user_id,p_actor_session_id);
  select s.organization_id into org from public.event_categories r join public.event_editions e on e.id=r.event_edition_id
    join public.event_series s on s.id=e.event_series_id where r.id=p_category_id;
  if org is null or not (app_private.reward_result_review_authorized_v3(p_actor_user_id,org) or app_private.reward_master_award_reviewer(p_actor_user_id,org)) then
    raise exception using errcode='42501',message='reward_result_review_not_found';
  end if;
  -- Serialize observation with policy/publication/hold writes, then recheck Auth.
  perform 1 from public.event_categories where id=p_category_id for update;
  perform app_private.require_reward_account(p_actor_user_id,p_actor_session_id);
  select * into p from app_private.reward_result_review_policies_v3 where event_category_id=p_category_id order by revision desc limit 1;
  select * into c from app_private.reward_result_review_clocks_v3 where event_category_id=p_category_id;
  select * into latest from public.result_publications where event_category_id=p_category_id order by published_at desc,created_at desc,id desc limit 1;
  select * into final_record from app_private.reward_final_publication_evidence_v3 where publication_id=latest.id and policy_id=p.id;
  held:=app_private.reward_result_review_held_v3(p_category_id); observed:=clock_timestamp();
  phase:=case when p.id is null then 'unconfigured' when held then 'held' when c.policy_id is null then 'awaiting_provisional'
    when observed<c.started_at+make_interval(secs=>p.review_seconds) then 'in_review'
    when final_record.publication_id is not null then 'final' else 'awaiting_final' end;
  -- Recheck the live hierarchy too; neither saved org IDs nor JWT roles grant access.
  if not exists(select 1 from public.event_categories r join public.event_editions e on e.id=r.event_edition_id
    join public.event_series s on s.id=e.event_series_id where r.id=p_category_id and s.organization_id=org)
    or (p.id is not null and p.organization_id<>org) or not (app_private.reward_result_review_authorized_v3(p_actor_user_id,org) or app_private.reward_master_award_reviewer(p_actor_user_id,org)) then
    raise exception using errcode='42501',message='reward_result_review_not_found';
  end if;
  perform app_private.require_reward_account(p_actor_user_id,p_actor_session_id);
  return jsonb_build_object('schema','raceson-result-review-v3','categoryId',p_category_id,'organizationId',org,'observedAt',observed,
    'state',phase,'revision',coalesce(p.revision,0),'reviewSeconds',p.review_seconds,'policyId',p.id,
    'configuredAt',p.configured_at,'locked',latest.id is not null,'held',held,
    'startedAt',c.started_at,'startedByPublicationId',c.started_by_publication_id,
    'endsAt',c.started_at+make_interval(secs=>p.review_seconds),
    'latestPublicationId',latest.id,'finalPublicationId',case when phase='final' then final_record.publication_id end,
    'officialPublishedAt',case when phase='final' then final_record.official_published_at end,
    'allocationApproved',false);
end $function$;

revoke all on function app_private.award_read_reward_result_review_v3(uuid,uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function app_private.award_read_reward_result_review_v3(uuid,uuid,uuid) to service_role;

CREATE OR REPLACE FUNCTION app_private.award_read_reward_native_finale_v3(p_actor_user_id uuid, p_actor_session_id uuid, p_chain_id integer, p_draft_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
 SET "TimeZone" TO 'UTC'
AS $function$
declare d jsonb; b app_private.reward_finale_bindings_v3%rowtype; reviews jsonb:='{}'::jsonb;
  pair jsonb; v jsonb; document jsonb; result_count bigint; observed timestamptz;
begin
  d:=app_private.award_read_reward_planning_draft(p_actor_user_id,p_actor_session_id,p_chain_id,p_draft_id);
  perform 1 from public.organization_memberships where user_id=p_actor_user_id and organization_id=(d->>'organizationId')::uuid for share;
  perform 1 from public.organizations where id=(d->>'organizationId')::uuid for share;
  perform 1 from app_private.reward_planning_drafts where id=p_draft_id for update;
  d:=app_private.award_read_reward_planning_draft(p_actor_user_id,p_actor_session_id,p_chain_id,p_draft_id);
  select * into b from app_private.reward_finale_bindings_v3 where draft_id=p_draft_id order by sequence desc limit 1;
  if b.id is not null then
    if not exists(select 1 from public.event_editions e join public.event_series s on s.id=e.event_series_id
      where e.id=b.edition_id and s.organization_id=(d->>'organizationId')::uuid) then raise exception 'reward_planning_not_found'; end if;
    -- Lock category rows in deterministic order, sharing the publication/complaint
    -- lock protocol. Wrong-owner/deleted scope never leaks a native source.
    for pair in select value from jsonb_array_elements(b.races) order by value->>'raceId' loop
      if not exists(select 1 from public.event_categories where id=(pair->>'raceId')::uuid and event_edition_id=b.edition_id) then
        raise exception 'reward_planning_revision_changed'; end if;
      v:=app_private.award_read_reward_result_review_v3(p_actor_user_id,p_actor_session_id,(pair->>'raceId')::uuid);
      if v->>'organizationId' is distinct from d->>'organizationId' then raise exception 'reward_planning_not_found'; end if;
      reviews:=reviews||jsonb_build_object(pair->>'raceId',v-'observedAt');
    end loop;
  end if;
  document:=app_private.reward_native_finale_document_v3(p_draft_id,reviews);
  select coalesce(sum((r->>'expectedResultCount')::bigint),0) into result_count from jsonb_array_elements(document->'races') r;
  if result_count>10000 or octet_length(document::text)>8388608 then raise exception 'reward_native_finale_too_large'; end if;
  -- A clock boundary, correction or authority change during observation requires
  -- a new read, not a partially current source. No writes or backdated clocks.
  for pair in select value from jsonb_array_elements(coalesce(b.races,'[]'::jsonb)) order by value->>'raceId' loop
    v:=app_private.award_read_reward_result_review_v3(p_actor_user_id,p_actor_session_id,(pair->>'raceId')::uuid);
    if v-'observedAt' is distinct from reviews->(pair->>'raceId') then raise exception 'reward_planning_revision_changed'; end if;
  end loop;
  if app_private.reward_native_finale_document_v3(p_draft_id,reviews) is distinct from document
    or app_private.award_read_reward_planning_draft(p_actor_user_id,p_actor_session_id,p_chain_id,p_draft_id) is distinct from d then
    raise exception 'reward_planning_revision_changed'; end if;
  perform app_private.require_reward_account(p_actor_user_id,p_actor_session_id);
  observed:=clock_timestamp();
  return jsonb_build_object('document',document,'observedAt',observed);
end $function$;

revoke all on function app_private.award_read_reward_native_finale_v3(uuid,uuid,integer,uuid) from public,anon,authenticated,service_role;
grant execute on function app_private.award_read_reward_native_finale_v3(uuid,uuid,integer,uuid) to service_role;

CREATE OR REPLACE FUNCTION app_private.award_read_reward_native_continuity_v3(p_actor_user_id uuid, p_actor_session_id uuid, p_chain_id integer, p_draft_id uuid, p_request_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare h jsonb; n jsonb; again jsonb; g text; labels jsonb; latest app_private.reward_native_continuity_reviews_v3%rowtype;
  saved app_private.reward_native_continuity_reviews_v3%rowtype;
begin
  -- Native reader holds membership/org/draft/category locks until this outer
  -- transaction ends. Recheck the stable projections, not observation times.
  n:=app_private.award_read_reward_native_finale_v3(p_actor_user_id,p_actor_session_id,p_chain_id,p_draft_id);
  h:=app_private.award_read_reward_historical_source_v3(p_actor_user_id,p_actor_session_id,p_chain_id,p_draft_id);
  again:=app_private.award_read_reward_native_finale_v3(p_actor_user_id,p_actor_session_id,p_chain_id,p_draft_id);
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
  if h-'observedAt' is distinct from app_private.award_read_reward_historical_source_v3(p_actor_user_id,p_actor_session_id,p_chain_id,p_draft_id)-'observedAt'
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
  if not app_private.reward_award_review_authorized(p_actor_user_id,(h#>>'{record,organizationId}')::uuid) then raise exception 'reward_planning_not_found'; end if;
  return jsonb_build_object('historical',h,'native',n,'guardHash',g,'labels',labels,
    'review',app_private.reward_native_continuity_decision_v3(latest),'recordedReview',app_private.reward_native_continuity_decision_v3(saved));
end $function$;

revoke all on function app_private.award_read_reward_native_continuity_v3(uuid,uuid,integer,uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function app_private.award_read_reward_native_continuity_v3(uuid,uuid,integer,uuid,uuid) to service_role;

CREATE OR REPLACE FUNCTION app_private.award_read_reward_league_policy_v3(p_actor_user_id uuid, p_actor_session_id uuid, p_chain_id integer, p_draft_id uuid, p_request_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare f jsonb; latest app_private.reward_league_policy_reviews_v3%rowtype; saved app_private.reward_league_policy_reviews_v3%rowtype; g text;
begin
  -- Reuses actual current-session/org/draft/category locks and source rechecks.
  f:=app_private.award_read_reward_native_continuity_v3(p_actor_user_id,p_actor_session_id,p_chain_id,p_draft_id,null);
  g:=encode(sha256(convert_to(jsonb_build_object('baseGuard',f->'guardHash','historicalDecisions',f#>'{historical,decisions}',
    'continuityReview',f->'review')::text,'UTF8')),'hex');
  select * into latest from app_private.reward_league_policy_reviews_v3 where draft_id=p_draft_id order by sequence desc limit 1;
  if p_request_id is not null then
    select * into saved from app_private.reward_league_policy_reviews_v3 where id=p_request_id;
    if found and (saved.draft_id<>p_draft_id or saved.reviewed_by_user_id<>p_actor_user_id) then raise exception 'reward_league_policy_conflict'; end if;
  end if;
  perform app_private.require_reward_account(p_actor_user_id,p_actor_session_id);
  if not app_private.reward_award_review_authorized(p_actor_user_id,(f#>>'{historical,record,organizationId}')::uuid) then raise exception 'reward_planning_not_found'; end if;
  return jsonb_build_object('facts',f,'guardHash',g,'review',app_private.reward_league_policy_decision_v3(latest),
    'recordedReview',app_private.reward_league_policy_decision_v3(saved));
end $function$;

revoke all on function app_private.award_read_reward_league_policy_v3(uuid,uuid,integer,uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function app_private.award_read_reward_league_policy_v3(uuid,uuid,integer,uuid,uuid) to service_role;

CREATE OR REPLACE FUNCTION app_private.award_reward_league_publication_v3(p_actor_user_id uuid, p_actor_session_id uuid, p_chain_id integer, p_draft_id uuid, p_request_id uuid, p_decision text, p_previous_publication_id uuid, p_source_guard_hash text, p_document_text text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare v jsonb; fresh jsonb; d jsonb; c jsonb; source jsonb; row jsonb; g text; stamp timestamptz;
  latest app_private.reward_league_publications_v3%rowtype; saved app_private.reward_league_publications_v3%rowtype;
begin
  if p_request_id is not null or p_decision is not null or p_previous_publication_id is not null or p_source_guard_hash is not null or p_document_text is not null then raise exception 'reward_award_read_only'; end if;
  -- Existing private source adapter checks current Auth/org and holds shared
  -- source/category locks. Its draft lock serializes all review/publication CAS.
  v:=app_private.award_read_reward_league_policy_v3(p_actor_user_id,p_actor_session_id,p_chain_id,p_draft_id,null);
  g:=app_private.reward_league_publication_guard_v3(v);
  select * into latest from app_private.reward_league_publications_v3 where draft_id=p_draft_id order by sequence desc limit 1;
  fresh:=app_private.award_read_reward_league_policy_v3(p_actor_user_id,p_actor_session_id,p_chain_id,p_draft_id,null);
  if app_private.reward_league_publication_guard_v3(fresh)<>g then raise exception 'reward_planning_revision_changed'; end if;
  return jsonb_build_object('policy',fresh,'guardHash',g,'publication',app_private.reward_league_publication_document_v3(latest),
    'recorded',app_private.reward_league_publication_document_v3(saved),'observedAt',clock_timestamp());
end $function$;

revoke all on function app_private.award_reward_league_publication_v3(uuid,uuid,integer,uuid,uuid,text,uuid,text,text) from public,anon,authenticated,service_role;
grant execute on function app_private.award_reward_league_publication_v3(uuid,uuid,integer,uuid,uuid,text,uuid,text,text) to service_role;

CREATE OR REPLACE FUNCTION public.service_read_reward_sponsor_allocation_v4(p_actor_user_id uuid, p_actor_session_id uuid, p_chain_id integer, p_setup_id uuid, p_slot integer, p_request_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare d app_private.reward_distribution_setups%rowtype; e app_private.reward_sponsor_executions%rowtype;
 l app_private.reward_sponsor_launches%rowtype; r app_private.reward_setup_revisions%rowtype;
 draft uuid; organizer jsonb; facts jsonb; launch jsonb; execution jsonb; guard text; stable_source jsonb;
 latest app_private.reward_sponsor_allocation_approvals_v4%rowtype; saved app_private.reward_sponsor_allocation_approvals_v4%rowtype;
begin
 perform app_private.require_reward_account(p_actor_user_id,p_actor_session_id);
 if p_chain_id is null or p_chain_id not in(10143,31337) or p_slot is null or p_slot not between 0 and 5 or p_setup_id is null then raise exception 'invalid_sponsor_allocation'; end if;
 -- Source authority, NOT sponsor ownership, determines who may review awards.
 select * into d from app_private.reward_distribution_setups where id=p_setup_id and chain_id=p_chain_id and archived_at is null;
 if d.id is null then raise exception 'reward_setup_not_found'; end if;
 select * into e from app_private.reward_sponsor_executions where setup_id=d.id;
 if e.setup_id is null then raise exception 'reward_sponsor_source_not_ready'; end if;
 select * into strict l from app_private.reward_sponsor_launches where id=e.launch_id;
 select * into strict r from app_private.reward_setup_revisions where setup_id=d.id and revision=l.setup_revision;
 draft:=(r.configuration#>>'{context,draftId}')::uuid;
 if draft is null then raise exception 'reward_sponsor_source_not_ready'; end if;
 organizer:=app_private.award_read_reward_planning_draft(p_actor_user_id,p_actor_session_id,p_chain_id,draft);
 perform 1 from public.organization_memberships where user_id=p_actor_user_id and organization_id=(organizer->>'organizationId')::uuid for share;
 perform 1 from public.organizations where id=(organizer->>'organizationId')::uuid for share;
 -- All source review writers also serialize on this draft. Lock before setup to avoid reversed source/setup waits.
 perform 1 from app_private.reward_planning_drafts where id=draft for update;
 perform pg_advisory_xact_lock(hashtextextended('reward-setup:'||p_setup_id::text,0));
 perform 1 from app_private.reward_distribution_setups where id=d.id and archived_at is null for share;
 if not found then raise exception 'reward_setup_not_found'; end if;
 if p_slot between 1 and 4 then
  facts:=app_private.award_read_reward_historical_source_v3(p_actor_user_id,p_actor_session_id,p_chain_id,draft);
  stable_source:=jsonb_build_object('contextHash',facts->'contextHash','decisions',facts->'decisions');
 else
  facts:=app_private.award_reward_league_publication_v3(p_actor_user_id,p_actor_session_id,p_chain_id,draft,null,null,null,null,null);
  stable_source:=jsonb_build_object('guardHash',facts->'guardHash','publication',facts->'publication');
 end if;
 launch:=jsonb_build_object('id',l.id,'state','prepared','configurationHash',l.configuration_hash,
  'createdAt',to_char(l.created_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
  'setup',jsonb_build_object('id',d.id,'chainId',d.chain_id,'revision',r.revision,'configuration',r.configuration,
   'updatedAt',to_char(r.saved_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')));
 -- Transaction hashes are not source decisions and do not change an award calculation.
 execution:=jsonb_build_object('plan',e.plan,'deploymentHash',e.deployment_hash,'fundingHash',e.funding_hash);
 guard:=encode(sha256(convert_to(jsonb_build_object('launch',launch,'plan',e.plan,'slot',p_slot,'source',stable_source)::text,'UTF8')),'hex');
 select * into latest from app_private.reward_sponsor_allocation_approvals_v4 where setup_id=d.id and slot=p_slot order by sequence desc limit 1;
 select * into saved from app_private.reward_sponsor_allocation_approvals_v4 where id=p_request_id and setup_id=d.id and slot=p_slot and actor_user_id=p_actor_user_id;
 perform app_private.require_reward_account(p_actor_user_id,p_actor_session_id);
 if not app_private.reward_award_review_authorized(p_actor_user_id,(organizer->>'organizationId')::uuid) then raise exception 'reward_planning_not_found'; end if;
 return jsonb_build_object('launch',launch,'execution',execution,'sourceFacts',facts,'contextHash',guard,
  'approval',case when latest.id is null then null else app_private.reward_sponsor_approval_document_v4(latest,guard) end,
  'recorded',case when saved.id is null then null else app_private.reward_sponsor_approval_document_v4(saved,guard) end);
end $function$;

CREATE OR REPLACE FUNCTION app_private.reward_sponsor_source_stamp_v4(p_approval_id uuid)
 RETURNS text
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
 select encode(sha256(convert_to(jsonb_build_object(
 'draft',to_jsonb(d),'mapping',to_jsonb(m),'source',s.source_hash,
 'catalogue',app_private.reward_planning_catalogue_v3(d.id),
 'historical',(select jsonb_agg(to_jsonb(h) order by h.sequence) from app_private.reward_historical_source_reviews_v3 h where h.draft_id=d.id),
 'native',case when a.slot in(0,5) then app_private.reward_native_finale_document_v3(d.id,null) end,
 'continuity',(select jsonb_agg(to_jsonb(c) order by c.sequence) from app_private.reward_native_continuity_reviews_v3 c where c.draft_id=d.id),
 'policy',(select jsonb_agg(to_jsonb(c) order by c.sequence) from app_private.reward_league_policy_reviews_v3 c where c.draft_id=d.id),
 'league',(select jsonb_agg(to_jsonb(c) order by c.sequence) from app_private.reward_league_publications_v3 c where c.draft_id=d.id),
 'reviews',(select jsonb_agg(jsonb_build_object('race',pair->>'raceId','held',app_private.reward_result_review_held_v3((pair->>'raceId')::uuid),
  'policy',(select jsonb_agg(to_jsonb(p) order by p.revision) from app_private.reward_result_review_policies_v3 p where p.event_category_id=(pair->>'raceId')::uuid),
  'clock',(select to_jsonb(c) from app_private.reward_result_review_clocks_v3 c where c.event_category_id=(pair->>'raceId')::uuid),
  'final',(select jsonb_agg(to_jsonb(f) order by f.publication_id) from app_private.reward_final_publication_evidence_v3 f where f.event_category_id=(pair->>'raceId')::uuid)) order by pair->>'raceId')
  from jsonb_array_elements(b.races) pair),
 'latest',(select x.id from app_private.reward_sponsor_allocation_approvals_v4 x where x.setup_id=a.setup_id and x.slot=a.slot order by x.sequence desc limit 1),
 'archived',setup.archived_at,'execution',to_jsonb(e),
 'authority',app_private.reward_award_review_authorized(a.actor_user_id,d.organization_id),
 'active',exists(select 1 from public.user_profiles where user_id=a.actor_user_id and status='active')
 )::text,'UTF8')),'hex')
 from app_private.reward_sponsor_allocation_approvals_v4 a
 join app_private.reward_distribution_setups setup on setup.id=a.setup_id
 join app_private.reward_sponsor_executions e on e.setup_id=a.setup_id
 join app_private.reward_planning_drafts d on d.id=(a.document_text::jsonb#>>'{binding,draftId}')::uuid
 left join app_private.reward_source_mappings_v2 m on m.draft_id=d.id
 left join app_private.reward_public_snapshots_v2 s on s.season_id=d.season_id and s.organization_id=d.organization_id
 left join lateral(select * from app_private.reward_finale_bindings_v3 where draft_id=d.id order by sequence desc limit 1)b on true
 where a.id=p_approval_id
$function$;

CREATE OR REPLACE FUNCTION public.service_sponsor_claim_v4(p_actor_user_id uuid, p_actor_session_id uuid, p_chain_id integer, p_claim_id uuid, p_role text, p_action text DEFAULT NULL::text, p_body_text text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
 SET "TimeZone" TO 'UTC'
AS $function$
declare c app_private.reward_sponsor_claims_v4%rowtype; a app_private.reward_sponsor_allocation_approvals_v4%rowtype;
 r app_private.reward_sponsor_recipients_v4%rowtype; n app_private.reward_athlete_destination_requests%rowtype; athlete public.athlete_profiles%rowtype;
 pub app_private.reward_sponsor_lifecycle_v4%rowtype; u app_private.reward_sponsor_uploads_v4%rowtype;
 ch app_private.reward_wallet_challenges%rowtype; execution app_private.reward_sponsor_executions%rowtype;
 b jsonb; old app_private.reward_sponsor_claim_events_v4%rowtype; events jsonb; source_stamp text; fingerprint text; current boolean; destination jsonb;
 today date:=(clock_timestamp() at time zone 'Europe/Zagreb')::date; before_stamp text; fresh jsonb;
begin
 perform app_private.require_reward_account(p_actor_user_id,p_actor_session_id);
 if p_chain_id is null or p_chain_id not in(31337,10143) or p_role is null or p_role not in('recipient','operator') then raise exception 'reward_claim_scope_required'; end if;
 b:=p_body_text::jsonb;
 if p_action='request' then
  if p_role<>'recipient' or b is null or jsonb_typeof(b)<>'object' or (select count(*) from jsonb_object_keys(b))<>3 then raise exception 'invalid_sponsor_claim'; end if;
  select * into n from app_private.reward_athlete_destination_requests where id=(b->>'destinationId')::uuid and user_id=p_actor_user_id;
  select * into r from app_private.reward_sponsor_recipients_v4 where approval_id=(b->>'approvalId')::uuid and entitlement_id=decode(substr(b->>'entitlementId',3),'hex')
   and beneficiary_kind='athlete' and beneficiary_id=n.athlete_profile_id;
  if n.id is null or r.entitlement_id is null then raise exception 'reward_claim_scope_required'; end if;
  select * into c from app_private.reward_sponsor_claims_v4 where id=p_claim_id;
  if c.id is not null and (c.recipient_user_id<>p_actor_user_id or c.destination_id<>n.id or c.approval_id<>r.approval_id or c.entitlement_id<>r.entitlement_id) then raise exception 'reward_sponsor_claim_conflict'; end if;
 else
  select * into c from app_private.reward_sponsor_claims_v4 where id=p_claim_id;
  if c.id is null then raise exception 'reward_claim_scope_required'; end if;
  select * into n from app_private.reward_athlete_destination_requests where id=c.destination_id;
  select * into r from app_private.reward_sponsor_recipients_v4 where entitlement_id=c.entitlement_id and approval_id=c.approval_id;
 end if;
 select * into a from app_private.reward_sponsor_allocation_approvals_v4 where id=r.approval_id;
 select * into pub from app_private.reward_sponsor_lifecycle_v4 where approval_id=a.id and kind='publication';
 select * into u from app_private.reward_sponsor_uploads_v4 where approval_id=a.id;
 select * into execution from app_private.reward_sponsor_executions where setup_id=a.setup_id;
 if pub.id is null or u.id is null or execution.plan->>'chainId'<>p_chain_id::text
  or (p_role='recipient' and p_actor_user_id<>n.user_id) or (p_role='operator' and p_actor_user_id<>pub.actor_user_id) then raise exception 'reward_claim_scope_required'; end if;
 -- Established organization -> draft -> wallet/profile lock order.
 perform 1 from public.organization_memberships where user_id=pub.actor_user_id and organization_id=(select organization_id from app_private.reward_planning_drafts where id=(a.document_text::jsonb#>>'{binding,draftId}')::uuid) for share;
 perform 1 from public.organizations where id=(select organization_id from app_private.reward_planning_drafts where id=(a.document_text::jsonb#>>'{binding,draftId}')::uuid) for share;
 if p_role='operator' then
  fresh:=public.service_read_reward_sponsor_upload_v4(p_actor_user_id,p_actor_session_id,p_chain_id,a.setup_id,a.slot,a.id);
 else
  perform 1 from app_private.reward_planning_drafts where id=(a.document_text::jsonb#>>'{binding,draftId}')::uuid for update;
 end if;
 perform pg_advisory_xact_lock(hashtextextended('reward-wallet-account:'||n.user_id::text,0));
 perform pg_advisory_xact_lock(hashtextextended('sponsor-claim:'||p_claim_id::text,0));
 select * into athlete from public.athlete_profiles where id=r.beneficiary_id for share;
 if athlete.claimed_by_user_id is distinct from n.user_id or not athlete.is_claimed or athlete.status<>'active' or athlete.merged_into_athlete_profile_id is not null then raise exception 'reward_claim_scope_required'; end if;
 destination:=app_private.reward_athlete_destination_document(n);
 select w.* into ch from app_private.reward_wallet_challenges w join app_private.reward_wallet_proofs p on p.challenge_id=w.id where p.id=n.proof_id;
 if ch.user_id is distinct from n.user_id or ch.chain_id is distinct from p_chain_id or ch.session_id is distinct from n.session_id then raise exception 'reward_claim_scope_required'; end if;
 source_stamp:=app_private.reward_sponsor_source_stamp_v4(a.id);fingerprint:=app_private.reward_athlete_profile_fingerprint(athlete.id);
 current:=coalesce(exists(select 1 from public.user_profiles where user_id=n.user_id and status='active')
  and exists(select 1 from public.user_profiles where user_id=pub.actor_user_id and status='active')
  and app_private.reward_award_review_authorized(pub.actor_user_id,(select organization_id from app_private.reward_planning_drafts where id=(a.document_text::jsonb#>>'{binding,draftId}')::uuid))
  and source_stamp=pub.source_stamp and (p_role<>'operator' or fresh->>'current'='true') and destination->>'status'='pending_review'
  and athlete.date_of_birth<=today-interval '18 years' and (athlete.birth_year is null or athlete.birth_year=extract(year from athlete.date_of_birth)),false);
 if p_action='request' then
  select * into c from app_private.reward_sponsor_claims_v4 where id=p_claim_id;
  if c.id is not null and (c.recipient_user_id<>p_actor_user_id or c.destination_id<>n.id or c.approval_id<>r.approval_id or c.entitlement_id<>r.entitlement_id) then raise exception 'reward_sponsor_claim_conflict'; end if;
 end if;
 if p_action='request' and c.id is null then
  if not current then raise exception 'reward_sponsor_claim_not_ready'; end if;
  insert into app_private.reward_sponsor_claims_v4(id,approval_id,entitlement_id,destination_id,recipient_user_id)
   values(p_claim_id,a.id,r.entitlement_id,n.id,n.user_id) returning * into c;
 elsif p_action is not null and p_action<>'request' then
  if p_action not in('intent','recipient','operator','receipt','revoked') or b is null or octet_length(p_body_text)>32768 then raise exception 'invalid_sponsor_claim'; end if;
  if (p_action='recipient' and p_role<>'recipient') or (p_action<>'recipient' and p_role<>'operator') then raise exception 'reward_claim_scope_required'; end if;
  select * into old from app_private.reward_sponsor_claim_events_v4 where claim_id=c.id and kind=p_action;
  if found then
   if old.body_text<>p_body_text or old.actor_user_id<>p_actor_user_id then raise exception 'reward_sponsor_claim_conflict'; end if;
  else
   if not current or exists(select 1 from app_private.reward_sponsor_claim_events_v4 where claim_id=c.id and kind='revoked') then raise exception 'reward_sponsor_claim_not_ready'; end if;
   if p_action='intent' then
    if b->>'sourceStamp' is distinct from source_stamp or b->>'profileFingerprint' is distinct from fingerprint
     or b#>>'{claim,recipient}' is distinct from destination->>'address' or b#>>'{claim,entitlementId}' is distinct from '0x'||encode(r.entitlement_id,'hex')
     or b#>>'{claim,amount}' is distinct from r.amount_wei::text or b#>>'{attestation,verifiedDateOfBirth}' is distinct from athlete.date_of_birth::text
     or b#>>'{claim,pot}' is distinct from (case when a.slot=0 then 'league' else 'race' end)
     or coalesce(b#>>'{claim,nonce}','') !~ '^[0-9]+$' or coalesce(b#>>'{claim,issuedAt}','') !~ '^[1-9][0-9]+$'
     or coalesce(b#>>'{claim,expiresAt}','') !~ '^[1-9][0-9]+$'
     or (b#>>'{claim,expiresAt}')::numeric<=(b#>>'{claim,issuedAt}')::numeric
     or (b#>>'{claim,expiresAt}')::numeric>(b#>>'{claim,issuedAt}')::numeric+86400 then raise exception 'invalid_sponsor_claim'; end if;
    -- Another still-live intent for this entitlement cannot choose a competing destination.
    if exists(select 1 from app_private.reward_sponsor_claim_events_v4 e join app_private.reward_sponsor_claims_v4 x on x.id=e.claim_id
      where x.entitlement_id=c.entitlement_id and e.kind='intent' and (e.body_text::jsonb#>>'{claim,expiresAt}')::numeric>(b#>>'{claim,issuedAt}')::numeric)
      then raise exception 'reward_sponsor_claim_conflict'; end if;
   elsif p_action in('recipient','operator','receipt') then
    select body_text::jsonb into events from app_private.reward_sponsor_claim_events_v4 where claim_id=c.id and kind='intent';
    if events is null or events->>'sourceStamp'<>source_stamp or events->>'profileFingerprint'<>fingerprint then raise exception 'reward_sponsor_claim_not_ready'; end if;
    if p_action in('operator','receipt') and not exists(select 1 from app_private.reward_sponsor_claim_events_v4 where claim_id=c.id and kind='recipient') then raise exception 'reward_recipient_consent_required'; end if;
    if p_action='receipt' and not exists(select 1 from app_private.reward_sponsor_claim_events_v4 where claim_id=c.id and kind='operator') then raise exception 'reward_sponsor_claim_not_ready'; end if;
   end if;
   insert into app_private.reward_sponsor_claim_events_v4(claim_id,kind,body_text,actor_user_id) values(c.id,p_action,p_body_text,p_actor_user_id);
  end if;
 end if;
 select coalesce(jsonb_object_agg(kind,body_text::jsonb),'{}'::jsonb) into events from app_private.reward_sponsor_claim_events_v4 where claim_id=c.id;
 if events?'revoked' or (events?'intent' and (events#>>'{intent,sourceStamp}'<>source_stamp or events#>>'{intent,profileFingerprint}'<>fingerprint)) then current:=false; end if;
 perform app_private.require_reward_account(p_actor_user_id,p_actor_session_id);
 if app_private.reward_sponsor_source_stamp_v4(a.id) is distinct from source_stamp or app_private.reward_athlete_profile_fingerprint(athlete.id) is distinct from fingerprint
  or app_private.reward_athlete_destination_document(n) is distinct from destination then raise exception 'reward_planning_revision_changed'; end if;
 return jsonb_build_object('claimId',c.id,'entitlementId','0x'||encode(c.entitlement_id,'hex'),'approvalId',a.id,'setupId',a.setup_id,'slot',a.slot,'current',current,'sourceStamp',source_stamp,'profileFingerprint',fingerprint,
  'destination',destination,'challenge',app_private.reward_wallet_challenge_document(ch),'package',u.package_text::jsonb,'packageHash',u.package_hash,
  'plan',execution.plan,'publication',pub.body_text::jsonb,'events',events);
end $function$;

CREATE OR REPLACE FUNCTION public.service_sponsor_club_claim_v4(p_actor_user_id uuid, p_actor_session_id uuid, p_chain_id integer, p_claim_id uuid, p_role text, p_action text DEFAULT NULL::text, p_body_text text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
 SET "TimeZone" TO 'UTC'
AS $function$
declare c app_private.reward_sponsor_club_claims_v4%rowtype; a app_private.reward_sponsor_allocation_approvals_v4%rowtype;
 r app_private.reward_sponsor_recipients_v4%rowtype; n app_private.reward_club_treasury_requests%rowtype; owner_now jsonb;
 pub app_private.reward_sponsor_lifecycle_v4%rowtype; u app_private.reward_sponsor_uploads_v4%rowtype;
 execution app_private.reward_sponsor_executions%rowtype;
 b jsonb; old app_private.reward_sponsor_club_claim_events_v4%rowtype; events jsonb; source_stamp text; fingerprint text; current boolean; destination jsonb;
 fresh jsonb;
begin
 perform app_private.require_reward_account(p_actor_user_id,p_actor_session_id);
 if p_chain_id is null or p_chain_id not in(31337,10143) or p_role is null or p_role not in('recipient','operator') then raise exception 'reward_claim_scope_required'; end if;
 b:=p_body_text::jsonb;
 if p_action='request' then
  if p_role<>'recipient' or b is null or jsonb_typeof(b)<>'object' or (select count(*) from jsonb_object_keys(b))<>3 then raise exception 'invalid_sponsor_claim'; end if;
  select * into n from app_private.reward_club_treasury_requests where id=(b->>'requestId')::uuid and user_id=p_actor_user_id;
  select * into r from app_private.reward_sponsor_recipients_v4 where approval_id=(b->>'approvalId')::uuid and entitlement_id=decode(substr(b->>'entitlementId',3),'hex')
   and beneficiary_kind='club' and beneficiary_id=n.club_id;
  if n.id is null or r.entitlement_id is null then raise exception 'reward_claim_scope_required'; end if;
  select * into c from app_private.reward_sponsor_club_claims_v4 where id=p_claim_id;
  if c.id is not null and (c.recipient_user_id<>p_actor_user_id or c.request_id<>n.id or c.approval_id<>r.approval_id or c.entitlement_id<>r.entitlement_id) then raise exception 'reward_sponsor_claim_conflict'; end if;
 else
  select * into c from app_private.reward_sponsor_club_claims_v4 where id=p_claim_id;
  if c.id is null then raise exception 'reward_claim_scope_required'; end if;
  select * into n from app_private.reward_club_treasury_requests where id=c.request_id;
  select * into r from app_private.reward_sponsor_recipients_v4 where entitlement_id=c.entitlement_id and approval_id=c.approval_id;
 end if;
 select * into a from app_private.reward_sponsor_allocation_approvals_v4 where id=r.approval_id;
 select * into pub from app_private.reward_sponsor_lifecycle_v4 where approval_id=a.id and kind='publication';
 select * into u from app_private.reward_sponsor_uploads_v4 where approval_id=a.id;
 select * into execution from app_private.reward_sponsor_executions where setup_id=a.setup_id;
 if pub.id is null or u.id is null or execution.plan->>'chainId'<>p_chain_id::text or n.chain_id is distinct from p_chain_id
  or (p_role='recipient' and p_actor_user_id<>n.user_id) or (p_role='operator' and p_actor_user_id<>pub.actor_user_id) then raise exception 'reward_claim_scope_required'; end if;
 -- Established organization -> draft -> wallet/profile lock order.
 perform 1 from public.organization_memberships where user_id=pub.actor_user_id and organization_id=(select organization_id from app_private.reward_planning_drafts where id=(a.document_text::jsonb#>>'{binding,draftId}')::uuid) for share;
 perform 1 from public.organizations where id=(select organization_id from app_private.reward_planning_drafts where id=(a.document_text::jsonb#>>'{binding,draftId}')::uuid) for share;
 if p_role='operator' then
  fresh:=public.service_read_reward_sponsor_upload_v4(p_actor_user_id,p_actor_session_id,p_chain_id,a.setup_id,a.slot,a.id);
 else
  perform 1 from app_private.reward_planning_drafts where id=(a.document_text::jsonb#>>'{binding,draftId}')::uuid for update;
 end if;
 perform pg_advisory_xact_lock(hashtextextended('reward-club-account:'||n.user_id::text,0));
 perform pg_advisory_xact_lock(hashtextextended('reward-club-treasury:'||n.club_id::text||':'||n.chain_id::text,0));
 perform pg_advisory_xact_lock(hashtextextended('sponsor-club-claim:'||p_claim_id::text,0));
 perform user_id from public.user_profiles where user_id in(pub.actor_user_id,n.user_id) order by user_id for share;
 perform id from public.clubs where id=n.club_id for share;
 perform id from public.athlete_profiles where claimed_by_user_id=n.user_id or id=(n.owner_identity->>'athleteProfileId')::uuid order by id for share;
 perform id from public.club_memberships where club_id=n.club_id order by id for share;
 perform id from public.club_roles where club_id=n.club_id order by id for share;
 owner_now:=app_private.reward_club_owner_identity(n.club_id,n.user_id);
 if p_role='recipient' and owner_now is null then raise exception 'reward_claim_scope_required'; end if;
 destination:=app_private.reward_club_treasury_document(n);
 source_stamp:=app_private.reward_sponsor_source_stamp_v4(a.id);fingerprint:=app_private.reward_club_review_fingerprint(n.id);
 current:=coalesce(exists(select 1 from public.user_profiles where user_id=n.user_id and status='active')
  and exists(select 1 from public.user_profiles where user_id=pub.actor_user_id and status='active')
  and app_private.reward_award_review_authorized(pub.actor_user_id,(select organization_id from app_private.reward_planning_drafts where id=(a.document_text::jsonb#>>'{binding,draftId}')::uuid))
  and source_stamp=pub.source_stamp and (p_role<>'operator' or fresh->>'current'='true') and destination->>'status'='pending_review'
  and owner_now is not null,false);
 if p_action='request' then
  select * into c from app_private.reward_sponsor_club_claims_v4 where id=p_claim_id;
  if c.id is not null and (c.recipient_user_id<>p_actor_user_id or c.request_id<>n.id or c.approval_id<>r.approval_id or c.entitlement_id<>r.entitlement_id) then raise exception 'reward_sponsor_claim_conflict'; end if;
 end if;
 if p_action='request' and c.id is null then
  if not current then raise exception 'reward_sponsor_claim_not_ready'; end if;
  insert into app_private.reward_sponsor_club_claims_v4(id,approval_id,entitlement_id,request_id,recipient_user_id)
   values(p_claim_id,a.id,r.entitlement_id,n.id,n.user_id) returning * into c;
 elsif p_action is not null and p_action<>'request' then
  if p_action not in('intent','recipient','operator','receipt','revoked') or b is null or octet_length(p_body_text)>32768 then raise exception 'invalid_sponsor_claim'; end if;
  if (p_action='recipient' and p_role<>'recipient') or (p_action<>'recipient' and p_role<>'operator') then raise exception 'reward_claim_scope_required'; end if;
  select * into old from app_private.reward_sponsor_club_claim_events_v4 where claim_id=c.id and kind=p_action;
  if found then
   if old.body_text<>p_body_text or old.actor_user_id<>p_actor_user_id then raise exception 'reward_sponsor_claim_conflict'; end if;
  else
   if not current or exists(select 1 from app_private.reward_sponsor_club_claim_events_v4 where claim_id=c.id and kind='revoked') then raise exception 'reward_sponsor_claim_not_ready'; end if;
   if p_action='intent' then
    if b->>'sourceStamp' is distinct from source_stamp or b->>'profileFingerprint' is distinct from fingerprint
     or b#>>'{claim,recipient}' is distinct from destination#>>'{candidate,safeAddress}' or b#>>'{claim,entitlementId}' is distinct from '0x'||encode(r.entitlement_id,'hex')
     or b#>>'{claim,amount}' is distinct from r.amount_wei::text
     or not app_private.valid_reward_club_review_evidence(b->'attestation')
     or b#>'{attestation,candidate}' is distinct from n.candidate or b#>>'{attestation,chainId}' is distinct from p_chain_id::text
     or b#>>'{claim,pot}' is distinct from (case when a.slot=0 then 'league' else 'race' end)
     or coalesce(b#>>'{claim,nonce}','') !~ '^[0-9]+$' or coalesce(b#>>'{claim,issuedAt}','') !~ '^[1-9][0-9]+$'
     or coalesce(b#>>'{claim,expiresAt}','') !~ '^[1-9][0-9]+$'
     or (b#>>'{claim,expiresAt}')::numeric<=(b#>>'{claim,issuedAt}')::numeric
     or (b#>>'{claim,expiresAt}')::numeric>(b#>>'{claim,issuedAt}')::numeric+86400 then raise exception 'invalid_sponsor_claim'; end if;
    -- Another still-live intent for this entitlement cannot choose a competing destination.
    if exists(select 1 from app_private.reward_sponsor_club_claim_events_v4 e join app_private.reward_sponsor_club_claims_v4 x on x.id=e.claim_id
      where x.entitlement_id=c.entitlement_id and e.kind='intent' and (e.body_text::jsonb#>>'{claim,expiresAt}')::numeric>(b#>>'{claim,issuedAt}')::numeric)
      then raise exception 'reward_sponsor_claim_conflict'; end if;
   elsif p_action in('recipient','operator','receipt') then
    select body_text::jsonb into events from app_private.reward_sponsor_club_claim_events_v4 where claim_id=c.id and kind='intent';
    if events is null or events->>'sourceStamp'<>source_stamp or events->>'profileFingerprint'<>fingerprint then raise exception 'reward_sponsor_claim_not_ready'; end if;
    if p_action in('operator','receipt') and not exists(select 1 from app_private.reward_sponsor_club_claim_events_v4 where claim_id=c.id and kind='recipient') then raise exception 'reward_recipient_consent_required'; end if;
    if p_action='receipt' and not exists(select 1 from app_private.reward_sponsor_club_claim_events_v4 where claim_id=c.id and kind='operator') then raise exception 'reward_sponsor_claim_not_ready'; end if;
   end if;
   insert into app_private.reward_sponsor_club_claim_events_v4(claim_id,kind,body_text,actor_user_id) values(c.id,p_action,p_body_text,p_actor_user_id);
  end if;
 end if;
 select coalesce(jsonb_object_agg(kind,body_text::jsonb),'{}'::jsonb) into events from app_private.reward_sponsor_club_claim_events_v4 where claim_id=c.id;
 if events?'revoked' or (events?'intent' and (events#>>'{intent,sourceStamp}'<>source_stamp or events#>>'{intent,profileFingerprint}'<>fingerprint)) then current:=false; end if;
 perform app_private.require_reward_account(p_actor_user_id,p_actor_session_id);
 if app_private.reward_sponsor_source_stamp_v4(a.id) is distinct from source_stamp or app_private.reward_club_review_fingerprint(n.id) is distinct from fingerprint
  or app_private.reward_club_treasury_document(n) is distinct from destination then raise exception 'reward_planning_revision_changed'; end if;
 return jsonb_build_object('claimId',c.id,'entitlementId','0x'||encode(c.entitlement_id,'hex'),'approvalId',a.id,'setupId',a.setup_id,'slot',a.slot,'current',current,'sourceStamp',source_stamp,'profileFingerprint',fingerprint,
  'nomination',destination,'package',u.package_text::jsonb,'packageHash',u.package_hash,
  'plan',execution.plan,'publication',pub.body_text::jsonb,'events',events);
end $function$;

create table app_private.reward_master_award_audit (
 approval_id uuid primary key references app_private.reward_sponsor_allocation_approvals_v4(id),
 actor_user_id uuid not null references public.user_profiles(user_id),
 setup_id uuid not null references app_private.reward_distribution_setups(id),
 slot integer not null, decision text not null, document_hash text not null,
 authority text not null check(authority='super_admin'), created_at timestamptz not null default clock_timestamp()
);
alter table app_private.reward_master_award_audit enable row level security;
revoke all on app_private.reward_master_award_audit from public,anon,authenticated,service_role;
grant select,insert on app_private.reward_master_award_audit to service_role;
create policy master_award_audit_read on app_private.reward_master_award_audit for select to service_role using(true);
create policy master_award_audit_insert on app_private.reward_master_award_audit for insert to service_role with check(true);
create trigger master_award_audit_immutable before update or delete on app_private.reward_master_award_audit for each row execute function app_private.reward_result_review_immutable_v3();
create function app_private.record_master_award_review()
returns trigger language plpgsql security invoker set search_path='' as $$
begin
 if exists(select 1 from public.platform_administrators where user_id=new.actor_user_id and is_active and platform_role='super_admin') then
  insert into app_private.reward_master_award_audit(approval_id,actor_user_id,setup_id,slot,decision,document_hash,authority)
  values(new.id,new.actor_user_id,new.setup_id,new.slot,new.decision,new.document_hash,'super_admin');
 end if;
 return new;
end $$;
revoke all on function app_private.record_master_award_review() from public,anon,authenticated,service_role;
grant execute on function app_private.record_master_award_review() to service_role;
create trigger record_master_award_review after insert on app_private.reward_sponsor_allocation_approvals_v4 for each row execute function app_private.record_master_award_review();
commit;
