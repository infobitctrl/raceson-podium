import assert from "node:assert/strict";
import { canonicalRewardJson,encodeRewardLifecycle,readVerifiedRewardCampaign,verifySignedRewardLifecycle,rewardCampaignBuild } from "../dist/index.js";
import { queueVerifiedRewardLifecycle,runRewardLifecycleJob } from "../../../apps/api/dist/features/rewards/lifecycle-worker.js";

// Explicit mock SQL transport for adversarial observations of a real owned chain.
// It does NOT prove database source approval, predecessor checks or locking;
// reward-lifecycle-job-scenarios and the continuous SQL/chain rehearsal do that.
export async function lifecycleWorkerFixture(chain,source,{action="upload_awards",nonceOffset=0n}={}) {
  const id=n=>`78000000-0000-4000-8000-${String(n).padStart(12,"0")}`;
  const {operator,publicClient,artifact,operatorClient}=chain;const {deployment,upload}=source;
  const checkpoint=await readVerifiedRewardCampaign(publicClient,deployment,artifact.bytecode.object);
  const plan={deployment,upload,action,nonce:BigInt(await publicClient.getTransactionCount({address:operator.address,blockTag:"pending"}))+nonceOffset,
    ...(action==="upload_awards"?{batchStart:Number(checkpoint.observation.accounting.entitlementCount),batchSize:upload.awards.length-Number(checkpoint.observation.accounting.entitlementCount)}:{})};
  const signed=await operator.signTransaction({...encodeRewardLifecycle(plan),type:"eip1559",gas:5000000n,maxFeePerGas:20000000000n,maxPriorityFeePerGas:100000000n});
  const witness=await verifySignedRewardLifecycle(plan,signed);const wire=value=>JSON.parse(canonicalRewardJson(value));
  const context={deploymentContext:{schemaVersion:1,programmeId:id(10),campaignId:id(2),environment:"local_simulation",chainId:31337,
    operatorAddress:operator.address.toLowerCase(),treasuryAddress:deployment.treasuryAddress.toLowerCase(),programmeOnChainId:deployment.programmeId,
    campaignOnChainId:deployment.campaignId,manifestHash:deployment.programmeManifestHash,pot:"race",budgetWei:upload.budgets[0].toString(),
    intent:{id:id(11),nonce:deployment.deploymentNonce.toString(),buildId:rewardCampaignBuild.id,creationCodeHash:rewardCampaignBuild.creationCodeHash,
      createdByUserId:id(1),createdAt:"2026-09-08T06:00:00Z",idempotencyKey:"worker-deployment"}},
    checkpoint:{campaignId:id(2),intentId:id(11),attemptId:id(12),...wire(checkpoint),observationId:id(13),observedByUserId:id(1),
      observedAt:"2026-09-08T06:00:01Z",idempotencyKey:"worker-lifecycle-prestate"},
    upload:{id:id(20),allocationId:id(21),preparedByUserId:id(1),preparedAt:"2026-09-08T06:00:01Z",
      body:wire({...upload,schemaVersion:1,chainId:31337,operatorAddress:operator.address.toLowerCase(),treasuryAddress:deployment.treasuryAddress.toLowerCase(),
        sourceReviewEndsAt:upload.latestPublicationAt+259200n})},
    intent:{id:id(3),observationId:id(13),nonce:plan.nonce.toString(),action,batchStart:plan.batchStart??null,batchSize:plan.batchSize??null,
      createdByUserId:id(1),createdAt:"2026-09-08T06:00:02Z",idempotencyKey:"worker-lifecycle-plan"}};
  let job;let sent=0;let armed=0;let confirmations=0;let armError=null;let expireArmResponse=false;
  const rpc=async(name,args)=>{
    assert.equal(args.p_actor_user_id,id(1));
    if(name==="service_read_reward_lifecycle_attempt")return{data:{context,attempt:{id:id(4),intentId:id(3),body:wire(witness),recordedByUserId:id(1),
      recordedAt:"2026-09-08T06:00:03Z",idempotencyKey:"worker-lifecycle-attempt"}},error:null};
    if(name==="service_queue_reward_lifecycle_job")job??={jobId:id(5),campaignId:id(2),uploadId:id(20),intentId:id(3),attemptId:id(4),transactionHash:witness.transactionHash,
      predecessorFundingJobId:action==="upload_awards"?id(22):null,predecessorLifecycleJobId:action==="upload_awards"?null:id(23),
      createdByUserId:id(1),createdAt:"2026-09-08T06:00:04Z",idempotencyKey:args.p_idempotency_key,state:"queued",mayHaveBroadcast:false,
      leaseOwner:null,leaseToken:null,leaseExpiresAt:null,leaseGeneration:0,confirmationObservationId:null};
    else if(name==="service_step_reward_lifecycle_job"){
      if(args.p_action==="lease")job={...job,state:"leased",leaseOwner:args.p_worker_id,leaseToken:id(6),leaseGeneration:1,leaseExpiresAt:"2099-01-01T00:00:00Z"};
      else{
        assert.equal(args.p_lease_token,id(6));
        if(args.p_action==="arm"){
          if(armError)return{data:null,error:{message:armError}};
          armed++;job.state="broadcasting";
        }else job.state="submitted";
        job.mayHaveBroadcast=true;
      }
    }else if(name==="service_confirm_reward_lifecycle_job"){
      confirmations++;assert.equal(args.p_lifecycle.transactionHash,witness.transactionHash);
      job={...job,state:"confirmed",mayHaveBroadcast:true,confirmationObservationId:id(14),leaseOwner:null,leaseToken:null,leaseExpiresAt:null};
    }else assert.equal(name,"service_read_reward_lifecycle_job");
    return{data:{...structuredClone(job),...(expireArmResponse&&args.p_action==="arm"?{leaseExpiresAt:"2020-01-01T00:00:00Z"}:{})},error:null};
  };
  const session={account:{userId:id(1)}};
  await queueVerifiedRewardLifecycle(session,{campaignId:id(2),uploadId:id(20),intentId:id(3),attemptId:id(4),idempotencyKey:"worker-lifecycle-queue"},rpc);
  const send=async bytes=>{assert.equal(job.state,"broadcasting");assert.equal(bytes,signed);sent++;return operatorClient.sendRawTransaction({serializedTransaction:bytes});};
  const run=(reader=publicClient,broadcast=send)=>runRewardLifecycleJob(session,{jobId:id(5),workerId:id(7)},{rpc,reader,broadcast,creationCode:artifact.bytecode.object});
  return{run,plan,signed,hash:witness.transactionHash,stats:()=>({sent,armed,confirmations}),setArmError:value=>{armError=value;},expireArm:value=>{expireArmResponse=value;}};
}
