import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { spawn } from "node:child_process";
import { createClient } from "@supabase/supabase-js";
import { privyPilotIdV3 as id } from "@raceson/domain/rewards/privy-testnet-pilot-v3";
import { decodePilotChangeV3, decodePilotViewV3 } from "@raceson/domain/rewards/pilot-acceptance-v3";
import { readAllocationApprovalV3, allocationDocumentHashV3, readAllocationUploadV3, rewardHistoricalSourceV3,
  rewardRoundPublicationV3, readProgrammeExecutionStatusV3, readReadinessV3, readClaimV3, paymentLedgerV3 } from "@raceson/db/rewards";
import { buildAllocationDocumentV3 } from "@raceson/domain/rewards/allocation-approval-v3";
import { rewardProgrammeChildV3 } from "@raceson/rewards-chain/programme-v3";
import { programmeDeploymentPlanV3 } from "../../../apps/api/dist/features/rewards/programme-deployment-v3-service.js";
import { allocationApprovalV3 } from "../../../apps/api/dist/features/rewards/allocation-approval-v3-service.js";
import { allocationUploadV3 } from "../../../apps/api/dist/features/rewards/allocation-upload-v3-service.js";
import { prepareProgrammeLifecycleV3 } from "../../../apps/api/dist/features/rewards/programme-lifecycle-v3-service.js";
import { inspectProgrammeSigningV3, signProgrammeV3 } from "../../../apps/api/dist/features/rewards/programme-signing-v3.js";
import { queueVerifiedProgrammeLifecycleV3, runProgrammeLifecycleJobV3 } from "../../../apps/api/dist/features/rewards/programme-lifecycle-worker-v3.js";
import { reviewAthleteReadinessV3 } from "../../../apps/api/dist/features/rewards/athlete-readiness-v3-service.js";
import { prepareAthleteClaimV3, reviewAthleteClaimSigningV3, recordAthleteClaimProofV3 } from "../../../apps/api/dist/features/rewards/athlete-claims-v3-service.js";
import { preparePaymentV3, queuePaymentV3 } from "../../../apps/api/dist/features/rewards/athlete-payment-v3-service.js";
import { inspectPaymentSigningV3, signPaymentV3 } from "../../../apps/api/dist/features/rewards/athlete-payment-signing-v3.js";
import { runPaymentJobV3 } from "../../../apps/api/dist/features/rewards/athlete-payment-worker-v3.js";
import { privyProgrammeSourceDigest, privyTestnetProgramme } from "./privy-testnet-programme.mjs";
import { privyTrialReader } from "./privy-testnet-round-one.mjs";
import { firstPrivyClaim } from "./privy-testnet-first-claim.mjs";
import { root, assertLocalStack, localCredentials, localAppEnvironment } from "./local-demo.mjs";
import { openCanaryJournal } from "./canary-journal.mjs";
import { loadTestnetOperatorAccount, publicTestnetWallet } from "./testnet-wallets.mjs";

export const pilotRecipient = "0x3a6f56813c43015c33f7cdc0d5026eadc9b6892d";
const campaigns = { 2: "0xac00a68d4a4fae75bf8b44d58bbdfa954399ca2c", 3: "0xbbdd4f10758b2ba634096ac0923747ac4e3b237c",
  4: "0xec61ca445f3efe49e146de09f2947a2e3d0675bd" };
const lifecycle = ["complete_funding", "upload_awards", "stage_allocation", "activate"];
const fees = gas => ({gasLimit:String(gas),maxFeePerGas:"200000000000",maxPriorityFeePerGas:"0",maxGasCostWei:String(BigInt(gas)*200000000000n)});
export const pilotIds = round => { assert.ok(round === 2 || round === 3 || round === 4); return n => id(820000 + round * 1000 + n); };
// Round 4 uses the same wallet's fresh, genuinely signed/selected request.
// The prior request was withdrawn. Never retarget already-paid claims 2/3.
export const pilotDestination = round => {
  pilotIds(round);
  return round === 4 ? "c1862a98-70bb-42d7-9730-9e9ec00c0a61" : firstPrivyClaim.destinationId;
};
export function pilotUiDigest() {
  const hash = createHash("sha256").update(privyProgrammeSourceDigest());
  for (const file of ["demo/rewards/web/server/local-pilot.ts", "demo/rewards/web/pages/api/[...path].ts"])
    hash.update(file).update("\0").update(readFileSync(join(root,file))).update("\0");
  return hash.digest("hex");
}
/** Private contexts never cross the child boundary. This read has no signer,
 * journal writes or borrowed operator session, and every RPC authorizes actor. */
