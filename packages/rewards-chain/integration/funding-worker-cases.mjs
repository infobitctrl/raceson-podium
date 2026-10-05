import assert from "node:assert/strict";
import { canonicalRewardJson, encodeRewardFunding, readVerifiedRewardCampaign, verifySignedRewardFunding, rewardCampaignBuild } from "../dist/index.js";
import { queueVerifiedRewardFunding, runRewardFundingJob } from "../../../apps/api/dist/features/rewards/funding-worker.js";

// Mock DB transport for adversarial worker observations; actual locks, role checks
// and atomic receipt persistence are separately covered by real PostgreSQL.
export async function fundingWorkerFixture(chain,deployment,{nonceOffset=0n}={}) {
  const id=n=>`77000000-0000-4000-8000-${String(n).padStart(12,"0")}`;
  const {operator,publicClient,artifact,operatorClient}=chain;
  const checkpoint=await readVerifiedRewardCampaign(publicClient,deployment,artifact.bytecode.object);
  const plan={deployment,nonce:BigInt(await publicClient.getTransactionCount({address:operator.address,blockTag:"pending"}))+nonceOffset,
    expectedAccountedFunding:checkpoint.observation.accounting.accountedFunding,expectedBudget:100n};
  const signed=await operator.signTransaction({...encodeRewardFunding(plan),type:"eip1559",gas:300000n,maxFeePerGas:20000000000n,maxPriorityFeePerGas:100000000n});
  const witness=await verifySignedRewardFunding(plan,signed);
  const wire=value=>JSON.parse(canonicalRewardJson(value));
  const context={deploymentContext:{schemaVersion:1,programmeId:id(10),campaignId:id(2),environment:"local_simulation",chainId:31337,
    operatorAddress:operator.address.toLowerCase(),treasuryAddress:deployment.treasuryAddress.toLowerCase(),programmeOnChainId:deployment.programmeId,
    campaignOnChainId:deployment.campaignId,manifestHash:deployment.programmeManifestHash,pot:"race",budgetWei:"100",
    intent:{id:id(11),nonce:deployment.deploymentNonce.toString(),buildId:rewardCampaignBuild.id,creationCodeHash:rewardCampaignBuild.creationCodeHash,
      createdByUserId:id(1),createdAt:"2026-09-08T05:00:00Z",idempotencyKey:"worker-deployment"}},
    checkpoint:{campaignId:id(2),intentId:id(11),attemptId:id(12),...wire(checkpoint),observationId:id(13),observedByUserId:id(1),
      observedAt:"2026-09-08T05:00:01Z",idempotencyKey:"worker-funding-prestate"},
    intent:{id:id(3),observationId:id(13),nonce:plan.nonce.toString(),expectedAccountedFunding:plan.expectedAccountedFunding.toString(),expectedBudget:"100",
      createdByUserId:id(1),createdAt:"2026-09-08T05:00:02Z",idempotencyKey:"worker-funding-plan"}};
  let job;let sent=0;let armed=0;let confirmations=0;let loseLease=false;let expireArmResponse=false;
  const rpc=async(name,args)=>{
    assert.equal(args.p_actor_user_id,id(1));
    if(name==="service_read_reward_funding_attempt")return{data:{context,attempt:{id:id(4),intentId:id(3),body:wire(witness),recordedByUserId:id(1),
      recordedAt:"2026-09-08T05:00:03Z",idempotencyKey:"worker-funding-attempt"}},error:null};
    if(name==="service_queue_reward_funding_job")job??={jobId:id(5),campaignId:id(2),intentId:id(3),attemptId:id(4),transactionHash:witness.transactionHash,
      createdByUserId:id(1),createdAt:"2026-09-08T05:00:04Z",idempotencyKey:args.p_idempotency_key,state:"queued",mayHaveBroadcast:false,
      leaseOwner:null,leaseToken:null,leaseExpiresAt:null,leaseGeneration:0,confirmationObservationId:null};
    else if(name==="service_step_reward_funding_job"){
      if(args.p_action==="lease")job={...job,state:"leased",leaseOwner:args.p_worker_id,leaseToken:id(6),leaseGeneration:1,leaseExpiresAt:"2099-01-01T00:00:00Z"};
      else{
        if(loseLease)return{data:null,error:{message:"reward_funding_job_lease_lost"}};
        assert.equal(args.p_lease_token,id(6));
        if(args.p_action==="arm"){armed++;job.state="broadcasting";}else job.state="submitted";
        job.mayHaveBroadcast=true;
      }
    }else if(name==="service_confirm_reward_funding_job"){
      confirmations++;assert.equal(args.p_funding.transactionHash,witness.transactionHash);
      job={...job,state:"confirmed",confirmationObservationId:id(14),leaseOwner:null,leaseToken:null,leaseExpiresAt:null};
    }else assert.equal(name,"service_read_reward_funding_job");
    return{data:{...structuredClone(job),...(expireArmResponse&&args.p_action==="arm"?{leaseExpiresAt:"2020-01-01T00:00:00Z"}:{})},error:null};
  };
  const session={account:{userId:id(1)}};
  await queueVerifiedRewardFunding(session,{campaignId:id(2),intentId:id(3),attemptId:id(4),idempotencyKey:"worker-funding-queue"},rpc);
  const send=async bytes=>{assert.equal(job.state,"broadcasting");assert.equal(bytes,signed);sent++;return operatorClient.sendRawTransaction({serializedTransaction:bytes});};
  const run=(reader=publicClient,broadcast=send)=>runRewardFundingJob(session,{jobId:id(5),workerId:id(7)},{rpc,reader,broadcast,creationCode:artifact.bytecode.object});
  return{run,plan,signed,hash:witness.transactionHash,stats:()=>({sent,armed,confirmations}),loseLease:value=>{loseLease=value;},expireArm:value=>{expireArmResponse=value;}};
}
