// Invented component fixture; not an authenticated ledger or public transaction.
import { decodeProgrammeActionsV3 } from "@raceson/domain/rewards/programme-actions-v3";
import type { ProgrammeExecutionStatusV3 } from "@raceson/domain/rewards/programme-execution-status-v3";
import { executionContext, executionWire } from "./programmeExecutionStatusV3.fixture";
export { executionContext as actionsContext };
export const actionFees = { gasLimit: "6000000", maxFeePerGas: "100000000000", maxPriorityFeePerGas: "0", maxGasCostWei: "600000000000000000" };
export function actionsFixture(state: "empty" | "reserved" | "signed" | "queued" | "confirmed" | "complete" = "empty") {
  const execution: ProgrammeExecutionStatusV3 = executionWire(), last = execution.steps[state === "complete" ? 1 : 0]!;
  execution.steps = state === "empty" ? [] : state === "complete" ? execution.steps : [{ ...last, state,
    transactionHash: state === "reserved" ? null : last.transactionHash,
    receipt: state === "confirmed" ? last.receipt : null }];
  return decodeProgrammeActionsV3({ schema: "raceson-programme-actions-v3", execution, publication: null, selected: state === "empty" ? null : {
    intentId: last.intentId, operatorAddress: `0x${"4".repeat(40)}`, nonce: "12", fees: actionFees,
    attemptId: state === "reserved" ? null : "8d000000-0000-4000-8000-000000000020",
    jobId: ["reserved", "signed"].includes(state) ? null : "8d000000-0000-4000-8000-000000000030" }, ack: null });
}

// Synthetic component states only. No real publication or wallet consent.
export function activationActionsFixture(state: "review" | "published" | "staged" | "activated") {
  const v = actionsFixture("complete"), last = v.execution.steps.at(-1)!;
  const { chainId, draftId, slot, approvalId, uploadId, packageHash } = executionContext;
  v.publication = { schema: "raceson-round-publication-view-v3", chainId, draftId, slot, approvalId, uploadId, packageHash, supported: true, current: true,
    observedAt: "2026-09-10T10:00:00Z", review: { id: "8e000000-0000-4000-8000-000000000001", seconds: 86400,
      startedAt: "2026-09-09T09:00:00Z", endsAt: "2026-09-10T09:00:00Z" },
    publication: state === "review" ? null : { id: "8e000000-0000-4000-8000-000000000002", publishedAt: "2026-09-10T09:00:01Z",
      evidenceHash: `0x${"a".repeat(64)}` }, canPublish: state === "review" };
  for (const [n, action] of ["stage_allocation", "activate"].entries()) {
    if (state === "review" || state === "published" || (state === "staged" && n === 1)) break;
    v.execution.steps.push({ ...last, intentId: `8e000000-0000-4000-8000-00000000000${n + 3}`, step: n + 2,
      action: action as "stage_allocation" | "activate", batchStart: null, batchSize: null, transactionHash: `0x${String(n + 7).repeat(64)}`,
      receipt: { ...last.receipt!, blockNumber: String(102 + n) } });
  }
  v.selected!.intentId = v.execution.steps.at(-1)!.intentId;
  return decodeProgrammeActionsV3(v);
}
