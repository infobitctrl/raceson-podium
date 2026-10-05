import { keccak256,parseTransaction,type Hex } from "viem";
import type { RewardOperatorAccount } from "./operator-account.js";
import { requireReward } from "@raceson/domain/rewards";
import { nextRewardOperatorJob,withRewardOperatorSession,readRewardDeploymentJob,readRewardFundingJob,readRewardLifecycleJob,readRewardAthletePaymentJob,readRewardClubPaymentJob,
  rewardDocumentUuid as uuid,type RewardAccountIdentity,type RewardLedgerRpc,type RewardOperatorQueueJob } from "@raceson/db/rewards";
import { runRewardDeploymentJob } from "./deployment-worker.js";
import { runRewardFundingJob } from "./funding-worker.js";
import { runRewardLifecycleJob } from "./lifecycle-worker.js";
import { runAthleteRewardPaymentJob,copyRewardPaymentGasPolicy } from "./athlete-payment-worker.js";
import { runClubRewardPaymentJob } from "./club-payment-worker.js";

type WorkerResult=Awaited<ReturnType<typeof runRewardDeploymentJob>>|Awaited<ReturnType<typeof runRewardFundingJob>>
  |Awaited<ReturnType<typeof runRewardLifecycleJob>>|Awaited<ReturnType<typeof runAthleteRewardPaymentJob>>|Awaited<ReturnType<typeof runClubRewardPaymentJob>>;
type WorkerOutcome=WorkerResult["outcome"];
export type RewardOperatorRunnerDependencies=Parameters<typeof runAthleteRewardPaymentJob>[2]&Parameters<typeof runClubRewardPaymentJob>[2]&{signal?:AbortSignal};
export type RewardOperatorRunnerInput={programmeId:string;workerId:string;maxJobs:number;deadlineMs:number};
type Entry={jobId:string;kind:RewardOperatorQueueJob["kind"];outcome:WorkerOutcome};
type Stop="queue_empty"|"signers_deferred"|"attention_required"|"unavailable"|"limit_reached"|"stopped";
type RunJob=(job:RewardOperatorQueueJob)=>Promise<WorkerResult>;
const outcomes=new Set<WorkerOutcome>(["busy","confirmed","submitted","pending","awaiting_nonce","nonce_conflict","not_ready","gas_guard",
  "prestate_changed","review_not_finished","evidence_changed","unavailable","broadcast_unknown","requires_attention"]);
const attention=new Set<WorkerOutcome>(["nonce_conflict","not_ready","gas_guard","prestate_changed","evidence_changed","requires_attention"]);
const code=(e:unknown)=>e!==null&&typeof e==="object"&&"code" in e?e.code:null;

/** Adapter to the actual five workers. This does not sign or create any jobs.
 * Only immutable selected job/attempt/hash may execute. The final broadcaster
 * wrapper is synchronous until it invokes the supplied bounded transport. */
export async function runStoredRewardOperatorJob(session:RewardOperatorAccount,identity:RewardAccountIdentity,job:RewardOperatorQueueJob,
  input:RewardOperatorRunnerInput,deps:RewardOperatorRunnerDependencies):Promise<WorkerResult>{
  const actorUserId=identity.userId;
  requireReward(session.account.userId===actorUserId,"reward_operator_permission_required");
  const rpc=withRewardOperatorSession(identity,deps.rpc);
  const stored=job.kind==="deployment"?await readRewardDeploymentJob({jobId:job.jobId,actorUserId},rpc)
    :job.kind==="funding"?await readRewardFundingJob({jobId:job.jobId,actorUserId},rpc)
    :job.kind==="lifecycle"?await readRewardLifecycleJob({jobId:job.jobId,actorUserId},rpc)
    :job.kind==="athlete_payment"?await readRewardAthletePaymentJob(identity,{jobId:job.jobId},rpc)
    :await readRewardClubPaymentJob(identity,{jobId:job.jobId},rpc);
  requireReward(stored&&stored.campaignId===job.campaignId&&stored.attemptId===job.attemptId&&stored.transactionHash===job.transactionHash
    &&("paymentIntentId" in stored?stored.paymentIntentId:stored.intentId)===job.intentId,"reward_job_attempt_mismatch");
  const broadcast=(bytes:Hex)=>{
    requireReward(!deps.signal?.aborted&&Date.now()<input.deadlineMs,"reward_runner_stopped");
    const tx=parseTransaction(bytes);
    requireReward(keccak256(bytes)===job.transactionHash&&tx.chainId===deps.chainId&&tx.nonce!==undefined&&BigInt(tx.nonce)===job.nonce,
      "reward_job_attempt_mismatch");
    return deps.broadcast(bytes);
  };
  const workerInput={jobId:job.jobId,workerId:input.workerId};const workerDeps={...deps,rpc,broadcast};
  if(job.kind==="deployment")return runRewardDeploymentJob(session,workerInput,workerDeps);
  if(job.kind==="funding")return runRewardFundingJob(session,workerInput,workerDeps);
  if(job.kind==="lifecycle")return runRewardLifecycleJob(session,workerInput,workerDeps);
  if(job.kind==="athlete_payment")return runAthleteRewardPaymentJob(identity,workerInput,workerDeps);
  return runClubRewardPaymentJob(identity,workerInput,workerDeps);
}

