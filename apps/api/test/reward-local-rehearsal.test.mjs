import assert from "node:assert/strict";
import { test } from "node:test";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { openRewardTestDatabase } from "../../../packages/db/scripts/reward-test-database.mjs";

test("local reward transport rejects remote, unrelated-parent and cross-mode database targets before connecting", async () => {
  const base = `sitrail_validation_${process.ppid}`;
  const args = ["/explicit/local/psql", "127.0.0.1", base];
  for (const wrong of [["psql", args[1], base], [args[0], "db.example.invalid", base], [args[0], args[1], "postgres"],
    [args[0], args[1], `${base}_chain`], [args[0], args[1], `${base}_unrelated`]]) {
    assert.throws(() => openRewardTestDatabase(wrong));
  }
  assert.throws(() => openRewardTestDatabase(args, { chainRehearsal: true }));
  const ordinary = openRewardTestDatabase(args);
  const chain = openRewardTestDatabase([args[0], "::1", `${base}_chain`], { chainRehearsal: true });
  await ordinary.close(); await chain.close(); // no query, process or database created
});

test("system rehearsal rejects unsafe connection overrides and invalid mode before any database command", () => {
  const script = fileURLToPath(new URL("../../../packages/db/scripts/validate-migrations.sh", import.meta.url));
  for (const [override, message] of [
    [{ RACESON_REWARD_CHAIN_REHEARSAL: "2" }, /Invalid reward chain rehearsal mode/],
    [{ PGHOST: "db.example.invalid" }, /requires a loopback database/],
    [{ PGPORT: "6543" }, /requires local PostgreSQL port 5432/],
    [{ PGHOSTADDR: "192.0.2.1" }, /refuses connection-routing overrides/],
    [{ PGSERVICE: "unexpected" }, /refuses connection-routing overrides/],
    [{ PGSERVICEFILE: "/unexpected" }, /refuses connection-routing overrides/],
    [{ PGOPTIONS: "-c role=unexpected" }, /refuses connection-routing overrides/],
    [{ IMPORT_REHEARSAL_FILE: "/unexpected" }, /refuses external import fixtures/],
  ]) {
    const result = spawnSync("/bin/sh", [script], { encoding: "utf8", timeout: 3000,
      env: { PATH: process.env.PATH, LANG: "C", RACESON_REWARD_CHAIN_REHEARSAL: "1", PG_BIN: "/nonexistent-reward-test-binary", ...override } });
    assert.equal(result.status, 1); assert.match(result.stderr, message);
    assert.doesNotMatch(result.stderr, /not found|No such file|Connecting/);
  }
});
