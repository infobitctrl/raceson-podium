begin;
-- Presentation only: independent of immutable economic revisions and chain journals.
create table app_private.reward_campaign_branding (
 setup_id uuid primary key references app_private.reward_distribution_setups(id) on delete cascade,
 name text not null check(length(btrim(name)) between 1 and 80 and name !~ '[[:cntrl:]]'),
 logo text check(logo is null or (length(logo) <= 90000 and logo ~ '^data:image/png;base64,iVBORw0KGgo[A-Za-z0-9+/]*={0,2}$')),
 revision integer not null check(revision > 0),
 updated_at timestamptz not null default clock_timestamp()
);
alter table app_private.reward_campaign_branding enable row level security;
revoke all on app_private.reward_campaign_branding from public,anon,authenticated,service_role;
grant select,insert,update on app_private.reward_campaign_branding to service_role;
create policy campaign_branding_service on app_private.reward_campaign_branding for all to service_role using(true) with check(true);
create function public.service_reward_campaign_branding(p_chain_id integer,p_actor_user_id uuid default null,p_actor_session_id uuid default null,
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
  if jsonb_typeof(p_change) is distinct from 'object' or (select count(*) from jsonb_object_keys(p_change))<>3
   or not(p_change ?& array['name','logo','expectedRevision']) or jsonb_typeof(p_change->'name') is distinct from 'string'
   or jsonb_typeof(p_change->'logo') not in('string','null') or coalesce(p_change->>'expectedRevision','') !~ '^(0|[1-9][0-9]{0,8})$'
   then raise exception 'invalid_campaign_branding'; end if;
  select * into b from app_private.reward_campaign_branding where setup_id=p_setup_id;
  if coalesce(b.revision,0)<>(p_change->>'expectedRevision')::integer then raise exception 'campaign_branding_conflict'; end if;
  insert into app_private.reward_campaign_branding(setup_id,name,logo,revision) values(p_setup_id,btrim(p_change->>'name'),p_change->>'logo',coalesce(b.revision,0)+1)
   on conflict(setup_id) do update set name=excluded.name,logo=excluded.logo,revision=excluded.revision,updated_at=clock_timestamp();
 end if;
 -- Owner reads include draft IDs, but anonymous reads expose only published branding.
 select coalesce(jsonb_agg(jsonb_build_object('id',setup.id,'name',brand.name,'logo',brand.logo,'revision',coalesce(brand.revision,0)) order by setup.id),'[]'::jsonb) into result
 from app_private.reward_distribution_setups setup left join app_private.reward_campaign_branding brand on brand.setup_id=setup.id
 where setup.chain_id=p_chain_id and (p_setup_id is null or setup.id=p_setup_id)
 and (case when p_actor_user_id is not null then setup.owner_user_id=p_actor_user_id else exists(select 1 from app_private.reward_public_campaigns p where p.setup_id=setup.id) end);
 return result;
end $$;
revoke all on function public.service_reward_campaign_branding(integer,uuid,uuid,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.service_reward_campaign_branding(integer,uuid,uuid,uuid,jsonb) to service_role;
commit;
