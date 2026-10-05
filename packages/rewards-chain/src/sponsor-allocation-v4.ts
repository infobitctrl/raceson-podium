import {previewSponsorAllocation, type SponsorSourceBinding} from "@raceson/domain/rewards/sponsor-allocation";
import type {SponsorLaunch} from "@raceson/domain/rewards/sponsor-launch";
import type {SponsorExecutionPlan} from "@raceson/domain/rewards/sponsor-execution";
import type {RewardAllocationSourceV3} from "@raceson/domain/rewards/allocation-preview-v3";
import {canonicalRewardJson, commitPrivateRewardDocument} from "./canonical.js";
import type {RewardPrivateBinding} from "./allocation.js";
import type {RewardFinalPublicationV3} from "./campaign-v3.js";
import {sponsorAllocationCommitmentV4} from "./sponsor-claims-v4.js";
import {bytes32, demand} from "./validation.js";
import type {Hex} from "viem";

/** Private, deterministic preparation only. Callers must persist fresh random
 * opaque IDs/salts and authenticate/recheck the exact source and allocation
 * approval before upload. This function cannot create that authority. It does
 * not make wallets or filter people without wallets out of the calculation. */
export function prepareSponsorUploadV4(input: {
  launch: SponsorLaunch; plan: SponsorExecutionPlan; binding: SponsorSourceBinding;
  source: RewardAllocationSourceV3; slot: number; publication: RewardFinalPublicationV3;
  snapshotSalt: Hex; recipients: readonly RewardPrivateBinding[];
}) {
  // Canonical capture prevents mutation/getters across calculation and commitment.
  const captured = JSON.parse(canonicalRewardJson(input)) as typeof input;
  const publication = {...captured.publication, reviewPeriod: BigInt(captured.publication.reviewPeriod),
    reviewStartedAt: BigInt(captured.publication.reviewStartedAt), officialPublishedAt: BigInt(captured.publication.officialPublishedAt)};
  const p = previewSponsorAllocation(captured.launch, captured.plan, captured.binding, captured.source);
  const pot = p.pots.find(p => p.slot === captured.slot);
  demand(pot && pot.budgetWei > 0n, "invalid_sponsor_allocation_slot");
  demand(pot.groups.every(g => g.hold === null), "sponsor_allocation_source_not_ready");
  // The attested final publication must cover this source's newest used table,
  // not merely the raw finish rows that predated it.
  const sourceTime = captured.slot === 0 ? captured.source.league?.evidence.publishedAt : captured.source.rounds[captured.slot - 1]?.evidence?.publishedAt;
  demand(sourceTime, "sponsor_allocation_source_not_ready");
  const categories = new Set(captured.launch.setup.configuration.root.children
    .find(n => n.id === captured.launch.setup.configuration.guided!.pots.find(p => p.slot === captured.slot)!.nodeId)!
    .children.filter(n => n.shareBps > 0).flatMap(n => n.rule?.source ? [n.rule.source.categoryId] : []));
  const usedTables = captured.source.standings.filter(t => t.slot === (captured.slot || null) && categories.has(t.categoryId));
  const latestMillis = Math.max(Date.parse(sourceTime), ...usedTables.map(t => Date.parse(t.evidence.publishedAt)));
  demand(publication.officialPublishedAt * 1000n >= BigInt(latestMillis), "sponsor_publication_precedes_source");
  const snapshotSalt = bytes32(captured.snapshotSalt), salts = new Set<string>([snapshotSalt]);
  const byRecipient = new Map<string, RewardPrivateBinding>();
  for (const r of captured.recipients) {
    demand(r.beneficiaryKind === "athlete" || r.beneficiaryKind === "club", "invalid_reward_beneficiary_kind");
    const key = `${r.beneficiaryKind}:${r.beneficiaryId}`, salt = bytes32(r.explanationSalt);
    demand(!byRecipient.has(key) && !salts.has(salt), "duplicate_reward_private_binding");
    salts.add(salt); byRecipient.set(key, r);
  }
  demand(byRecipient.size === pot.recipients.length, "reward_binding_set_mismatch");
  const snapshotDigest = commitPrivateRewardDocument("snapshot", {schema: "raceson-sponsor-allocation-document-v4",
    launch: captured.launch, plan: captured.plan, binding: captured.binding, source: captured.source,
    slot: captured.slot, publication, calculation: pot}, snapshotSalt);
  const awards = pot.recipients.map(r => {
    const ids = byRecipient.get(`${r.beneficiaryKind}:${r.beneficiaryId}`);
    demand(ids, "missing_reward_private_binding");
    const contributions = pot.groups.flatMap(g => g.beneficiaryKind === r.beneficiaryKind
      ? g.awards.filter(a => a.beneficiaryId === r.beneficiaryId).map(a => ({groupId: g.groupId, type: g.type, ...a})) : []);
    return {entitlementId: bytes32(ids.entitlementId), beneficiaryId: bytes32(ids.opaqueBeneficiaryId),
      pot: captured.slot === 0 ? 1 as const : 0 as const, amount: r.amountWei,
      beneficiaryKind: r.beneficiaryKind === "athlete" ? 0 as const : 1 as const,
      explanationHash: commitPrivateRewardDocument("explanation", {schema: "raceson-sponsor-award-v4", launchId: p.launchId,
        slot: captured.slot, ...r, contributions}, ids.explanationSalt)};
  }).sort((a, b) => a.entitlementId < b.entitlementId ? -1 : a.entitlementId > b.entitlementId ? 1 : 0);
  return sponsorAllocationCommitmentV4(captured.plan, captured.slot, {...publication, snapshotDigest, awards});
}
