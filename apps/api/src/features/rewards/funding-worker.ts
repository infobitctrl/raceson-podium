import { TransactionNotFoundError, keccak256, type Hex, type PublicClient } from "viem";
import type { RewardOperatorAccount } from "./operator-account.js";
import { requireReward } from "@raceson/domain/rewards";
import { queueRewardFundingJob, readRewardFundingJob, stepRewardFundingJob, confirmRewardFundingJob, rewardDocumentUuid as uuid,
  type RewardLedgerRpc } from "@raceson/db/rewards";
import { readVerifiedRewardCampaign, readVerifiedRewardFunding, type RewardCampaignReader } from "@raceson/rewards-chain";
import { loadVerifiedRewardFundingAttempt } from "./funding-service.js";
import { rewardLeaseCanStartSend } from "./worker-send-fence.js";

export async function queueVerifiedRewardFunding(session:RewardOperatorAccount,input:{campaignId:string;intentId:string;attemptId:string;idempotencyKey:string},rpc?:RewardLedgerRpc) {
  const actorUserId=uuid(session.account.userId); const campaignId=uuid(input.campaignId); const intentId=uuid(input.intentId); const attemptId=uuid(input.attemptId);
  const idempotencyKey=input.idempotencyKey;
  requireReward(typeof idempotencyKey==="string" && idempotencyKey.length>=8 && idempotencyKey.length<=128,"invalid_reward_funding_job");
  const fixedSession={...session,account:{...session.account,userId:actorUserId}};
  const attempt=await loadVerifiedRewardFundingAttempt(fixedSession,{campaignId,intentId,attemptId},rpc);
  const job=await queueRewardFundingJob({campaignId,actorUserId,intentId,attemptId,idempotencyKey},rpc);
  requireReward(job.transactionHash===attempt.verified.transactionHash,"reward_job_attempt_mismatch");
  return job;
}

type Dependencies={rpc?:RewardLedgerRpc;reader:RewardCampaignReader & Pick<PublicClient,"getTransactionCount">;
  creationCode:Hex;broadcast:(signedTransaction:Hex)=>Promise<Hex>};
type Outcome="busy"|"confirmed"|"submitted"|"pending"|"awaiting_nonce"|"nonce_conflict"|"prestate_changed"|"unavailable"|"broadcast_unknown"|"requires_attention";

/** One bounded private pass. No signing, implicit retries, new nonce, fee
 * replacement or background loop. Use worker-owned bounded transports only.
 * Database leases fence writes; they cannot revoke signed bytes already released. */
