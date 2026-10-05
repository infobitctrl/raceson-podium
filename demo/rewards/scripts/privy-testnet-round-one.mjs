import assert from "node:assert/strict";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { createPublicClient, http } from "viem";
import { monadTestnet } from "viem/chains";
import { privyPilotIdV3 as id } from "@raceson/domain/rewards/privy-testnet-pilot-v3";
import { readAllocationUploadV3, rewardHistoricalSourceV3, rewardRoundPublicationV3,
  readProgrammeLifecycleV3, readProgrammeExecutionStatusV3 } from "@raceson/db/rewards";
import { encodeRewardProgrammeLifecycleV3 } from "@raceson/rewards-chain/programme-lifecycle-v3";
import { allocationApprovalV3 } from "../../../apps/api/dist/features/rewards/allocation-approval-v3-service.js";
import { allocationUploadV3 } from "../../../apps/api/dist/features/rewards/allocation-upload-v3-service.js";
import { prepareProgrammeLifecycleV3, recordSignedProgrammeLifecycleV3 } from "../../../apps/api/dist/features/rewards/programme-lifecycle-v3-service.js";
import { queueVerifiedProgrammeLifecycleV3, runProgrammeLifecycleJobV3 } from "../../../apps/api/dist/features/rewards/programme-lifecycle-worker-v3.js";
import { acquireTestnetRead } from "../../../apps/api/dist/features/rewards/testnet-read-pacing.js";
import { preparePrivyProgramme, privyProgrammeSourceDigest } from "./privy-testnet-programme.mjs";
import { root, assertLocalStack } from "./local-demo.mjs";
import { localOrganizer } from "./programme-local-rehearsal.mjs";
import { openCanaryJournal } from "./canary-journal.mjs";
import { loadTestnetOperatorAccount } from "./testnet-wallets.mjs";

export const privyRoundOne = Object.freeze({ chainId: 10143, draftId: id(52), slot: 1,
  programmeAddress: "0x3427f256dfd29390641956ea9782031846281abc",
  campaignAddress: "0x176ac58c30e545057c5ece40e01cc18f639700b1",
  deploymentTransactionHash: "0x9d86a90a58df56af857e472e57f907fb150bce259bdf33066f31e67d2d025a98" });
export function privyTrialReader() {
  return createPublicClient({ chain: monadTestnet, cacheTime: 0, transport: http("https://testnet-rpc.monad.xyz", {
    retryCount: 0, timeout: 10000, fetchFn: async (input, init) => {
      const method=JSON.parse(init.body).method;
      const release=method==="eth_sendRawTransaction" ? null : await acquireTestnetRead(init.signal ?? new AbortController().signal);
      try { return await fetch(input, { ...init, redirect: "error", credentials: "omit" }); }
      finally { release?.(); }
    } }) });
}
export async function preparePrivyRoundOne(session, reader, active=()=>{}) {
  const { identity, rpc }=session, scope=privyRoundOne;
  const { prepared, current }=await preparePrivyProgramme(session,reader,active);
  assert.equal(prepared.plan.context.verifyingContract.toLowerCase(),scope.programmeAddress);
  let history=await rewardHistoricalSourceV3(identity,10143,scope.draftId,undefined,rpc);
  const old=history.decisions.find(d=>d.slot===1);assert.notEqual(old?.decision,"held");
  if(!old?.current) { active(); history=await rewardHistoricalSourceV3(identity,10143,scope.draftId,{requestId:id(801001),
    slot:1,expectedReviewId:old?.id??null,contextHash:history.contextHash,decision:"confirmed_final"},rpc); }
  assert.equal(history.source.kind,"synthetic_rehearsal");
  let approval=await allocationApprovalV3(identity,scope,undefined,{rpc,reader});
  if(!approval.approval) { assert.deepEqual(approval.reasons,[]);active();
    approval=await allocationApprovalV3(identity,scope,{requestId:id(801002),expectedApprovalId:null,
      contextHash:approval.contextHash,documentHash:approval.documentHash},{rpc,reader}); }
  assert.equal(approval.approval.id,id(801002));assert.equal(approval.approval.current,true);
  const selected={chainId:10143,draftId:scope.draftId,slot:1,approvalId:approval.approval.id};
  let upload=await allocationUploadV3(identity,selected,undefined,rpc);
  if(!upload.prepared) {active();upload=await allocationUploadV3(identity,selected,{requestId:id(801003),
    contextHash:upload.contextHash,documentHash:upload.documentHash},rpc);}
  assert.equal(upload.prepared.id,id(801003));assert.equal(upload.current,true);
  const context={...selected,uploadId:upload.prepared.id,packageHash:upload.prepared.packageHash};
  let review=await rewardRoundPublicationV3(identity,context,undefined,rpc);
  if(!review.review) {active();review=await rewardRoundPublicationV3(identity,context,{action:"start",requestId:id(801004),
    reviewId:null,packageHash:context.packageHash},rpc);}
  assert.equal(review.review.id,id(801004));assert.equal(review.review.seconds,0);
  if(!review.publication) { assert.equal(review.canPublish,true);active();
    review=await rewardRoundPublicationV3(identity,context,{action:"publish",requestId:id(801005),
      reviewId:review.review.id,packageHash:context.packageHash},rpc); }
  assert.equal(review.publication.id,id(801005));await current();
  return {context,review,current};
}

