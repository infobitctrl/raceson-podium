import assert from "node:assert/strict";
import test from "node:test";
import { hashTypedData, keccak256, padHex, toHex } from "viem";
import { normalizeRewardClubSafeExpectation, readVerifiedRewardClubSafe, rewardClubSafeBuild, rewardClubSafeSlots, verifyRewardClubSafeConsent,
  safeRewardConsentMessage } from "../dist/index.js";
import { originalSafeArtifacts } from "./safe-artifacts.mjs";
const a = n => toHex(BigInt(n), { size: 20 }), hash = n => toHex(BigInt(n), { size: 32 });
const artifacts = originalSafeArtifacts(), zero = hash(0);
function fixture() {
  const expected = { context: { environment: "local-simulation", chainId: 31337, verifyingContract: a(10) },
    singletonAddress: a(11), fallbackHandlerAddress: a(12), owners: [a(20), a(21), a(22)] };
  const checkpoint = { number: 100n, hash: hash(100), timestamp: 2000n }, calls = [];
  const reader = {
    async getChainId() { return 31337; }, async getBlock() { return { ...checkpoint }; },
    async getCode(params) { calls.push(params); return Object.entries({ proxy: a(10), singleton: a(11), handler: a(12) })
      .map(([key, address]) => params.address.toLowerCase() === address ? artifacts[key].deployedBytecode : null).find(Boolean); },
    async getStorageAt(params) { calls.push(params); return params.slot === rewardClubSafeSlots.singleton ? padHex(a(11), { size: 32 })
      : params.slot === rewardClubSafeSlots.fallbackHandler ? padHex(a(12), { size: 32 }) : zero; },
    async readContract(params) { calls.push(params); return { VERSION: "1.4.1", getOwners: [...expected.owners].reverse(), getThreshold: 2n, getModulesPaginated: [[], a(1)] }[params.functionName]; },
  };
  return { expected, checkpoint, reader, calls };
}
test("Safe bytecode pins equal the original three SHA-verified artifacts and cannot be mutated", () => {
  for (const [key, artifact] of Object.entries(artifacts)) { assert.equal(keccak256(artifact.deployedBytecode), rewardClubSafeBuild[key].hash);
    assert.equal((artifact.deployedBytecode.length - 2) / 2, rewardClubSafeBuild[key].bytes); assert.ok(Object.isFrozen(rewardClubSafeBuild[key])); }
});
test("Safe configuration is canonical, exact and observed entirely at one finalized checkpoint", async () => {
  const h = fixture(), result = await readVerifiedRewardClubSafe(h.reader, h.expected);
  assert.equal(result.threshold, 2); assert.deepEqual(result.owners, h.expected.owners); assert.deepEqual(result.finalizedBlock, h.checkpoint);
  assert.ok(h.calls.every(c => c.blockNumber === 100n)); assert.deepEqual(result.modules, []); assert.equal(result.guard, null);
  assert.equal(h.calls.filter(c => c.functionName === "getModulesPaginated")[0].args[1], 1n);
});
test("Safe expectation refuses mainnet, duplicate/sentinel/self owners and conflated deployment addresses", () => {
  const h = fixture();
  for (const patch of [{ context: { ...h.expected.context, chainId: 143, environment: "monad-mainnet" } },
    { owners: [a(20), a(20), a(22)] }, { owners: [a(1), a(21), a(22)] }, { owners: [a(10), a(21), a(22)] }, { owners: [a(20), a(21)] },
    { singletonAddress: a(10) }]) assert.throws(() => normalizeRewardClubSafeExpectation({ ...h.expected, ...patch }));
});
test("lookalike version/owner responses cannot hide wrong proxy, singleton or handler code", async () => {
  for (const [address, code] of [[a(10), "reward_club_proxy_code_mismatch"], [a(11), "reward_club_singleton_code_mismatch"], [a(12), "reward_club_handler_code_mismatch"]]) {
    const h = fixture(), getCode = h.reader.getCode;
    h.reader.getCode = async p => p.address.toLowerCase() === address ? "0x6000" : getCode(p);
    await assert.rejects(readVerifiedRewardClubSafe(h.reader, h.expected), { code });
    assert.equal(h.calls.filter(c => c.functionName).length, 0);
  }
});
test("changed singleton/handler, guards, malformed storage and missing storage fail closed", async () => {
  for (const [slot, value, code] of [[rewardClubSafeSlots.singleton, padHex(a(99), { size: 32 }), "reward_club_singleton_mismatch"],
    [rewardClubSafeSlots.fallbackHandler, padHex(a(99), { size: 32 }), "reward_club_handler_mismatch"],
    [rewardClubSafeSlots.guard, padHex(a(99), { size: 32 }), "reward_club_guard_not_supported"],
    [rewardClubSafeSlots.singleton, `0xff${"00".repeat(31)}`, "reward_club_invalid_storage"],
    [rewardClubSafeSlots.guard, undefined, "reward_club_invalid_storage"]]) {
    const h = fixture(), get = h.reader.getStorageAt; h.reader.getStorageAt = p => p.slot === slot ? value : get(p);
    await assert.rejects(readVerifiedRewardClubSafe(h.reader, h.expected), { code });
  }
});
test("threshold, owner replacements, added owners, modules and version changes are not approved", async () => {
  for (const [name, value, code] of [["getThreshold", 1n, "reward_club_two_signatures_required"], ["getOwners", [a(20), a(21), a(23)], "reward_club_owners_changed"],
    ["getOwners", [a(20), a(21), a(22), a(23)], "reward_club_three_owners_required"], ["getModulesPaginated", [[a(99)], a(1)], "reward_club_modules_not_supported"],
    ["getModulesPaginated", [[], a(99)], "reward_club_modules_not_supported"], ["VERSION", "1.5.0", "reward_club_safe_version_mismatch"]]) {
    const h = fixture(), read = h.reader.readContract; h.reader.readContract = p => p.functionName === name ? value : read(p);
    await assert.rejects(readVerifiedRewardClubSafe(h.reader, h.expected), { code });
  }
});
test("chain drift, reorg, finality regression and unfinalized supplied checkpoints are rejected", async () => {
  const h = fixture(); let calls = 0; h.reader.getChainId = async () => ++calls === 1 ? 31337 : 10143;
  await assert.rejects(readVerifiedRewardClubSafe(h.reader, h.expected), { code: "reward_observed_chain_mismatch" });
  for (const patch of [{ hash: hash(99) }, { timestamp: 1999n }]) {
    const f = fixture(); f.reader.getBlock = async p => ({ ...f.checkpoint, ...(p.blockNumber === 100n ? patch : {}) });
    await assert.rejects(readVerifiedRewardClubSafe(f.reader, f.expected), { code: "reward_chain_changed_during_observation" });
  }
  const f = fixture(); let count = 0; f.reader.getBlock = async p => ({ ...f.checkpoint, ...(p.blockTag === "finalized" && count++ > 0 ? { number: 99n } : {}) });
  await assert.rejects(readVerifiedRewardClubSafe(f.reader, f.expected), { code: "reward_finality_regressed" });
  await assert.rejects(readVerifiedRewardClubSafe(fixture().reader, f.expected, { ...f.checkpoint, number: 101n }), { code: "reward_club_checkpoint_not_finalized" });
});
test("observations freeze caller-owned expectations before awaiting and suppress raw RPC diagnostics", async () => {
  const h = fixture(), original = structuredClone(h.expected), read = h.reader.getChainId;
  h.reader.getChainId = async () => { h.expected.owners = [a(91), a(92), a(93)]; h.expected.singletonAddress = a(99); return read(); };
  const rpcRead = h.reader.readContract; h.reader.readContract = p => p.functionName === "getOwners" ? original.owners : rpcRead(p);
  const verified = await readVerifiedRewardClubSafe(h.reader, h.expected); assert.deepEqual(verified.owners, original.owners);
  const f = fixture(); f.reader.getStorageAt = async () => { throw Error("https://private:key@rpc.example/secret"); };
  await assert.rejects(readVerifiedRewardClubSafe(f.reader, f.expected), e => e.code === "reward_club_safe_observation_unavailable" && !JSON.stringify(e).includes("secret") && !e.cause);
});
function consentFixture() {
  const h = fixture(), campaignContext = { ...h.expected.context, verifyingContract: a(30) };
  const claim = { entitlementId: hash(1), recipient: a(10), amount: 5n, pot: "race", nonce: 0n, issuedAt: 1990n, expiresAt: 2100n, allocationDigest: hash(2) };
  const input = { safe: h.expected, campaignContext, claim, signature: `0x${"01".repeat(130)}` }, read = h.reader.readContract;
  h.reader.readContract = p => p.functionName === "getMessageHash" ? hashTypedData(safeRewardConsentMessage(campaignContext, claim))
    : p.functionName === "isValidSignature" ? "0x1626ba7e" : read(p);
  return { h, campaignContext, claim, input };
}
test("Safe consent binds exact campaign/recipient/network/wrapper, live time and final canonical identity", async () => {
  const { h, campaignContext, claim, input } = consentFixture();
  const result = await verifyRewardClubSafeConsent(h.reader, input); assert.equal(result.role, "recipient"); assert.equal(result.signer.toLowerCase(), a(10));
  for (const patch of [{ claim: { ...claim, recipient: a(40) } }, { campaignContext: { ...campaignContext, chainId: 10143, environment: "monad-testnet" } }]) {
    await assert.rejects(verifyRewardClubSafeConsent(h.reader, { ...input, ...patch }), { code: "reward_club_consent_scope_mismatch" });
  }
  await assert.rejects(verifyRewardClubSafeConsent(h.reader, { ...input, claim: { ...claim, expiresAt: 2000n } }), { code: "reward_claim_not_live" });
  const readAll = h.reader.readContract; h.reader.readContract = p => p.functionName === "isValidSignature" ? "0xffffffff" : readAll(p);
  await assert.rejects(verifyRewardClubSafeConsent(h.reader, input), { code: "reward_club_consent_invalid" });
});
test("an older supplied checkpoint cannot hide regression of the initially observed finalized head", async () => {
  for (const regress of [false, true]) {
    const h = fixture(), older = { number: 90n, hash: hash(90), timestamp: 1900n }; let heads = 0;
    h.reader.getBlock = async p => p.blockTag === "finalized"
      ? { ...h.checkpoint, ...(regress && heads++ > 0 ? { number: 99n, hash: hash(99), timestamp: 1999n } : {}) }
      : older;
    if (regress) await assert.rejects(readVerifiedRewardClubSafe(h.reader, h.expected, older), { code: "reward_finality_regressed" });
    else {
      const observation = await readVerifiedRewardClubSafe(h.reader, h.expected, older);
      assert.deepEqual(observation.finalizedBlock, older); assert.deepEqual(observation.observedFinalizedHead, h.checkpoint);
      assert.ok(h.calls.every(c => c.blockNumber === 90n));
    }
  }
});
test("consent rejects a wrong wrapper and chain changes occurring after configuration verification", async () => {
  const wrong = consentFixture(), read = wrong.h.reader.readContract;
  wrong.h.reader.readContract = p => p.functionName === "getMessageHash" ? hash(999) : read(p);
  await assert.rejects(verifyRewardClubSafeConsent(wrong.h.reader, wrong.input), { code: "reward_club_consent_wrapper_mismatch" });
  for (const [change, code] of [["chain", "reward_observed_chain_mismatch"], ["reorg", "reward_chain_changed_during_observation"], ["head", "reward_finality_regressed"]]) {
    const { h, input } = consentFixture(), contractRead = h.reader.readContract; let proofRead = false;
    h.reader.readContract = p => { if (p.functionName === "isValidSignature") proofRead = true; return contractRead(p); };
    h.reader.getChainId = async () => proofRead && change === "chain" ? 10143 : 31337;
    h.reader.getBlock = async p => ({ ...h.checkpoint,
      ...(proofRead && change === "reorg" && p.blockNumber === 100n ? { hash: hash(999) } : {}),
      ...(proofRead && change === "head" && p.blockTag === "finalized" ? { number: 99n } : {}),
    });
    await assert.rejects(verifyRewardClubSafeConsent(h.reader, input), { code });
  }
});
