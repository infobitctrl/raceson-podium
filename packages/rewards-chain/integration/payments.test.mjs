import assert from "node:assert/strict";
import {before,after,test} from "node:test";
import {encodeRewardAthletePayment,verifySignedRewardAthletePayment,readVerifiedRewardAthletePayment,rewardAthletePaymentFromObservation,
  rewardClaimMessages,rewardCampaignAbi,readVerifiedRewardCampaign,encodeRewardLifecycle} from "../dist/index.js";
import {proposalFor,h} from "../test/fixtures.mjs";
import {startOwnedRewardChain,fixtureSigner} from "./owned-chain.mjs";

let chain,main;const athlete=fixtureSigner(996);const finalize=()=>chain.testClient.mine({blocks:96,interval:1});
async function receipt(hash,status="success"){const r=await chain.publicClient.waitForTransactionReceipt({hash,timeout:10000});assert.equal(r.status,status);return r;}
const read=(entry=main,reader=chain.publicClient)=>readVerifiedRewardAthletePayment(reader,entry.plan,entry.signed,chain.artifact.bytecode.object);
async function invoke(name,args=[],value=0n){return receipt(await chain.operatorClient.writeContract({address:main.plan.deployment.context.verifyingContract,abi:rewardCampaignAbi,functionName:name,args,value}));}
async function lifecycle(action){
  const nonce=BigInt(await chain.publicClient.getTransactionCount({address:chain.operator.address,blockTag:"pending"}));
  const plan={...main.plan,nonce,action,...(action==="upload_awards"?{batchStart:0,batchSize:main.plan.upload.awards.length}:{})};
  return receipt(await chain.operatorClient.sendTransaction({...encodeRewardLifecycle(plan),gas:5000000n}));
}
before(async()=>{
  chain=await startOwnedRewardChain();const {operatorClient,operator,treasury,artifact,publicClient,relayer}=chain;
  const upload=proposalFor();const deployed=await receipt(await operatorClient.deployContract({abi:rewardCampaignAbi,bytecode:artifact.bytecode.object,
    args:[operator.address,treasury,upload.programmeId,upload.campaignId,upload.programmeManifestHash,upload.enabledPot]}));
  const deploymentTx=await publicClient.getTransaction({hash:deployed.transactionHash});
  const deployment={context:{environment:"local-simulation",chainId:31337,verifyingContract:deployed.contractAddress},operatorAddress:operator.address,
    treasuryAddress:treasury,programmeId:upload.programmeId,campaignId:upload.campaignId,programmeManifestHash:upload.programmeManifestHash,
    enabledPot:0,deploymentNonce:BigInt(deploymentTx.nonce),deploymentTransactionHash:deployed.transactionHash};
  main={plan:{deployment,upload}};
  await invoke("completeFunding",[0n,upload.budgets[0]],upload.budgets[0]);
  await lifecycle("upload_awards");
  await lifecycle("stage_allocation");
  const at=await publicClient.readContract({address:deployed.contractAddress,abi:rewardCampaignAbi,functionName:"activationNotBefore"});
  await chain.testClient.setNextBlockTimestamp({timestamp:at});await finalize();await lifecycle("activate");await finalize();
  const block=await publicClient.getBlock({blockTag:"finalized"});const award=upload.awards.find(a=>a.beneficiaryKind===0);
  const claim={entitlementId:award.entitlementId,recipient:athlete.address,amount:award.amount,pot:"race",nonce:0n,issuedAt:block.timestamp,
    expiresAt:block.timestamp+86400n,allocationDigest:upload.allocationDigest};const messages=rewardClaimMessages(deployment.context,claim);
  main.plan={deployment,upload,claim,proofs:{operator:await operator.signTypedData(messages.authorization),recipient:await athlete.signTypedData(messages.consent)},
    relayerAddress:relayer.address,nonce:0n};
  main.signed=await relayer.signTransaction({...encodeRewardAthletePayment(main.plan),type:"eip1559",gas:500000n,maxFeePerGas:20000000000n,maxPriorityFeePerGas:100000000n});
  main.attempt=await verifySignedRewardAthletePayment(main.plan,main.signed);
  main.receipt=await receipt(await chain.relayerClient.sendRawTransaction({serializedTransaction:main.signed}));await finalize();
},{timeout:30000});
after(async()=>{await chain?.stop();});

