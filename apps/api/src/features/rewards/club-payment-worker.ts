import { TransactionNotFoundError,keccak256,parseTransaction,type Hex,type PublicClient,type Transaction } from "viem";
import { requireReward } from "@raceson/domain/rewards";
import { queueRewardClubPaymentJob,readRewardClubPaymentJob,stepRewardClubPaymentJob,confirmRewardClubPaymentJob,
  rewardDocumentUuid as uuid,type RewardAccountIdentity,type RewardLedgerRpc,type RewardClubPaymentJob } from "@raceson/db/rewards";
import { canonicalRewardJson,encodeRewardClubPayment,readVerifiedRewardClubPayment,requireLiveRewardClaim,type RewardClubClaimReader } from "@raceson/rewards-chain";
import { loadVerifiedClubRewardPaymentAttempt,observeFreshClubRewardPayment } from "./club-payment-service.js";
import type { RewardPortalConfig } from "./request-identity.js";
import { copyRewardPaymentGasPolicy, type RewardPaymentGasPolicy } from "./athlete-payment-worker.js";
import { rewardLeaseCanStartSend } from "./worker-send-fence.js";

type Config=RewardPortalConfig&{rpc?:RewardLedgerRpc;reader:RewardClubClaimReader&Pick<PublicClient,"getTransactionCount">;creationCode:Hex};
type Dependencies=Config&{reader:Config["reader"]&Pick<PublicClient,"estimateGas">;gasPolicy:RewardPaymentGasPolicy;broadcast:(signed:Hex)=>Promise<Hex>};
const fixedActor=(i:RewardAccountIdentity)=>({userId:uuid(i.userId),sessionId:uuid(i.sessionId)});
export async function queueVerifiedClubRewardPayment(identity:RewardAccountIdentity,input:{claimIntentId:string;paymentIntentId:string;attemptId:string;idempotencyKey:string},dependencies:Config){
  const actor=fixedActor(identity);const scope={claimIntentId:uuid(input.claimIntentId),paymentIntentId:uuid(input.paymentIntentId),attemptId:uuid(input.attemptId)};
  const idempotencyKey=input.idempotencyKey;requireReward(typeof idempotencyKey==="string"&&idempotencyKey.length>=8&&idempotencyKey.length<=128,"invalid_reward_payment_job");
  const {rpc,reader,creationCode,chainId,origin}=dependencies;const deps={rpc,reader,creationCode,chainId,origin};
  const stored=await loadVerifiedClubRewardPaymentAttempt(actor,scope,deps);
  const existing=await readRewardClubPaymentJob(actor,{paymentIntentId:scope.paymentIntentId},rpc);
  if(existing){requireReward(existing.claimIntentId===scope.claimIntentId&&existing.attemptId===scope.attemptId&&existing.idempotencyKey===idempotencyKey
    &&existing.transactionHash===stored.verified.transactionHash,"reward_payment_job_already_queued");return existing;}
  const live=await observeFreshClubRewardPayment(actor,scope,deps);
  const job=await queueRewardClubPaymentJob(actor,{...scope,idempotencyKey,witness:live.witness,observedAt:new Date().toISOString()},rpc);
  requireReward(job.transactionHash===stored.verified.transactionHash,"reward_job_attempt_mismatch");return job;
}
type Attempt=Awaited<ReturnType<typeof loadVerifiedClubRewardPaymentAttempt>>["verified"];
function exactTransaction(tx:Transaction,a:Attempt){
  const signed=parseTransaction(a.signedTransaction);
  const scalar=(v:unknown,expected:Hex|undefined)=>typeof v==="string"&&/^0x[0-9a-fA-F]{1,64}$/.test(v)&&expected!==undefined&&BigInt(v)===BigInt(expected);
  requireReward(tx.hash.toLowerCase()===a.transactionHash&&tx.chainId===a.chainId&&tx.from.toLowerCase()===a.relayerAddress
    &&Number.isSafeInteger(tx.nonce)&&BigInt(tx.nonce)===a.nonce&&tx.to?.toLowerCase()===a.contractAddress&&tx.type==="eip1559"&&tx.value===0n
    &&(tx.accessList?.length??0)===0&&typeof tx.input==="string"&&/^0x(?:[0-9a-fA-F]{2})*$/.test(tx.input)&&keccak256(tx.input)===a.calldataHash
    &&tx.gas===a.gasLimit&&tx.maxFeePerGas===a.maxFeePerGas&&tx.maxPriorityFeePerGas===a.maxPriorityFeePerGas
    &&scalar(tx.r,signed.r)&&scalar(tx.s,signed.s)&&tx.yParity===signed.yParity
    &&(tx.blockNumber===null)===(tx.blockHash===null),"reward_payment_signed_transaction_mismatch");
}
const errorCode=(e:unknown)=>e!==null&&typeof e==="object"&&"code" in e?e.code:null;
const held=new Set(["reward_claim_readiness_required","reward_review_source_changed","reward_review_superseded","reward_record_source_changed",
  "reward_record_source_not_ready","reward_record_approval_withdrawn","reward_record_approval_superseded","reward_claim_not_live","reward_claim_expired",
  "reward_claim_campaign_unavailable","reward_claim_campaign_not_ready","reward_mapping_source_not_ready",
  "reward_club_review_identity_changed","reward_club_execution_changed_since_review","reward_club_consent_invalid",
  "reward_club_owners_changed","reward_club_threshold_changed","reward_club_three_owners_required"]);
