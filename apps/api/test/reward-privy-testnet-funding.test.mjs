import assert from "node:assert/strict";
import test from "node:test";
import { decodeFunctionData, toHex } from "viem";
import { rewardProgrammeV3Abi } from "@raceson/rewards-chain/programme-v3";
import { privyFundingCall, fundPrivyProgrammeStep } from "../../../demo/rewards/scripts/privy-testnet-funding.mjs";
import { privyTestnetProgramme } from "../../../demo/rewards/scripts/privy-testnet-programme.mjs";
function fixture() {
  const expected = { context: { chainId: 10143, verifyingContract: "0x1111111111111111111111111111111111111111" },
    budgetWei: 100n * 10n ** 18n, operatorAddress: privyTestnetProgramme.operatorAddress,
    funderAddress: privyTestnetProgramme.funderAddress, programmeManifestHash: toHex(1n, { size: 32 }) };
  let keyReads = 0, broadcasts = 0;
  const reader = { getChainId: async () => 10143, getTransactionCount: async () => 1,
    estimateGas: async () => 100000n, estimateFeesPerGas: async () => ({ maxFeePerGas: 100000000000n, maxPriorityFeePerGas: 0n }),
    getBalance: async () => 200n * 10n ** 18n, sendRawTransaction: async () => { broadcasts++; throw Error("must_not_send"); } };
  const deps = { reader, expected, current: async () => {}, active: () => {}, journal: { read: () => null, write: () => { throw Error("must_not_write"); } },
    observe: async () => ({ depositedWei: 0n, pots: Array.from({ length: 6 }, () => ({ routed: false, paidWei: 0n })) }),
    loadSigner: () => { keyReads++; return { address: "0x2222222222222222222222222222222222222222" }; } };
  return { deps, counts: () => ({ keyReads, broadcasts }) };
}
test("funding encoder permits only the exact 100-MON deposit and six fixed pot routes on 10143", () => {
  const { deps } = fixture();
  const deposit = privyFundingCall("deposit", deps.expected);
  assert.equal(deposit.value, 100n * 10n ** 18n);
  assert.deepEqual(decodeFunctionData({ abi: rewardProgrammeV3Abi, data: deposit.data }), { functionName: "deposit", args: [0n] });
  for (let slot = 0; slot < 6; slot++) {
    const route = privyFundingCall(`route-${slot}`, deps.expected);
    assert.equal(route.value, 0n); assert.deepEqual(decodeFunctionData({ abi: rewardProgrammeV3Abi, data: route.data }), { functionName: "routePot", args: [slot] });
  }
  for (const action of ["route-6", "withdraw", "claim", "route--1", "deposit-1"]) assert.throws(() => privyFundingCall(action, deps.expected));
  for (const patch of [{ context: { ...deps.expected.context, chainId: 143 } }, { budgetWei: 101n * 10n ** 18n },
    { operatorAddress: "0x2222222222222222222222222222222222222222" }]) assert.throws(() => privyFundingCall("deposit", { ...deps.expected, ...patch }));
});
test("funding fails before key access for wrong chain, pending nonce, gas ceiling, balance, source hold and unexpected deposit", async () => {
  for (const change of [
    d => { d.reader.getChainId = async () => 143; },
    d => { d.reader.getTransactionCount = async ({ blockTag }) => blockTag === "pending" ? 2 : 1; },
    d => { d.reader.estimateGas = async () => 100000000n; },
    d => { d.reader.getBalance = async () => 0n; },
    d => { d.current = async () => { throw Error("source_hold"); }; },
    d => { d.observe = async () => ({ depositedWei: 100n * 10n ** 18n }); },
  ]) {
    const { deps, counts } = fixture(); change(deps);
    await assert.rejects(fundPrivyProgrammeStep(deps, "deposit")); assert.deepEqual(counts(), { keyReads: 0, broadcasts: 0 });
  }
});
test("a wrong Keychain signer is rejected without signatures or broadcasts", async () => {
  const { deps, counts } = fixture(); await assert.rejects(fundPrivyProgrammeStep(deps, "deposit"));
  assert.deepEqual(counts(), { keyReads: 1, broadcasts: 0 });
});
test("gas top-up is a separate fixed 2-MON transfer and refuses adequate balance or excessive fees before keys", async () => {
  const { deps } = fixture();
  assert.deepEqual(privyFundingCall("operator-gas", deps.expected), {
    to: privyTestnetProgramme.operatorAddress, value: 2n * 10n ** 18n, data: "0x",
  });
  for (const excessiveFees of [false, true]) {
    const { deps: d, counts } = fixture();
    d.observe = async () => { throw Error("topup_must_not_need_deployed_contract"); };
    if (excessiveFees) {
      d.reader.getBalance = async ({ address }) => address === privyTestnetProgramme.operatorAddress ? 0n : 200n * 10n ** 18n;
      d.reader.estimateGas = async () => 1000000n;
    }
    await assert.rejects(fundPrivyProgrammeStep(d, "operator-gas"));
    assert.deepEqual(counts(), { keyReads: 0, broadcasts: 0 });
  }
});
