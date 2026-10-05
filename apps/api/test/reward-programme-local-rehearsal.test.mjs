import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { assertSyntheticProgrammeContext, localProgrammeCommand, programmeLocalDraft } from "../../../demo/rewards/scripts/programme-local-rehearsal.mjs";
import { programmeLocalReader } from "../dist/features/rewards/programme-local-reader.js";

const id = n => `88000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
test("wallet runtime command accepts only a registered draft scope, never endpoints, keys or chain overrides", () => {
  for (const mode of ["inspect", "serve", "rehearse"]) assert.deepEqual(localProgrammeCommand([mode]), { mode, draftId: null });
  assert.deepEqual(localProgrammeCommand(["serve-wallet", "--draft", programmeLocalDraft]), { mode: "serve-wallet", draftId: programmeLocalDraft });
  for (const args of [[], ["serve-wallet"], ["serve-wallet", "--draft", "00000000-0000-0000-0000-000000000000"],
    ["serve-wallet", "--draft", "https://example.com"], ["serve-wallet", "--draft", programmeLocalDraft, "--chain-id", "143"],
    ["serve-wallet", "--rpc", "http://127.0.0.1:8545"], ["serve-wallet", "--key", "not-a-key"], ["rehearse", "--draft", programmeLocalDraft]])
    assert.throws(() => localProgrammeCommand(args));
});
function fixture() {
  return { record: { chainId: 31337, draftId: programmeLocalDraft, seasonId: id(4), organizationId: "82000000-0000-4000-8000-000000000002", rules: { budgetMon: "100000" } },
    workspace: { catalogue: { rounds: Array.from({ length: 5 }, (_, i) => ({ slot: i + 1, id: id(1011 + i * 10), status: "draft",
      races: [0, 1].map(n => ({ id: id(1012 + i * 10 + n), publicationId: null, resultCount: 0 })) })),
    categories: Array.from({ length: 8 }, (_, i) => ({ id: id(100 + i), eligibility: { demoOnly: true } })) } } };
}
test("local funded rehearsal cannot select public chains, existing programmes, real results or non-synthetic categories", () => {
  assertSyntheticProgrammeContext(fixture());
  for (const mutate of [v => v.record.chainId = 10143, v => v.record.chainId = 143, v => v.record.draftId = "87000000-0000-4000-8000-000000000005",
    v => v.record.seasonId = id(999), v => v.record.rules.budgetMon = "1", v => v.workspace.catalogue.rounds[0].races[0].resultCount = 1,
    v => v.workspace.catalogue.rounds[0].races[0].publicationId = id(99), v => v.workspace.catalogue.categories[0].eligibility.demoOnly = false,
    v => v.workspace.catalogue.rounds[0].status = "cancelled"]) {
    const v = fixture(); mutate(v); assert.throws(() => assertSyntheticProgrammeContext(v));
  }
});
test("demo local programme provider is fixed loopback and cannot sign or mine", () => {
  for (const method of ["signTransaction", "signMessage", "writeContract", "setBalance", "mine", "sendRawTransaction", "request"]) assert.equal(programmeLocalReader[method], undefined);
  const source = readFileSync(new URL("../src/features/rewards/programme-local-reader.ts", import.meta.url), "utf8");
  assert.match(source, /const endpoint = "http:\/\/127.0.0.1:18546"/);
  assert.doesNotMatch(source, /process\.env/);
  const normal = readFileSync(new URL("../src/server.ts", import.meta.url), "utf8");
  assert.doesNotMatch(normal, /programmeLocalReader|programme-local-reader|18546/);
});
