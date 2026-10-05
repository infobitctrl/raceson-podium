begin;

-- Isolated demo overlay only. Keep immutable V2 production-origin snapshots as
-- they are. A distinct version/origin permits the finite invented compact pilot;
-- inserting this source never creates Auth/profile/claim/review/funding records.
alter table app_private.reward_public_snapshots_v2
  drop constraint reward_public_snapshots_v2_payload_check,
  add constraint reward_public_snapshots_v2_payload_check check ((
    jsonb_typeof(payload)='object' and octet_length(payload::text)<=2097152 and (
      (payload->>'version'='2' and payload->>'sourceOrigin'='https://www.raceson.com'
        and season_id<>'8a000000-0000-4000-8000-000000000051'::uuid
        and payload->>'sourceLeagueId'<>'8a000000-0000-4000-8000-000000000050'
        and payload->>'sourceSeasonId'<>'8a000000-0000-4000-8000-000000000051') or
      (payload->>'version'='3' and payload->>'sourceOrigin'='urn:raceson:synthetic:compact-20:v3'
        and season_id='8a000000-0000-4000-8000-000000000051'::uuid
        and payload->>'sourceSeasonId'=season_id::text
        and payload->>'sourceLeagueId'='8a000000-0000-4000-8000-000000000050'
        and jsonb_typeof(payload->'results')='array' and jsonb_array_length(payload->'results')=80
        and jsonb_typeof(payload->'clubs')='array' and jsonb_array_length(payload->'clubs')=4
        and jsonb_typeof(payload#>'{catalogue,rounds}')='array' and jsonb_array_length(payload#>'{catalogue,rounds}')=4
        and jsonb_typeof(payload#>'{catalogue,categories}')='array' and jsonb_array_length(payload#>'{catalogue,categories}')=8)
    )) is true);

-- Defence in depth for service-role direct SQL callers. Synthetic snapshots must
-- not become old V2 documents, whose schema has no synthetic provenance field.
create function app_private.require_v2_reward_proposal_source() returns trigger
language plpgsql security invoker set search_path='' as $$ begin
  if exists(select 1 from app_private.reward_planning_drafts d
    join app_private.reward_public_snapshots_v2 s on s.season_id=d.season_id and s.organization_id=d.organization_id
    where d.id=new.draft_id and s.payload->>'version'<>'2') then
    raise exception 'invalid_reward_planning_request';
  end if;
  return new;
end $$;
revoke all on function app_private.require_v2_reward_proposal_source() from public,anon,authenticated,service_role;
create trigger reward_v2_proposal_source before insert on app_private.reward_frozen_proposals_v2
  for each row execute function app_private.require_v2_reward_proposal_source();

-- Existing source sealing, append-only history, RLS, grants, live-session checks
-- and source-context hashing are unchanged. This grants no browser SQL access.
commit;
