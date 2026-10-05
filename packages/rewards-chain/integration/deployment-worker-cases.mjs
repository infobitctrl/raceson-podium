import assert from "node:assert/strict";
import { getContractAddress, TransactionNotFoundError } from "viem";
import { canonicalRewardJson, encodeRewardDeployment, rewardCampaignBuild, verifySignedRewardDeployment } from "../dist/index.js";
import { queueVerifiedRewardDeployment, runRewardDeploymentJob } from "../../../apps/api/dist/features/rewards/deployment-worker.js";
import { h } from "../test/fixtures.mjs";

// Explicitly mocked DB RPC plus the owned real local chain. SQL locking and
// fencing are separately exercised by the disposable PostgreSQL suite.
export async function deploymentWorkerCases({t,artifact,publicClient,testClient,operatorClient,operator,treasury}){
  const id=n=>`76000000-0000-4000-8000-${String(n).padStart(12,"0")}`;
  const nonce=BigInt(await publicClient.getTransactionCount({address:operator.address,blockTag:"pending"}));
  const address=getContractAddress({from:operator.address,nonce});
  const spec={context:{environment:"local-simulation",chainId:31337,verifyingContract:address},operatorAddress:operator.address,treasuryAddress:treasury,
    programmeId:h("worker programme"),campaignId:h("worker campaign"),programmeManifestHash:h("worker manifest"),enabledPot:0};
  const signed=await operator.signTransaction({type:"eip1559",chainId:31337,nonce:Number(nonce),gas:5000000n,maxFeePerGas:10000000000n,
    maxPriorityFeePerGas:100000000n,value:0n,data:encodeRewardDeployment(spec,artifact.bytecode.object)});
  const witness=await verifySignedRewardDeployment({...spec,network:spec.context,nonce},signed);
  const context={schemaVersion:1,programmeId:id(6),campaignId:id(2),environment:"local_simulation",chainId:31337,operatorAddress:operator.address.toLowerCase(),
    treasuryAddress:treasury.toLowerCase(),programmeOnChainId:spec.programmeId,campaignOnChainId:spec.campaignId,manifestHash:spec.programmeManifestHash,pot:"race",budgetWei:"100",
    intent:{id:id(3),nonce:nonce.toString(),buildId:rewardCampaignBuild.id,creationCodeHash:rewardCampaignBuild.creationCodeHash,createdByUserId:id(1),
      createdAt:"2026-09-08T03:30:00Z",idempotencyKey:"worker-plan"}};
  const session={account:{userId:id(1)}}; let job; const checkpoints=new Map(); let sent=0; let armed=0; let loseLease=false;let expireArmResponse=false;
  const rpc=async(name,args)=>{
    assert.equal(args.p_actor_user_id,id(1));
    if(name==="service_read_reward_deployment_attempt")return{data:{context,attempt:{id:id(4),intentId:id(3),body:JSON.parse(canonicalRewardJson(witness)),
      recordedByUserId:id(1),recordedAt:"2026-09-08T03:30:01Z",idempotencyKey:"worker-signed"}},error:null};
    if(name==="service_queue_reward_deployment_job"){
      job??={jobId:id(5),campaignId:id(2),intentId:id(3),attemptId:id(4),transactionHash:witness.transactionHash,createdByUserId:id(1),
        createdAt:"2026-09-08T03:30:02Z",idempotencyKey:args.p_idempotency_key,state:"queued",mayHaveBroadcast:false,
        leaseOwner:null,leaseToken:null,leaseExpiresAt:null,leaseGeneration:0,confirmationObservationId:null};
      return{data:structuredClone(job),error:null};
    }
    if(name==="service_read_reward_deployment_job")return{data:structuredClone(job),error:null};
    if(name==="service_step_reward_deployment_job"){
      if(job.state==="confirmed")return{data:structuredClone(job),error:null};
      if(args.p_action==="lease"){
        if(job.leaseExpiresAt && Date.parse(job.leaseExpiresAt)>Date.now()) return{data:job.leaseOwner===args.p_worker_id?structuredClone(job):null,error:null};
        job={...job,state:"leased",leaseOwner:args.p_worker_id,leaseToken:id(100+job.leaseGeneration),leaseGeneration:job.leaseGeneration+1,
          leaseExpiresAt:new Date(Date.now()+60000).toISOString()};
      }else{
        if(loseLease || args.p_lease_token!==job.leaseToken || args.p_worker_id!==job.leaseOwner)return{data:null,error:{message:"reward_deployment_job_lease_lost"}};
        if(args.p_action==="arm"){armed++;job.state="broadcasting";job.mayHaveBroadcast=true;}
        if(args.p_action==="submitted"){job.state="submitted";job.mayHaveBroadcast=true;}
        if(args.p_action==="confirm"){
          assert(checkpoints.size>0,"Only a persisted finalized observation may confirm the job");
          job={...job,state:"confirmed",confirmationObservationId:id(7),leaseOwner:null,leaseToken:null,leaseExpiresAt:null};
        }
      }
      return{data:{...structuredClone(job),...(expireArmResponse&&args.p_action==="arm"?{leaseExpiresAt:"2020-01-01T00:00:00Z"}:{})},error:null};
    }
    if(name==="service_read_reward_campaign_checkpoint")return{data:structuredClone(checkpoints.get(args.p_idempotency_key)??null),error:null};
    if(name==="service_record_reward_campaign_checkpoint"){
      const value={campaignId:id(2),intentId:id(3),attemptId:id(4),deployment:args.p_deployment,observation:args.p_observation,
        observationId:id(7),observedByUserId:id(1),observedAt:"2026-09-08T03:30:03Z",idempotencyKey:args.p_idempotency_key};
      checkpoints.set(args.p_idempotency_key,value);return{data:structuredClone(value),error:null};
    }
    assert.fail(`Unexpected worker RPC ${name}`);
  };
  const broadcast=async(bytes)=>{assert.equal(job.state,"broadcasting");assert.equal(job.mayHaveBroadcast,true);assert.equal(bytes,signed);sent++;
    return operatorClient.sendRawTransaction({serializedTransaction:bytes});};
  const run=(reader=publicClient,sender=broadcast,workerId=id(8))=>runRewardDeploymentJob(session,{jobId:id(5),workerId},{rpc,reader,broadcast:sender,creationCode:artifact.bytecode.object});
  await queueVerifiedRewardDeployment(session,{campaignId:id(2),intentId:id(3),attemptId:id(4),idempotencyKey:"worker-job"},rpc);
  await t.test("worker fails closed on wrong chain, unavailable RPC, missing earlier nonces and occupied nonce slots",async()=>{
    assert.equal((await run({...publicClient,getChainId:async()=>143})).outcome,"unavailable");
    assert.equal((await run({...publicClient,getTransaction:async()=>{throw new Error("credential-bearing RPC failure");}})).outcome,"unavailable");
    for(const malformed of [undefined,null,{}, {hash:witness.transactionHash,from:null}]){
      assert.equal((await run({...publicClient,getTransaction:async()=>malformed})).outcome,"requires_attention");
    }
    const missing={...publicClient,getTransaction:async()=>{throw new TransactionNotFoundError({hash:witness.transactionHash});}};
    assert.equal((await run({...missing,getTransactionCount:async()=>Number(nonce)-1})).outcome,"awaiting_nonce");
    assert.equal((await run({...missing,getTransactionCount:async()=>Number(nonce)+1})).outcome,"nonce_conflict");
    assert.equal((await run(publicClient,broadcast,id(9))).outcome,"busy");
    loseLease=true;await assert.rejects(run(),{code:"reward_deployment_job_lease_lost"});loseLease=false;
    assert.equal(sent,0);assert.equal(armed,0);
  });
  await t.test("deployment worker cannot send when the final arm response arrives after lease expiry",async()=>{
    expireArmResponse=true;try{assert.equal((await run()).outcome,"busy");assert.equal(sent,0);}finally{expireArmResponse=false;}
  });
  await t.test("broadcast response loss retains the armed attempt and receipt recovery never sends another transaction",async()=>{
    await testClient.setAutomine(false);
    const lost=await run(publicClient,async(bytes)=>{await broadcast(bytes);throw new Error("simulated response loss after real local send");});
    assert.equal(lost.outcome,"broadcast_unknown");assert.equal(sent,1);assert.equal(job.mayHaveBroadcast,true);assert.equal(job.state,"broadcasting");
    assert.doesNotMatch(JSON.stringify(lost),/signedTransaction|leaseToken|privateKey/);
    assert.equal((await run()).outcome,"pending");assert.equal(sent,1);
    await testClient.setAutomine(true);
    await testClient.mine({blocks:96,interval:1});
    job.leaseExpiresAt=new Date(Date.now()-1000).toISOString();
    const recovered=await run(publicClient,broadcast,id(9));assert.equal(recovered.outcome,"confirmed");assert.equal(job.leaseGeneration,2);assert.equal(sent,1);
    assert.equal(checkpoints.size,1);assert.equal(job.leaseToken,null);
    assert.equal((await run()).outcome,"confirmed");assert.equal(sent,1);
    assert.equal((await publicClient.getTransactionCount({address:operator.address})),Number(nonce)+1,"Only one operator nonce was consumed");
  });
}