export async function runRewardFundingJob(session:RewardOperatorAccount,input:{jobId:string;workerId:string},dependencies:Dependencies) {
  const actorUserId=uuid(session.account.userId); const jobId=uuid(input.jobId); const workerId=uuid(input.workerId);
  const {rpc,reader,creationCode,broadcast}=dependencies;
  const fixedSession={...session,account:{...session.account,userId:actorUserId}};
  const result=(outcome:Outcome)=>({jobId,outcome});
  const original=await readRewardFundingJob({jobId,actorUserId},rpc);
  if(original.state==="confirmed") return result("confirmed");
  const lease=await stepRewardFundingJob({jobId,actorUserId,workerId,leaseToken:null,action:"lease"},rpc);
  if(!lease) return result("busy");
  const matches=(job:typeof lease)=>job.campaignId===original.campaignId && job.intentId===original.intentId
    && job.attemptId===original.attemptId && job.transactionHash===original.transactionHash;
  requireReward(matches(lease),"reward_job_attempt_mismatch");
  if(lease.state==="confirmed") return result("confirmed");
  const step=async(action:"arm"|"submitted")=>{
    const updated=await stepRewardFundingJob({jobId,actorUserId,workerId,leaseToken:lease.leaseToken,action},rpc);
    requireReward(updated && matches(updated),"reward_job_attempt_mismatch"); return updated;
  };
  const attempt=await loadVerifiedRewardFundingAttempt(fixedSession,lease,rpc);
  requireReward(attempt.verified.transactionHash===lease.transactionHash,"reward_job_attempt_mismatch");
  const {plan,verified}=attempt; const chainId=plan.deployment.context.chainId;
  let tx; let missing=false;
  try {
    requireReward(await reader.getChainId()===chainId,"reward_observed_chain_mismatch");
    try {tx=await reader.getTransaction({hash:lease.transactionHash});}
    catch(error){if(!(error instanceof TransactionNotFoundError))throw error; missing=true;}
  } catch {return result("unavailable");}
  if(!missing) {
    try {
      if(!tx || tx.hash.toLowerCase()!==verified.transactionHash || tx.chainId!==chainId || tx.from.toLowerCase()!==verified.operatorAddress
        || !Number.isSafeInteger(tx.nonce) || BigInt(tx.nonce)!==plan.nonce || tx.to===null || tx.to.toLowerCase()!==verified.contractAddress
        || tx.type!=="eip1559" || tx.value!==verified.value || (tx.accessList?.length??0)!==0
        || typeof tx.input!=="string" || !/^0x(?:[0-9a-fA-F]{2})*$/.test(tx.input) || keccak256(tx.input)!==verified.calldataHash
        || (tx.blockNumber===null)!==(tx.blockHash===null)) return result("requires_attention");
    } catch {return result("requires_attention");}
    if(tx?.blockNumber===null) {
      try {if(await reader.getChainId()!==chainId)return result("unavailable"); await step("submitted");}
      catch {return result("unavailable");}
      return result("pending");
    }
    try {
      const proof=await readVerifiedRewardFunding(reader,plan,verified.signedTransaction,creationCode);
      requireReward(lease.leaseToken,"reward_funding_job_lease_lost");
      const confirmed=await confirmRewardFundingJob({jobId,actorUserId,workerId,leaseToken:lease.leaseToken,
        funding:proof.funding,...proof.checkpoint},rpc);
      requireReward(matches(confirmed) && confirmed.state==="confirmed","reward_funding_not_verified");
      return result("confirmed");
    } catch(error) {
      return result(error!==null && typeof error==="object" && "code" in error && error.code==="reward_funding_reverted"?"requires_attention":"unavailable");
    }
  }
  try {
    // Fresh canonical accounting, not the original preparation checkpoint. The
    // contract's atomic guard still protects a deposit racing this remote read.
    const current=await readVerifiedRewardCampaign(reader,plan.deployment,creationCode);
    if(current.observation.accounting.state!==0 || current.observation.accounting.accountedFunding!==plan.expectedAccountedFunding)
      return result("prestate_changed");
    const [latest,pending]=await Promise.all([reader.getTransactionCount({address:verified.operatorAddress,blockTag:"latest"}),
      reader.getTransactionCount({address:verified.operatorAddress,blockTag:"pending"})]);
    if(!Number.isSafeInteger(latest)||latest<0||!Number.isSafeInteger(pending)||pending<latest||await reader.getChainId()!==chainId)return result("unavailable");
    if(BigInt(latest)>plan.nonce||BigInt(pending)>plan.nonce)return result("nonce_conflict");
    if(BigInt(latest)<plan.nonce||BigInt(pending)<plan.nonce)return result("awaiting_nonce");
  } catch {return result("unavailable");}
  // Current DB authority/lease is rechecked after all preceding network reads.
  const armed=await step("arm");
  if(armed.state==="confirmed")return result("confirmed");
  if(!rewardLeaseCanStartSend(armed))return result("busy");
  try {
    const hash=await broadcast(verified.signedTransaction);
    if(hash.toLowerCase()!==verified.transactionHash)return result("broadcast_unknown");
    await step("submitted"); return result("submitted");
  } catch {return result("broadcast_unknown");}
}