export async function pilotState(identity, round, rpc) {
  const key=pilotIds(round),scope={chainId:10143,draftId:id(52),slot:round};
  const raw=await readAllocationApprovalV3(identity,scope,rpc);
  const history=await rewardHistoricalSourceV3(identity,10143,id(52),undefined,rpc);
  assert.equal(history.source.kind,"synthetic_rehearsal");
  assert.equal(history.contextHash,raw.sourceContextHash);
  assert.ok(raw.context.intent?.current && raw.provenance);
  const plan=programmeDeploymentPlanV3(raw.context),child=rewardProgrammeChildV3(plan,round-1),p=raw.provenance;
  assert.equal(p.contractAddress,"0x3427f256dfd29390641956ea9782031846281abc");
  assert.equal(child.context.verifyingContract.toLowerCase(),campaigns[round]);
  assert.equal(Number(child.reviewPeriod),0);
  const binding={intentId:raw.context.intent.id,fundingApprovalId:raw.context.intent.approvalId,
    programmeAddress:p.contractAddress,campaignAddress:campaigns[round],deploymentTransactionHash:p.transactionHash,
    programmeId:plan.programmeId,campaignId:child.campaignId,programmeManifestHash:plan.programmeManifestHash,
    reviewSeconds:0,fundingContextHash:raw.context.intent.contextHash};
  const document=buildAllocationDocumentV3(history.record,history.workspace,history.sourceHash,history.contextHash,round,
    history.source,raw.decision,binding);
  const documentHash=allocationDocumentHashV3(document);
  let scopeUpload=null,upload=null,publication=null,execution=null,claim=null,payment=null,claimScope=null;
  if(raw.approval){
    assert.equal(raw.approval.id,key(2));assert.ok(raw.approval.current);assert.equal(raw.approval.documentHash,documentHash);
    upload=await readAllocationUploadV3(identity,{...scope,approvalId:key(2)},rpc);
    if(upload.prepared){
      assert.equal(upload.prepared.id,key(3));assert.ok(upload.current);
      scopeUpload={...scope,approvalId:key(2),uploadId:key(3),packageHash:upload.prepared.packageHash};
      publication=await rewardRoundPublicationV3(identity,scopeUpload,undefined,rpc);
      execution=await readProgrammeExecutionStatusV3(identity,scopeUpload,rpc);
      assert.ok(execution.current);assert.equal(execution.campaignAddress,campaigns[round]);
      if(execution.steps.some(s=>s.action==="activate"&&s.state==="confirmed")){
        const beneficiary=upload.recipients.find(r=>r.beneficiaryKind==="athlete"&&r.sourceBeneficiaryId===id(1060));
        assert.ok(beneficiary);
        claimScope={chainId:10143,uploadId:key(3),destinationId:pilotDestination(round),entitlementId:beneficiary.entitlementId,
          claimId:key(7),paymentId:key(8)};
        claim=await readClaimV3(identity,{...claimScope,role:"operator"},rpc);
        assert.equal(claim.readiness.destination.address,pilotRecipient);
        if(claim.intent)payment=await paymentLedgerV3(identity,claimScope,undefined,rpc);
      }
    }
  }
  const decision=history.decisions.find(d=>d.slot===round),held=decision?.decision==="held";
  const recipientConsented=Boolean(claim?.proofs.some(p=>p.role==="recipient")),operatorApproved=Boolean(claim?.proofs.some(p=>p.role==="operator"));
  const paid=Boolean(payment?.receipt),expired=Boolean(!paid&&claim?.intent&&claim.intent.expiresAt<=BigInt(Math.floor(Date.now()/1000)));
  let nextAction=null;
  if(!held&&!paid&&!expired){
    if(!decision?.current)nextAction="review_results";
    else if(!raw.approval||!upload?.prepared)nextAction="approve_allocation";
    else if(!publication?.publication)nextAction="publish_results";
    else {
      const pending=execution.steps.find(s=>s.state!=="confirmed");
      nextAction=pending?.state==="submitted"?"reconcile":lifecycle.find(action=>!execution.steps.some(s=>s.action===action&&s.state==="confirmed"))??
        (!claim?.intent?"prepare_claim":!recipientConsented?null:!operatorApproved?"approve_claim":payment?.job?.state==="submitted"?"reconcile":"pay");
    }
  }
  const calculated=document.calculation;
  const amount=upload?.recipients.find(r=>r.beneficiaryKind==="athlete"&&r.sourceBeneficiaryId===id(1060))?.amountWei;
  const view={schema:"raceson-pilot-acceptance-v3",chainId:10143,draftId:id(52),round,
    viewHash:"0".repeat(64),campaignAddress:campaigns[round],budgetWei:String(calculated.budgetWei),
    allocatedWei:String(calculated.proposedWei),unallocatedWei:String(calculated.retainedWei),
    awardCount:Number(upload?.prepared?.package.entitlementCount??0),athleteAmountWei:amount==null?null:String(amount),recipientAddress:pilotRecipient,
    reviewSeconds:0,nextAction,held,waitingForConsent:Boolean(claim?.intent&&!recipientConsented&&!expired),expired,
    steps:(execution?.steps??[]).map(s=>({action:s.action,state:s.state,transactionHash:s.transactionHash})),
    recipientConsented,operatorApproved,paid,claimExpiresAt:claim?.intent?String(claim.intent.expiresAt):null,
    paymentTransactionHash:payment?.attempt?.body.transactionHash??null,claimId:claim?.intent?.id??null,
    maximumActionGasWei:nextAction==="upload_awards"?fees(2500000).maxGasCostWei:
      lifecycle.includes(nextAction)?fees(250000).maxGasCostWei:nextAction==="pay"?fees(300000).maxGasCostWei:"0"};
  view.viewHash=allocationDocumentHashV3({view,contextHash:raw.contextHash,documentHash,decision:decision??null,
    approvalId:raw.approval?.id??null,packageHash:scopeUpload?.packageHash??null,publication:publication?.publication??null});
  return {view:decodePilotViewV3(view,round),key,scope,raw,history,documentHash,upload,scopeUpload,publication,execution,claimScope,claim,payment};
}

