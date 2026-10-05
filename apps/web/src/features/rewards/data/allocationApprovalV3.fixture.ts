import { createHash } from "node:crypto";
import { buildAllocationDocumentV3 } from "@raceson/domain/rewards/allocation-approval-v3";
import { canonicalRewardProposalV2 } from "@raceson/domain/rewards/frozen-proposal-v2";
import { historicalFixture } from "./historicalSourceV3.fixture";
// Test-only. No runtime file imports this fixture or any Node crypto dependency.
export function allocationFixture() {
  const f = historicalFixture("confirmed_final"), c = f.context;
  const binding = { intentId: "8c000000-0000-4000-8000-000000001000", fundingApprovalId: "8c000000-0000-4000-8000-000000001001",
    programmeAddress: `0x${"1".repeat(40)}`, campaignAddress: `0x${"2".repeat(40)}`, deploymentTransactionHash: `0x${"3".repeat(64)}`,
    programmeId: `0x${"4".repeat(64)}`, campaignId: `0x${"5".repeat(64)}`, programmeManifestHash: `0x${"6".repeat(64)}`,
    reviewSeconds: 86400, fundingContextHash: "a".repeat(64) };
  const document = buildAllocationDocumentV3(c.record, c.workspace, c.sourceHash, f.data.contextHash, 1, f.data.source, f.data.decisions[0], binding);
  const data = { contextHash: "b".repeat(64), documentHash: createHash("sha256").update(canonicalRewardProposalV2(document)).digest("hex"),
    document, reasons: [] as string[], approval: null, recorded: null };
  const wire = JSON.parse(canonicalRewardProposalV2({ schema: "raceson-allocation-approval-v3", ...data, stageReady: false, payableWei: "0" }));
  return { context: c, data, wire };
}