test("exact relayer-signed payment proves one award, incremented authorization nonce and untouched other reserves",async()=>{
  const result=await read();const p=result.payment;assert.equal(p.transactionHash,main.attempt.transactionHash);
  assert.equal(p.amount,main.plan.claim.amount);assert.equal(p.nonce,0n);assert.equal(p.authorizationNonce,0n);
  assert.equal(p.gasLimit,main.attempt.gasLimit);assert.equal(p.monadGasLimitFee,p.gasLimit*p.effectiveGasPrice);
  assert.equal(await chain.publicClient.getBalance({address:athlete.address}),p.amount);
  assert.equal(await chain.publicClient.getTransactionCount({address:athlete.address}),0);
  assert.equal(result.checkpoint.observation.accounting.nativeBalance+p.amount,main.plan.upload.budgets[0]);
  assert.deepEqual(result.checkpoint.observation.accounting.paid,[p.amount,0n]);
  const nonce=await chain.publicClient.getTransactionCount({address:chain.relayer.address});assert.deepEqual(await read(),result);
  assert.equal(await chain.publicClient.getTransactionCount({address:chain.relayer.address}),nonce);
});
test("payment receipt rejects altered complete events, sender, input, provenance, finality and gas fields",async()=>{
  const {publicClient}=chain;const hash=main.attempt.transactionHash;const f=await publicClient.getBlock({blockTag:"finalized"});
  const b=await publicClient.getBlock({blockNumber:main.receipt.blockNumber});
  const observed={observedChainId:31337,transaction:await publicClient.getTransaction({hash}),receipt:main.receipt,
    canonicalPaymentBlock:{number:b.number,hash:b.hash,timestamp:b.timestamp},finalizedBlock:{number:f.number,hash:f.hash,timestamp:f.timestamp},
    runtimeCode:await publicClient.getCode({address:main.plan.deployment.context.verifyingContract,blockNumber:f.number})};
  assert.equal(rewardAthletePaymentFromObservation(main.plan,hash,observed).transactionHash,hash);
  for(const mutate of [o=>{o.receipt.status="reverted";},o=>{o.transaction.hash=h("wrong");},o=>{o.receipt.transactionHash=h("wrong");},
    o=>{o.transaction.from=chain.operator.address;},o=>{o.receipt.from=chain.operator.address;},o=>{o.receipt.to=athlete.address;},
    o=>{o.transaction.nonce++;},o=>{o.transaction.value=1n;},o=>{o.transaction.input+="00";},o=>{o.receipt.contractAddress=athlete.address;},
    o=>{o.receipt.transactionIndex++;},o=>{o.transaction.chainId=143;},o=>{o.observedChainId=143;},
    o=>{o.canonicalPaymentBlock.hash=h("wrong");},o=>{o.canonicalPaymentBlock.timestamp=main.plan.claim.expiresAt;},
    o=>{o.finalizedBlock.number=o.receipt.blockNumber-1n;},o=>{o.runtimeCode=`${o.runtimeCode.slice(0,-2)}00`;},
    o=>{o.receipt.logs=[];},o=>{o.receipt.logs.push(o.receipt.logs[0]);},o=>{o.receipt.logs[0].removed=true;},
    o=>{o.receipt.logs[0].transactionIndex++;},o=>{o.receipt.logs[0].data+="00";},o=>{o.receipt.logs[0].topics.push(h("extra"));},
    o=>{o.receipt.logs[0].topics[2]=h("wrong recipient");},o=>{o.receipt.logs[0].logIndex=null;},o=>{o.receipt.logs[0].address=chain.treasury;},
    o=>{o.receipt.gasUsed=o.transaction.gas+1n;},o=>{o.receipt.effectiveGasPrice=o.transaction.maxFeePerGas+1n;}]){
    const copy=structuredClone(observed);mutate(copy);assert.throws(()=>rewardAthletePaymentFromObservation(main.plan,hash,copy));
  }
});
test("payment reader rejects mutated signed transaction fields, paid row, RPC drift and provider errors",async()=>{
  for(const mutate of [tx=>{tx.gas++;},tx=>{tx.maxFeePerGas++;},tx=>{tx.r=h("other signature");},
    tx=>{tx.r=` ${tx.r}`;},tx=>{tx.s=`0x${"a".repeat(65)}`;},tx=>{tx.yParity=1-tx.yParity;}]){
    const reader={...chain.publicClient,getTransaction:async args=>{const tx=await chain.publicClient.getTransaction(args);if(args.hash===main.attempt.transactionHash)mutate(tx);return tx;}};
    await assert.rejects(read(main,reader),{code:"reward_payment_signed_transaction_mismatch"});
  }
  const badRow={...chain.publicClient,readContract:async args=>{const row=await chain.publicClient.readContract(args);return args.functionName==="entitlements"?[row[0],row[1],row[2],0n,...row.slice(4)]:row;}};
  await assert.rejects(read(main,badRow),{code:"reward_payment_award_mismatch"});
  let blocks=0;const drift={...chain.publicClient,getBlock:async args=>{const b=await chain.publicClient.getBlock(args);
    return args.blockNumber===main.receipt.blockNumber&&++blocks===2?{...b,hash:h("drift")}:b;}};
  await assert.rejects(read(main,drift),{code:"reward_chain_changed_during_observation"});
  let networks=0;await assert.rejects(read(main,{...chain.publicClient,getChainId:async()=>++networks===4?143:31337}),{code:"reward_observed_chain_mismatch"});
  const broken={...chain.publicClient,getTransactionReceipt:async args=>{if(args.hash===main.attempt.transactionHash)throw new Error("private provider diagnostic");return chain.publicClient.getTransactionReceipt(args);}};
  await assert.rejects(read(main,broken),error=>error.code==="reward_payment_observation_unavailable"&&!String(error).includes("diagnostic"));
});
test("absent and reverted signed attempts cannot borrow an earlier successful claim receipt",async()=>{
  const plan={...main.plan,nonce:1n};const signed=await chain.relayer.signTransaction({...encodeRewardAthletePayment(plan),type:"eip1559",gas:500000n,
    maxFeePerGas:20000000000n,maxPriorityFeePerGas:100000000n});
  await assert.rejects(read({plan,signed}),{code:"reward_payment_observation_unavailable"});
  await receipt(await chain.relayerClient.sendRawTransaction({serializedTransaction:signed}),"reverted");await finalize();
  await assert.rejects(read({plan,signed}),{code:"reward_payment_reverted"});
  assert.equal((await read()).payment.amount,main.plan.claim.amount);
});
test("a later expired approval, paused vault or closed treasury does not erase the exact historical payment",async()=>{
  await invoke("pause");await finalize();assert.equal((await read()).checkpoint.observation.accounting.paused,true);
  await invoke("resume");await finalize();
  await chain.testClient.setNextBlockTimestamp({timestamp:main.plan.claim.expiresAt+1n});await finalize();
  assert.equal((await read()).payment.amount,main.plan.claim.amount);
  const cp=await readVerifiedRewardCampaign(chain.publicClient,main.plan.deployment,chain.artifact.bytecode.object);
  await chain.testClient.setNextBlockTimestamp({timestamp:cp.observation.accounting.claimDeadline});await finalize();await invoke("close");await invoke("returnToTreasury");await finalize();
  const closed=await read();assert.equal(closed.checkpoint.observation.accounting.state,4);assert.equal(closed.checkpoint.observation.accounting.nativeBalance,0n);
  assert.equal(closed.payment.amount,main.plan.claim.amount);
});
