import assert from "node:assert/strict";
import test from "node:test";
import { createPrivyTestnetPilotV3, privyPilotIdV3 as id } from "../../../packages/domain/dist/rewards/privy-testnet-pilot-v3.js";
import { createSyntheticPilotV3 } from "../../../packages/domain/dist/rewards/synthetic-pilot-v3.js";
import { decodeStoredRewardSnapshot, decodePublishedRewardSnapshotV2, previewPublishedRewardsV2 } from "../../../packages/domain/dist/rewards/published-preview-v2.js";
import { privyPilotSeedSql } from "../../../demo/rewards/scripts/seed-privy-testnet-pilot.mjs";
import { parsePrivyProgrammeCommand, preparePrivyProgramme, privyTestnetProgramme } from "../../../demo/rewards/scripts/privy-testnet-programme.mjs";
const now = "2026-09-13T18:00:00.000Z";
test("new Privy pilot has ten recurring synthetic athletes, seven categories and four independently rescored clubs", () => {
  const original = createSyntheticPilotV3(now), before = structuredClone(original), p = createPrivyTestnetPilotV3(now);
  assert.equal(p.chainId, 10143); assert.equal(p.rules.budgetMon, "100"); assert.equal(p.athletes.length, 10);
  assert.equal(p.athletes[0].id, p.firstAthleteId); assert.equal(p.firstAthleteId, id(1060));
  assert.equal(p.snapshot.results.length, 40); assert.equal(p.snapshot.clubs.length, 4);
  assert.equal(new Set(p.snapshot.results.flatMap(r => r.classificationIds)).size, 7);
  assert.deepEqual(decodeStoredRewardSnapshot(p.snapshot), p.snapshot);
  assert.throws(() => decodePublishedRewardSnapshotV2(p.snapshot));
  assert.deepEqual(original, before); assert.deepEqual(createSyntheticPilotV3(now), before);
  assert.doesNotMatch(JSON.stringify(p), /8a000000|privateKey|password|dateOfBirth|date_of_birth|https:/);
  for (const round of p.snapshot.catalogue.rounds) {
    const rows = p.snapshot.results.filter(r => round.races.some(race => race.id === r.raceId));
    assert.equal(rows.length, 10); assert.equal(new Set(rows.map(r => r.athleteId)).size, 10);
  }
  const preview = previewPublishedRewardsV2(p.rules, p.mapping, p.snapshot);
  assert.equal(preview.leagueRetainedWei, 50n * 10n ** 18n);
});
test("Privy source cannot become a production export, compact fixture, foreign profile or incomplete cohort", () => {
  for (const mutate of [p => p.sourceOrigin = "urn:raceson:synthetic:compact-20:v3",
    p => { p.version = 2; p.sourceOrigin = "https://www.raceson.com"; },
    p => p.results[0].athleteId = "40c6cfd6-5f3f-44c5-9d8f-68e273761a70",
    p => p.results.pop(), p => p.results[0].athleteId = p.results[1].athleteId,
    p => p.catalogue.categories[0].eligibility.demoOnly = false]) {
    const snapshot = createPrivyTestnetPilotV3(now).snapshot; mutate(snapshot);
    assert.throws(() => decodeStoredRewardSnapshot(snapshot));
  }
});
test("seed links only one new synthetic profile, leaves DOB unknown and never creates keys or approvals", () => {
  const p = createPrivyTestnetPilotV3(now), sql = privyPilotSeedSql(p, id(9001), id(9002));
  assert.equal((sql.match(/insert into public.athlete_profiles/g) ?? []).length, 10);
  assert.match(sql, /a.username='demo.athlete'/); assert.match(sql, /o.slug='monad-demo'/);
  assert.match(sql, /Privy pilot saved scope changed/);
  assert.doesNotMatch(sql, /insert into auth\.|update public.athlete_profiles|date_of_birth|wallet|private_key|insert into app_private.reward_(?:athlete|programme_approval|programme_deployment|allocation_approval)/);
  assert.throws(() => privyPilotSeedSql({ ...p, chainId: 31337 }, id(9001), id(9002)));
  assert.throws(() => privyPilotSeedSql(p, id(9001), id(9001)));
});
test("dedicated programme command rejects network/key/budget overrides and wrong chain before database IO", async () => {
  assert.deepEqual(parsePrivyProgrammeCommand(["prepare"]), { command: "prepare" });
  assert.equal(parsePrivyProgrammeCommand(["deploy", "--confirm-source", "a".repeat(64)]).command, "deploy");
  for (const args of [[], ["run"], ["deploy"], ["prepare", "--chain", "143"], ["deploy", "--confirm-source", "no"],
    ["deploy", "--confirm-source", "a".repeat(64), "--key", "secret"]]) assert.throws(() => parsePrivyProgrammeCommand(args));
  assert.equal(privyTestnetProgramme.budgetMon, "100"); assert.equal(privyTestnetProgramme.chainId, 10143);
  assert.equal(privyTestnetProgramme.reviewSeconds, 0);
  const session = { identity: {}, rpc: () => { throw Error("unexpected_database_io"); } };
  for (const chainId of [143, 31337]) await assert.rejects(preparePrivyProgramme(session, { getChainId: async () => chainId }), /10143/);
  await assert.rejects(preparePrivyProgramme(session, { getChainId: async () => 10143 }, () => { throw Error("stopped"); }), /stopped/);
});
