import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
import { createPrivyTestnetPilotV3, privyPilotIdV3 as id } from "@raceson/domain/rewards/privy-testnet-pilot-v3";
import { localSql } from "./local-demo.mjs";

export const privyPilotOrganization = "82000000-0000-4000-8000-000000000001";
const q = value => `'${String(value).replaceAll("'", "''")}'`;
const uuid = value => assert.match(value, /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/);

/** Only the guarded local runner executes this seed. Owner explicitly approved
 * a new synthetic cohort and ONE link to demo.athlete on 2026-09-13. No existing
 * profile is updated, no date of birth/evidence/nomination/key/consent is created. */
export function privyPilotSeedSql(pilot, organizerUserId, athleteUserId) {
  uuid(organizerUserId); uuid(athleteUserId); assert.notEqual(organizerUserId, athleteUserId);
  assert.deepEqual(pilot, createPrivyTestnetPilotV3(pilot.snapshot.capturedAt));
  const { snapshot, draftId, rules, mapping, finale, athletes, firstAthleteId } = pilot;
  const org = privyPilotOrganization;
  return `begin; do $privy_pilot$ begin
    perform pg_advisory_xact_lock(hashtextextended(${q(draftId)},0));
    if not exists(select 1 from public.account_login_identifiers a join public.organization_memberships m on m.user_id=a.user_id
      join public.organizations o on o.id=m.organization_id where a.username='demo.organizer' and a.user_id=${q(organizerUserId)}
      and o.id=${q(org)} and o.slug='monad-demo' and m.role='owner' and m.status='active'
      and (m.expires_at is null or m.expires_at>clock_timestamp())) then raise exception 'Privy pilot owner required'; end if;
    if not exists(select 1 from public.account_login_identifiers a join public.user_profiles p on p.user_id=a.user_id
      where a.username='demo.athlete' and a.user_id=${q(athleteUserId)} and p.status='active')
      then raise exception 'Privy pilot demo athlete required'; end if;
    if exists(select 1 from app_private.reward_planning_drafts where id=${q(draftId)}) then
      if not exists(select 1 from app_private.reward_planning_drafts d join app_private.reward_public_snapshots_v2 s
        on s.season_id=d.season_id and s.organization_id=d.organization_id where d.id=${q(draftId)} and d.organization_id=${q(org)}
        and d.season_id=${q(snapshot.sourceSeasonId)} and d.chain_id=10143 and s.payload=${q(JSON.stringify(snapshot))}::jsonb)
        or not exists(select 1 from public.athlete_profiles where id=${q(firstAthleteId)} and claimed_by_user_id=${q(athleteUserId)}
          and is_claimed and status='active' and merged_into_athlete_profile_id is null)
        then raise exception 'Privy pilot saved scope changed'; end if;
      return; -- Never reset later edits, claims, profiles, consent or receipts.
    end if;
    insert into public.leagues(id,organization_id,slug,name,status,description) values
      (${q(snapshot.sourceLeagueId)},${q(org)},'privy-testnet-pilot','Monad Testnet · 10 athletes · Synthetic','active',
       'Separate 100 test MON Privy pilot. Invented sporting data, not Si Trail results. No real-world age or identity attestation.');
    insert into public.league_seasons(id,league_id,year,name,status) values
      (${q(snapshot.sourceSeasonId)},${q(snapshot.sourceLeagueId)},2026,'Privy testnet pilot · Synthetic','active');
    insert into public.event_series(id,organization_id,slug,name,status) values
      (${q(finale.seriesId)},${q(org)},'privy-testnet-pilot','Privy testnet pilot · Synthetic','active');
    insert into public.event_editions(id,event_series_id,slug,name,start_date,status,results_visibility) values
      (${q(finale.editionId)},${q(finale.seriesId)},'privy-testnet-finale','Round 5 · Synthetic finale rehearsal','2026-10-03','draft','private');
    ${[[finale.shortRaceId, "short", 5], [finale.longRaceId, "long", 10]].map(([raceId, name, km]) =>
      `insert into public.event_categories(id,event_edition_id,slug,name,distance_km,status) values
       (${q(raceId)},${q(finale.editionId)},${q(name)},${q(`${name} · Synthetic Privy pilot`)},${km},'draft');`).join("\n")}
    ${athletes.map((a, n) => `insert into public.athlete_profiles(id,slug,first_name,last_name,display_name,is_claimed,claimed_by_user_id,status)
      values(${q(a.id)},${q(`privy-testnet-athlete-${n + 1}`)},'Synthetic',${q(`Test Athlete ${n + 1}`)},${q(a.name)},
        ${a.id === firstAthleteId ? "true" : "false"},${a.id === firstAthleteId ? q(athleteUserId) : "null"},'active');`).join("\n")}
    insert into app_private.reward_public_snapshots_v2(season_id,organization_id,payload,source_hash) values
      (${q(snapshot.sourceSeasonId)},${q(org)},${q(JSON.stringify(snapshot))}::jsonb,repeat('0',64));
    insert into app_private.reward_planning_drafts(id,organization_id,season_id,chain_id,rules,updated_by_user_id) values
      (${q(draftId)},${q(org)},${q(snapshot.sourceSeasonId)},10143,${q(JSON.stringify(rules))}::jsonb,${q(organizerUserId)});
    insert into app_private.reward_source_mappings_v2(draft_id,revision,mapping,catalogue_hash,rules_revision,updated_by_user_id) values
      (${q(draftId)},1,${q(JSON.stringify(mapping))}::jsonb,
       encode(sha256(convert_to(app_private.reward_mapping_catalogue_v2(${q(snapshot.sourceSeasonId)},${q(org)})::text,'UTF8')),'hex'),1,${q(organizerUserId)});
  end $privy_pilot$; commit;`;
}

export function seedPrivyTestnetPilot() {
  const accounts = JSON.parse(localSql(`begin read only; select jsonb_object_agg(username,user_id) from public.account_login_identifiers
    where username in('demo.organizer','demo.athlete'); commit;`));
  const prior = JSON.parse(localSql(`begin read only; select coalesce((select to_jsonb(payload->>'capturedAt') from app_private.reward_public_snapshots_v2
    where season_id=${q(id(51))}),'null'::jsonb); commit;`));
  const pilot = createPrivyTestnetPilotV3(prior ?? new Date().toISOString());
  localSql(privyPilotSeedSql(pilot, accounts["demo.organizer"], accounts["demo.athlete"]));
  return { draftId: pilot.draftId, chainId: 10143, budgetMon: pilot.rules.budgetMon, athletes: 10,
    linkedProfiles: 1, firstAthleteId: pilot.firstAthleteId, source: pilot.snapshot.sourceOrigin,
    status: "Synthetic programme saved. No age evidence, wallets, nominations, approvals, deployment or payment created." };
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { assert.equal(process.argv.length, 2, "No seed overrides allowed"); console.log(JSON.stringify(seedPrivyTestnetPilot())); }
  catch { console.error("Privy pilot seed stopped; private account details suppressed. Inspect saved scope before retrying."); process.exitCode = 1; }
}
