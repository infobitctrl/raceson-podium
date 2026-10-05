begin;
create index reward_athlete_destination_history on app_private.reward_athlete_destination_requests(user_id,id);

-- Account-scoped recovery of pending/held/withdrawn choices after a reload or
-- new login. A new profile owner never inherits the previous owner's history.
create function public.service_list_reward_athlete_destinations(p_user_id uuid,p_session_id uuid,p_after_id uuid default null)
returns jsonb language plpgsql volatile security invoker set search_path='' as $$
declare items jsonb;
begin
  perform app_private.require_reward_account(p_user_id,p_session_id);
  select coalesce(jsonb_agg(body order by id),'[]'::jsonb) into items from (
    select d.id,app_private.reward_athlete_destination_document(d) body
    from app_private.reward_athlete_destination_requests d
    where d.user_id=p_user_id and (p_after_id is null or d.id>p_after_id)
    order by d.id limit 51
  ) page;
  return jsonb_build_object('items',case when jsonb_array_length(items)>50 then items-50 else items end,
    'nextCursor',case when jsonb_array_length(items)>50 then items->49->>'requestId' else null end);
end $$;
revoke all on function public.service_list_reward_athlete_destinations(uuid,uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function public.service_list_reward_athlete_destinations(uuid,uuid,uuid) to service_role;
commit;
