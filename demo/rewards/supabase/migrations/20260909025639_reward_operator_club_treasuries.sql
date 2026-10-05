begin;

-- Private designated-operator discovery; no nominee session/audit data leaves
-- this projection. Scope follows programme beneficiaries, not organization roles.
create function public.service_list_reward_operator_club_treasuries(p_actor_user_id uuid,p_actor_session_id uuid,
  p_programme_id uuid,p_chain_id integer,p_after_id uuid default null)
returns jsonb language plpgsql volatile security invoker set search_path='' set timezone='UTC' as $$
declare picked uuid[]; rows jsonb; body jsonb;
begin
  perform app_private.require_reward_account(p_actor_user_id,p_actor_session_id);
  perform app_private.require_reward_operator(p_programme_id,p_actor_user_id);
  if p_chain_id is null or p_chain_id not in(31337,10143) or not exists(
    select 1 from app_private.reward_programmes where id=p_programme_id and chain_id=p_chain_id
  ) then raise exception using errcode='42501',message='reward_club_review_scope_required'; end if;
  with recursive scope(id) as (
    select b.entity_id from app_private.reward_beneficiaries b join app_private.reward_campaigns c on c.id=b.campaign_id
      where c.programme_id=p_programme_id and b.kind='club'
    union select c.merged_into_club_id from public.clubs c join scope s on c.id=s.id where c.merged_into_club_id is not null
  ) select array_agg(id order by id) into picked from (
    select q.id from app_private.reward_club_treasury_requests q where q.chain_id=p_chain_id
      and (p_after_id is null or q.id>p_after_id) and (q.club_id in(select id from scope) or exists(
        select 1 from app_private.reward_club_treasury_reviews r where r.programme_id=p_programme_id and r.request_id=q.id))
    order by q.id limit 26
  ) page;
  select coalesce(jsonb_agg(jsonb_build_object('requestId',q.id,'clubId',q.club_id,
    'clubName',nullif(left(btrim(c.name),256),''),'address',q.candidate->>'safeAddress','requestedAt',q.requested_at,
    'nominationStatus',app_private.reward_club_treasury_document(q)->>'status') order by q.id),'[]'::jsonb)
    into rows from app_private.reward_club_treasury_requests q left join public.clubs c on c.id=q.club_id
    where q.id=any(picked[1:25]);
  body:=jsonb_build_object('programmeId',p_programme_id,'chainId',p_chain_id,'items',rows,
    'nextCursor',case when cardinality(picked)>25 then picked[25] else null end);
  perform app_private.require_reward_account(p_actor_user_id,p_actor_session_id);
  perform app_private.require_reward_operator(p_programme_id,p_actor_user_id);
  return body;
end $$;

create function public.service_read_reward_operator_club_treasury(p_actor_user_id uuid,p_actor_session_id uuid,
  p_programme_id uuid,p_chain_id integer,p_request_id uuid)
returns jsonb language plpgsql volatile security invoker set search_path='' as $$
declare context jsonb; labels jsonb;
begin
  context:=public.service_read_reward_club_review_context(p_programme_id,p_actor_user_id,p_actor_session_id,p_request_id);
  if context->'chainId' is distinct from to_jsonb(p_chain_id) then
    raise exception using errcode='42501',message='reward_club_review_scope_required'; end if;
  select jsonb_build_object('clubName',nullif(left(btrim(c.name),256),''),'ownerProfileId',a.id,
    'ownerName',case when a.status='active' then nullif(left(btrim(a.display_name),256),'') else null end)
    into labels from app_private.reward_club_treasury_requests q left join public.clubs c on c.id=q.club_id
    left join public.athlete_profiles a on a.id=(q.owner_identity->>'athleteProfileId')::uuid where q.id=p_request_id;
  if app_private.reward_club_review_fingerprint(p_request_id) is distinct from context->>'identityFingerprintSha256' then
    raise exception using errcode='22023',message='reward_club_review_identity_changed'; end if;
  perform app_private.require_reward_account(p_actor_user_id,p_actor_session_id);
  perform app_private.require_reward_operator(p_programme_id,p_actor_user_id);
  return jsonb_build_object('context',context,'labels',labels);
end $$;
revoke all on function public.service_list_reward_operator_club_treasuries(uuid,uuid,uuid,integer,uuid),
  public.service_read_reward_operator_club_treasury(uuid,uuid,uuid,integer,uuid) from public,anon,authenticated,service_role;
grant execute on function public.service_list_reward_operator_club_treasuries(uuid,uuid,uuid,integer,uuid),
  public.service_read_reward_operator_club_treasury(uuid,uuid,uuid,integer,uuid) to service_role;
commit;
