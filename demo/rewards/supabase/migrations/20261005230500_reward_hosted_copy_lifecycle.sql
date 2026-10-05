begin;
-- A copied approval retains its actual sporting projection and reviewer authority.
-- This helper exposes only an opaque freshness stamp, never sporting/profile data.
create function app_private.reward_demo_copy_source_stamp(p_approval_id uuid)
returns text language sql stable security definer set search_path='' as $$
 select case when a.document_text::jsonb->>'schema'='podium-copy-allocation-document-v1'
  and a.document_text::jsonb->'source'=b.source_projection
  and a.document_text::jsonb->'plan'=e.plan and e.launch_id=a.launch_id
  and a.document_text::jsonb->'binding'=jsonb_build_object(
   'batchSha256','073a68cf7703e72af9954d5b05c77bf1e7519a1e7c47b56ec57e07a3655f1644',
   'projectionSha256','7043cf919edd4dc3bdf40d022c60d0fc40036f2e4093b33b57dfc040bda3975d',
   'leagueId','ba81ced7-b2c5-4d51-95b6-d95d8c04fa36','seasonId','323d55fc-a396-4ff4-a17e-eb7152c8f8f1',
   'combined','owner-combined-selection-20261005-v1','unaffiliated','owner-unaffiliated-selection-20261005-v1')
  and u.deleted_at is null and p.status='active'
  and u.raw_app_meta_data->>'podium_role_setup'='20261005-owner-request'
  and u.raw_app_meta_data->>'trail_credential_mode'='username'
  and (u.raw_app_meta_data->>'podium_requested_role'='reviewer' and i.username='demo.review'
   or u.raw_app_meta_data->>'podium_requested_role'='platform_admin' and i.username='demo.master')
  and public.service_user_has_organization_permission(league.organization_id,a.actor_user_id,'results.manage')
 then encode(sha256(convert_to(jsonb_build_object('launchId',a.launch_id,'configurationHash',l.configuration_hash,
   'sourceFingerprint',b.source_fingerprint,'source',b.source_projection,'plan',e.plan,'deploymentHash',e.deployment_hash,
   'fundingHash',e.funding_hash,'latest',(select x.id from app_private.reward_sponsor_allocation_approvals_v4 x
     where x.setup_id=a.setup_id and x.slot=a.slot order by x.sequence desc limit 1),
   'archived',d.archived_at,'role',u.raw_app_meta_data->>'podium_requested_role')::text,'UTF8')),'hex') end
 from app_private.reward_sponsor_allocation_approvals_v4 a
 join app_private.reward_distribution_setups d on d.id=a.setup_id and d.chain_id=10143
 join app_private.reward_sponsor_launches l on l.id=a.launch_id
 join app_private.reward_sponsor_executions e on e.setup_id=a.setup_id
 join app_private.reward_demo_copy_launch_sources b on b.launch_id=a.launch_id
  and b.batch_sha256='073a68cf7703e72af9954d5b05c77bf1e7519a1e7c47b56ec57e07a3655f1644'
 join public.leagues league on league.id='ba81ced7-b2c5-4d51-95b6-d95d8c04fa36'
 join auth.users u on u.id=a.actor_user_id
 join public.user_profiles p on p.user_id=u.id
 join public.account_login_identifiers i on i.user_id=u.id
 where a.id=p_approval_id
$$;
create function app_private.reward_demo_copy_lifecycle(p_actor_user_id uuid,p_actor_session_id uuid,p_chain_id integer,
 p_setup_id uuid,p_slot integer,p_approval_id uuid,p_request_id uuid default null,p_kind text default null,p_body_text text default null)