type Outcome="busy"|"confirmed"|"submitted"|"pending"|"awaiting_nonce"|"nonce_conflict"|"not_ready"|"gas_guard"|"unavailable"|"broadcast_unknown"|"requires_attention";

/** One bounded private pass. No signer, timer, provider fallback, automatic fee
 * replacement or new nonce. Absence at one RPC never proves non-broadcast. */
export async function runClubRewardPaymentJob(identity:RewardAccountIdentity,input:{jobId:string;workerId:string},dependencies:Dependencies){
  const actor=fixedActor(identity);const jobId=uuid(input.jobId);const workerId=uuid(input.workerId);
  const {rpc,reader,creationCode,chainId,origin,broadcast}=dependencies;const gasPolicy=copyRewardPaymentGasPolicy(dependencies.gasPolicy);const deps={rpc,reader,creationCode,chainId,origin};
  const outcome=(value:Outcome)=>({jobId,outcome:value});const original=await readRewardClubPaymentJob(actor,{jobId},rpc);requireReward(original,"reward_payment_job_required");
  if(original.state==="confirmed")return outcome("confirmed");
  const lease=await stepRewardClubPaymentJob(actor,{jobId,workerId,leaseToken:null,action:"lease"},rpc);if(!lease)return outcome("busy");
  const matches=(j:RewardClubPaymentJob)=>j.claimIntentId===original.claimIntentId&&j.paymentIntentId===original.paymentIntentId&&j.attemptId===original.attemptId
    &&j.transactionHash===original.transactionHash&&j.campaignId===original.campaignId&&j.uploadId===original.uploadId&&j.entitlementId===original.entitlementId&&j.activationJobId===original.activationJobId;
  requireReward(matches(lease),"reward_job_attempt_mismatch");if(lease.state==="confirmed")return outcome("confirmed");
  const step=async(action:"arm"|"submitted",execution?:unknown)=>{
    const j=await stepRewardClubPaymentJob(actor,{jobId,workerId,leaseToken:lease.leaseToken,action,
      ...(action==="arm"?{execution,observedAt:new Date().toISOString()}:{})},rpc);
    requireReward(j&&matches(j),"reward_job_attempt_mismatch");return j;
  };
  // Unlike an EOA proof, stored Safe consent needs canonical historical RPC
  // reads. A missing archive or wrong network must defer this bounded pass.
  let saved:Awaited<ReturnType<typeof loadVerifiedClubRewardPaymentAttempt>>;
  try{saved=await loadVerifiedClubRewardPaymentAttempt(actor,lease,deps);}
  catch(e){return outcome(errorCode(e)==="reward_stored_payment_attempt_mismatch"?"requires_attention":"unavailable");}
  const {plan,verified:a}=saved;
  requireReward(a.transactionHash===lease.transactionHash&&a.chainId===chainId,"reward_job_attempt_mismatch");
  let tx;let missing=false;
  try{requireReward(await reader.getChainId()===chainId,"reward_observed_chain_mismatch");
    try{tx=await reader.getTransaction({hash:a.transactionHash});}catch(e){if(!(e instanceof TransactionNotFoundError))throw e;missing=true;}
  }catch{return outcome("unavailable");}
  if(!missing){
    try{requireReward(tx,"reward_payment_observation_unavailable");exactTransaction(tx,a);}catch{return outcome("requires_attention");}
    if(tx!.blockNumber===null){
      try{requireReward(await reader.getChainId()===chainId,"reward_observed_chain_mismatch");await step("submitted");return outcome("pending");}catch{return outcome("unavailable");}
    }
    try{
      const proof=await readVerifiedRewardClubPayment(reader,plan,a.signedTransaction,creationCode);requireReward(lease.leaseToken,"reward_payment_job_lease_lost");
      const confirmed=await confirmRewardClubPaymentJob(actor,{jobId,workerId,leaseToken:lease.leaseToken,payment:proof.payment,...proof.checkpoint},rpc);
      requireReward(matches(confirmed)&&confirmed.state==="confirmed","reward_payment_not_verified");return outcome("confirmed");
    }catch(e){return outcome(errorCode(e)==="reward_payment_reverted"?"requires_attention":"unavailable");}
  }
  let execution;
  try{
    const live=await observeFreshClubRewardPayment(actor,lease,deps);
    requireReward(canonicalRewardJson(live.verified)===canonicalRewardJson(a),"reward_job_attempt_mismatch");
    const latest=await reader.getTransactionCount({address:a.relayerAddress,blockTag:"latest"});const pending=live.pendingNonce;
    requireReward(Number.isSafeInteger(latest)&&latest>=0&&pending>=BigInt(latest),"reward_invalid_nonce_observation");
    if(BigInt(latest)>a.nonce||pending>a.nonce)return outcome("nonce_conflict");
    if(BigInt(latest)<a.nonce||pending<a.nonce)return outcome("awaiting_nonce");
    const [estimatedGas,balance,head]=await Promise.all([
      reader.estimateGas({...encodeRewardClubPayment(plan),account:a.relayerAddress,type:"eip1559",maxFeePerGas:a.maxFeePerGas,maxPriorityFeePerGas:a.maxPriorityFeePerGas,blockTag:"pending"}),
      reader.getBalance({address:a.relayerAddress,blockTag:"pending"}),reader.getBlock({blockTag:"latest"})]);
    requireReward(typeof estimatedGas==="bigint"&&estimatedGas>0n&&typeof balance==="bigint"&&balance>=0n&&head.number!==null&&head.hash!==null
      &&head.number>=live.witness.observation.finalizedBlock.number&&head.timestamp>=live.witness.observation.finalizedBlock.timestamp
      &&typeof head.baseFeePerGas==="bigint"&&head.baseFeePerGas>=0n,"reward_payment_observation_unavailable");
    requireLiveRewardClaim(plan.expected.deployment.context,plan.claim,head.timestamp,live.witness.observation.accounting.claimDeadline);
    const cost=a.gasLimit*a.maxFeePerGas;
    if(estimatedGas>a.gasLimit||a.gasLimit>gasPolicy.maxGasLimit||a.maxFeePerGas>gasPolicy.maxFeePerGas||a.maxFeePerGas<head.baseFeePerGas
      ||cost>gasPolicy.maxTotalFeeWei||balance<cost+gasPolicy.minimumRemainingBalanceWei)return outcome("gas_guard");
    requireReward(await reader.getChainId()===chainId,"reward_observed_chain_mismatch");
    execution={schemaVersion:1,claimWitness:live.witness,latestNonce:BigInt(latest),pendingNonce:pending,relayerBalanceWei:balance,estimatedGas,gasPolicy};
  }catch(e){const code=errorCode(e);return outcome(code==="reward_claim_already_paid"?"requires_attention":typeof code==="string"&&held.has(code)?"not_ready":"unavailable");}
  let armed:RewardClubPaymentJob;
  try{armed=await step("arm",execution);if(armed.state==="confirmed")return outcome("confirmed");}
  catch(e){const code=errorCode(e);if(typeof code==="string"&&held.has(code))return outcome("not_ready");if(code==="reward_payment_gas_guard")return outcome("gas_guard");throw e;}
  // Chain identity was checked immediately before the SQL arm. Do not add an
  // awaited RPC between this final fence and invoking the broadcaster. A slow
  // SQL response must not start a send after the returned lease has expired.
  // Once handed to a provider, signed bytes cannot be revoked by a DB lease.
  if(!rewardLeaseCanStartSend(armed))return outcome("busy");
  try{const hash=await broadcast(a.signedTransaction);if(hash.toLowerCase()!==a.transactionHash)return outcome("broadcast_unknown");
    await step("submitted");return outcome("submitted");}catch{return outcome("broadcast_unknown");}
}
