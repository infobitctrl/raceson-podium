import assert from "node:assert/strict";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { privyPilotIdV3 as id } from "@raceson/domain/rewards/privy-testnet-pilot-v3";
import { readFinalAllocationUploadV3, readProgrammeExecutionStatusV3, readReadinessV3, readClaimV3, paymentLedgerV3 } from "@raceson/db/rewards";
import { reviewAthleteReadinessV3 } from "../../../apps/api/dist/features/rewards/athlete-readiness-v3-service.js";
import { prepareAthleteClaimV3, reviewAthleteClaimSigningV3, recordAthleteClaimProofV3 } from "../../../apps/api/dist/features/rewards/athlete-claims-v3-service.js";
import { preparePaymentV3, queuePaymentV3 } from "../../../apps/api/dist/features/rewards/athlete-payment-v3-service.js";
import { inspectPaymentSigningV3, signPaymentV3 } from "../../../apps/api/dist/features/rewards/athlete-payment-signing-v3.js";
import { runPaymentJobV3 } from "../../../apps/api/dist/features/rewards/athlete-payment-worker-v3.js";
import { finalPotScope } from "./privy-testnet-final-pots.mjs";
import { pilotUiDigest, pilotRecipient, receiptOnlyBroadcast } from "./privy-testnet-pilot-ui.mjs";
import { firstPrivyClaim } from "./privy-testnet-first-claim.mjs";
import { privyTrialReader } from "./privy-testnet-round-one.mjs";
import { localOrganizer } from "./programme-local-rehearsal.mjs";
import { root, assertLocalStack } from "./local-demo.mjs";
import { openCanaryJournal } from "./canary-journal.mjs";
import { loadTestnetOperatorAccount, publicTestnetWallet } from "./testnet-wallets.mjs";
const campaigns={5:"0x51e5e6e624e76152a170abf2ef13166b39ea7252",6:"0x9e7076fe48f9f67c377f3642eb940fb0d8a3381b"};
const amounts={5:"400120000000000000",6:"1868346153846153846"};
// Fresh genuine Privy proof/nomination for profile 9a...1060. The prior R4
// request was withdrawn; preserve it on historical paid claims, never restore it.
const destinationId="b8616917-975c-47cc-974e-da72a00fe958";
const key=(slot,n)=>id(840000+slot*1000+n);
export function finalClaimScope(slot,upload) {
  const scope=finalPotScope(slot);
  assert.ok(upload.current);assert.equal(upload.prepared.id,scope.uploadId);
  assert.equal(upload.document.source.kind,"synthetic_rehearsal");
  assert.equal(upload.document.record.draftId,scope.draftId);assert.equal(upload.document.record.chainId,10143);
  assert.equal(upload.document.slot,slot);assert.equal(upload.document.binding.campaignAddress,campaigns[slot]);
  const recipients=upload.recipients.filter(r=>r.beneficiaryKind==="athlete"&&r.sourceBeneficiaryId===id(1060));
  assert.equal(recipients.length,1);const r=recipients[0];assert.equal(String(r.amountWei),amounts[slot]);
  return {chainId:10143,uploadId:scope.uploadId,destinationId,entitlementId:r.entitlementId,
    claimId:key(slot,7),paymentId:key(slot,8)};
}
export function parseFinalClaimCommand(args) {
  assert.ok(args.length===2||args.length===4);
  const [action,s,flag,digest]=args;assert.ok(s==="5"||s==="6");
  assert.ok(["inspect","prepare","approve","pay","reconcile"].includes(action));
  if(action==="inspect")assert.equal(args.length,2);
  else {assert.equal(flag,"--confirm-source");assert.match(digest??"",/^[0-9a-f]{64}$/);}
  return {action,slot:Number(s),digest};
}
/** Only the previously linked synthetic tester. Reuses genuine observed policy,
 * never creates athlete keys/consent, never changes a destination or paid claim. */
