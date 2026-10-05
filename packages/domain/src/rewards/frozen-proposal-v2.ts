import { requireReward } from "./arithmetic.js";
import { decodeSavedRewardPlanningDraft, type SavedRewardPlanningDraft } from "./programme-draft-v2.js";
import { decodeRewardMappingWorkspaceV2, previewRewardSourceMappingV2, type RewardMappingWorkspaceV2 } from "./source-mapping-v2.js";
import { decodePublishedRewardSnapshotV2, previewPublishedRewardsV2, type PublishedRewardSnapshotV2 } from "./published-preview-v2.js";

/** Stable comparison/transport, not a cryptographic commitment. SQL seals stored JSON. */
export function canonicalRewardProposalV2(value: unknown): string {
  return JSON.stringify(value, (_key, v: unknown) => typeof v === "bigint" ? v.toString() : v && typeof v === "object" && !Array.isArray(v)
    ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)) : v);
}
const check = (value: unknown) => requireReward(value, "invalid_v2_frozen_proposal");
const hash = (value: unknown): value is string => typeof value === "string" && /^[0-9a-f]{64}$/.test(value);
function object(value: unknown, keys: string[]) {
  check(value && typeof value === "object" && !Array.isArray(value)); const r = value as Record<string, unknown>;
  check(Object.keys(r).length === keys.length && keys.every(k => Object.hasOwn(r, k))); return r;
}
export function buildRewardProposalV2(record: SavedRewardPlanningDraft, workspace: RewardMappingWorkspaceV2,
  snapshot: PublishedRewardSnapshotV2, sourceHash: string, slot: number) {
  decodePublishedRewardSnapshotV2(snapshot);
  check(Number.isInteger(slot) && slot >= 1 && slot <= 5 && hash(sourceHash));
  check(record.draftId === workspace.draftId && record.revision === workspace.rulesRevision && workspace.revision > 0
    && workspace.boundCatalogueHash === workspace.catalogueHash
    && canonicalRewardProposalV2(workspace.catalogue) === canonicalRewardProposalV2(snapshot.catalogue));
  const calculation = previewPublishedRewardsV2(record.rules, workspace.mapping, snapshot).rounds[slot - 1]!;
  return { version: 2 as const, slot, record, workspace, sourceHash, calculation };
}
export type RewardProposalDocumentV2 = ReturnType<typeof buildRewardProposalV2>;
export type FrozenRewardProposalV2 = { revision: number; frozenAt: string; proposalHash: string; document: RewardProposalDocumentV2 };

/** Recompute history from its OWN rules/map, never today's draft or browser amounts. */
export function decodeFrozenRewardProposalV2(raw: unknown, snapshot: PublishedRewardSnapshotV2,
  scope: { draftId: string; organizationId: string; seasonId: string; chainId: number; sourceHash: string; slot: number }): FrozenRewardProposalV2 {
  const r = object(raw, ["revision", "frozenAt", "proposalHash", "document"]);
  check(Number.isSafeInteger(r.revision) && Number(r.revision) > 0 && Number(r.revision) <= 2147483647);
  check(typeof r.frozenAt === "string" && /^\d{4}-\d{2}-\d{2}T/.test(r.frozenAt) && /(?:Z|[+-]\d{2}:\d{2})$/.test(r.frozenAt) && Number.isFinite(Date.parse(r.frozenAt)) && hash(r.proposalHash));
  const d = object(r.document, ["version", "slot", "record", "workspace", "sourceHash", "calculation"]);
  const record = decodeSavedRewardPlanningDraft(d.record), workspace = decodeRewardMappingWorkspaceV2(d.workspace);
  check(d.version === 2 && d.slot === scope.slot && d.sourceHash === scope.sourceHash
    && record.draftId === scope.draftId && record.organizationId === scope.organizationId && record.seasonId === scope.seasonId && record.chainId === scope.chainId);
  const document = buildRewardProposalV2(record, workspace, snapshot, scope.sourceHash, scope.slot);
  check(canonicalRewardProposalV2({ ...d, record, workspace }) === canonicalRewardProposalV2(document));
  return { revision: r.revision as number, frozenAt: r.frozenAt as string, proposalHash: r.proposalHash as string, document };
}

/** Freezing is NOT approval or the review start. All clock/payment fields stay absent. */
export function rewardProposalReadinessV2(document: RewardProposalDocumentV2) {
  const budget = previewRewardSourceMappingV2(document.record.rules, document.workspace.mapping, document.workspace.catalogue)[document.slot - 1]!;
  const reasons: Array<"source_missing" | "ambiguous_results" | "unassigned_categories" | "organizer_approval" | "chain_review_anchor"> = [];
  if (!document.calculation.sourceName) reasons.push("source_missing");
  if (document.calculation.categories.some(c => c.blockedReason === "source_missing") && !reasons.includes("source_missing")) reasons.push("source_missing");
  if (document.calculation.categories.some(c => c.blockedReason === "ambiguous_results")) reasons.push("ambiguous_results");
  if (budget.families.some(f => f.unassignedWei > 0n)) reasons.push("unassigned_categories");
  reasons.push("organizer_approval", "chain_review_anchor");
  return { state: "frozen_unapproved" as const, reviewSeconds: 86400 as const, reviewStartedAt: null, payableWei: 0n, reasons };
}
