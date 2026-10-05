begin;

-- Isolated demo only. A read-only native source observation, not a result import,
-- approval, athlete claim or replacement for the immutable historical snapshot.
-- One stable statement supplies publication/run/rows from one MVCC snapshot.
create function app_private.reward_native_finale_document_v3(p_draft_id uuid,p_reviews jsonb)
returns jsonb language sql stable security invoker set search_path='' set timezone='UTC' as $$
  select jsonb_build_object('schema','raceson-native-finale-source-v3','draftId',d.id,'chainId',d.chain_id,
    'organizationId',d.organization_id,'recordRevision',d.revision,
    'binding',case when b.id is null then null else jsonb_build_object('id',b.id,'editionId',b.edition_id,'races',b.races) end,
    'edition',case when e.id is null then null else jsonb_build_object('id',e.id,'status',e.status,
      'isPractice',e.is_practice,'removed',e.organizer_deleted_at is not null) end,
    'races',coalesce((select jsonb_agg(jsonb_build_object('raceId',c.id,'competitionId',pair->>'competitionId',
      'status',c.status,'removed',c.organizer_deleted_at is not null,'resultsMode',c.results_mode,
      'distanceMetres',case when c.distance_km>0 and c.distance_km*1000=trunc(c.distance_km*1000) then (c.distance_km*1000)::bigint::text
        when c.distance_km>0 then (c.distance_km*1000)::text else null end,
      'review',p_reviews->c.id::text,
      'publication',case when p.id is null then null else jsonb_build_object('id',p.id,'raceId',p.event_category_id,
        'runId',p.result_run_id,'state',p.publication_state,'publishedAt',p.published_at) end,
      'run',case when run.id is null then null else jsonb_build_object('id',run.id,'raceId',run.event_category_id,
        'status',run.status,'completedAt',run.completed_at) end,
      'expectedResultCount',(select count(*) from public.result_rows rr where rr.result_run_id=p.result_run_id),
      'rows',coalesce((select jsonb_agg(jsonb_build_object('id',rr.id,'raceId',rr.event_category_id,'runId',rr.result_run_id,
        'athleteId',rr.athlete_profile_id,'clubId',rr.represented_club_id,
        'registrationMatches',reg.athlete_profile_id=rr.athlete_profile_id and reg.event_category_id=rr.event_category_id,
        'participationStatus',reg.participation_status,'resultStatus',rr.result_status,'finishTimeMs',rr.finish_time_ms::text,
        'rankOverall',rr.rank_overall,'clubPoints',rr.club_points::text) order by rr.id)
        from (select * from public.result_rows where result_run_id=p.result_run_id and event_category_id=c.id order by id limit 10001) rr
        join public.registrations reg on reg.id=rr.registration_id),'[]'::jsonb)) order by pair->>'competitionId')
      from jsonb_array_elements(b.races) pair
      join public.event_categories c on c.id=(pair->>'raceId')::uuid and c.event_edition_id=e.id
      left join lateral (select * from public.result_publications where event_category_id=c.id
        order by published_at desc,created_at desc,id desc limit 1) p on true
      left join public.result_runs run on run.id=p.result_run_id),'[]'::jsonb))
  from app_private.reward_planning_drafts d
  left join lateral (select * from app_private.reward_finale_bindings_v3 where draft_id=d.id order by sequence desc limit 1) b on true
  left join public.event_editions e on e.id=b.edition_id
  where d.id=p_draft_id
$$;

create function public.service_read_reward_native_finale_v3(p_actor_user_id uuid,p_actor_session_id uuid,p_chain_id integer,p_draft_id uuid)
returns jsonb language plpgsql volatile security invoker set search_path='' set timezone='UTC' as $$
declare d jsonb; b app_private.reward_finale_bindings_v3%rowtype; reviews jsonb:='{}'::jsonb;
  pair jsonb; v jsonb; document jsonb; result_count bigint; observed timestamptz;
begin
  d:=public.service_read_reward_planning_draft(p_actor_user_id,p_actor_session_id,p_chain_id,p_draft_id);
  perform 1 from public.organization_memberships where user_id=p_actor_user_id and organization_id=(d->>'organizationId')::uuid for share;
  perform 1 from public.organizations where id=(d->>'organizationId')::uuid for share;
  perform 1 from app_private.reward_planning_drafts where id=p_draft_id for update;
  d:=public.service_read_reward_planning_draft(p_actor_user_id,p_actor_session_id,p_chain_id,p_draft_id);
  select * into b from app_private.reward_finale_bindings_v3 where draft_id=p_draft_id order by sequence desc limit 1;
  if b.id is not null then
    if not exists(select 1 from public.event_editions e join public.event_series s on s.id=e.event_series_id
      where e.id=b.edition_id and s.organization_id=(d->>'organizationId')::uuid) then raise exception 'reward_planning_not_found'; end if;
    -- Lock category rows in deterministic order, sharing the publication/complaint
    -- lock protocol. Wrong-owner/deleted scope never leaks a native source.
    for pair in select value from jsonb_array_elements(b.races) order by value->>'raceId' loop
      if not exists(select 1 from public.event_categories where id=(pair->>'raceId')::uuid and event_edition_id=b.edition_id) then
        raise exception 'reward_planning_revision_changed'; end if;
      v:=public.service_read_reward_result_review_v3(p_actor_user_id,p_actor_session_id,(pair->>'raceId')::uuid);
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
    v:=public.service_read_reward_result_review_v3(p_actor_user_id,p_actor_session_id,(pair->>'raceId')::uuid);
    if v-'observedAt' is distinct from reviews->(pair->>'raceId') then raise exception 'reward_planning_revision_changed'; end if;
  end loop;
  if app_private.reward_native_finale_document_v3(p_draft_id,reviews) is distinct from document
    or public.service_read_reward_planning_draft(p_actor_user_id,p_actor_session_id,p_chain_id,p_draft_id) is distinct from d then
    raise exception 'reward_planning_revision_changed'; end if;
  perform app_private.require_reward_account(p_actor_user_id,p_actor_session_id);
  observed:=clock_timestamp();
  return jsonb_build_object('document',document,'observedAt',observed);
end $$;
revoke all on function app_private.reward_native_finale_document_v3(uuid,jsonb),
  public.service_read_reward_native_finale_v3(uuid,uuid,integer,uuid) from public,anon,authenticated,service_role;
grant execute on function app_private.reward_native_finale_document_v3(uuid,jsonb),
  public.service_read_reward_native_finale_v3(uuid,uuid,integer,uuid) to service_role;
commit;
