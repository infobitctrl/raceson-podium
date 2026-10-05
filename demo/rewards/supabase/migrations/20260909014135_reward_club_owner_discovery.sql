begin;

-- Named selection only; nomination still rechecks ownership under write locks.
create function public.service_list_reward_owned_clubs(p_user_id uuid,p_session_id uuid,p_chain_id integer,p_after_id uuid default null)
returns jsonb language plpgsql volatile security invoker set search_path='' as $$
declare rows jsonb; item jsonb; items jsonb;
begin
  perform app_private.require_reward_account(p_user_id,p_session_id);
  if p_chain_id is null or p_chain_id not in(31337,10143) then
    raise exception using errcode='22023',message='invalid_reward_club_treasury_request'; end if;
  select coalesce(jsonb_agg(body order by id),'[]'::jsonb) into rows from (
    select c.id,jsonb_build_object('clubId',c.id,'name',c.name,
      'identity',app_private.reward_club_owner_identity(c.id,p_user_id)) body
    from public.clubs c where (p_after_id is null or c.id>p_after_id)
      and c.id in (select m.club_id from public.club_memberships m join public.athlete_profiles a on a.id=m.athlete_profile_id
        where a.claimed_by_user_id=p_user_id and m.status='active')
      and app_private.reward_club_owner_identity(c.id,p_user_id) is not null
    order by c.id limit 26
  ) page;
  -- Recheck after possible relation-lock waits; never return stale authority.
  for item in select value from jsonb_array_elements(rows) loop
    if app_private.reward_club_owner_identity((item->>'clubId')::uuid,p_user_id) is distinct from item->'identity' then
      raise exception using errcode='42501',message='reward_club_owner_required'; end if;
  end loop;
  perform app_private.require_reward_account(p_user_id,p_session_id);
  select coalesce(jsonb_agg(value-'identity' order by ord),'[]'::jsonb) into items
    from jsonb_array_elements(rows) with ordinality r(value,ord) where ord<=25;
  return jsonb_build_object('chainId',p_chain_id,'items',items,
    'nextCursor',case when jsonb_array_length(rows)>25 then rows->24->>'clubId' else null end);
end $$;
revoke all on function public.service_list_reward_owned_clubs(uuid,uuid,integer,uuid) from public,anon,authenticated,service_role;
grant execute on function public.service_list_reward_owned_clubs(uuid,uuid,integer,uuid) to service_role;
commit;
