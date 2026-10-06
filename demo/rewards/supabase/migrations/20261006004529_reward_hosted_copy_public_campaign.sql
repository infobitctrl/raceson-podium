begin;
-- Public facts stay distinct from sporting publication, wallet consent and payment.
-- These wrappers expose only the owner's fixed copied cohort; generic RPCs remain revoked.
create function app_private.reward_demo_copy_public_scope(p_setup_id uuid)
returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from app_private.reward_sponsor_executions e
  join app_private.reward_sponsor_launches l on l.id=e.launch_id and l.setup_id=e.setup_id
  join app_private.reward_demo_copy_launch_sources b on b.launch_id=l.id
  join app_private.reward_demo_copy_setup_bindings s on s.setup_id=e.setup_id and s.batch_sha256=b.batch_sha256 and s.source_fingerprint=b.source_fingerprint
  join app_private.reward_distribution_setups d on d.id=e.setup_id
  where e.setup_id=p_setup_id and d.chain_id=10143 and e.plan->>'chainId'='10143'
   and b.batch_sha256='073a68cf7703e72af9954d5b05c77bf1e7519a1e7c47b56ec57e07a3655f1644'
   and b.source_projection->>'leagueId'='ba81ced7-b2c5-4d51-95b6-d95d8c04fa36'
   and b.source_projection->>'seasonId'='323d55fc-a396-4ff4-a17e-eb7152c8f8f1');
$$;
create function public.service_reward_demo_copy_public_campaign(p_setup_id uuid,p_actor_user_id uuid default null,
 p_actor_session_id uuid default null,p_campaign jsonb default null)
returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare result jsonb;
begin
 if p_setup_id is null then raise exception 'invalid_public_campaign';end if;
 if p_campaign is not null then
  perform app_private.require_reward_demo_copy_setup(p_actor_user_id,p_actor_session_id,p_setup_id);
  -- Same setup lock used by launch/edit; owner/session and source must survive waits.
  perform pg_advisory_xact_lock(hashtextextended('reward-setup:'||p_setup_id::text,0));
  perform app_private.require_reward_demo_copy_setup(p_actor_user_id,p_actor_session_id,p_setup_id);
  if not app_private.reward_demo_copy_public_scope(p_setup_id) then raise exception 'reward_setup_not_found';end if;
  if jsonb_typeof(p_campaign) is distinct from 'object' or octet_length(p_campaign::text)>131072
   or (select count(*) from jsonb_object_keys(p_campaign))<>9
   or not(p_campaign ?& array['id','name','chainId','budgetWei','address','fundingHash','blockNumber','blockTimestamp','pots'])
   then raise exception 'invalid_public_campaign';end if;
 elsif p_actor_user_id is not null or p_actor_session_id is not null then raise exception 'invalid_public_campaign';
 end if;
 if not app_private.reward_demo_copy_public_scope(p_setup_id) then return null;end if;
 result:=public.service_reward_public_campaign(10143,p_setup_id,p_actor_user_id,p_actor_session_id,p_campaign);
 if p_campaign is not null then perform app_private.require_reward_demo_copy_setup(p_actor_user_id,p_actor_session_id,p_setup_id);end if;
 return result;
end $$;
create function public.service_reward_demo_copy_public_awards(p_setup_id uuid,p_slot integer)
returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
 if p_setup_id is null or p_slot is null or p_slot not between 0 and 5 then raise exception 'invalid_public_awards';end if;
 if not app_private.reward_demo_copy_public_scope(p_setup_id) then return null;end if;
 -- A copied approved package is required. A later hold never becomes an empty
 -- or unpaid assertion: the chain observer separately rejects inconsistent totals.
 if not exists(select 1 from app_private.reward_sponsor_allocation_approvals_v4 a
  join app_private.reward_sponsor_uploads_v4 u on u.approval_id=a.id
  where a.setup_id=p_setup_id and a.slot=p_slot and a.decision='approved'
   and a.document_text::jsonb->>'schema'='podium-copy-allocation-document-v1'
   and a.sequence=(select max(n.sequence) from app_private.reward_sponsor_allocation_approvals_v4 n where n.setup_id=a.setup_id and n.slot=a.slot)) then return null;end if;
 return public.service_reward_public_awards_v4(10143,p_setup_id,p_slot);
end $$;
create function public.service_reward_demo_copy_public_directory()
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare result jsonb;
begin
 with eligible as (
  select p.setup_id,p.campaign,p.completed_at,e.plan,e.deployment_hash,e.funding_hash,d.owner_user_id,
   r.configuration->'sponsorSelection' selection
  from app_private.reward_public_campaigns p
  join app_private.reward_sponsor_executions e on e.setup_id=p.setup_id and e.launch_id=p.launch_id
  join app_private.reward_sponsor_launches l on l.id=p.launch_id
  join app_private.reward_setup_revisions r on r.setup_id=p.setup_id and r.revision=l.setup_revision
  join app_private.reward_distribution_setups d on d.id=p.setup_id
  where app_private.reward_demo_copy_public_scope(p.setup_id) and e.deployment_hash is not null and e.funding_hash is not null
 ) select jsonb_build_object('sponsors',count(distinct owner_user_id),'items',coalesce(jsonb_agg(jsonb_build_object(
  'campaign',campaign,'selection',selection,'publishedAt',to_char(completed_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
  'record',jsonb_build_object('plan',plan,'deploymentHash',deployment_hash,'fundingHash',funding_hash)) order by completed_at desc,setup_id),'[]'::jsonb))
 into result from eligible;
 return result;
end $$;
revoke all on function app_private.reward_demo_copy_public_scope(uuid),
 public.service_reward_demo_copy_public_campaign(uuid,uuid,uuid,jsonb),
 public.service_reward_demo_copy_public_awards(uuid,integer),public.service_reward_demo_copy_public_directory() from public,anon,authenticated,service_role;
grant execute on function public.service_reward_demo_copy_public_campaign(uuid,uuid,uuid,jsonb),
 public.service_reward_demo_copy_public_awards(uuid,integer),public.service_reward_demo_copy_public_directory() to service_role;
notify pgrst,'reload schema';
commit;
