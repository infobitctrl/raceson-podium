import { getContractAddress, type Address } from "viem";
import { decodeProgrammeDeploymentV3, rewardProgrammeDeploymentV3, rewardDocumentUuid as uuid,
  type ProgrammeDeploymentContextV3, type RewardAccountIdentity, type RewardLedgerRpc } from "@raceson/db/rewards";
import { requireReward } from "@raceson/domain/rewards";
import { previewRewardProgrammeDraftV2 } from "@raceson/domain/rewards/programme-draft-v2";
import { hashPublicRewardRules, readRewardPendingNonce, type RewardNonceReader } from "@raceson/rewards-chain";
import { normalizeRewardProgrammePlanV3, rewardProgrammeV3Build } from "@raceson/rewards-chain/programme-v3";

/** Derive opaque on-chain IDs and the whole fixed constructor from the stored
 * approval. No placeholder transaction hash or claimed deployed address. */
export function programmeDeploymentPlanV3(input:ProgrammeDeploymentContextV3) {
  const context=decodeProgrammeDeploymentV3({schema:"raceson-programme-deployment-v3",approvalView:input.approvalView,
    intent:input.intent?{...input.intent,chainId:input.approvalView.record.chainId,operatorAddress:input.intent.terms.operatorAddress,
      nonce:input.intent.nonce.toString(),maximumGasCostWei:input.intent.maximumGasCostWei.toString()}:null});
  const i=context.intent;requireReward(i,"reward_programme_deployment_required");
  const {chainId,draftId}=context.approvalView.record,preview=previewRewardProgrammeDraftV2(i.rules);
  requireReward(preview.budgetWei%10n===0n&&i.rules.leagueShareBps===5000&&i.rules.roundSharesBps.every(v=>v===1000),"reward_programme_split_unsupported");
  const programmeId=hashPublicRewardRules({kind:"raceson-programme-identity-v3",chainId,draftId,intentId:i.id});
  const campaignIds=Array.from({length:6},(_,slot)=>hashPublicRewardRules({kind:"raceson-programme-campaign-v3",programmeId,slot}));
  const programmeManifestHash=hashPublicRewardRules({kind:"raceson-programme-manifest-v3",chainId,programmeId,campaignIds,
    approvalId:i.approvalId,contextHash:i.contextHash,terms:i.terms,creationCodeHash:rewardProgrammeV3Build.creationCodeHash});
  return normalizeRewardProgrammePlanV3({context:{environment:chainId===31337?"local-simulation":"monad-testnet",chainId,
    verifyingContract:getContractAddress({from:i.terms.operatorAddress as Address,nonce:i.nonce})},
    funderAddress:i.terms.funderAddress as Address,operatorAddress:i.terms.operatorAddress as Address,programmeId,programmeManifestHash,
    campaignIds,reviewPeriods:i.terms.reviewPeriods.map(BigInt),budgetWei:preview.budgetWei,deploymentNonce:i.nonce});
}

/** Private preparation only. No keys, signatures, broadcasts or HTTP activation.
 * Live signer possession, policy/finality and an execution lease remain required.
 * Original stale reservations are recoverable history, never recycled nonces. */
export async function prepareProgrammeDeploymentV3(identity:RewardAccountIdentity,input:{chainId:31337|10143;draftId:string;
  requestId:string;approvalId:string;contextHash:string;maximumGasCostWei:bigint},dependencies:{reader:RewardNonceReader;rpc?:RewardLedgerRpc}) {
  const actor={userId:uuid(identity.userId),sessionId:uuid(identity.sessionId)},fixed={...input,draftId:uuid(input.draftId),requestId:uuid(input.requestId),approvalId:uuid(input.approvalId)};
  requireReward(/^[0-9a-f]{64}$/.test(fixed.contextHash)&&typeof fixed.maximumGasCostWei==="bigint"&&fixed.maximumGasCostWei>0n&&fixed.maximumGasCostWei<(1n<<256n),"invalid_reward_programme_deployment");
  const {rpc,reader}=dependencies;
  const before=await rewardProgrammeDeploymentV3(actor,fixed.chainId,fixed.draftId,undefined,rpc);
  let pendingNonce=0n;
  if(!before.intent){
    const a=before.approvalView.approval;
    requireReward(a?.id===fixed.approvalId&&a.current&&a.contextHash===fixed.contextHash,"reward_programme_approval_required");
    const rules=before.approvalView.record.rules,preview=previewRewardProgrammeDraftV2(rules);
    requireReward(preview.budgetWei%10n===0n&&rules.leagueShareBps===5000&&rules.roundSharesBps.every(v=>v===1000),"reward_programme_split_unsupported");
    pendingNonce=await readRewardPendingNonce(reader,{environment:fixed.chainId===31337?"local-simulation":"monad-testnet",chainId:fixed.chainId},a.terms.operatorAddress as Address);
  }
  // SQL rechecks the latest exact approval/Auth under the shared nonce lock.
  const saved=await rewardProgrammeDeploymentV3(actor,fixed.chainId,fixed.draftId,{...fixed,pendingNonce},rpc);
  requireReward(saved.intent,"reward_programme_deployment_required");
  return{status:saved.intent.current?"reserved" as const:"held" as const,intentId:saved.intent.id,
    approvalId:saved.intent.approvalId,maximumGasCostWei:saved.intent.maximumGasCostWei,plan:programmeDeploymentPlanV3(saved)};
}
