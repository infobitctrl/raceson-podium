import assert from "node:assert/strict";
import test from "node:test";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { listMigrationSources, selectMigrationSources } from "../../../packages/db/scripts/reward-migration-sources.mjs";

const base = ["20260907010000_core.sql", "20260909010000_later_core.sql"];
const demo = ["20260908010000_reward_demo.sql"];

test("default migration selection excludes demo and preserves later core migrations", () => {
  assert.deepEqual(selectMigrationSources(base, demo), base.map((name) => ({ name, source: "base" })));
  assert.deepEqual(selectMigrationSources(base, ["invalid demo path"]), selectMigrationSources(base));
});

test("explicit demo migration selection merges both sources in global timestamp order", () => {
  assert.deepEqual(selectMigrationSources([...base].reverse(), demo, true), [
    { name: base[0], source: "base" }, { name: demo[0], source: "demo" }, { name: base[1], source: "base" },
  ]);
});

test("migration selection rejects duplicate versions, malformed names and empty required sources", () => {
  assert.throws(() => selectMigrationSources(base, ["20260907010000_reward_duplicate.sql"], true), /Duplicate/);
  assert.throws(() => selectMigrationSources([...base, base[0]]), /Duplicate/);
  for (const name of ["../outside.sql", "20260907010000_core.sql\n", "20260907010000_CORE.sql", "bad.sql", 123]) {
    assert.throws(() => selectMigrationSources([name]), /filename/);
  }
  for (const args of [[[], demo, true], [base, [], true], [base, demo, "true"], [null]]) {
    assert.throws(() => selectMigrationSources(...args), /selection/);
  }
});

test("reward-named migrations fail closed if placed back in the production path", () => {
  for (const includeDemo of [false, true]) {
    assert.throws(() => selectMigrationSources([...base, demo[0]], demo, includeDemo), /isolated demo/);
  }
});

test("actual repository migration sources keep the demo out of the default replay", () => {
  const production = listMigrationSources();
  const isolated = listMigrationSources(true);
  const rewardFiles = isolated.filter((path) => path.includes("/demo/rewards/supabase/migrations/"));
  assert.ok(production.length > 0);
  assert.ok(rewardFiles.length >= 23);
  assert.equal(isolated.length, production.length + rewardFiles.length);
  assert.ok(production.every((path) => !path.includes("/demo/") && !/\d{14}_reward_/.test(path)));
  assert.deepEqual(isolated.filter((path) => !rewardFiles.includes(path)), production);
});

test("demo validation rejects invalid modes and non-local targets before database or fixture access", () => {
  const script = fileURLToPath(new URL("../../../packages/db/scripts/validate-migrations.sh", import.meta.url));
  const clean = { PATH: process.env.PATH, PGHOST: "127.0.0.1", PGPORT: "5432", RACESON_REWARD_DEMO_VALIDATION: "1" };
  for (const [patch, message] of [
    [{ RACESON_REWARD_DEMO_VALIDATION: "testnet" }, /Invalid reward demo/],
    [{ RACESON_REWARD_CHAIN_REHEARSAL: "true" }, /Invalid reward chain/],
    [{ RACESON_REWARD_CHAIN_REHEARSAL: "1", RACESON_REWARD_DEMO_VALIDATION: "0" }, /requires the isolated demo/],
    [{ PGHOST: "production.invalid" }, /loopback/],
    [{ PGPORT: "6543" }, /port 5432/],
    [{ PGHOSTADDR: "203.0.113.1" }, /routing overrides/],
    [{ PGSERVICE: "production" }, /routing overrides/],
    [{ PGSERVICEFILE: "/not-a-real-service-file" }, /routing overrides/],
    [{ PGOPTIONS: "-c search_path=public" }, /routing overrides/],
    [{ IMPORT_REHEARSAL_FILE: "/not-a-real-fixture" }, /external import fixtures/],
  ]) {
    const result = spawnSync("/bin/sh", [script], { env: { ...clean, ...patch }, encoding: "utf8", timeout: 5_000 });
    assert.ifError(result.error);
    assert.equal(result.status, 1);
    assert.equal(result.stdout, "");
    assert.match(result.stderr, message);
  }
});
