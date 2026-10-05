import test from "node:test";
import assert from "node:assert/strict";
import { pacePrivyTestnetReads, requirePrivyProgrammeSource } from "../../../demo/rewards/scripts/privy-testnet-rpc.mjs";

test("public RPC reads are sequential and failures never retry or prevent later reads", async () => {
  let active = 0, peak = 0, waits = 0;
  const calls = [], client = { getBalance: async ({ id }) => {
    active++; peak = Math.max(peak, active); calls.push(id);
    await Promise.resolve(); active--; if (id === 2) throw Error("read_unavailable"); return BigInt(id);
  }, sendRawTransaction: async () => "original-only" };
  const paced = pacePrivyTestnetReads(client, async () => { waits++; });
  const results = await Promise.allSettled([1, 2, 3].map(id => paced.getBalance({ id })));
  assert.deepEqual(calls, [1, 2, 3]); assert.equal(peak, 1); assert.equal(waits, 3);
  assert.deepEqual(results.map(r => r.status), ["fulfilled", "rejected", "fulfilled"]);
  assert.equal(paced.sendRawTransaction, client.sendRawTransaction);
});
test("source continuation needs its exact separate receipt and never overwrites the initial journal", () => {
  const old = "71e11e2bfa421134e998da9aeea0b71f2ea34e7949e786bc460b182657b71766", next = "a".repeat(64);
  const draftId = "9a000000-0000-4000-8000-000000000052", rows = new Map();
  const journal = { read: key => rows.get(key) ?? null, write: (key, value) => { assert.ok(!rows.has(key)); rows.set(key, value); } };
  requirePrivyProgrammeSource(journal, old, draftId); requirePrivyProgrammeSource(journal, old, draftId);
  assert.throws(() => requirePrivyProgrammeSource(journal, next, draftId));
  rows.set("source-revision.json", { schemaVersion: 1, draftId, previousDigest: old, sourceDigest: next, reason: "read-only-rpc-pacing-v1" });
  requirePrivyProgrammeSource(journal, next, draftId);
  assert.deepEqual(rows.get("source.json"), { sourceDigest: old, draftId });
  assert.throws(() => requirePrivyProgrammeSource(journal, "b".repeat(64), draftId));
  rows.get("source-revision.json").extra = true;
  assert.throws(() => requirePrivyProgrammeSource(journal, next, draftId));
});