export async function advancePilot(identity, round, change, deps) {
  const {rpc,reader,active,signal,loadSigner,broadcast}=deps;
  const state=await pilotState(identity,round,rpc),{view,key,scope,raw,history,scopeUpload,publication,upload,claimScope,claim}=state;
  if(view.viewHash!==change.viewHash||!view.nextAction||view.nextAction!==change.action)throw Error("reward_pilot_changed");
  active();const action=change.action,shared={rpc,reader,chainId:10143,origin:"http://127.0.0.1:3102"};
  if(action==="review_results")await rewardHistoricalSourceV3(identity,10143,id(52),{requestId:key(1),slot:round,
    expectedReviewId:raw.decision?.id??null,contextHash:history.contextHash,decision:"confirmed_final"},rpc);
  else if(action==="approve_allocation"){
    if(!raw.approval)await allocationApprovalV3(identity,scope,{requestId:key(2),expectedApprovalId:null,
      contextHash:raw.contextHash,documentHash:state.documentHash},shared);
    const selected={...scope,approvalId:key(2)},u=await allocationUploadV3(identity,selected,undefined,rpc);active();
    if(!u.prepared)await allocationUploadV3(identity,selected,{requestId:key(3),contextHash:u.contextHash,documentHash:u.documentHash},rpc);
  }else if(action==="publish_results"){
    let current=publication;
    if(!current.review)current=await rewardRoundPublicationV3(identity,scopeUpload,{action:"start",requestId:key(4),reviewId:null,
      packageHash:scopeUpload.packageHash},rpc);
    assert.equal(current.review.seconds,0);active();assert.ok(current.canPublish);
    await rewardRoundPublicationV3(identity,scopeUpload,{action:"publish",requestId:key(5),reviewId:current.review.id,
      packageHash:scopeUpload.packageHash},rpc);
  }else if(lifecycle.includes(action)){
    const index=lifecycle.indexOf(action),selected={...scopeUpload,intentId:key(20+index),attemptId:key(30+index),jobId:key(40+index),workerId:key(50+index)};
    const pub={reviewId:publication.review.id,publicationId:publication.publication.id,reviewPeriod:"0",
      reviewStartedAt:String(Math.floor(Date.parse(publication.review.startedAt)/1000)),
      officialPublishedAt:String(Math.floor(Date.parse(publication.publication.publishedAt)/1000)),publicationEvidenceHash:publication.publication.evidenceHash};
    await prepareProgrammeLifecycleV3(identity,{...selected,predecessorId:index===0?null:key(19+index),body:{action,
      batchStart:index===1?0:null,batchSize:index===1?Number(upload.prepared.package.entitlementCount):null,
      packageHash:scopeUpload.packageHash,...fees(index===1?2500000:250000),...(index>=2?{publication:pub}:{})}},shared);
    const review=await inspectProgrammeSigningV3(identity,selected,shared);active();
    assert.equal(review.plan.campaignAddress,campaigns[round]);assert.equal(review.plan.valueWei,"0");
    if(!review.recorded)await signProgrammeV3(identity,{...selected,planHash:review.plan.planHash},{...shared,signal,
      loadSigner:async()=>{active();return loadSigner("operator");}});
    active();await queueVerifiedProgrammeLifecycleV3(identity,selected,rpc);active();
    await runProgrammeLifecycleJobV3(identity,selected,{...shared,broadcast});
  }else if(action==="reconcile" && state.execution.steps.some(s=>s.state==="submitted")){
    const pending=state.execution.steps.find(s=>s.state==="submitted"),index=lifecycle.indexOf(pending.action);
    assert.ok(index>=0);assert.equal(pending.intentId,key(20+index));
    // Receipt-only recovery deliberately has NO signing, preparation, queue or
    // broadcast capability. Unknown/missing chain history stops instead of resending.
    await reconcilePilotLifecycle(identity,{...scopeUpload,intentId:key(20+index),attemptId:key(30+index),jobId:key(40+index),workerId:key(50+index)},shared);
  }else if(action==="prepare_claim"){
    let readiness=await readReadinessV3(identity,{...claimScope,role:"operator"},rpc);
    assert.equal(readiness.destination.address,pilotRecipient);
    if(!readiness.review){
      // Reuse actual observed proof of THIS same synthetic identity and wallet.
      // No invented DOB, MFA, recovery evidence, consent or athlete private key.
      const original=await readReadinessV3(identity,{...firstPrivyClaim,role:"operator"},rpc);
      assert.equal(original.review?.attestation.policy,"operator-observed-privy-synthetic-test-v1");
      assert.equal(original.destination.address,readiness.destination.address);
      assert.equal(original.profileFingerprint,readiness.profileFingerprint);active();
      await reviewAthleteReadinessV3(identity,{...claimScope,reviewId:key(6),previousReviewId:null,
        sourceGuardHash:readiness.source.sourceGuardHash,profileFingerprint:readiness.profileFingerprint,attestation:original.review.attestation},shared);
      readiness=await readReadinessV3(identity,{...claimScope,role:"operator"},rpc);
    }
    assert.equal(readiness.review.id,key(6));active();
    await prepareAthleteClaimV3(identity,{...claimScope,reviewId:key(6),sourceGuardHash:readiness.source.sourceGuardHash,
      profileFingerprint:readiness.profileFingerprint},shared);
  }else if(action==="approve_claim"){
    assert.ok(claim.proofs.some(p=>p.role==="recipient"));
    const review=await reviewAthleteClaimSigningV3(identity,{...claimScope,role:"operator"},shared);
    assert.equal(review.recipientAddress,pilotRecipient);active();
    const signer=loadSigner("operator");assert.equal(signer.address.toLowerCase(),claim.readiness.source.operatorAddress);
    const signature=await signer.signTypedData(review.typedData);active();
    await recordAthleteClaimProofV3(identity,{...claimScope,role:"operator",signature},shared);
  }else{
    assert.ok(action==="pay"||action==="reconcile");assert.ok(view.recipientConsented&&view.operatorApproved);
    const selected={...claimScope,attemptId:key(9),jobId:key(10),workerId:key(11)};
    if(action==="pay"){
      const relayer=publicTestnetWallet("relayer");assert.equal(relayer.toLowerCase(),"0x6c215b3052588f4b3bcb957bf4a1b0aaf38771ec");
      await preparePaymentV3(identity,{...selected,relayerAddress:relayer,fees:fees(300000)},shared);
      const review=await inspectPaymentSigningV3(identity,selected,shared);active();
      assert.equal(review.plan.contractAddress,campaigns[round]);assert.equal(review.plan.recipientAddress,pilotRecipient);
      assert.equal(review.plan.amountWei,view.athleteAmountWei);
      if(!review.recorded)await signPaymentV3(identity,{...selected,planHash:review.plan.planHash},{...shared,signal,
        loadSigner:async()=>{active();return loadSigner("relayer");}});
      active();await queuePaymentV3(identity,selected,shared);
    }
    active();await runPaymentJobV3(identity,selected,{...shared,broadcast:action==="reconcile"?receiptOnlyBroadcast:broadcast});
  }
  return (await pilotState(identity,round,rpc)).view;
}

