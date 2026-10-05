import { keccak256,type Hex } from "viem";
import { createClubPaymentOperatorClientV3,rewardDocumentObject as object,rewardDocumentUuid as uuid,rewardDocumentInteger as uint,
  type RewardLedgerRpc,type RewardAccountIdentity } from "@raceson/db/rewards";
import { requireReward } from "@raceson/domain/rewards";
import { rewardDemoTarget,type RewardDemoTarget } from "@raceson/domain/rewards/environment";
import { loadClubPaymentV3 } from "./club-payment-v3-service.js";
import { runClubPaymentJobV3 } from "./club-payment-worker-v3.js";
const invalid="invalid_reward_club_payment_operator_v3";
const address=(v:unknown)=>{requireReward(typeof v==="string" && /^0x[0-9a-f]{40}$/.test(v) && BigInt(v)!==0n,invalid);return v;};
const hash=(v:unknown)=>{requireReward(typeof v==="string" && /^0x[0-9a-f]{64}$/.test(v) && BigInt(v)!==0n,invalid);return v as Hex;};
export function captureClubPaymentOperatorJobsV3(raw:unknown){
  requireReward(Array.isArray(raw) && raw.length>=1 && raw.length<=100 && Object.getOwnPropertySymbols(raw).length===0
    && Object.getOwnPropertyNames(raw).length===raw.length+1,invalid);
  const entries=Object.getOwnPropertyDescriptors(raw);
  const jobs=Array.from({length:raw.length},(_,n)=>{
    const item=entries[String(n)];requireReward(item && "value" in item,invalid);
    const j=object(item.value,["uploadId","requestId","entitlementId","claimId","paymentId","attemptId","jobId","transactionHash","recipientAddress","amountWei"]);
    const amountWei=uint(j.amountWei);requireReward(amountWei>0n,invalid);
    return{uploadId:uuid(j.uploadId),requestId:uuid(j.requestId),entitlementId:hash(j.entitlementId),claimId:uuid(j.claimId),
      paymentId:uuid(j.paymentId),attemptId:uuid(j.attemptId),jobId:uuid(j.jobId),transactionHash:hash(j.transactionHash),
      recipientAddress:address(j.recipientAddress),amountWei};
  });
  for(const field of ["claimId","paymentId","attemptId","jobId","transactionHash"] as const)
    requireReward(new Set(jobs.map(j=>j[field])).size===jobs.length,invalid);
  return jobs;
}
export type ClubPaymentOperatorInputV3={target:RewardDemoTarget;draftId:string;programmeAddress:string;operatorAddress:string;relayerAddress:string;
  operatorUserId:string;workerId:string;durationMs:number;maxGasCostWei:bigint;maxPayoutWei:bigint;jobs:unknown;
  accessToken:string;publishableKey:string;serverKey:string};
type Dependencies=Omit<Parameters<typeof runClubPaymentJobV3>[2],"rpc"|"origin"|"chainId">;
type Outcome=Awaited<ReturnType<typeof runClubPaymentJobV3>>["outcome"];

/** Delivery only. Every exact persisted attempt is checked before any lease.
 * No proof creation, signer, payment reservation, fee replacement or discovery. */
