import { TransactionNotFoundError,keccak256,type Hex,type PublicClient } from "viem";
import type { RewardOperatorAccount } from "./operator-account.js";
import { requireReward } from "@raceson/domain/rewards";
import { queueRewardLifecycleJob,readRewardLifecycleJob,stepRewardLifecycleJob,confirmRewardLifecycleJob,rewardDocumentUuid as uuid,type RewardLedgerRpc } from "@raceson/db/rewards";
import { readVerifiedRewardCampaign,readVerifiedRewardLifecycle,requireRewardLifecyclePrestate,type RewardCampaignReader } from "@raceson/rewards-chain";
import { loadVerifiedRewardLifecycleAttempt } from "./lifecycle-service.js";
import { rewardLeaseCanStartSend } from "./worker-send-fence.js";

export async function queueVerifiedRewardLifecycle(session:RewardOperatorAccount,input:{campaignId:string;uploadId:string;intentId:string;attemptId:string;idempotencyKey:string},rpc?:RewardLedgerRpc){
  const actorUserId=uuid(session.account.userId);const campaignId=uuid(input.campaignId);const uploadId=uuid(input.uploadId);const intentId=uuid(input.intentId);const attemptId=uuid(input.attemptId);
  const idempotencyKey=input.idempotencyKey;requireReward(typeof idempotencyKey==="string" && idempotencyKey.length>=8 && idempotencyKey.length<=128,"invalid_reward_lifecycle_job");
  const fixedSession={...session,account:{...session.account,userId:actorUserId}};
  const attempt=await loadVerifiedRewardLifecycleAttempt(fixedSession,{campaignId,uploadId,intentId,attemptId},rpc);
  const job=await queueRewardLifecycleJob({campaignId,actorUserId,uploadId,intentId,attemptId,idempotencyKey},rpc);
  requireReward(job.transactionHash===attempt.verified.transactionHash,"reward_job_attempt_mismatch");return job;
}
type Dependencies={rpc?:RewardLedgerRpc;reader:RewardCampaignReader & Pick<PublicClient,"getTransactionCount">;creationCode:Hex;broadcast:(signed:Hex)=>Promise<Hex>};
type Outcome="busy"|"confirmed"|"submitted"|"pending"|"awaiting_nonce"|"nonce_conflict"|"prestate_changed"|"review_not_finished"|"evidence_changed"|"unavailable"|"broadcast_unknown"|"requires_attention";
const errorCode=(error:unknown)=>error!==null && typeof error==="object" && "code" in error?error.code:null;
const evidenceErrors=new Set(["reward_upload_evidence_changed","reward_review_superseded","reward_review_source_changed","reward_round_has_unresolved_adjudication",
  "reward_record_approval_mismatch","reward_record_approval_withdrawn","reward_record_approval_superseded","reward_record_approval_omitted","reward_record_source_changed","reward_record_source_not_ready"]);

/** One bounded private pass, never a signer/scheduler/HTTP route. Current source
 * and confirmed predecessors gate arm; mined-history reconciliation must still
 * work after source changes. Leases cannot revoke bytes already released. */