returns jsonb language plpgsql volatile security definer set search_path='' set timezone='UTC' as $$
declare u jsonb; fresh jsonb; b jsonb; old app_private.reward_sponsor_lifecycle_v4%rowtype; stamp text; pub jsonb; receipts jsonb; official bigint; publications jsonb;
begin
 u:=app_private.read_reward_demo_copy_upload(p_actor_user_id,p_actor_session_id,p_chain_id,p_setup_id,p_slot,p_approval_id);
 if u#>>'{prepared,id}' is null then raise exception 'reward_sponsor_upload_required'; end if;
 stamp:=app_private.reward_demo_copy_source_stamp(p_approval_id);
 if stamp is null then raise exception 'reward_sponsor_source_not_ready'; end if;
 if p_kind is not null then
  if p_kind not in('publication','receipt') or p_request_id is null or p_body_text is null or octet_length(p_body_text)>131072 then raise exception 'invalid_sponsor_lifecycle'; end if;
  b:=p_body_text::jsonb;
  if jsonb_typeof(b) is distinct from 'object' then raise exception 'invalid_sponsor_lifecycle'; end if;
  select * into old from app_private.reward_sponsor_lifecycle_v4 where id=p_request_id;
  if found then
   if old.approval_id<>p_approval_id or old.kind<>p_kind or old.actor_user_id<>p_actor_user_id or old.body_text<>p_body_text then raise exception 'reward_sponsor_lifecycle_conflict'; end if;
  else
   if u->'current' is distinct from 'true'::jsonb then raise exception 'reward_sponsor_source_not_ready'; end if;
   if p_kind='publication' then
    select jsonb_agg(jsonb_build_object('slot',r->'slot','raceId',r->'id','publicationId',r->'publicationId',
      'runId',r->'runId','state',r->'publicationState','publishedAt',r->'publishedAt') order by n) into publications
      from jsonb_array_elements(u#>'{document,source,races}') with ordinality rows(r,n) where p_slot=0 or (r->>'slot')::integer=p_slot;
    if (select count(*) from jsonb_object_keys(b))<>6
      or not(b ?& array['schema','approvalId','contextHash','packageHash','evidence','timing'])
      or b->'evidence' is distinct from jsonb_build_object('schema','podium-copy-publication-evidence-v1',
        'approvalId',p_approval_id,'packageHash',u#>>'{prepared,packageHash}','documentHash',u->>'documentHash',
        'binding',u#>'{document,binding}','sportingSha256',u#>'{document,source,sportingSha256}','publications',publications)
      then raise exception 'invalid_sponsor_lifecycle'; end if;
    select max(floor(extract(epoch from (r->>'publishedAt')::timestamptz))::bigint) into official
      from jsonb_array_elements(u#>'{document,source,races}') r where p_slot=0 or (r->>'slot')::integer=p_slot;
    if official is null or b#>>'{timing,reviewPeriod}' is distinct from '0'
      or b#>>'{timing,reviewStartedAt}' is distinct from official::text
      or b#>>'{timing,officialPublishedAt}' is distinct from official::text then raise exception 'invalid_sponsor_lifecycle'; end if;
    if b->>'schema' is distinct from 'raceson-sponsor-publication-v4' or b->>'approvalId' is distinct from p_approval_id::text
     or b->>'packageHash' is distinct from u#>>'{prepared,packageHash}' or b->>'contextHash' is distinct from u->>'contextHash'
     or b#>>'{timing,reviewPeriod}' is distinct from u#>>array['execution','plan','reviewPeriods',p_slot::text]
     or coalesce(b#>>'{timing,reviewStartedAt}','') !~ '^[1-9][0-9]{0,11}$'
     or coalesce(b#>>'{timing,officialPublishedAt}','') !~ '^[1-9][0-9]{0,11}$'
     or (b#>>'{timing,officialPublishedAt}')::bigint < (b#>>'{timing,reviewStartedAt}')::bigint+(b#>>'{timing,reviewPeriod}')::bigint
     or (b#>>'{timing,officialPublishedAt}')::bigint>extract(epoch from clock_timestamp())
     or coalesce(b#>>'{timing,publicationEvidenceHash}','') !~ '^0x[0-9a-f]{64}$' then raise exception 'invalid_sponsor_lifecycle'; end if;
   else
    if not exists(select 1 from app_private.reward_sponsor_lifecycle_v4 where approval_id=p_approval_id and kind='publication' and source_stamp=stamp)
     or coalesce(b->>'transactionHash','') !~ '^0x[0-9a-f]{64}$' or coalesce(b->>'blockHash','') !~ '^0x[0-9a-f]{64}$'
     or coalesce(b->>'blockNumber','') !~ '^[0-9]+$' or b->>'campaignAddress' is distinct from u#>>'{prepared,package,campaignAddress}'
     or coalesce(b->>'action','') not in('upload','stage','activate') then raise exception 'invalid_sponsor_lifecycle'; end if;
   end if;
   insert into app_private.reward_sponsor_lifecycle_v4(id,approval_id,kind,body_text,body_hash,source_stamp,actor_user_id)
   values(p_request_id,p_approval_id,p_kind,p_body_text,encode(sha256(convert_to(p_body_text,'UTF8')),'hex'),stamp,p_actor_user_id);
   fresh:=app_private.read_reward_demo_copy_upload(p_actor_user_id,p_actor_session_id,p_chain_id,p_setup_id,p_slot,p_approval_id);
   if fresh->'current' is distinct from 'true'::jsonb or app_private.reward_demo_copy_source_stamp(p_approval_id) is distinct from stamp then raise exception 'reward_planning_revision_changed'; end if;
  end if;
 end if;
 select jsonb_build_object('id',id,'body',body_text::jsonb,'bodyHash',body_hash,'current',source_stamp=stamp,'createdAt',created_at) into pub
 from app_private.reward_sponsor_lifecycle_v4 where approval_id=p_approval_id and kind='publication';
 select coalesce(jsonb_agg(jsonb_build_object('id',id,'body',body_text::jsonb) order by created_at,id),'[]'::jsonb) into receipts
 from app_private.reward_sponsor_lifecycle_v4 where approval_id=p_approval_id and kind='receipt';
 perform app_private.require_reward_demo_copy_reviewer(p_actor_user_id,p_actor_session_id);
 return jsonb_build_object('upload',u,'publication',pub,'receipts',receipts);
end $$;

create function public.service_reward_demo_copy_lifecycle(p_actor_user_id uuid,p_actor_session_id uuid,
 p_setup_id uuid,p_slot integer,p_approval_id uuid,p_request_id uuid default null,p_kind text default null,p_body_text text default null)
returns jsonb language plpgsql volatile security definer set search_path='' as $$
begin
 if p_kind is null and (p_request_id is not null or p_body_text is not null) then raise exception 'invalid_sponsor_lifecycle'; end if;
 return app_private.reward_demo_copy_lifecycle(p_actor_user_id,p_actor_session_id,10143,p_setup_id,p_slot,p_approval_id,p_request_id,p_kind,p_body_text);
end $$;
revoke all on function app_private.reward_demo_copy_source_stamp(uuid),
 app_private.reward_demo_copy_lifecycle(uuid,uuid,integer,uuid,integer,uuid,uuid,text,text),
 public.service_reward_demo_copy_lifecycle(uuid,uuid,uuid,integer,uuid,uuid,text,text) from public,anon,authenticated,service_role;
grant execute on function public.service_reward_demo_copy_lifecycle(uuid,uuid,uuid,integer,uuid,uuid,text,text) to service_role;
notify pgrst,'reload schema';
commit;