export async function runFinalClaim(command) {
  const {action,slot,digest}=command,pot=finalPotScope(slot);
  assert.ok(["inspect","prepare","approve","pay","reconcile"].includes(action));
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),9*60*1000);
  const active=()=>{assert.ok(!controller.signal.aborted);assertLocalStack();if(action!=="inspect")assert.equal(pilotUiDigest(),digest);};
  let s,journal;
  try {
    active();s=await localOrganizer(pot.draftId);const {identity,rpc}=s;
    if(action!=="inspect") {
      journal=openCanaryJournal(join(root,"demo/rewards/local/.artifacts/privy-testnet-ui-v3"));
      const f=`source-${digest}.json`;if(!journal.read(f))journal.write(f,{digest,programme:pot.draftId});
    }
    const upload=await readFinalAllocationUploadV3(identity,pot,rpc),scope=finalClaimScope(slot,upload);
    const execution=await readProgrammeExecutionStatusV3(identity,pot,rpc);
    assert.ok(execution.current&&execution.steps.some(s=>s.action==="activate"&&s.state==="confirmed"));
    let claim=await readClaimV3(identity,{...scope,role:"operator"},rpc);
    assert.equal(claim.readiness.destination.address,pilotRecipient);
    let payment=claim.intent?await paymentLedgerV3(identity,scope,undefined,rpc):null;
    const view=()=>({slot,claimId:scope.claimId,amountWei:amounts[slot],recipient:pilotRecipient,prepared:Boolean(claim.intent),
      recipientConsented:claim.proofs.some(p=>p.role==="recipient"),operatorApproved:claim.proofs.some(p=>p.role==="operator"),
      paid:Boolean(payment?.receipt),transactionHash:payment?.attempt?.body.transactionHash??null,jobState:payment?.job?.state??null});
    if(action==="inspect"||payment?.receipt)return view();
    const reader=privyTrialReader(),shared={rpc,reader,chainId:10143,origin:"http://127.0.0.1:3102"};
    assert.equal(await reader.getChainId(),10143);active();
    let outcome=null;
    if(action==="prepare") {
      let readiness=await readReadinessV3(identity,{...scope,role:"operator"},rpc);
      if(!readiness.review) {
        const original=await readReadinessV3(identity,{...firstPrivyClaim,role:"operator"},rpc);
        assert.equal(original.review?.attestation.policy,"operator-observed-privy-synthetic-test-v1");
        assert.equal(original.destination.address,readiness.destination.address);assert.equal(original.profileFingerprint,readiness.profileFingerprint);
        active();await reviewAthleteReadinessV3(identity,{...scope,reviewId:key(slot,6),previousReviewId:null,
          sourceGuardHash:readiness.source.sourceGuardHash,profileFingerprint:readiness.profileFingerprint,attestation:original.review.attestation},shared);
        readiness=await readReadinessV3(identity,{...scope,role:"operator"},rpc);
      }
      assert.equal(readiness.review.id,key(slot,6));active();
      await prepareAthleteClaimV3(identity,{...scope,reviewId:key(slot,6),sourceGuardHash:readiness.source.sourceGuardHash,
        profileFingerprint:readiness.profileFingerprint},shared);
    } else {
      assert.equal(String(claim.intent?.witness.amountWei),amounts[slot]);assert.equal(claim.intent.recipientAddress,pilotRecipient);
      assert.equal(claim.stage.receipt.campaignAddress,campaigns[slot]);
      assert.ok(claim.proofs.some(p=>p.role==="recipient"),"genuine_privy_recipient_consent_required");
      if(action==="approve") {
        const review=await reviewAthleteClaimSigningV3(identity,{...scope,role:"operator"},shared);
        if(review.status!=="already_recorded") {
          assert.equal(review.recipientAddress,pilotRecipient);assert.equal(review.amountWei,amounts[slot]);active();
          const signer=loadTestnetOperatorAccount("operator");assert.equal(signer.address.toLowerCase(),claim.readiness.source.operatorAddress);
          const signature=await signer.signTypedData(review.typedData);active();
          await recordAthleteClaimProofV3(identity,{...scope,role:"operator",signature},shared);
        }
      } else {
        assert.ok(claim.proofs.some(p=>p.role==="operator"));
        const selected={...scope,attemptId:key(slot,9),jobId:key(slot,10),workerId:key(slot,11)};
        if(action==="pay") {
          assert.ok(!payment?.job||payment.job.state!=="submitted","submitted_payment_requires_reconciliation");
          const relayer=publicTestnetWallet("relayer");assert.equal(relayer.toLowerCase(),"0x6c215b3052588f4b3bcb957bf4a1b0aaf38771ec");
          await preparePaymentV3(identity,{...selected,relayerAddress:relayer,fees:{gasLimit:"300000",maxFeePerGas:"200000000000",
            maxPriorityFeePerGas:"0",maxGasCostWei:"60000000000000000"}},shared);
          const review=await inspectPaymentSigningV3(identity,selected,shared);active();
          assert.equal(review.plan.contractAddress,campaigns[slot]);assert.equal(review.plan.recipientAddress,pilotRecipient);
          assert.equal(review.plan.amountWei,amounts[slot]);
          if(!review.recorded)await signPaymentV3(identity,{...selected,planHash:review.plan.planHash},{...shared,signal:controller.signal,
            loadSigner:async()=>{active();return loadTestnetOperatorAccount("relayer");}});
          active();await queuePaymentV3(identity,selected,shared);
        } else assert.equal(action,"reconcile");
        active();outcome=await runPaymentJobV3(identity,selected,{...shared,broadcast:action==="reconcile"?receiptOnlyBroadcast:
          serializedTransaction=>{active();return reader.sendRawTransaction({serializedTransaction});}});
      }
    }
    claim=await readClaimV3(identity,{...scope,role:"operator"},rpc);
    payment=claim.intent?await paymentLedgerV3(identity,scope,undefined,rpc):null;
    return {...view(),outcome};
  } finally {clearTimeout(timer);journal?.close();await s?.signOut();}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href) {
  try{console.log(JSON.stringify(await runFinalClaim(parseFinalClaimCommand(process.argv.slice(2)))));}
  catch(e){console.error(JSON.stringify({error:e.code??e.message}));process.exitCode=1;}
}
