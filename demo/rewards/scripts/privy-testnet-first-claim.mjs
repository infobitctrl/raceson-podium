import assert from "node:assert/strict";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { readReadinessV3, readClaimV3 } from "@raceson/db/rewards";
import { prepareAthleteClaimV3, reviewAthleteClaimSigningV3, recordAthleteClaimProofV3 } from "../../../apps/api/dist/features/rewards/athlete-claims-v3-service.js";
import { preparePaymentV3, loadPaymentV3, queuePaymentV3 } from "../../../apps/api/dist/features/rewards/athlete-payment-v3-service.js";
import { inspectPaymentSigningV3, signPaymentV3 } from "../../../apps/api/dist/features/rewards/athlete-payment-signing-v3.js";
import { runPaymentJobV3 } from "../../../apps/api/dist/features/rewards/athlete-payment-worker-v3.js";
import { privyProgrammeSourceDigest } from "./privy-testnet-programme.mjs";
import { privyTrialReader, privyRoundOne } from "./privy-testnet-round-one.mjs";
import { localOrganizer } from "./programme-local-rehearsal.mjs";
import { root, assertLocalStack } from "./local-demo.mjs";
import { loadTestnetOperatorAccount, publicTestnetWallet } from "./testnet-wallets.mjs";
import { openCanaryJournal } from "./canary-journal.mjs";

export const firstPrivyClaim = Object.freeze({ chainId:10143,uploadId:"9a000000-0000-4000-8000-000000801003",
  destinationId:"38e853f6-21ca-4bc1-a46b-b0c5135cce4c",
  entitlementId:"0x33797b5929e7209849bb68025b3af88c2688c2631ae62cdd2537c48bfcfd62a0",
  claimId:"9a000000-0000-4000-8000-000000802005",paymentId:"9a000000-0000-4000-8000-000000802010" });
const recipient="0x3a6f56813c43015c33f7cdc0d5026eadc9b6892d",amount="400120000000000000";
export function parseFirstPrivyClaim(args) {
  assert.ok(args.length===3&&["prepare","approve","pay"].includes(args[0])&&args[1]==="--confirm-source"&&/^[0-9a-f]{64}$/.test(args[2]));
  return {action:args[0],digest:args[2]};
}
/** Fixed synthetic trial only. Recipient consent MUST already come through
 * the actual Privy browser flow; this command has no athlete signer or keys.
 * All writes use real organizer Auth and the existing exact-once ledger worker. */
export async function main(args=process.argv.slice(2)) {
  const {action,digest}=parseFirstPrivyClaim(args),end=Date.now()+10*60*1000;
  const active=()=>{assert.ok(Date.now()<end);assertLocalStack();assert.equal(privyProgrammeSourceDigest(),digest);};
  active();let session,journal;
  try{
    session=await localOrganizer(privyRoundOne.draftId);const {identity,rpc}=session,reader=privyTrialReader();
    const scope=firstPrivyClaim,deps={rpc,reader,chainId:10143,origin:"http://127.0.0.1:3102"};
    const readiness=await readReadinessV3(identity,{...scope,role:"operator"},rpc);
    assert.equal(readiness.source.draftId,privyRoundOne.draftId);
    assert.equal(readiness.destination.address,recipient);assert.equal(readiness.review?.id,"9a000000-0000-4000-8000-000000802004");
    assert.equal(readiness.review.attestation.policy,"operator-observed-privy-synthetic-test-v1");
    if(action==="prepare")return await prepareAthleteClaimV3(identity,{...scope,reviewId:readiness.review.id,
      sourceGuardHash:readiness.source.sourceGuardHash,profileFingerprint:readiness.profileFingerprint},deps);
    const claim=await readClaimV3(identity,{...scope,role:"operator"},rpc);
    assert.equal(claim.intent?.witness.amountWei.toString(),amount);assert.equal(claim.intent.recipientAddress,recipient);
    assert.equal(claim.stage.receipt.campaignAddress,privyRoundOne.campaignAddress);
    assert.ok(claim.proofs.some(p=>p.role==="recipient"),"Actual Privy recipient consent is required");
    journal=openCanaryJournal(join(root,"demo/rewards/local/.artifacts/privy-testnet-first-claim-v3"));
    const target={...scope,recipient,amount,programme:privyRoundOne.programmeAddress};
    if(journal.read("target.json"))assert.deepEqual(journal.read("target.json"),target);else journal.write("target.json",target);
    // Preserve every reviewed executor revision, including a failed pre-payment
    // run. Never overwrite its source receipt when recovering the same claim.
    const recordSource=()=>{const name=`${action}-source-${digest}.json`,value={digest,action};
      if(journal.read(name))assert.deepEqual(journal.read(name),value);else journal.write(name,value);};
    if(action==="approve"){
      const review=await reviewAthleteClaimSigningV3(identity,{...scope,role:"operator"},deps);
      if(review.status==="already_recorded")return{status:review.status,claimId:scope.claimId};
      assert.equal(review.amountWei,amount);assert.equal(review.recipientAddress,recipient);
      active();recordSource();const signer=loadTestnetOperatorAccount("operator");
      assert.equal(signer.address.toLowerCase(),readiness.source.operatorAddress);active();
      const signature=await signer.signTypedData(review.typedData);
      // Await persistence before finally revokes this real organizer session.
      active();return await recordAthleteClaimProofV3(identity,{...scope,role:"operator",signature},deps);
    }
    assert.ok(claim.proofs.some(p=>p.role==="operator"));
    const relayer=publicTestnetWallet("relayer");
    assert.equal(relayer?.toLowerCase(),"0x6c215b3052588f4b3bcb957bf4a1b0aaf38771ec");
    const fees={gasLimit:"300000",maxFeePerGas:"200000000000",maxPriorityFeePerGas:"0",maxGasCostWei:"60000000000000000"};
    await preparePaymentV3(identity,{...scope,relayerAddress:relayer,fees},deps);
    const attemptId="9a000000-0000-4000-8000-000000802011",jobId="9a000000-0000-4000-8000-000000802012",workerId="9a000000-0000-4000-8000-000000802013";
    const inspected=await inspectPaymentSigningV3(identity,{...scope,attemptId},deps);
    assert.equal(inspected.plan.amountWei,amount);assert.equal(inspected.plan.recipientAddress,recipient);
    assert.equal(inspected.plan.contractAddress,privyRoundOne.campaignAddress);
    if(!inspected.recorded){active();recordSource();await signPaymentV3(identity,{...scope,attemptId,planHash:inspected.plan.planHash},
      {...deps,signal:AbortSignal.timeout(Math.max(1,end-Date.now())),loadSigner:async()=>{active();return loadTestnetOperatorAccount("relayer");}});}
    await queuePaymentV3(identity,{...scope,attemptId,jobId},deps);active();
    const outcome=await runPaymentJobV3(identity,{...scope,jobId,workerId},{...deps,broadcast:serializedTransaction=>{
      assert.ok(Date.now()<end);return reader.sendRawTransaction({serializedTransaction});}});
    const saved=await loadPaymentV3(identity,scope,rpc);
    return{...outcome,claimId:scope.claimId,amountWei:amount,recipientAddress:recipient,
      transactionHash:saved.attempt?.transactionHash??null,confirmed:saved.context.receipt!==null};
  }finally{journal?.close();await session?.signOut();}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  try{console.log(JSON.stringify(await main()));}catch(e){console.error("First Privy claim stopped:",e.code??e.name);process.exitCode=1;}
}
