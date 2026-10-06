begin;
-- Isolated club representatives nominate public addresses; this never provisions
-- owners, deploys a Safe, attests key control or approves a prize payment.
create function app_private.require_reward_demo_copy_club(p_user_id uuid,p_session_id uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare account jsonb; source jsonb;
begin
 account:=app_private.reward_demo_web_session(p_user_id,p_session_id);
 if account->>'kind' is distinct from 'club_representative' then raise exception 'reward_club_owner_required';end if;
 source:=public.operator_read_reward_five_round_copy_v1('073a68cf7703e72af9954d5b05c77bf1e7519a1e7c47b56ec57e07a3655f1644');
 return source->'clubs';
end $$;
create function public.service_reward_demo_copy_club_wallet(p_user_id uuid,p_session_id uuid,p_action text,p_input jsonb)
returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare clubs jsonb; result jsonb; rows jsonb; items jsonb; row jsonb; club_id uuid; after_id uuid; request_id uuid;
 r app_private.reward_club_treasury_requests%rowtype;
begin
 clubs:=app_private.require_reward_demo_copy_club(p_user_id,p_session_id);
 if p_input is null or jsonb_typeof(p_input) is distinct from 'object' or octet_length(p_input::text)>16384 then raise exception 'invalid_reward_club_treasury_request';end if;
 if p_action in('clubs','history') then
  if (select count(*) from jsonb_object_keys(p_input))<>1 or not(p_input?'p_after_id') then raise exception 'invalid_reward_club_treasury_request';end if;
  after_id:=(p_input->>'p_after_id')::uuid;
  if p_action='clubs' then
   select coalesce(jsonb_agg(body order by id),'[]'::jsonb) into rows from (
    select c.id,jsonb_build_object('clubId',c.id,'name',c.name,'identity',app_private.reward_club_owner_identity(c.id,p_user_id)) body
    from public.clubs c where (after_id is null or c.id>after_id)
     and exists(select 1 from jsonb_array_elements(clubs) x where (x->>'id')::uuid=c.id)
     and app_private.reward_club_owner_identity(c.id,p_user_id) is not null order by c.id limit 26
   ) q;
   for row in select value from jsonb_array_elements(rows) loop
    if app_private.reward_club_owner_identity((row->>'clubId')::uuid,p_user_id) is distinct from row->'identity' then raise exception 'reward_club_owner_required';end if;
   end loop;
   select coalesce(jsonb_agg(value-'identity' order by ord),'[]'::jsonb) into items from jsonb_array_elements(rows) with ordinality q(value,ord) where ord<=25;
   result:=jsonb_build_object('chainId',10143,'items',items,'nextCursor',case when jsonb_array_length(rows)>25 then rows->24->>'clubId' else null end);
  else
   select coalesce(jsonb_agg(body order by id),'[]'::jsonb) into rows from (
    select n.id,app_private.reward_club_treasury_document(n) body from app_private.reward_club_treasury_requests n
    where n.user_id=p_user_id and n.chain_id=10143 and (after_id is null or n.id>after_id)
     and exists(select 1 from jsonb_array_elements(clubs) x where (x->>'id')::uuid=n.club_id) order by n.id limit 26
   ) q;
   result:=jsonb_build_object('items',case when jsonb_array_length(rows)>25 then rows-25 else rows end,
    'nextCursor',case when jsonb_array_length(rows)>25 then rows->24->>'requestId' else null end);
  end if;
 elsif p_action='nominate' then
  if (select count(*) from jsonb_object_keys(p_input))<>3 or not(p_input?&array['p_club_id','p_candidate','p_idempotency_key']) then raise exception 'invalid_reward_club_treasury_request';end if;
  club_id:=(p_input->>'p_club_id')::uuid;
  if not exists(select 1 from jsonb_array_elements(clubs) x where (x->>'id')::uuid=club_id) then raise exception 'reward_club_owner_required';end if;
  perform pg_advisory_xact_lock(hashtextextended('reward-club-account:'||p_user_id::text,0));
  perform app_private.require_reward_demo_copy_club(p_user_id,p_session_id);
  if not exists(select 1 from app_private.reward_club_treasury_requests n where n.user_id=p_user_id and n.chain_id=10143 and n.idempotency_key=p_input->>'p_idempotency_key')
   and ((select count(*) from app_private.reward_club_treasury_requests n where n.user_id=p_user_id and n.requested_at>clock_timestamp()-interval '1 hour')>=16
    or (select count(*) from app_private.reward_club_treasury_requests n where n.user_id=p_user_id)>=160) then raise exception 'reward_club_treasury_withdraw_first';end if;
  result:=public.service_request_reward_club_treasury(p_user_id,p_session_id,club_id,10143,p_input->'p_candidate',p_input->>'p_idempotency_key');
 elsif p_action in('read','withdraw') then
  if (select count(*) from jsonb_object_keys(p_input))<>1 or not(p_input?'p_request_id') then raise exception 'invalid_reward_club_treasury_request';end if;
  request_id:=(p_input->>'p_request_id')::uuid;
  select * into r from app_private.reward_club_treasury_requests where id=request_id and user_id=p_user_id and chain_id=10143;
  if r.id is null or not exists(select 1 from jsonb_array_elements(clubs) x where (x->>'id')::uuid=r.club_id) then raise exception 'reward_club_treasury_not_found';end if;
  if p_action='read' then result:=public.service_read_reward_club_treasury(p_user_id,p_session_id,10143,request_id);
  else result:=public.service_withdraw_reward_club_treasury(p_user_id,p_session_id,10143,request_id);end if;
 else raise exception 'invalid_reward_club_treasury_request';end if;
 perform app_private.require_reward_demo_copy_club(p_user_id,p_session_id);
 return result;
end $$;
revoke all on function app_private.require_reward_demo_copy_club(uuid,uuid),public.service_reward_demo_copy_club_wallet(uuid,uuid,text,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.service_reward_demo_copy_club_wallet(uuid,uuid,text,jsonb) to service_role;
notify pgrst,'reload schema';
commit;
