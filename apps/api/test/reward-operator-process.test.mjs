import assert from "node:assert/strict";
import test from "node:test";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { createRewardOperatorProcess } from "../../../packages/db/scripts/reward-operator-process.mjs";

test("operator process fixture refuses public endpoints before creating a child or obtaining credentials", () => {
  for (const url of ["https://testnet-rpc.monad.xyz", "https://rpc.monad.xyz", "http://localhost:8545",
    "http://127.0.0.1", "http://127.0.0.1:8545/path", "http://127.0.0.1:8545?token=synthetic",
    "http://synthetic@127.0.0.1:8545", "http://127.0.0.1:8545/#fragment"]) {
    assert.throws(() => createRewardOperatorProcess({ reader: { transport: { url } } }));
  }
});

test("the local process test child cannot be used as a standalone operator command", () => {
  const file = fileURLToPath(new URL("../../../packages/db/scripts/reward-operator-process-child.mjs", import.meta.url));
  for (const flag of [undefined, "1"]) {
    const result = spawnSync(process.execPath, [file], { encoding: "utf8", timeout: 5000,
      env: { PATH: process.env.PATH, ...(flag ? { RACESON_REWARD_OWNED_PROCESS_TEST: flag } : {}) } });
    assert.equal(result.status, 1); assert.equal(result.stdout, ""); assert.equal(result.stderr, "");
  }
});
