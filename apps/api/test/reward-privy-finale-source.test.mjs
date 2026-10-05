import assert from "node:assert/strict";
import test from "node:test";
import { privyFinaleFixture, finaleFixtureSql } from "../../../demo/rewards/scripts/privy-testnet-finale-source.mjs";
import { decodeLeagueScoringPolicyV3 } from "../../../packages/domain/dist/rewards/league-standings-v3.js";
const capturedAt="2026-09-13T18:00:00.000Z",actor="d6907f24-a783-47b9-be66-285ca877422f";
test("finale fixture keeps the exact ten-person cohort, seven categories and four clubs",()=>{
  const f=privyFinaleFixture(capturedAt),rows=f.races.flatMap(r=>r.rows);
  assert.equal(rows.length,10);assert.equal(new Set(rows.map(r=>r.athleteId)).size,10);
  assert.equal(new Set(rows.map(r=>r.categoryId)).size,7);assert.equal(new Set(rows.map(r=>r.clubId)).size,4);
  assert.deepEqual(rows.map(r=>r.athleteId).sort(),f.pilot.athletes.map(a=>a.id).sort());
  assert.equal(f.races[0].rows.length,7);assert.equal(f.races[1].rows.length,3);
  assert.deepEqual(decodeLeagueScoringPolicyV3(f.policy),f.policy);
  assert.deepEqual(privyFinaleFixture(capturedAt),f);
  for(const r of f.races)assert.deepEqual(r.rows.map(row=>row.rankOverall),r.rows.map((_,i)=>i+1));
});
test("fixture writer rejects altered results, foreign IDs, amounts and SQL-bearing actor input",()=>{
  for(const change of [f=>f.races[0].rows[0].athleteId=actor,f=>f.races[0].rows[0].finishTimeMs=1,
    f=>f.pilot.rules.budgetMon="100000",f=>f.policy.club.membersPerRound=10]){
    const f=privyFinaleFixture(capturedAt);change(f);assert.throws(()=>finaleFixtureSql(f,actor));
  }
  assert.throws(()=>finaleFixtureSql(privyFinaleFixture(capturedAt),"'; drop table clubs; --"));
});
test("fixture has transactional rollback and scope guards, no identity proof or payment writes",()=>{
  const f=privyFinaleFixture(capturedAt),sql=finaleFixtureSql(f,actor,true);
  assert.match(sql,/begin; do \$finale\$/);assert.match(sql,/rollback;$/);
  assert.match(sql,/reward_privy_synthetic_programme_v3/);assert.match(sql,/synthetic_finale_empty_fixture_required/);
  assert.match(sql,/synthetic_finale_changed/);assert.match(sql,/is_practice=true,public_visibility='private'/);
  assert.doesNotMatch(sql,/update public\.athlete_profiles|auth\.|reward_athlete_claim|private_key|drop |delete |truncate /i);
  assert.match(finaleFixtureSql(f,actor),/commit;$/);
});