/** One fixed lifecycle step per run. No deployment/funding or athlete signer.
 * Immutable SQL signed attempts and the original worker enforce send/recovery.
 * Source digests are phase-local; the completed funding journal is untouched. */
export async function main(args=process.argv.slice(2)) {
  const actions=["prepare","complete_funding","upload_awards","stage_allocation","activate"];
  assert.ok(args.length===3&&actions.includes(args[0])&&args[1]==="--confirm-source"&&/^[0-9a-f]{64}$/.test(args[2]));
  const digest=privyProgrammeSourceDigest();assert.equal(args[2],digest);
  const end=Date.now()+10*60*1000;
  const active=()=>{assert.ok(Date.now()<end);assertLocalStack();assert.equal(privyProgrammeSourceDigest(),digest);};
  active();let session,journal;
  try {
    session=await localOrganizer(privyRoundOne.draftId);const reader=privyTrialReader();
    journal=openCanaryJournal(join(root,"demo/rewards/local/.artifacts/privy-testnet-round-one-v3"));
    const target={...privyRoundOne,policy:"operator-observed-privy-synthetic-test-v1"};
    if(journal.read("target.json"))assert.deepEqual(journal.read("target.json"),target);else journal.write("target.json",target);
    const {context,review,current}=await preparePrivyRoundOne(session,reader,active), {identity,rpc}=session;
    const facts=await readAllocationUploadV3(identity,context,rpc),count=Number(facts.prepared.package.entitlementCount);
    assert.ok(count>0&&count<=64);
    if(args[0]==="prepare")return{status:"allocation_published_not_activated",...context,awardCount:count,
      allocatedWei:facts.prepared.package.allocatedWei,unallocatedWei:facts.prepared.package.unallocatedWei};
    const step=actions.indexOf(args[0])-1,action=args[0],scope={...context,intentId:id(801010+step)};
    const selected={...scope,attemptId:id(801020+step),jobId:id(801030+step),workerId:id(801040+step)};
    const fee=200000000000n,gasLimit=10000000n;
    const publication={reviewId:review.review.id,publicationId:review.publication.id,reviewPeriod:"0",
      reviewStartedAt:String(Math.floor(Date.parse(review.review.startedAt)/1000)),
      officialPublishedAt:String(Math.floor(Date.parse(review.publication.publishedAt)/1000)),publicationEvidenceHash:review.publication.evidenceHash};
    const saved=await prepareProgrammeLifecycleV3(identity,{...scope,predecessorId:step===0?null:id(801009+step),
      body:{action,batchStart:step===1?0:null,batchSize:step===1?count:null,packageHash:context.packageHash,
        gasLimit:String(gasLimit),maxFeePerGas:String(fee),maxPriorityFeePerGas:"0",maxGasCostWei:String(gasLimit*fee),
        ...(step>=2?{publication}:{})}},{rpc,reader});
    assert.equal(saved.plan.programme.context.verifyingContract.toLowerCase(),privyRoundOne.programmeAddress);
    assert.equal(saved.plan.programme.deploymentTransactionHash,privyRoundOne.deploymentTransactionHash);
    const prior=await readProgrammeLifecycleV3(identity,scope,rpc);
    if(!prior.attempt) {
      assert.equal(saved.status,"reserved");const tx=encodeRewardProgrammeLifecycleV3(saved.plan);
      assert.equal(tx.to.toLowerCase(),privyRoundOne.campaignAddress);assert.equal(tx.value,0n);
      const gas=(await reader.estimateGas({...tx,account:saved.plan.programme.operatorAddress}))*12n/10n;
      assert.ok(gas>0n&&gas<=gasLimit);
      assert.ok(await reader.getBalance({address:saved.plan.programme.operatorAddress})>=gas*fee,"operator_gas_insufficient");
      await current();active();const signer=loadTestnetOperatorAccount("operator");
      assert.equal(signer.address.toLowerCase(),saved.plan.programme.operatorAddress.toLowerCase());
      const sourceFile=`step-${step}-source.json`,source={digest,action,packageHash:context.packageHash};
      if(journal.read(sourceFile))assert.deepEqual(journal.read(sourceFile),source);else journal.write(sourceFile,source);
      const signedTransaction=await signer.signTransaction({...tx,type:"eip1559",gas,maxFeePerGas:fee,maxPriorityFeePerGas:0n});
      active();await recordSignedProgrammeLifecycleV3(identity,{...selected,signedTransaction},rpc);
    }
    await queueVerifiedProgrammeLifecycleV3(identity,selected,rpc);await current();active();
    const result=await runProgrammeLifecycleJobV3(identity,selected,{rpc,reader,broadcast:serializedTransaction=>{
      assert.ok(Date.now()<end);return reader.sendRawTransaction({serializedTransaction});}});
    const execution=await readProgrammeExecutionStatusV3(identity,context,rpc);
    return{action,outcome:result.outcome,...context,campaignAddress:execution.campaignAddress,
      steps:execution.steps.map(s=>({action:s.action,state:s.state,transactionHash:s.transactionHash,receipt:s.receipt}))};
  } finally {journal?.close();await session?.signOut();}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href) {
  try{console.log(JSON.stringify(await main()));}catch(e){console.error("Privy Round 1 stopped:",e.code??e.name);process.exitCode=1;}
}
