import { readProgrammeRegistryV3, rewardDocumentUuid as uuid, type RewardAccountIdentity, type RewardLedgerRpc } from "@raceson/db/rewards";
import type { SavedRewardPlanningDraft } from "@raceson/domain/rewards/programme-draft-v2";
import { requireReward } from "@raceson/domain/rewards";
import { canonicalRewardJson } from "@raceson/rewards-chain";
import { verifyRewardProgrammeRuntimeV3, type RewardProgrammeReaderV3 } from "@raceson/rewards-chain/programme-v3";
import { programmeDeploymentPlanV3 } from "./programme-deployment-v3-service.js";
import { programmeFundingRulesDigestV3, readProgrammeFundingViewV3 } from "./programme-funding-v3-service.js";

/** Read-only registry composition. The fixed provider is server-owned. Neither
 * an address, a deployment hash nor a provider URL comes from the browser. */
export async function readRegisteredProgrammeFundingV3(identity: RewardAccountIdentity, record: SavedRewardPlanningDraft,
  dependencies: { reader?: RewardProgrammeReaderV3; rpc?: RewardLedgerRpc }) {
  const actor = { userId: uuid(identity.userId), sessionId: uuid(identity.sessionId) }, draft = structuredClone(record), { reader, rpc } = dependencies;
  const scope = { chainId: draft.chainId, draftId: draft.draftId };
  const saved = await readProgrammeRegistryV3(actor, scope, rpc);
  requireReward(canonicalRewardJson(saved.context.approvalView.record) === canonicalRewardJson(draft), "reward_programme_binding_mismatch");
  if (!saved.registry) return readProgrammeFundingViewV3(draft);
  requireReward(reader, "reward_programme_reader_required");
  requireReward(saved.context.intent?.current, "reward_programme_approval_required");
  const plan = programmeDeploymentPlanV3(saved.context), p = saved.registry.provenance;
  requireReward(p.contractAddress === plan.context.verifyingContract.toLowerCase() && p.programmeId === plan.programmeId
    && p.programmeManifestHash === plan.programmeManifestHash, "reward_programme_binding_mismatch");
  // Preserve the canonical historical anchor on which registration was based.
  const [anchor, code] = await Promise.all([reader.getBlock({ blockNumber: p.finalizedBlockNumber }),
    reader.getCode({ address: plan.context.verifyingContract, blockNumber: p.finalizedBlockNumber })]);
  requireReward(anchor.number === p.finalizedBlockNumber && anchor.hash === p.finalizedBlockHash && anchor.timestamp === p.finalizedBlockTimestamp,
    "reward_programme_binding_mismatch");
  requireReward(code !== undefined && verifyRewardProgrammeRuntimeV3({ ...plan, deploymentTransactionHash: p.transactionHash }, code) === p.runtimeCodeHash,
    "reward_programme_binding_mismatch");
  const view = await readProgrammeFundingViewV3(draft, async () => ({ draftId: draft.draftId, rulesRevision: draft.revision,
    rulesDigest: programmeFundingRulesDigestV3(draft), approvedExpectation: { ...plan, deploymentTransactionHash: p.transactionHash }, reader }));
  requireReward(view.observation?.deploymentBlockNumber === p.deploymentBlockNumber.toString()
    && view.observation.deploymentBlockHash === p.deploymentBlockHash && BigInt(view.observation.blockNumber) >= p.finalizedBlockNumber,
    "reward_programme_binding_mismatch");
  const anchorAfter = await reader.getBlock({ blockNumber: p.finalizedBlockNumber });
  requireReward(anchorAfter.hash === p.finalizedBlockHash && anchorAfter.timestamp === p.finalizedBlockTimestamp, "reward_programme_binding_mismatch");
  // Mapping, nominated roles and approval can change WITHOUT a rules revision.
  const fresh = await readProgrammeRegistryV3(actor, scope, rpc);
  requireReward(fresh.context.intent?.current && canonicalRewardJson(fresh.registry) === canonicalRewardJson(saved.registry)
    && canonicalRewardJson(fresh.context) === canonicalRewardJson(saved.context), "reward_programme_binding_mismatch");
  return view;
}
