import assert from "node:assert/strict";
import { getContractAddress } from "viem";
import { canonicalRewardJson, encodeRewardDeployment, readVerifiedRewardCampaign, rewardCampaignAbi, rewardCampaignBuild,
  verifySignedRewardDeployment } from "../dist/index.js";
import { observeVerifiedRewardCampaign } from "../../../apps/api/dist/features/rewards/campaign-checkpoint-service.js";
import { h } from "../test/fixtures.mjs";

// Owned loopback chain and synthetic signatures. RPC below is an explicit mock
// database transport; real SQL persistence/concurrency is exercised separately.
export async function campaignCheckpointCases({t,artifact,publicClient,testClient,operatorClient,operator,treasury,receipt}) {
  const nonce=BigInt(await publicClient.getTransactionCount({address:operator.address,blockTag:"pending"}));
  const address=getContractAddress({from:operator.address,nonce});
  const spec={context:{environment:"local-simulation",chainId:31337,verifyingContract:address},operatorAddress:operator.address,
    treasuryAddress:treasury,programmeId:h("checkpoint programme"),campaignId:h("checkpoint campaign"),programmeManifestHash:h("checkpoint manifest"),enabledPot:0};
  const signedTransaction=await operator.signTransaction({type:"eip1559",chainId:31337,nonce:Number(nonce),gas:5000000n,
    maxFeePerGas:10000000000n,maxPriorityFeePerGas:100000000n,value:0n,data:encodeRewardDeployment(spec,artifact.bytecode.object)});
  const witness=await verifySignedRewardDeployment({...spec,network:spec.context,nonce},signedTransaction);
  await receipt(await operatorClient.sendRawTransaction({serializedTransaction:signedTransaction}));
  const expected={...spec,deploymentNonce:nonce,deploymentTransactionHash:witness.transactionHash};
  const id=n=>`78000000-0000-4000-8000-${String(n).padStart(12,"0")}`;
  const session={account:{userId:id(1)}}; const base={campaignId:id(2),intentId:id(3),attemptId:id(4)};
  const context={schemaVersion:1,programmeId:id(5),campaignId:id(2),environment:"local_simulation",chainId:31337,
    operatorAddress:operator.address.toLowerCase(),treasuryAddress:treasury.toLowerCase(),programmeOnChainId:spec.programmeId,
    campaignOnChainId:spec.campaignId,manifestHash:spec.programmeManifestHash,pot:"race",budgetWei:"100",
    intent:{id:id(3),nonce:nonce.toString(),buildId:rewardCampaignBuild.id,creationCodeHash:rewardCampaignBuild.creationCodeHash,
      createdByUserId:id(1),createdAt:"2026-09-08T03:00:00Z",idempotencyKey:"checkpoint-deploy"}};
  const stored=new Map(); let writes=0; let corruptRead=false; let mutateCaller;
  const rpc=async(name,args)=>{
    assert.equal(args.p_campaign_id,id(2)); assert.equal(args.p_actor_user_id,id(1));
    if(mutateCaller){const callback=mutateCaller; mutateCaller=null; callback();}
    if(name==="service_read_reward_deployment_attempt") {
      assert.equal(args.p_intent_id,id(3)); assert.equal(args.p_attempt_id,id(4));
      return {data:{context:structuredClone(context),attempt:{id:id(4),intentId:id(3),body:JSON.parse(canonicalRewardJson(witness)),
        recordedByUserId:id(1),recordedAt:"2026-09-08T03:00:01Z",idempotencyKey:"checkpoint-attempt"}},error:null};
    }
    if(name==="service_read_reward_campaign_checkpoint") {
      const data=structuredClone(stored.get(args.p_idempotency_key)??null);
      if(corruptRead && data) data.deployment.deploymentTransactionHash=h("substituted persisted receipt");
      return {data,error:null};
    }
    if(name==="service_record_reward_campaign_checkpoint") {
      assert.equal(args.p_intent_id,id(3)); assert.equal(args.p_attempt_id,id(4)); writes++;
      const data={...base,deployment:args.p_deployment,observation:args.p_observation,observationId:id(100+writes),
        observedByUserId:id(1),observedAt:"2026-09-08T03:00:02Z",idempotencyKey:args.p_idempotency_key};
      stored.set(args.p_idempotency_key,structuredClone(data)); return {data:structuredClone(data),error:null};
    }
    assert.fail(`Unexpected checkpoint RPC ${name}`);
  };
  const observe=key=>observeVerifiedRewardCampaign(session,{...base,idempotencyKey:key},{rpc,reader:publicClient,creationCode:artifact.bytecode.object});
  const mine=()=>testClient.mine({blocks:96,interval:1});
  const write=async(functionName,value)=>receipt(await operatorClient.writeContract({address,abi:rewardCampaignAbi,functionName,value}));
  await mine();
  await t.test("worker saves exact mined signed-attempt identity and historical retries perform no chain reads",async()=>{
    const first=await observe("checkpoint-initial"); assert.equal(first.reused,false); assert.equal(writes,1);
    assert.equal(first.checkpoint.deployment.deploymentTransactionHash,witness.transactionHash);
    assert.equal(first.funding.deposited,0n); assert.equal(first.funding.shortfall,100n);
    assert.doesNotMatch(canonicalRewardJson(first),/signedTransaction|privateKey|sourceSnapshot/);
    const reader=new Proxy({}, {get(){throw new Error("Historical retry must not read network");}});
    const old=await observeVerifiedRewardCampaign(session,{...base,idempotencyKey:"checkpoint-initial"},{rpc,reader,creationCode:artifact.bytecode.object});
    assert.equal(old.reused,true); assert.deepEqual(old.checkpoint,first.checkpoint); assert.equal(writes,1);
    corruptRead=true; await assert.rejects(observe("checkpoint-initial"),{code:"reward_stored_campaign_checkpoint_mismatch"}); corruptRead=false;
    const callerSession=structuredClone(session); const input={...base,idempotencyKey:"checkpoint-copied"};
    const dependencies={rpc,reader:publicClient,creationCode:artifact.bytecode.object};
    mutateCaller=()=>{callerSession.account.userId=id(99); input.campaignId=id(99); input.idempotencyKey="mutated-checkpoint"; dependencies.reader=reader; dependencies.creationCode="0x";};
    const copied=await observeVerifiedRewardCampaign(callerSession,input,dependencies);
    assert.equal(copied.checkpoint.campaignId,id(2)); assert.equal(copied.checkpoint.idempotencyKey,"checkpoint-copied");
  });
  await t.test("partial deposits and synthetic forced balance stay separate; only the exact closed budget matches",async()=>{
    await write("fund",40n); await testClient.setBalance({address,value:140n}); await mine();
    const partial=await observe("checkpoint-partial");
    assert.equal(partial.funding.deposited,40n); assert.equal(partial.funding.shortfall,60n); assert.equal(partial.funding.forcedSurplus,100n);
    assert.equal(partial.funding.fixedBudgetMatches,false); assert.equal(partial.funding.fundingClosed,false);
    await write("fund",60n); await write("closeFunding"); await mine();
    const complete=await observe("checkpoint-review");
    assert.equal(complete.funding.fixedBudgetMatches,true); assert.equal(complete.funding.state,1); assert.equal(complete.funding.remainingAccounted,100n);
    assert.equal(complete.funding.forcedSurplus,100n);
  });
  await t.test("accounting calls use one finalized block and reject RPC errors, inconsistent state and post-read drift",async()=>{
    const calls=[]; const reader={...publicClient,async readContract(args){calls.push(args); return publicClient.readContract(args);},
      async getBalance(args){calls.push(args); return publicClient.getBalance(args);}};
    const observed=await readVerifiedRewardCampaign(reader,expected,artifact.bytecode.object);
    assert.equal(calls.length,18); assert(calls.every(call=>call.blockNumber===observed.observation.finalizedBlock.number && call.address===address));
    await assert.rejects(readVerifiedRewardCampaign({...publicClient,readContract:async()=>{throw new Error("credential-bearing RPC URL");}},expected,artifact.bytecode.object),
      e=>e.code==="reward_campaign_observation_unavailable" && e.cause===undefined && !e.stack.includes("credential-bearing"));
    await assert.rejects(readVerifiedRewardCampaign({...publicClient,getBalance:async()=>99n},expected,artifact.bytecode.object),{code:"reward_accounting_balance_shortfall"});
    await assert.rejects(readVerifiedRewardCampaign({...publicClient,readContract:args=>args.functionName==="state"?7:publicClient.readContract(args)},expected,artifact.bytecode.object),{code:"invalid_reward_accounting"});
    let accountingStarted=false;
    await assert.rejects(readVerifiedRewardCampaign({...publicClient,getChainId:async()=>accountingStarted?143:31337,
      readContract(args){accountingStarted=true; return publicClient.readContract(args);}},expected,artifact.bytecode.object),{code:"reward_observed_chain_mismatch"});
    accountingStarted=false;
    await assert.rejects(readVerifiedRewardCampaign({...publicClient,async getBlock(args){const block=await publicClient.getBlock(args);
      return accountingStarted && args.blockNumber!==undefined?{...block,hash:h("changed accounting checkpoint")}:block;},
      readContract(args){accountingStarted=true; return publicClient.readContract(args);}},expected,artifact.bytecode.object),{code:"reward_chain_changed_during_observation"});
  });
  await t.test("cancelled treasury return preserves deposit history and reports zero remaining accounted funds",async()=>{
    await write("cancel"); await write("returnToTreasury"); await mine();
    const returned=await observe("checkpoint-returned");
    assert.equal(returned.funding.state,5); assert.equal(returned.funding.deposited,100n); assert.equal(returned.funding.remainingAccounted,0n);
    assert.equal(returned.checkpoint.observation.accounting.treasuryReturned,100n); assert.equal(returned.funding.forcedSurplus,100n);
  });
}