/** One bounded operator session. Empty means no pending queued jobs NOW, never
 * completion of the programme or evidence that unqueued awards have been paid.
 * A pending/held head blocks its signer for this pass; other signers can proceed.
 * No polling sleeps, automatic signing/replacement, fresh nonce or provider swap.
 * Caller owns authentication and bounded IO. CLI/hosted execution is separate. */
export async function drainRewardOperatorQueue(session:RewardOperatorAccount,identity:RewardAccountIdentity,input:RewardOperatorRunnerInput,
  dependencies:RewardOperatorRunnerDependencies,runJob?:RunJob){
  const actor={userId:uuid(identity.userId),sessionId:uuid(identity.sessionId)};
  requireReward(session.account.userId===actor.userId,"reward_operator_permission_required");
  const fixedSession={...session,account:{...session.account,userId:actor.userId}};
  const fixed={programmeId:uuid(input.programmeId),workerId:uuid(input.workerId),maxJobs:input.maxJobs,deadlineMs:input.deadlineMs};
  const {rpc,reader,chainId,origin,creationCode,broadcast,signal}=dependencies;
  requireReward((chainId===10143||chainId===31337)&&Number.isInteger(fixed.maxJobs)&&fixed.maxJobs>=1&&fixed.maxJobs<=100
    &&Number.isSafeInteger(fixed.deadlineMs)&&fixed.deadlineMs>0&&fixed.deadlineMs<=Date.now()+30*60_000,"invalid_reward_operator_runner");
  const deps={rpc,reader,chainId,origin,creationCode,broadcast,signal,gasPolicy:copyRewardPaymentGasPolicy(dependencies.gasPolicy)};
  const execute=runJob??(job=>runStoredRewardOperatorJob(fixedSession,actor,job,fixed,deps));
  const excludedSigners=new Set<string>();const seen=new Set<string>();const entries:Entry[]=[];
  const stopped=()=>signal?.aborted||Date.now()>=fixed.deadlineMs;
  const result=(stop:Stop)=>({programmeId:fixed.programmeId,workerId:fixed.workerId,stop,entries});
  while(entries.length<fixed.maxJobs){
    if(stopped())return result("stopped");
    let job:RewardOperatorQueueJob|null;
    try{job=await nextRewardOperatorJob(actor,{programmeId:fixed.programmeId,chainId,excludedSigners:[...excludedSigners]},rpc);}
    catch{return result("unavailable");}
    if(stopped())return result("stopped");
    if(!job)return result(entries.some(e=>attention.has(e.outcome))?"attention_required":excludedSigners.size?"signers_deferred":"queue_empty");
    // A stale replica must not turn a completed job into a hot loop or a second
    // execution. The next session re-reads authoritative state from scratch.
    if(seen.has(job.jobId))return result("unavailable");
    seen.add(job.jobId);
    let observed:WorkerResult;
    try{observed=await execute({...job});}
    catch(e){
      const c=code(e);observed={jobId:job.jobId,outcome:c==="reward_job_attempt_mismatch"?"requires_attention":"unavailable"};
    }
    if(!observed||observed.jobId!==job.jobId||!outcomes.has(observed.outcome))return result("unavailable");
    entries.push({jobId:job.jobId,kind:job.kind,outcome:observed.outcome});
    if(stopped())return result("stopped");
    if(observed.outcome==="unavailable")return result("unavailable");
    if(observed.outcome!=="confirmed")excludedSigners.add(job.signerAddress);
  }
  return result("limit_reached");
}