export async function runAuthenticatedClubPaymentOperatorV3(input:ClubPaymentOperatorInputV3,deps:Dependencies,
  clientFactory:typeof createClubPaymentOperatorClientV3=createClubPaymentOperatorClientV3){
  const target=rewardDemoTarget(input.target),draftId=uuid(input.draftId),operatorUserId=uuid(input.operatorUserId),workerId=uuid(input.workerId);
  const programmeAddress=address(input.programmeAddress),operatorAddress=address(input.operatorAddress),relayerAddress=address(input.relayerAddress);
  const jobs=captureClubPaymentOperatorJobsV3(input.jobs),{durationMs,maxGasCostWei,maxPayoutWei,accessToken,publishableKey,serverKey}=input;
  requireReward(target && target.chainId===input.target.chainId && Number.isSafeInteger(durationMs) && durationMs>=1000 && durationMs<=1800000
    && [maxGasCostWei,maxPayoutWei].every(n=>typeof n==="bigint"&&n>0n&&n<1n<<256n)
    && new Set([programmeAddress,operatorAddress,relayerAddress]).size===3,invalid);
  const {reader,broadcast,signal:callerSignal}=deps,controller=new AbortController();
  const signal=callerSignal?AbortSignal.any([callerSignal,controller.signal]):controller.signal;
  let deadline=Date.now()+durationMs,timer=setTimeout(()=>controller.abort(),durationMs);
  let verifiedGasCeilingWei=0n,verifiedPayoutWei=0n;
  const startedAt=new Date().toISOString(),entries:Array<{jobId:string;transactionHash:Hex;outcome:Outcome}>=[];
  const stopped=()=>signal.aborted||Date.now()>=deadline;
  const result=(stop:"jobs_confirmed"|"deferred"|"attention_required"|"unavailable"|"stopped")=>({schemaVersion:3,
    kind:"raceson-club-payment-operator-session-v3",chainId:target.chainId,draftId,programmeAddress,operatorAddress,relayerAddress,workerId,
    startedAt,finishedAt:new Date().toISOString(),maxGasCostWei:maxGasCostWei.toString(),maxPayoutWei:maxPayoutWei.toString(),
    verifiedGasCeilingWei:verifiedGasCeilingWei.toString(),verifiedPayoutWei:verifiedPayoutWei.toString(),requestedJobs:jobs.length,stop,entries});
  try{
    if(stopped())return result("stopped");
    const client=clientFactory({target,publishableKey,serverKey,signal});
    const authenticated=await client.authenticate(accessToken,operatorUserId);
    const identity:RewardAccountIdentity={userId:uuid(authenticated.identity.userId),sessionId:uuid(authenticated.identity.sessionId)};
    requireReward(identity.userId===operatorUserId && Number.isSafeInteger(authenticated.expiresAtMs),"reward_operator_auth_required");
    deadline=Math.min(deadline,authenticated.expiresAtMs-5000);clearTimeout(timer);
    if(stopped())return result("stopped");timer=setTimeout(()=>controller.abort(),deadline-Date.now());
    const rpc:RewardLedgerRpc=(method,args)=>{
      requireReward(!stopped(),"reward_runner_stopped");
      requireReward(args.p_actor_user_id===identity.userId && args.p_actor_session_id===identity.sessionId && args.p_chain_id===target.chainId
        && jobs.some(j=>args.p_upload_id===j.uploadId&&args.p_request_id===j.requestId&&args.p_entitlement_id===j.entitlementId
          && args.p_claim_id===j.claimId&&args.p_payment_id===j.paymentId)
        && ["service_read_reward_club_payment_v3","service_change_reward_club_payment_v3"].includes(method)
        && (method!=="service_change_reward_club_payment_v3" || ["lease","arm","submitted","confirm"].includes(args.p_action as string)),
      "reward_job_attempt_mismatch");return client.rpc(method,args);
    };
    const scope=(job:typeof jobs[number])=>({...job,chainId:target.chainId,workerId});
    let previousNonce=-1n;
    try{
      for(const job of jobs){
        if(stopped())return result("stopped");
        const loaded=await loadClubPaymentV3(identity,scope(job),{rpc,reader,origin:target.origin,chainId:target.chainId}),a=loaded.attempt,j=loaded.context.job,p=loaded.plan;
        requireReward(a && j?.jobId===job.jobId && j.attemptId===job.attemptId && j.transactionHash===job.transactionHash
          && a.transactionHash===job.transactionHash && a.relayerAddress===relayerAddress && a.nonce>previousNonce
          && loaded.context.claimContext.readiness.source.draftId===draftId && p.expectation.programme.context.verifyingContract.toLowerCase()===programmeAddress
          && p.expectation.programme.operatorAddress.toLowerCase()===operatorAddress && p.claim.recipient.toLowerCase()===job.recipientAddress
          && p.claim.amount===job.amountWei,"reward_job_attempt_mismatch");
        previousNonce=a.nonce;verifiedGasCeilingWei+=a.gasLimit*a.maxFeePerGas;verifiedPayoutWei+=p.claim.amount;
        requireReward(verifiedGasCeilingWei<=maxGasCostWei&&verifiedPayoutWei<=maxPayoutWei,"reward_operator_spending_limit");
      }
    }catch(error){if(stopped())return result("stopped");const code=error&&typeof error==="object"&&"code" in error?error.code:null;
      return result(["reward_job_attempt_mismatch","reward_operator_spending_limit"].includes(String(code))?"attention_required":"unavailable");}
    for(const job of jobs){
      if(stopped())return result("stopped");let outcome:Outcome;
      try{const r=await runClubPaymentJobV3(identity,scope(job),{rpc,reader,origin:target.origin,chainId:target.chainId,signal,broadcast:bytes=>{
        requireReward(!stopped(),"reward_runner_stopped");requireReward(keccak256(bytes)===job.transactionHash,"reward_job_attempt_mismatch");return broadcast(bytes);
      }});requireReward(r.jobId===job.jobId,"reward_job_attempt_mismatch");outcome=r.outcome;}catch{outcome="unavailable";}
      entries.push({jobId:job.jobId,transactionHash:job.transactionHash,outcome});
      if(stopped())return result("stopped");
      if(outcome!=="confirmed")return result(outcome==="requires_attention"?"attention_required":outcome==="unavailable"?"unavailable":"deferred");
    }
    return result("jobs_confirmed");
  }finally{clearTimeout(timer);controller.abort();}
}
