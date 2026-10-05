import { decodeSavedRewardPlanningDraft, type SavedRewardPlanningDraft } from "./programme-draft-v2.js";
import { decodeRewardMappingWorkspaceV2, decodeRewardSourceMappingV2, validateRewardSourceMappingV2, type RewardMappingWorkspaceV2, type RewardSourceMappingV2 } from "./source-mapping-v2.js";
import { decodeHistoricalSourceDecisionV3, type HistoricalSourceDecisionV3 } from "./historical-source-v3.js";
import { decodeRewardAllocationSourceV3, previewRewardAllocationV3, type RewardAllocationSourceV3 } from "./allocation-preview-v3.js";
import { canonicalRewardProposalV2 as canonical } from "./frozen-proposal-v2.js";

export type AllocationContractBindingV3 = {
  intentId: string; fundingApprovalId: string; programmeAddress: string; campaignAddress: string;
  deploymentTransactionHash: string; programmeId: string; campaignId: string; programmeManifestHash: string;
  reviewSeconds: number; fundingContextHash: string;
};
function check(v: unknown): asserts v { if (!v) throw new Error("invalid_reward_allocation_approval"); }
function object(v: unknown, keys: string[]) {
  check(v && typeof v === "object" && !Array.isArray(v)); const r = v as Record<string, unknown>;
  check(Object.keys(r).sort().join(",") === [...keys].sort().join(",")); return r;
}
const uuid = (v: unknown) => { check(typeof v === "string" && /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/.test(v) && BigInt(`0x${v.replaceAll("-", "")}`) > 0n); return v; };
const hex = (v: unknown, n: number) => { check(typeof v === "string" && new RegExp(`^0x[0-9a-f]{${n}}$`).test(v) && BigInt(v) > 0n); return v; };
export function decodeAllocationContractBindingV3(value: unknown): AllocationContractBindingV3 {
  const r = object(value, ["intentId", "fundingApprovalId", "programmeAddress", "campaignAddress", "deploymentTransactionHash", "programmeId", "campaignId", "programmeManifestHash", "reviewSeconds", "fundingContextHash"]);
  check(Number.isInteger(r.reviewSeconds) && Number(r.reviewSeconds) >= 0 && Number(r.reviewSeconds) <= 2592000);
  check(typeof r.fundingContextHash === "string" && /^[0-9a-f]{64}$/.test(r.fundingContextHash));
  return { intentId: uuid(r.intentId), fundingApprovalId: uuid(r.fundingApprovalId), programmeAddress: hex(r.programmeAddress, 40),
    campaignAddress: hex(r.campaignAddress, 40), deploymentTransactionHash: hex(r.deploymentTransactionHash, 64),
    programmeId: hex(r.programmeId, 64), campaignId: hex(r.campaignId, 64), programmeManifestHash: hex(r.programmeManifestHash, 64), reviewSeconds: Number(r.reviewSeconds), fundingContextHash: r.fundingContextHash };
}

/** Exact sporting/economic document, not staging calldata or payment consent.
 * Only the authenticated server may supply the source/decision/contract binding.
 * Other rounds' human decisions and observation time cannot churn this pot's hash.
 */
export function buildAllocationDocumentV3(recordInput: SavedRewardPlanningDraft, workspaceInput: RewardMappingWorkspaceV2,
  sourceHash: string, sourceContextHash: string, slot: number, sourceInput: RewardAllocationSourceV3,
  decisionInput: HistoricalSourceDecisionV3 | null, bindingInput: AllocationContractBindingV3 | null) {
  const record = decodeSavedRewardPlanningDraft(recordInput), workspace = decodeRewardMappingWorkspaceV2(workspaceInput);
  check(record.draftId === workspace.draftId && record.revision === workspace.rulesRevision && workspace.revision > 0);
  validateRewardSourceMappingV2(workspace.mapping, workspace.catalogue);
  // Publication counters may change after funding. The authenticated caller must
  // check the immutable funding context, not require the old catalogue's counters.
  return compose(record, workspace.mapping, workspace.revision, sourceHash, sourceContextHash, slot, sourceInput, decisionInput, bindingInput);
}

