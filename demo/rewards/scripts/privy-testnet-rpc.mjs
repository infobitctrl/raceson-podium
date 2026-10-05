import assert from "node:assert/strict";
import { setTimeout as delay } from "node:timers/promises";

/** The public endpoint reported a 15 requests/sec limit. Serialize reads with
 * headroom; never retry, switch provider or queue a send behind read work. */
export function pacePrivyTestnetReads(client, wait = () => delay(160)) {
  const reads = new Set(["getChainId", "getBlock", "getTransaction", "getTransactionReceipt", "getCode",
    "readContract", "getBalance", "getTransactionCount", "estimateGas", "estimateFeesPerGas"]);
  let tail = Promise.resolve();
  return new Proxy(client, { get(target, key) {
    if (!reads.has(key)) return target[key];
    return (...args) => {
      const result = tail.then(async () => { await wait(); return target[key](...args); });
      tail = result.catch(() => {});
      return result;
    };
  } });
}

/** A changed runtime never silently replaces the original immutable source
 * journal. This single reviewed continuation permits only the recorded pacing
 * revision; writing that receipt is a separate explicit operator step. */
export function requirePrivyProgrammeSource(journal, sourceDigest, draftId) {
  const initial = journal.read("source.json");
  if (!initial) { journal.write("source.json", { sourceDigest, draftId }); return; }
  assert.deepEqual(Object.keys(initial).sort(), ["draftId", "sourceDigest"]);
  assert.equal(initial.draftId, draftId);
  if (initial.sourceDigest === sourceDigest) return;
  const revision = journal.read("source-revision.json");
  assert.deepEqual(revision, { schemaVersion: 1, draftId,
    previousDigest: "71e11e2bfa421134e998da9aeea0b71f2ea34e7949e786bc460b182657b71766",
    sourceDigest, reason: "read-only-rpc-pacing-v1" });
  assert.equal(initial.sourceDigest, revision.previousDigest);
}
