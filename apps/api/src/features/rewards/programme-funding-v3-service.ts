import type { SavedRewardPlanningDraft } from "@raceson/domain/rewards/programme-draft-v2";
import { decodeProgrammeFundingV3, emptyProgrammeFundingV3 } from "@raceson/domain/rewards/programme-funding-v3";
import { readVerifiedRewardProgrammeV3, type RewardProgrammeExpectationV3, type RewardProgrammeReaderV3 } from "@raceson/rewards-chain/programme-v3";
import { canonicalRewardJson, hashPublicRewardRules } from "@raceson/rewards-chain";

/** Internal binding, not an HTTP DTO or browser-supplied address/RPC. The normal
 * demo uses programme-registry-v3-service to load and recheck persisted provenance.
 * This injection remains useful for isolated verifier/route acceptance tests. */
export type ProgrammeFundingBindingV3 = { draftId: string; rulesRevision: number; rulesDigest: string;
  approvedExpectation: RewardProgrammeExpectationV3; reader: RewardProgrammeReaderV3 };
export type ProgrammeFundingRegistryV3 = (record: SavedRewardPlanningDraft) => Promise<ProgrammeFundingBindingV3 | null>;
export function programmeFundingRulesDigestV3(record: SavedRewardPlanningDraft) {
  return hashPublicRewardRules({ kind: "programme-funding-rules-v3", draftId: record.draftId, revision: record.revision,
    chainId: record.chainId, rules: record.rules });
}
export async function readProgrammeFundingViewV3(record: SavedRewardPlanningDraft, registry?: ProgrammeFundingRegistryV3) {
  const draft = structuredClone(record), empty = emptyProgrammeFundingV3(draft);
  const binding = registry ? await registry(structuredClone(draft)) : null;
  if (!binding) return empty;
  const { approvedExpectation: expected, reader } = binding;
  if (binding.draftId !== draft.draftId || binding.rulesRevision !== draft.revision || binding.rulesDigest !== programmeFundingRulesDigestV3(draft)
    || expected.context.chainId !== draft.chainId || expected.budgetWei.toString() !== empty.budgetWei)
    throw new Error("reward_programme_binding_mismatch");
  const verified = await readVerifiedRewardProgrammeV3(reader, expected);
  const observation = { address: verified.context.verifyingContract, funderAddress: verified.funderAddress, operatorAddress: verified.operatorAddress,
    deploymentTransactionHash: verified.deploymentTransactionHash, deploymentBlockNumber: verified.deploymentBlockNumber,
    deploymentBlockHash: verified.deploymentBlockHash, blockNumber: verified.finalizedBlock.number, blockHash: verified.finalizedBlock.hash,
    blockTimestamp: verified.finalizedBlock.timestamp, depositedWei: verified.depositedWei, totalRoutedWei: verified.totalRoutedWei,
    unroutedRefundedWei: verified.unroutedRefundedWei, returnedWei: verified.returnedWei, returnsWithdrawnWei: verified.returnsWithdrawnWei,
    pendingFundingWei: verified.pendingFundingWei, pendingReturnsWei: verified.pendingReturnsWei, balanceWei: verified.balanceWei,
    surplusWei: verified.surplusWei, fundingAborted: verified.fundingAborted, pots: verified.pots };
  return decodeProgrammeFundingV3(JSON.parse(canonicalRewardJson({ ...empty, status: "verified", observation })), draft);
}
