import { decodeSavedRewardPlanningDraft, type SavedRewardPlanningDraft } from "./programme-draft-v2.js";
import { decodeRewardMappingWorkspaceV2, decodeRewardSourceMappingV2, validateRewardSourceMappingV2,
  type RewardMappingWorkspaceV2, type RewardSourceMappingV2 } from "./source-mapping-v2.js";
import { decodeAllocationContractBindingV3, type AllocationContractBindingV3 } from "./allocation-approval-v3.js";
import { decodeRewardAllocationSourceV3, previewRewardAllocationV3, type RewardAllocationSourceV3 } from "./allocation-preview-v3.js";
import { decodeLeaguePolicyDecisionV3, proposeRoundClubStandingsV3 } from "./league-standings-v3.js";
import { canonicalRewardProposalV2 as canonical } from "./frozen-proposal-v2.js";
import { programmeApprovalRequestIdV3 as uuid } from "./programme-approval-v3.js";

function check(v: unknown): asserts v { if (!v) throw new Error("invalid_reward_final_allocation"); }
function object(v: unknown, keys: string[]) {
  check(v && typeof v === "object" && !Array.isArray(v));
  const fields = Object.getOwnPropertyDescriptors(v);
  check(Reflect.ownKeys(v).length === keys.length && keys.every(k => fields[k]?.enumerable && "value" in fields[k]!));
  return Object.fromEntries(keys.map(k => [k, fields[k]!.value])) as Record<string, unknown>;
}
const hash = (v: unknown) => { check(typeof v === "string" && /^[0-9a-f]{64}$/.test(v)); return v; };
const instant = (v: unknown) => { check(typeof v === "string" && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(v)
  && Number.isFinite(Date.parse(v)) && new Date(v).toISOString() === v); return v; };

/** References to authenticated, saved source decisions, never browser authority.
 * Currentness is established again by the source repository on every operation.
 * These references cannot independently authorize storage, staging or payment. */
export function decodeFinalAllocationSourceReviewV3(value: unknown) {
  check(value && typeof value === "object" && !Array.isArray(value));
  const kind = Object.getOwnPropertyDescriptor(value, "kind"); check(kind && "value" in kind);
  if (kind.value === "native_finale") {
    const v = object(value, ["kind", "guardHash", "continuityReviewId", "continuityContextHash", "continuityCommitment", "reviewedAt", "policyReview"]);
    const policyReview = decodeLeaguePolicyDecisionV3(v.policyReview); check(policyReview?.decision === "selected");
    return { kind: "native_finale" as const, guardHash: hash(v.guardHash), continuityReviewId: uuid(v.continuityReviewId),
      continuityContextHash: hash(v.continuityContextHash), continuityCommitment: hash(v.continuityCommitment),
      reviewedAt: instant(v.reviewedAt), policyReview };
  }
  const v = object(value, ["kind", "guardHash", "publicationId", "publicationDocumentHash", "evidenceHash", "publishedAt"]);
  check(v.kind === "published_league");
  return { kind: "published_league" as const, guardHash: hash(v.guardHash), publicationId: uuid(v.publicationId),
    publicationDocumentHash: hash(v.publicationDocumentHash), evidenceHash: hash(v.evidenceHash), publishedAt: instant(v.publishedAt) };
}
export type FinalAllocationSourceReviewV3 = ReturnType<typeof decodeFinalAllocationSourceReviewV3>;

/** New schema for native round 5 and the final league, not a reinterpretation of
 * v3.1 historical documents. No wallet or claimed-profile input: every earned
 * share remains in the immutable recipient calculation. */
export function buildFinalAllocationDocumentV3(recordInput: SavedRewardPlanningDraft, workspaceInput: RewardMappingWorkspaceV2,
  sourceInput: RewardAllocationSourceV3, reviewInput: FinalAllocationSourceReviewV3, bindingInput: AllocationContractBindingV3 | null) {
  const record = decodeSavedRewardPlanningDraft(recordInput), workspace = decodeRewardMappingWorkspaceV2(workspaceInput);
  check(record.draftId === workspace.draftId && record.revision === workspace.rulesRevision && workspace.revision > 0);
  validateRewardSourceMappingV2(workspace.mapping, workspace.catalogue);
  return compose(record, workspace.mapping, workspace.revision, sourceInput, reviewInput, bindingInput);
}

