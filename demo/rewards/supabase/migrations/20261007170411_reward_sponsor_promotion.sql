begin;
-- Presentation metadata only. No economic setup, operator or claim term changes.
alter table app_private.reward_campaign_branding add column website text check(website is null or (length(website)<=300 and website ~ '^https://[A-Za-z0-9][A-Za-z0-9.-]*(:[0-9]{1,5})?([/?#][^[:space:][:cntrl:]]*)?$')),
 add column promotion text check(promotion is null or (length(promotion)<=1200 and promotion !~ '[\x01-\x08\x0B\x0C\x0E-\x1F\x7F]'));
create or replace function public.service_reward_campaign_branding(p_chain_id integer,p_actor_user_id uuid default null,p_actor_session_id uuid default null,
 p_setup_id uuid default null,p_change jsonb default null)
returns jsonb language plpgsql volatile security invoker set search_path='' as $$
declare d app_private.reward_distribution_setups%rowtype; b app_private.reward_campaign_branding%rowtype; result jsonb;
begin
 if p_chain_id is null or p_chain_id not in(10143,31337) then raise exception 'invalid_campaign_branding'; end if;
 if p_actor_user_id is not null or p_actor_session_id is not null or p_change is not null then
  perform app_private.require_reward_account(p_actor_user_id,p_actor_session_id);
 end if;
 if p_change is not null then
  select * into d from app_private.reward_distribution_setups where id=p_setup_id and chain_id=p_chain_id and owner_user_id=p_actor_user_id for update;
  if not found then raise exception 'reward_setup_not_found'; end if;
  perform app_private.require_reward_account(p_actor_user_id,p_actor_session_id);
  if jsonb_typeof(p_change) is distinct from 'object' or exists(select 1 from jsonb_object_keys(p_change) k where k not in('name','logo','expectedRevision','website','promotion'))
   or not(p_change ?& array['name','logo','expectedRevision']) or jsonb_typeof(p_change->'name') is distinct from 'string'
   or jsonb_typeof(p_change->'logo') not in('string','null') or coalesce(p_change->>'expectedRevision','') !~ '^(0|[1-9][0-9]{0,8})$'
   then raise exception 'invalid_campaign_branding'; end if;
  if p_change ? 'website' and (jsonb_typeof(p_change->'website') not in('string','null') or (p_change->>'website' is not null and (length(p_change->>'website')>300 or p_change->>'website' !~ '^https://[A-Za-z0-9][A-Za-z0-9.-]*(:[0-9]{1,5})?([/?#][^[:space:][:cntrl:]]*)?$'))) then raise exception 'invalid_campaign_branding'; end if;
  if p_change ? 'promotion' and (jsonb_typeof(p_change->'promotion') not in('string','null') or length(p_change->>'promotion')>1200 or p_change->>'promotion' ~ '[\x01-\x08\x0B\x0C\x0E-\x1F\x7F]') then raise exception 'invalid_campaign_branding'; end if;
  select * into b from app_private.reward_campaign_branding where setup_id=p_setup_id;
  if coalesce(b.revision,0)<>(p_change->>'expectedRevision')::integer then raise exception 'campaign_branding_conflict'; end if;
  insert into app_private.reward_campaign_branding(setup_id,name,logo,website,promotion,revision) values(p_setup_id,btrim(p_change->>'name'),p_change->>'logo',case when p_change ? 'website' then p_change->>'website' else b.website end,case when p_change ? 'promotion' then p_change->>'promotion' else b.promotion end,coalesce(b.revision,0)+1)
   on conflict(setup_id) do update set name=excluded.name,logo=excluded.logo,website=excluded.website,promotion=excluded.promotion,revision=excluded.revision,updated_at=clock_timestamp();
 end if;
 -- Owner reads include draft IDs, but anonymous reads expose only published branding.
 select coalesce(jsonb_agg(jsonb_build_object('id',setup.id,'name',brand.name,'logo',brand.logo,'website',brand.website,'promotion',brand.promotion,'revision',coalesce(brand.revision,0)) order by setup.id),'[]'::jsonb) into result
 from app_private.reward_distribution_setups setup left join app_private.reward_campaign_branding brand on brand.setup_id=setup.id
 where setup.chain_id=p_chain_id and (p_setup_id is null or setup.id=p_setup_id)
 and (case when p_actor_user_id is not null then setup.owner_user_id=p_actor_user_id else exists(select 1 from app_private.reward_public_campaigns p where p.setup_id=setup.id) end);
 return result;
end $$;
-- CREATE OR REPLACE preserves existing ACLs, including the hosted generic-RPC revocation.
notify pgrst,'reload schema';
commit;
