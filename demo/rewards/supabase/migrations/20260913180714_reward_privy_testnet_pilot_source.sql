begin;

-- A separately identified ten-person synthetic source for the owner-approved
-- Privy/Monad testnet trial. No profiles, ownership, age evidence or funds here.
alter table app_private.reward_public_snapshots_v2
  drop constraint reward_public_snapshots_v2_payload_check,
  add constraint reward_public_snapshots_v2_payload_check check ((
    jsonb_typeof(payload)='object' and octet_length(payload::text)<=2097152 and (
      (payload->>'version'='2' and payload->>'sourceOrigin'='https://www.raceson.com'
        and season_id not in('8a000000-0000-4000-8000-000000000051'::uuid,'9a000000-0000-4000-8000-000000000051'::uuid)
        and payload->>'sourceLeagueId' not in('8a000000-0000-4000-8000-000000000050','9a000000-0000-4000-8000-000000000050')
        and payload->>'sourceSeasonId' not in('8a000000-0000-4000-8000-000000000051','9a000000-0000-4000-8000-000000000051')) or
      (payload->>'version'='3'
        and payload->>'sourceSeasonId'=season_id::text
        and jsonb_typeof(payload->'results')='array'
        and jsonb_typeof(payload->'clubs')='array' and jsonb_array_length(payload->'clubs')=4
        and jsonb_typeof(payload#>'{catalogue,rounds}')='array' and jsonb_array_length(payload#>'{catalogue,rounds}')=4
        and jsonb_typeof(payload#>'{catalogue,categories}')='array' and jsonb_array_length(payload#>'{catalogue,categories}')=8
        and (
          (payload->>'sourceOrigin'='urn:raceson:synthetic:compact-20:v3'
            and season_id='8a000000-0000-4000-8000-000000000051'::uuid
            and payload->>'sourceLeagueId'='8a000000-0000-4000-8000-000000000050'
            and jsonb_array_length(payload->'results')=80) or
          (payload->>'sourceOrigin'='urn:raceson:synthetic:privy-10:v3'
            and season_id='9a000000-0000-4000-8000-000000000051'::uuid
            and payload->>'sourceLeagueId'='9a000000-0000-4000-8000-000000000050'
            and jsonb_array_length(payload->'results')=40)
        ))
    )) is true);

alter table app_private.reward_planning_drafts add constraint reward_privy_pilot_chain
  check (season_id<>'9a000000-0000-4000-8000-000000000051'::uuid or chain_id=10143);

-- Keep V2 freeze exclusions, existing ownership/RLS and all payment gates.
commit;
