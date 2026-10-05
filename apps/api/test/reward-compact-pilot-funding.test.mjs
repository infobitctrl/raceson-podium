import test from "node:test";
import assert from "node:assert/strict";
import { compactFundingCommand, compactPilotDraft, fundCompactPilot, runCompactFundingStep } from "../../../demo/rewards/scripts/compact-pilot-funding.mjs";

test("compact funding command is fixed local 100-MON scope without credential, budget or chain overrides", () => {
  assert.equal(compactPilotDraft, "8a000000-0000-4000-8000-000000000052");
  for (const mode of ["inspect", "rehearse"]) assert.equal(compactFundingCommand([mode]), mode);
  for (const args of [[], ["run"], ["rehearse", "--chain", "10143"], ["rehearse", "--budget", "100000"], ["inspect", "--key", "secret"]])
    assert.throws(() => compactFundingCommand(args));
});
test("compact funding refuses nonlocal chains before database, signer or journal access", async () => {
  for (const chainId of [1, 143, 10143]) {
    const runtime = { reader: { getChainId: async () => chainId } };
    await assert.rejects(fundCompactPilot(runtime, {}, {}));
    await assert.rejects(runCompactFundingStep(runtime, {}, {}, () => {}, "deposit"));
  }
});
test("cancelled compact funding starts no database or chain work", async () => {
  const stopped = () => { throw Error("cancelled"); };
  await assert.rejects(fundCompactPilot({}, {}, {}, stopped), /cancelled/);
  await assert.rejects(runCompactFundingStep({}, {}, {}, () => {}, "deposit", stopped), /cancelled/);
});