function compose(recordInput: SavedRewardPlanningDraft, mappingInput: RewardSourceMappingV2, mappingRevision: number,
  sourceHash: string, sourceContextHash: string, slot: number, sourceInput: RewardAllocationSourceV3,
  decisionInput: HistoricalSourceDecisionV3 | null, bindingInput: AllocationContractBindingV3 | null) {
  const record = decodeSavedRewardPlanningDraft(recordInput), mapping = decodeRewardSourceMappingV2(mappingInput);
  check(Number.isInteger(slot) && slot >= 1 && slot <= 4 && /^[0-9a-f]{64}$/.test(sourceHash) && /^[0-9a-f]{64}$/.test(sourceContextHash));
  check(Number.isInteger(mappingRevision) && mappingRevision > 0 && mappingRevision <= 2147483645);
  const source = decodeRewardAllocationSourceV3(sourceInput), decision = decisionInput && decodeHistoricalSourceDecisionV3(decisionInput);
  // Both stored production-origin and explicitly synthetic sources retain their
  // provenance in the sealed document. Neither kind grants review or funding.
  check(decision === null || decision.slot === slot && decision.current === (decision.contextHash === sourceContextHash));
  const confirmed = decision?.current === true && decision.decision === "confirmed_final";
  // Retain the five approved IDs but no unrelated results, publication evidence
  // or review decisions. These empty slots mean "outside this document", not DNS.
  source.rounds = source.rounds.map(round => round.slot === slot ? round : {
    slot: round.slot, roundId: mapping.rounds[round.slot - 1]!.roundId, evidence: null,
    resultsComplete: false, expectedResultCount: 0, results: [],
  });
  source.standings = source.standings.filter(table => table.slot === slot);
  for (const round of source.rounds) if (round.evidence) round.evidence.held = !confirmed || round.evidence.held;
  for (const table of source.standings) table.evidence.held = !confirmed || table.evidence.held;
  source.league = null;
  source.capturedAt = new Date(Math.max(...[...source.rounds.flatMap(r => r.evidence ? [r.evidence.publishedAt] : []),
    ...(decision ? [decision.reviewedAt] : []), record.updatedAt].map(v => Date.parse(v)))).toISOString();
  const calculation = previewRewardAllocationV3(record.rules, mapping, source).rounds[slot - 1]!;
  const recipients = new Map<string, { beneficiaryKind: "athlete" | "club"; beneficiaryId: string; amountWei: bigint }>();
  for (const family of calculation.families) for (const category of family.categories) for (const award of category.awards) {
    if (award.amountWei === 0n) continue;
    const beneficiaryKind = category.target === "individual" ? "athlete" : "club", key = `${beneficiaryKind}:${award.beneficiaryId}`;
    const prior = recipients.get(key) ?? { beneficiaryKind, beneficiaryId: award.beneficiaryId, amountWei: 0n };
    prior.amountWei += award.amountWei; recipients.set(key, prior);
  }
  return { schema: "raceson-allocation-document-v3.1" as const, slot, record, mapping, mappingRevision, sourceHash, sourceContextHash, source, decision,
    binding: bindingInput && decodeAllocationContractBindingV3(bindingInput), calculation,
    recipients: [...recipients].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([, r]) => r) };
}
export type AllocationDocumentV3 = ReturnType<typeof buildAllocationDocumentV3>;
export function decodeAllocationDocumentV3(value: unknown): AllocationDocumentV3 {
  const r = object(value, ["schema", "slot", "record", "mapping", "mappingRevision", "sourceHash", "sourceContextHash", "source", "decision", "binding", "calculation", "recipients"]);
  check(r.schema === "raceson-allocation-document-v3.1");
  const result = compose(r.record as SavedRewardPlanningDraft, r.mapping as RewardSourceMappingV2, r.mappingRevision as number,
    r.sourceHash as string, r.sourceContextHash as string, r.slot as number, r.source as RewardAllocationSourceV3,
    r.decision as HistoricalSourceDecisionV3 | null, r.binding as AllocationContractBindingV3 | null);
  check(canonical(result) === canonical(r)); return result;
}
export function allocationApprovalReasonsV3(d: AllocationDocumentV3) {
  const reasons: Array<"source_review_required" | "unresolved_results" | "funding_required"> = [];
  if (!d.decision?.current || d.decision.decision !== "confirmed_final") reasons.push("source_review_required");
  if (!d.source.rounds[d.slot - 1]?.evidence || d.calculation.families.some(f => f.categories.some(c => c.hold !== null))) reasons.push("unresolved_results");
  if (!d.binding) reasons.push("funding_required");
  return reasons;
}