export async function runRewardLifecycleJob(session:RewardOperatorAccount,input:{jobId:string;workerId:string},dependencies:Dependencies){
  const actorUserId=uuid(session.account.userId);const jobId=uuid(input.jobId);const workerId=uuid(input.workerId);
  const {rpc,reader,creationCode,broadcast}=dependencies;const fixedSession={...session,account:{...session.account,userId:actorUserId}};
  const result=(outcome:Outcome)=>({jobId,outcome});const original=await readRewardLifecycleJob({jobId,actorUserId},rpc);
  if(original.state==="confirmed")return result("confirmed");
  const lease=await stepRewardLifecycleJob({jobId,actorUserId,workerId,leaseToken:null,action:"lease"},rpc);if(!lease)return result("busy");
  const matches=(job:typeof lease)=>job.campaignId===original.campaignId && job.uploadId===original.uploadId && job.intentId===original.intentId
    && job.attemptId===original.attemptId && job.transactionHash===original.transactionHash && job.predecessorFundingJobId===original.predecessorFundingJobId
    && job.predecessorLifecycleJobId===original.predecessorLifecycleJobId;
  requireReward(matches(lease),"reward_job_attempt_mismatch");if(lease.state==="confirmed")return result("confirmed");
  const step=async(action:"arm"|"submitted")=>{
    const updated=await stepRewardLifecycleJob({jobId,actorUserId,workerId,leaseToken:lease.leaseToken,action},rpc);
    requireReward(updated && matches(updated),"reward_job_attempt_mismatch");return updated;
  };
  const attempt=await loadVerifiedRewardLifecycleAttempt(fixedSession,lease,rpc);
  requireReward(attempt.verified.transactionHash===lease.transactionHash,"reward_job_attempt_mismatch");
  const {plan,verified}=attempt;const chainId=plan.deployment.context.chainId;
  let tx;let missing=false;
  try{
    requireReward(await reader.getChainId()===chainId,"reward_observed_chain_mismatch");
    try{tx=await reader.getTransaction({hash:lease.transactionHash});}catch(error){if(!(error instanceof TransactionNotFoundError))throw error;missing=true;}
  }catch{return result("unavailable");}
  if(!missing){
    try{
      if(!tx || tx.hash.toLowerCase()!==verified.transactionHash || tx.chainId!==chainId || tx.from.toLowerCase()!==verified.operatorAddress
        || !Number.isSafeInteger(tx.nonce) || BigInt(tx.nonce)!==plan.nonce || tx.to===null || tx.to.toLowerCase()!==verified.contractAddress
        || tx.type!=="eip1559" || tx.value!==0n || (tx.accessList?.length??0)!==0 || typeof tx.input!=="string"
        || !/^0x(?:[0-9a-fA-F]{2})*$/.test(tx.input) || keccak256(tx.input)!==verified.calldataHash || (tx.blockNumber===null)!==(tx.blockHash===null))return result("requires_attention");
    }catch{return result("requires_attention");}
    if(tx?.blockNumber===null){
      try{if(await reader.getChainId()!==chainId)return result("unavailable");await step("submitted");}catch{return result("unavailable");}
      return result("pending");
    }
    try{
      const proof=await readVerifiedRewardLifecycle(reader,plan,verified.signedTransaction,creationCode);requireReward(lease.leaseToken,"reward_lifecycle_job_lease_lost");
      const confirmed=await confirmRewardLifecycleJob({jobId,actorUserId,workerId,leaseToken:lease.leaseToken,lifecycle:proof.lifecycle,...proof.checkpoint},rpc);
      requireReward(matches(confirmed) && confirmed.state==="confirmed","reward_lifecycle_not_verified");return result("confirmed");
    }catch(error){return result(errorCode(error)==="reward_lifecycle_reverted"?"requires_attention":"unavailable");}
  }
  try{
    const current=await readVerifiedRewardCampaign(reader,plan.deployment,creationCode);
    try{requireRewardLifecyclePrestate(plan,current.observation.accounting,current.observation.finalizedBlock.timestamp);}
    catch(error){return result(errorCode(error)==="reward_lifecycle_review_not_finished"?"review_not_finished":"prestate_changed");}
    const[latest,pending]=await Promise.all([reader.getTransactionCount({address:verified.operatorAddress,blockTag:"latest"}),reader.getTransactionCount({address:verified.operatorAddress,blockTag:"pending"})]);
    if(!Number.isSafeInteger(latest)||latest<0||!Number.isSafeInteger(pending)||pending<latest||await reader.getChainId()!==chainId)return result("unavailable");
    if(BigInt(latest)>plan.nonce||BigInt(pending)>plan.nonce)return result("nonce_conflict");
    if(BigInt(latest)<plan.nonce||BigInt(pending)<plan.nonce)return result("awaiting_nonce");
  }catch{return result("unavailable");}
  // After ALL preflight network reads, acquire fresh source/authority under the
  // DB lock. A chain read and SQL are not atomic; no claim to revoke stale bytes.
  let armed:NonNullable<Awaited<ReturnType<typeof step>>>;
  try{armed=await step("arm");if(armed.state==="confirmed")return result("confirmed");}
  catch(error){const code=errorCode(error);if(typeof code==="string" && evidenceErrors.has(code))return result("evidence_changed");
    if(code==="reward_lifecycle_review_not_finished")return result("review_not_finished");throw error;}
  if(!rewardLeaseCanStartSend(armed))return result("busy");
  try{const hash=await broadcast(verified.signedTransaction);if(hash.toLowerCase()!==verified.transactionHash)return result("broadcast_unknown");
    await step("submitted");return result("submitted");}catch{return result("broadcast_unknown");}
}
