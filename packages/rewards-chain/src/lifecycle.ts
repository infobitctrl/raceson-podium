import { encodeFunctionData, keccak256, parseTransaction, recoverTransactionAddress, serializeTransaction, type Hex } from "viem";
import { rewardCampaignAbi } from "./abi.js";
import { rewardAllocationCommitment, rewardUploadDigest } from "./allocation.js";
import { normalizeRewardDeployment, rewardCampaignBuild, type RewardDeploymentExpectation } from "./deployment.js";
import { validateRewardCampaignAccounting, type RewardCampaignAccounting } from "./campaign-checkpoint.js";
import { demand, RewardProtocolError, uint, walletAddress } from "./validation.js";

export const rewardLifecycleClocks={publicationReview:259200n,allocationReview:86400n,claimLifetime:31536000n} as const;
export type RewardLifecycleUpload=ReturnType<typeof rewardAllocationCommitment>;
export type RewardLifecyclePlan={deployment:RewardDeploymentExpectation;nonce:bigint;upload:RewardLifecycleUpload} & (
  {action:"upload_awards";batchStart:number;batchSize:number} | {action:"stage_allocation"|"activate"});

/** Recompute the complete approved package, never caller-selected award amounts.
 * Extra private metadata is not copied to the normalized public manifest. */
export function normalizeRewardLifecyclePlan(input:RewardLifecyclePlan):RewardLifecyclePlan {
  const deployment=normalizeRewardDeployment(input.deployment);const nonce=uint(input.nonce,64);
  demand(nonce>deployment.deploymentNonce && nonce<=BigInt(Number.MAX_SAFE_INTEGER),"invalid_reward_lifecycle_nonce");
  const u=input.upload;
  demand(Array.isArray(u.awards) && u.awards.length<=20000 && Array.isArray(u.budgets) && u.budgets.length===2
    && Array.isArray(u.allocated) && u.allocated.length===2 && u.enabledPot===deployment.enabledPot,"invalid_reward_lifecycle_upload");
  const budget=uint(u.budgets[u.enabledPot]);demand(budget>0n,"invalid_reward_lifecycle_budget");
  const upload=rewardAllocationCommitment({...u,budget});
  demand(upload.programmeId===deployment.programmeId && upload.campaignId===deployment.campaignId
    && upload.programmeManifestHash===deployment.programmeManifestHash,"reward_lifecycle_manifest_mismatch");
  demand(u.uploadDigest===upload.uploadDigest && u.allocationDigest===upload.allocationDigest && u.entitlementCount===upload.entitlementCount
    && u.unallocated===upload.unallocated && u.budgets.every((v,i)=>v===upload.budgets[i]) && u.allocated.every((v,i)=>v===upload.allocated[i]),
    "reward_lifecycle_upload_mismatch");
  if(input.action==="upload_awards") {
    demand(Number.isSafeInteger(input.batchStart) && input.batchStart>=0 && Number.isSafeInteger(input.batchSize)
      && input.batchSize>0 && input.batchSize<=64 && input.batchStart+input.batchSize<=upload.awards.length,"invalid_reward_lifecycle_batch");
    return {deployment,nonce,upload,action:input.action,batchStart:input.batchStart,batchSize:input.batchSize};
  }
  demand(input.action==="stage_allocation" || input.action==="activate","invalid_reward_lifecycle_action");
  demand(!("batchStart" in input) && !("batchSize" in input),"invalid_reward_lifecycle_batch");
  return {deployment,nonce,upload,action:input.action};
}

export function encodeRewardLifecycle(input:RewardLifecyclePlan) {
  const p=normalizeRewardLifecyclePlan(input);const u=p.upload;
  const data=p.action==="upload_awards" ? encodeFunctionData({abi:rewardCampaignAbi,functionName:"uploadAwards",args:[u.awards.slice(p.batchStart,p.batchStart+p.batchSize)]})
    :p.action==="stage_allocation" ? encodeFunctionData({abi:rewardCampaignAbi,functionName:"stageAllocation",args:[u.snapshotDigest,u.uploadDigest,u.entitlementCount,u.latestPublicationAt]})
    :encodeFunctionData({abi:rewardCampaignAbi,functionName:"activate",args:[u.allocationDigest,u.snapshotDigest]});
  return {chainId:p.deployment.context.chainId,to:p.deployment.context.verifyingContract,nonce:Number(p.nonce),value:0n,data};
}

/** Canonical prefix must match the stored package, not just its row count. */
export function rewardLifecyclePrefix(input:RewardLifecyclePlan,accounting:RewardCampaignAccounting) {
  const p=normalizeRewardLifecyclePlan(input);const a=validateRewardCampaignAccounting(accounting,p.deployment.enabledPot);const u=p.upload;
  demand(a.accountedFunding===u.budgets[u.enabledPot] && a.budgets[u.enabledPot]===u.budgets[u.enabledPot],"reward_lifecycle_budget_mismatch");
  demand(a.entitlementCount<=u.entitlementCount,"reward_lifecycle_prefix_mismatch");
  const prefix=rewardUploadDigest(u.awards.slice(0,Number(a.entitlementCount)),u.enabledPot,u.budgets[u.enabledPot]);
  demand(a.uploadDigest===prefix.digest && a.allocated[u.enabledPot]===prefix.total,"reward_lifecycle_prefix_mismatch");
  return {plan:p,accounting:a,prefix};
}

