import { TransactionNotFoundError, keccak256, type Hex, type PublicClient } from "viem";
import type { RewardOperatorAccount } from "./operator-account.js";
import { requireReward } from "@raceson/domain/rewards";
import { queueRewardDeploymentJob, readRewardDeploymentJob, stepRewardDeploymentJob, rewardDocumentUuid as uuid,
  type RewardLedgerRpc } from "@raceson/db/rewards";
import type { RewardCampaignReader } from "@raceson/rewards-chain";
import { loadVerifiedRewardDeploymentAttempt } from "./deployment-service.js";
import { observeVerifiedRewardCampaign } from "./campaign-checkpoint-service.js";
import { rewardLeaseCanStartSend } from "./worker-send-fence.js";

export async function queueVerifiedRewardDeployment(session:RewardOperatorAccount,input:{campaignId:string;intentId:string;attemptId:string;idempotencyKey:string},rpc?:RewardLedgerRpc){
  const actorUserId=uuid(session.account.userId); const campaignId=uuid(input.campaignId); const intentId=uuid(input.intentId); const attemptId=uuid(input.attemptId);
  const idempotencyKey=input.idempotencyKey;
  requireReward(typeof idempotencyKey==="string" && idempotencyKey.length>=8 && idempotencyKey.length<=128,"invalid_reward_deployment_job");
  const fixedSession={...session,account:{...session.account,userId:actorUserId}};
  const attempt=await loadVerifiedRewardDeploymentAttempt(fixedSession,{campaignId,intentId,attemptId},rpc);
  const job=await queueRewardDeploymentJob({campaignId,actorUserId,intentId,attemptId,idempotencyKey},rpc);
  requireReward(job.transactionHash===attempt.verified.transactionHash,"reward_job_attempt_mismatch");
  return job;
}

type WorkerReader=RewardCampaignReader & Pick<PublicClient,"getTransactionCount">;
type Dependencies={rpc?:RewardLedgerRpc;reader:WorkerReader;creationCode:Hex;broadcast:(signedTransaction:Hex)=>Promise<Hex>};
type Outcome="busy"|"confirmed"|"submitted"|"pending"|"awaiting_nonce"|"nonce_conflict"|"unavailable"|"broadcast_unknown"|"requires_attention";

/** One bounded private worker pass for one explicitly queued deployment. Only
 * stored, operator-signed bytes can be sent; this function never signs, replaces
 * fees, invents a nonce or loops after an HTTP response. No route/CLI enables it.
 * Use a worker-owned, bounded/no-retry transport, never request-provided clients. */
