import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
import { createSyntheticPilotV3 } from "@raceson/domain/rewards/synthetic-pilot-v3";
import { localSql } from "./local-demo.mjs";

const org = "82000000-0000-4000-8000-000000000002";
const q = value => `'${String(value).replaceAll("'", "''")}'`;
const validId = value => assert.match(value, /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/);

// Export the exact SQL for disposable database coverage. Scope is supplied by
// the guarded local runner, never by a browser or inherited remote connection.
export function compactPilotSeedSql(pilot, organizationId, actorUserId) {
  validId(organizationId); validId(actorUserId);
  assert.deepEqual(pilot, createSyntheticPilotV3(pilot.snapshot.capturedAt));
  const { draftId, snapshot, rules, mapping, finale } = pilot;
  const statements = [
    `perform pg_advisory_xact_lock(hashtextextended(${q(draftId)},0));`,
    `if not exists(select 1 from public.organizations o join public.organization_memberships m on m.organization_id=o.id
      where o.id=${q(organizationId)} and m.user_id=${q(actorUserId)} and m.role='owner' and m.status='active'
        and (m.expires_at is null or m.expires_at>clock_timestamp()))
      then raise exception 'Synthetic pilot requires the local demo owner'; end if;`,
    `if exists(select 1 from app_private.reward_planning_drafts where id=${q(draftId)}) then
      if not exists(select 1 from app_private.reward_planning_drafts d join app_private.reward_public_snapshots_v2 s
        on s.season_id=d.season_id and s.organization_id=d.organization_id where d.id=${q(draftId)}
        and d.organization_id=${q(organizationId)} and d.season_id=${q(snapshot.sourceSeasonId)} and d.chain_id=31337
        and s.payload=${q(JSON.stringify(snapshot))}::jsonb) then raise exception 'Synthetic pilot source conflict'; end if;
      return; -- Never reset saved edits, source decisions, approvals or receipts.
    end if;`,
    `insert into public.leagues(id,organization_id,slug,name,status,description)
      values(${q(snapshot.sourceLeagueId)},${q(organizationId)},'synthetic-compact-pilot',
      '100 MON pilot · 20 athletes · Synthetic','active','Invented five-round league for isolated reward testing. Not actual Si Trail results. No athlete ownership or wallet control is asserted.');`,
    `insert into public.league_seasons(id,league_id,year,name,status) values(${q(snapshot.sourceSeasonId)},${q(snapshot.sourceLeagueId)},2026,'20-athlete pilot · Synthetic','active');`,
    `insert into public.event_series(id,organization_id,slug,name,status) values(${q(finale.seriesId)},${q(organizationId)},'synthetic-compact-pilot','Compact pilot · Synthetic','active');`,
    `insert into public.event_editions(id,event_series_id,slug,name,start_date,status,results_visibility)
      values(${q(finale.editionId)},${q(finale.seriesId)},'synthetic-pilot-finale','Round 5 · Synthetic finale rehearsal','2026-10-03','draft','private');`,
    ...[[finale.shortRaceId, "short", "Short", 5], [finale.longRaceId, "long", "Long", 10]].map(([id, slug, name, km]) =>
      `insert into public.event_categories(id,event_edition_id,slug,name,distance_km,status)
        values(${q(id)},${q(finale.editionId)},${q(slug)},${q(`${name} · Synthetic`)},${km},'draft');`),
    `insert into app_private.reward_public_snapshots_v2(season_id,organization_id,payload,source_hash)
      values(${q(snapshot.sourceSeasonId)},${q(organizationId)},${q(JSON.stringify(snapshot))}::jsonb,repeat('0',64));`,
    `insert into app_private.reward_planning_drafts(id,organization_id,season_id,chain_id,rules,updated_by_user_id)
      values(${q(draftId)},${q(organizationId)},${q(snapshot.sourceSeasonId)},31337,${q(JSON.stringify(rules))}::jsonb,${q(actorUserId)});`,
    `insert into app_private.reward_source_mappings_v2(draft_id,revision,mapping,catalogue_hash,rules_revision,updated_by_user_id)
      values(${q(draftId)},1,${q(JSON.stringify(mapping))}::jsonb,
      encode(sha256(convert_to(app_private.reward_mapping_catalogue_v2(${q(snapshot.sourceSeasonId)},${q(organizationId)})::text,'UTF8')),'hex'),1,${q(actorUserId)});`,
  ];
  return `begin; do $compact_pilot$ begin\n${statements.join("\n")}\nend $compact_pilot$; commit;`;
}

export function seedCompactPilot() {
  // localSql validates the dedicated Unix-socket Docker/loopback stack before IO.
  const actor = JSON.parse(localSql(`select to_jsonb(a.user_id) from public.account_login_identifiers a
    join public.organization_memberships m on m.user_id=a.user_id join public.organizations o on o.id=m.organization_id
    where a.username='demo.organizer' and o.id=${q(org)} and o.slug='si-trail-demo' and m.role='owner' and m.status='active'
      and (m.expires_at is null or m.expires_at>clock_timestamp())`));
  validId(actor);
  const prior = JSON.parse(localSql(`select coalesce((select to_jsonb(payload->>'capturedAt') from app_private.reward_public_snapshots_v2
    where season_id='8a000000-0000-4000-8000-000000000051'),'null'::jsonb)`));
  const pilot = createSyntheticPilotV3(prior ?? new Date().toISOString());
  localSql(compactPilotSeedSql(pilot, org, actor));
  console.log(JSON.stringify({ draftId: pilot.draftId, chainId: 31337, source: pilot.snapshot.sourceOrigin,
    athletes: 20, historicalEntries: 80, clubs: 4, budgetMon: "100", finale: "draft_not_published",
    status: "Saved pilot preserved; no wallets, approvals, review clocks, deployment or funding created." }));
  return pilot.draftId;
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { assert.equal(process.argv.length, 2, "This local pilot accepts no inputs"); seedCompactPilot(); }
  catch { console.error("Compact pilot seed failed; no credentials or private rows logged."); process.exitCode = 1; }
}