export const receiptOnlyBroadcast=()=>{throw Error("reward_pilot_receipt_only");};
export const reconcilePilotLifecycle=(identity,scope,deps,worker=runProgrammeLifecycleJobV3)=>
  worker(identity,scope,{...deps,broadcast:receiptOnlyBroadcast});

/** Child process receives only the authenticated actor, fixed round and change.
 * It never accepts RPC URLs, wallet addresses, amounts, commands or key bytes. */
export async function runChild(input) {
  assert.deepEqual(Object.keys(input).sort(),["change","identity","round"]);
  assert.deepEqual(Object.keys(input.identity).sort(),["sessionId","userId"]);
  for(const v of Object.values(input.identity))assert.match(v,/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
  pilotIds(input.round);const change=input.change===null?undefined:decodePilotChangeV3(input.change);
  const digest=process.env.RACESON_REWARD_LOCAL_PILOT_SOURCE_SHA;assert.match(digest??"",/^[0-9a-f]{64}$/);
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),9*60*1000);
  const stop=()=>controller.abort();process.once("SIGTERM",stop);
  const active=()=>{assert.ok(!controller.signal.aborted);assertLocalStack();assert.equal(pilotUiDigest(),digest);};
  let journal;
  try{
    active();const credentials=localCredentials(),client=createClient(credentials.API_URL,credentials.SERVICE_ROLE_KEY,
      {auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false}}),rpc=(name,args)=>client.rpc(name,args);
    if(!change)return (await pilotState(input.identity,input.round,rpc)).view;
    // All rounds share one operator lock, in addition to DB nonce/job leases.
    journal=openCanaryJournal(join(root,"demo/rewards/local/.artifacts/privy-testnet-ui-v3"));
    const source=`source-${digest}.json`;if(!journal.read(source))journal.write(source,{digest,programme:privyTestnetProgramme.draftId});
    const reader=privyTrialReader();assert.equal(await reader.getChainId(),10143);active();
    return await advancePilot(input.identity,input.round,change,{rpc,reader,active,signal:controller.signal,
      loadSigner:role=>{active();return loadTestnetOperatorAccount(role);},broadcast:serializedTransaction=>{
        active();return reader.sendRawTransaction({serializedTransaction});}});
  }finally{clearTimeout(timer);process.off("SIGTERM",stop);journal?.close();}
}