export async function runRewardDeploymentJob(session:RewardOperatorAccount,input:{jobId:string;workerId:string},dependencies:Dependencies){
  const actorUserId=uuid(session.account.userId); const jobId=uuid(input.jobId); const workerId=uuid(input.workerId);
  const {rpc,reader,creationCode,broadcast}=dependencies;
  const fixedSession={...session,account:{...session.account,userId:actorUserId}};
  const result=(outcome:Outcome)=>({jobId,outcome}); // no signed bytes/lease tokens/errors in output
  const original=await readRewardDeploymentJob({jobId,actorUserId},rpc);
  if(original.state==="confirmed") return result("confirmed");
  const lease=await stepRewardDeploymentJob({jobId,actorUserId,workerId,leaseToken:null,action:"lease"},rpc);
  if(!lease) return result("busy");
  requireReward(lease.campaignId===original.campaignId && lease.intentId===original.intentId && lease.attemptId===original.attemptId
    && lease.transactionHash===original.transactionHash,"reward_job_attempt_mismatch");
  if(lease.state==="confirmed") return result("confirmed");
  const step=async(action:"arm"|"submitted"|"confirm")=>{
    const updated=await stepRewardDeploymentJob({jobId,actorUserId,workerId,leaseToken:lease.leaseToken,action},rpc);
    requireReward(updated && updated.campaignId===lease.campaignId && updated.intentId===lease.intentId && updated.attemptId===lease.attemptId
      && updated.transactionHash===lease.transactionHash,"reward_job_attempt_mismatch");
    return updated;
  };
  const attempt=await loadVerifiedRewardDeploymentAttempt(fixedSession,lease,rpc);
  requireReward(attempt.verified.transactionHash===lease.transactionHash,"reward_job_attempt_mismatch");
  const chainId=attempt.deployment.context.chainId;
  let tx; let transactionMissing=false;
  try {
    requireReward(await reader.getChainId()===chainId,"reward_observed_chain_mismatch");
    try {tx=await reader.getTransaction({hash:lease.transactionHash});}
    catch(error){if(!(error instanceof TransactionNotFoundError)) throw error; transactionMissing=true;}
  } catch {return result("unavailable");}
  if(!transactionMissing){
    // Only an explicit not-found response permits the send path. Malformed RPC
    // data must not masquerade as absence or leak transport details to callers.
    try {
      if(!tx || tx.hash.toLowerCase()!==lease.transactionHash || tx.chainId!==chainId || tx.from.toLowerCase()!==attempt.verified.operatorAddress
        || !Number.isSafeInteger(tx.nonce) || BigInt(tx.nonce)!==attempt.nonce || tx.to!==null || tx.value!==0n
        || typeof tx.input!=="string" || !/^0x(?:[0-9a-fA-F]{2})*$/.test(tx.input)
        || keccak256(tx.input)!==attempt.verified.calldataHash
        || (tx.blockNumber===null)!==(tx.blockHash===null)) return result("requires_attention");
    } catch {return result("requires_attention");}
    if(tx?.blockNumber===null){
      try {if(await reader.getChainId()!==chainId) return result("unavailable"); await step("submitted");}
      catch {return result("unavailable");}
      return result("pending");
    }
    try {
      // Each lease generation gets one observation key; its exact retry remains
      // history. Confirmation requires a persisted finalized registry, not tx presence.
      await observeVerifiedRewardCampaign(fixedSession,{campaignId:lease.campaignId,intentId:lease.intentId,attemptId:lease.attemptId,
        idempotencyKey:`deployment-job:${jobId}:${lease.leaseGeneration}`},{rpc,reader,creationCode});
      const confirmed=await step("confirm");
      requireReward(confirmed.state==="confirmed","reward_job_deployment_not_verified");
      return result("confirmed");
    } catch(error){
      return result(error!==null && typeof error==="object" && "code" in error && error.code==="reward_deployment_reverted"?"requires_attention":"unavailable");
    }
  }
  try {
    const [latest,pending]=await Promise.all([reader.getTransactionCount({address:attempt.deployment.operatorAddress,blockTag:"latest"}),
      reader.getTransactionCount({address:attempt.deployment.operatorAddress,blockTag:"pending"})]);
    if(!Number.isSafeInteger(latest)||latest<0||!Number.isSafeInteger(pending)||pending<latest||await reader.getChainId()!==chainId) return result("unavailable");
    if(BigInt(latest)>attempt.nonce||BigInt(pending)>attempt.nonce) return result("nonce_conflict");
    if(BigInt(latest)<attempt.nonce||BigInt(pending)<attempt.nonce) return result("awaiting_nonce");
  } catch {return result("unavailable");}
  // A persisted arm survives response loss. Expired workers may still possess
  // the bytes, but all competing sends have the SAME hash/nonce/economic effect.
  // A lease is database fencing, not remote-chain revocation of a signature.
  const armed=await step("arm");
  if(armed.state==="confirmed") return result("confirmed");
  if(!rewardLeaseCanStartSend(armed))return result("busy");
  try {
    const hash=await broadcast(attempt.verified.signedTransaction);
    if(hash.toLowerCase()!==lease.transactionHash) return result("broadcast_unknown");
    await step("submitted");
    return result("submitted");
  } catch {return result("broadcast_unknown");}
}