/** Chain-only preflight. Source freshness/current actor authority and a reserved
 * nonce are separate private service gates, not proved by this return value. */
export function requireRewardLifecyclePrestate(input:RewardLifecyclePlan,accounting:RewardCampaignAccounting,finalizedTimestamp:bigint) {
  const {plan:p,accounting:a}=rewardLifecyclePrefix(input,accounting);const now=uint(finalizedTimestamp);const u=p.upload;
  demand(a.state===(p.action==="activate"?2:1),"reward_lifecycle_state_mismatch");
  if(p.action==="upload_awards") demand(a.entitlementCount===BigInt(p.batchStart),"reward_lifecycle_prefix_mismatch");
  else {
    demand(a.entitlementCount===u.entitlementCount,"reward_lifecycle_upload_incomplete");
    demand(u.latestPublicationAt<=now,"reward_lifecycle_publication_in_future");
    if(p.action==="activate") {
      demand(a.snapshotDigest===u.snapshotDigest && a.allocationDigest===u.allocationDigest
        && a.activationNotBefore>=u.latestPublicationAt+rewardLifecycleClocks.publicationReview,"reward_lifecycle_staging_mismatch");
      demand(now>=a.activationNotBefore,"reward_lifecycle_review_not_finished");
    }
  }
  return {completedAwards:a.entitlementCount,sourceReviewEndsAt:u.latestPublicationAt+rewardLifecycleClocks.publicationReview,
    activationNotBefore:a.activationNotBefore};
}

/** Private broadcast capability. No signing, RPC, key/provider or nonce creation.
 * At most 64 six-word awards plus the canonical transaction envelope (16 KiB). */
export async function verifySignedRewardLifecycle(input:RewardLifecyclePlan,serialized:Hex) {
  const p=normalizeRewardLifecyclePlan(input);const encoded=encodeRewardLifecycle(p);
  demand(typeof serialized==="string" && /^0x02(?:[0-9a-fA-F]{2}){1,16384}$/.test(serialized),"invalid_reward_signed_lifecycle");
  const signedTransaction=serialized.toLowerCase() as `0x02${string}`;
  try {
    const tx=parseTransaction(signedTransaction);
    demand(tx.type==="eip1559" && tx.chainId===encoded.chainId,"reward_lifecycle_transaction_chain_mismatch");
    demand(tx.to!==undefined && tx.to!==null && walletAddress(tx.to)===encoded.to && (tx.accessList?.length??0)===0,"reward_lifecycle_destination_mismatch");
    demand(Number.isSafeInteger(tx.nonce) && tx.nonce===encoded.nonce,"reward_lifecycle_nonce_mismatch");
    demand((tx.value??0n)===0n && tx.data===encoded.data,"reward_lifecycle_input_mismatch");
    demand(tx.r!==undefined && tx.s!==undefined && (tx.yParity===0||tx.yParity===1),"reward_unsigned_lifecycle");
    demand(tx.gas!==undefined && uint(tx.gas)>0n && tx.maxFeePerGas!==undefined && uint(tx.maxFeePerGas)>0n
      && tx.maxPriorityFeePerGas!==undefined && uint(tx.maxPriorityFeePerGas)<=tx.maxFeePerGas,"invalid_reward_lifecycle_fees");
    demand(serializeTransaction(tx)===signedTransaction,"invalid_reward_signed_lifecycle");
    const sender=walletAddress(await recoverTransactionAddress({serializedTransaction:signedTransaction}));
    demand(sender===p.deployment.operatorAddress,"reward_lifecycle_sender_mismatch");
    return {schemaVersion:1 as const,action:p.action,chainId:encoded.chainId,operatorAddress:sender.toLowerCase() as Hex,nonce:p.nonce,
      contractAddress:encoded.to.toLowerCase() as Hex,transactionHash:keccak256(signedTransaction),signedTransaction,buildId:rewardCampaignBuild.id,
      calldataHash:keccak256(encoded.data),allocationDigest:p.upload.allocationDigest,
      batchStart:p.action==="upload_awards"?p.batchStart:null,batchSize:p.action==="upload_awards"?p.batchSize:null,
      value:0n,gasLimit:tx.gas,maxFeePerGas:tx.maxFeePerGas,maxPriorityFeePerGas:tx.maxPriorityFeePerGas};
  } catch(error) {
    if(error instanceof RewardProtocolError)throw error;
    throw new RewardProtocolError("invalid_reward_signed_lifecycle");
  }
}