function compose(recordInput: SavedRewardPlanningDraft, mappingInput: RewardSourceMappingV2, mappingRevision: number,
  sourceInput: RewardAllocationSourceV3, reviewInput: FinalAllocationSourceReviewV3, bindingInput: AllocationContractBindingV3 | null) {
  const record = decodeSavedRewardPlanningDraft(recordInput), mapping = decodeRewardSourceMappingV2(mappingInput);
  const source = decodeRewardAllocationSourceV3(sourceInput), sourceReview = decodeFinalAllocationSourceReviewV3(reviewInput);
  check(Number.isInteger(mappingRevision) && mappingRevision > 0 && mappingRevision <= 2147483645);
  const slot = sourceReview.kind === "native_finale" ? 5 as const : 6 as const;
  let clubProposal: ReturnType<typeof proposeRoundClubStandingsV3> | null = null;
  if (sourceReview.kind === "native_finale") {
    const finale = source.rounds[4]!;
    // A synthetic finale still uses native result publication, but must never
    // be relabelled as evidence of a real sporting event.
    const evidenceKind = source.kind === "synthetic_rehearsal" ? "synthetic" : "native_final";
    check(finale.evidence?.kind === evidenceKind && finale.evidence.digest === sourceReview.continuityCommitment
      && finale.evidence.publishedAt <= sourceReview.reviewedAt && finale.roundId === mapping.rounds[4]!.roundId);
    source.rounds = source.rounds.map(r => r.slot === 5 ? r : { slot: r.slot, roundId: mapping.rounds[r.slot - 1]!.roundId,
      evidence: null, resultsComplete: false, expectedResultCount: 0, results: [] });
    // Recompute the club table. A supplied club ranking is never trusted.
    const individual = new Set(source.categories.filter(c => c.target === "individual").map(c => c.id));
    source.standings = source.standings.filter(t => t.slot === 5 && individual.has(t.categoryId));
    source.league = null;
    clubProposal = proposeRoundClubStandingsV3(source, sourceReview.policyReview.policy, 5);
    if (clubProposal.table) source.standings.push({ slot: 5, categoryId: clubProposal.table.categoryId, complete: true,
      evidence: { ...finale.evidence }, roundDigests: [finale.evidence.digest], rows: clubProposal.table.rows.map(r => {
        // A real contributing result anchors this derived row; it is not a
        // fabricated official club-result record. All contributions stay below.
        const sourceRowId = r.contributions.map(c => c.sourceRowId).sort()[0]; check(sourceRowId);
        return { sourceRowId, beneficiaryId: r.beneficiaryId, rank: r.rank };
      }) });
    source.capturedAt = new Date(Math.max(Date.parse(record.updatedAt), Date.parse(sourceReview.reviewedAt),
      Date.parse(sourceReview.policyReview.reviewedAt), ...source.standings.map(t => Date.parse(t.evidence.publishedAt)))).toISOString();
  } else {
    check(source.league?.evidence.digest === sourceReview.evidenceHash && source.league.evidence.publishedAt === sourceReview.publishedAt);
    // Race tables are not needed to allocate an already authenticated published
    // league. Original five result sets remain for participation and eligibility.
    source.standings = source.standings.filter(t => t.slot === null);
    check(source.standings.every(t => t.evidence.digest === sourceReview.evidenceHash && t.evidence.publishedAt === sourceReview.publishedAt));
    source.capturedAt = new Date(Math.max(Date.parse(record.updatedAt), Date.parse(sourceReview.publishedAt))).toISOString();
  }
  const normalized = decodeRewardAllocationSourceV3(source);
  const preview = previewRewardAllocationV3(record.rules, mapping, normalized);
  const calculation = slot === 5 ? preview.rounds[4]! : preview.league;
  const recipients = new Map<string, { beneficiaryKind: "athlete" | "club"; beneficiaryId: string; amountWei: bigint }>();
  function add(beneficiaryKind: "athlete" | "club", beneficiaryId: string, amountWei: bigint) {
    if (amountWei === 0n) return;
    const key = `${beneficiaryKind}:${beneficiaryId}`, prior = recipients.get(key) ?? { beneficiaryKind, beneficiaryId, amountWei: 0n };
    prior.amountWei += amountWei; recipients.set(key, prior);
  }
  for (const f of calculation.families) for (const c of f.categories) for (const r of c.awards)
    add(c.target === "individual" ? "athlete" : "club", r.beneficiaryId, r.amountWei);
  if (slot === 6) for (const r of preview.league.participation.awards) add("athlete", r.beneficiaryId, r.amountWei);
  check([...recipients.values()].reduce((n, r) => n + r.amountWei, 0n) === calculation.proposedWei);
  return { schema: "raceson-allocation-document-v3.2" as const, slot, enabledPot: slot === 5 ? 0 as const : 1 as const,
    record, mapping, mappingRevision, source: normalized, sourceReview, clubProposal,
    binding: bindingInput && decodeAllocationContractBindingV3(bindingInput), calculation,
    recipients: [...recipients].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([, r]) => r) };
}
export type FinalAllocationDocumentV3 = ReturnType<typeof buildFinalAllocationDocumentV3>;
export function decodeFinalAllocationDocumentV3(value: unknown): FinalAllocationDocumentV3 {
  const v = object(value, ["schema", "slot", "enabledPot", "record", "mapping", "mappingRevision", "source", "sourceReview", "clubProposal", "binding", "calculation", "recipients"]);
  check(v.schema === "raceson-allocation-document-v3.2");
  const result = compose(v.record as SavedRewardPlanningDraft, v.mapping as RewardSourceMappingV2, v.mappingRevision as number,
    v.source as RewardAllocationSourceV3, v.sourceReview as FinalAllocationSourceReviewV3, v.binding as AllocationContractBindingV3 | null);
  check(canonical(result) === canonical(v)); return result;
}
export function finalAllocationReasonsV3(d: FinalAllocationDocumentV3) {
  const reasons: Array<"unresolved_results" | "funding_required"> = [];
  if (d.calculation.families.some(f => f.categories.some(c => c.budgetWei > 0n && c.hold !== null))
    || "participation" in d.calculation && d.calculation.participation.budgetWei > 0n && d.calculation.participation.hold !== null
    || "hold" in d.calculation && d.calculation.hold !== null
    || d.slot === 5 && d.source.rounds[4]!.evidence?.held) reasons.push("unresolved_results");
  if (!d.binding) reasons.push("funding_required");
  return reasons;
}
