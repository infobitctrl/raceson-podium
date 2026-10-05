import test from "node:test";
import assert from "node:assert/strict";
import childProcess from "node:child_process";
import { syncBuiltinESMExports } from "node:module";
import { EventEmitter } from "node:events";
import { openRewardTestDatabase } from "../../../packages/db/scripts/reward-test-database.mjs";

// No database/provider process is started. Deterministically deliver the two
// independent psql pipes out of order to exercise the real fixture transport.
for (const order of ["stdout-first", "stderr-first"]) {
  test(`rollback fixture associates errors with the correct statement (${order})`, async t => {
    const child = new EventEmitter(); child.stdout = new EventEmitter(); child.stderr = new EventEmitter();
    child.stdin = {
      write(text) {
        const marker = /\\echo (REWARD_FIXTURE_[a-f0-9]+)/.exec(text)?.[1]; if (!marker) return;
        const fail = text.startsWith("synthetic failure"), success = text.startsWith("synthetic success");
        const stdout = () => child.stdout.emit("data", `${success ? "42\n" : ""}${marker}\n`);
        const stderr = () => child.stderr.emit("data", `${fail ? "ERROR: synthetic_expected_error\n" : ""}${text.includes("\\warn ") ? marker + "\n" : ""}`);
        const [first, last] = order === "stdout-first" ? [stdout, stderr] : [stderr, stdout];
        setImmediate(() => { first(); setImmediate(last); });
      },
      end() { setImmediate(() => child.emit("close", 0)); },
    };
    child.kill = () => child.emit("close", 0);
    const mocked = t.mock.method(childProcess, "spawn", () => child); syncBuiltinESMExports();
    const harness = openRewardTestDatabase(["/synthetic/psql", "127.0.0.1", `sitrail_validation_${process.ppid}`]);
    try {
      await harness.rollbackFixture(async ({ query }) => {
        for (let n = 0; n < 3; n++) {
          await assert.rejects(query("synthetic failure"), { code: "synthetic_expected_error" });
          assert.equal(await query("synthetic rollback"), "");
          assert.equal(await query("synthetic success"), "42");
        }
      });
    } finally { mocked.mock.restore(); syncBuiltinESMExports(); }
  });
}