if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  try{
    if(process.argv[2]==="digest"&&process.argv.length===3)console.log(pilotUiDigest());
    else if(process.argv[2]==="serve"&&process.argv.length===5&&process.argv[3]==="--confirm-source"){
      assert.equal(process.argv[4],pilotUiDigest());assertLocalStack();
      const env={...localAppEnvironment(localCredentials(),"local-testnet"),RACESON_REWARD_LOCAL_PILOT_SOURCE_SHA:process.argv[4],
        RACESON_REWARD_PRIVY_APP_ID:"cmtx921we00fu0cifaab7exez",NEXT_PUBLIC_RACESON_REWARD_PRIVY_APP_ID:"cmtx921we00fu0cifaab7exez"};
      const child=spawn(process.execPath,[join(root,"node_modules/next/dist/bin/next"),"dev","--webpack","--hostname","127.0.0.1","--port","3102"],
        {cwd:join(root,"demo/rewards/web"),env,stdio:"inherit"});
      process.on("SIGTERM",()=>child.kill("SIGTERM"));process.on("SIGINT",()=>child.kill("SIGINT"));
      child.on("exit",code=>{process.exitCode=code??1;});
    }else{
      assert.equal(process.argv.length,2);let text="";for await(const bytes of process.stdin){text+=bytes;assert.ok(text.length<=2048);}
      console.log(JSON.stringify(await runChild(JSON.parse(text))));
    }
  }catch(error){
    const code=error.code??error.message;
    console.log(JSON.stringify({error:["reward_account_session_required","reward_planning_not_found","reward_readiness_scope_required",
      "reward_pilot_changed"].includes(code)?code:"reward_pilot_unavailable"}));process.exitCode=1;
  }
}
