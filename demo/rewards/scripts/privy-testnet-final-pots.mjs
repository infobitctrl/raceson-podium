import assert from "node:assert/strict";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { privyPilotIdV3 as id } from "@raceson/domain/rewards/privy-testnet-pilot-v3";
import { readFinalAllocationApprovalV3, readFinalAllocationUploadV3, readProgrammeExecutionStatusV3 } from "@raceson/db/rewards";
import { finalAllocationApprovalV3, finalAllocationUploadV3 } from "../../../apps/api/dist/features/rewards/final-allocation-actions-v3-service.js";
import { finalPublicationV3 } from "../../../apps/api/dist/features/rewards/final-publication-v3-service.js";
import { prepareProgrammeLifecycleV3 } from "../../../apps/api/dist/features/rewards/programme-lifecycle-v3-service.js";
import { inspectProgrammeSigningV3, signProgrammeV3 } from "../../../apps/api/dist/features/rewards/programme-signing-v3.js";
import { queueVerifiedProgrammeLifecycleV3, runProgrammeLifecycleJobV3 } from "../../../apps/api/dist/features/rewards/programme-lifecycle-worker-v3.js";
import { root, assertLocalStack } from "./local-demo.mjs";
import { localOrganizer } from "./programme-local-rehearsal.mjs";
import { privyTrialReader } from "./privy-testnet-round-one.mjs";
import { pilotUiDigest, receiptOnlyBroadcast } from "./privy-testnet-pilot-ui.mjs";
import { loadTestnetOperatorAccount } from "./testnet-wallets.mjs";
import { openCanaryJournal } from "./canary-journal.mjs";

const programme = "0x3427f256dfd29390641956ea9782031846281abc";
const reviewed = Object.freeze({
  5: { address:"0x51e5e6e624e76152a170abf2ef13166b39ea7252", budget:"10000000000000000000",
    hash:"132f4d60fb03d95dbd582370fa61d35a789d69f77882329331d19edc58268d5e" },
  6: { address:"0x9e7076fe48f9f67c377f3642eb940fb0d8a3381b", budget:"50000000000000000000",
    hash:"202dbc1b6ac16b5a241d644385efe6c0a443d1637e42e6337118ccff417582d3" },
});
const actions = ["complete_funding","upload_awards","stage_allocation","activate"];
export function finalPotScope(slot) {
  assert.ok(slot === 5 || slot === 6);
  return {chainId:10143,draftId:id(52),slot,approvalId:id(840000+slot*1000+2),uploadId:id(840000+slot*1000+3)};
}
export function parseFinalPotCommand(args) {
  assert.ok(args.length===2 || args.length===4);
  const [action,number,flag,digest]=args,slot=Number(number);
  assert.ok(number==="5"||number==="6");finalPotScope(slot);
  assert.ok(["inspect","prepare","reconcile",...actions].includes(action));
  if(action==="inspect")assert.equal(args.length,2);
  else {assert.equal(flag,"--confirm-source");assert.match(digest??"",/^[0-9a-f]{64}$/);}
  return {action,slot,digest};
}
function verifyDocument(d,slot) {
  assert.equal(d.schema,"raceson-allocation-document-v3.2");assert.equal(d.source.kind,"synthetic_rehearsal");
  assert.equal(d.slot,slot);assert.equal(d.binding.programmeAddress,programme);
  assert.equal(d.binding.campaignAddress,reviewed[slot].address);assert.equal(d.binding.reviewSeconds,0);
  assert.equal(String(d.calculation.budgetWei),reviewed[slot].budget);assert.equal(d.recipients.length,14);
}
/** Fixed final-source adapter. No historical-round fallback, funding/deployment,
 * sporting-result mutation, recipient consent or payment in this command. */
export async function runFinalPot(command) {
  const {action,slot,digest}=command,scope=finalPotScope(slot),key=n=>id(840000+slot*1000+n);
  assert.ok(["inspect","prepare","reconcile",...actions].includes(action));
  assertLocalStack();const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),9*60*1000);
  const active=()=>{assert.ok(!controller.signal.aborted);assertLocalStack();if(action!=="inspect")assert.equal(pilotUiDigest(),digest);};
  let s,journal;
  try {
    active();s=await localOrganizer(scope.draftId);const {identity,rpc}=s;
    if(action!=="inspect") {
      journal=openCanaryJournal(join(root,"demo/rewards/local/.artifacts/privy-testnet-ui-v3"));
      const file=`source-${digest}.json`;if(!journal.read(file))journal.write(file,{digest,programme:scope.draftId});
    }
    let approval=await readFinalAllocationApprovalV3(identity,scope,rpc);
    if(action==="prepare"&&!approval.approval) {
      const reader=privyTrialReader();assert.equal(await reader.getChainId(),10143);
      const v=await finalAllocationApprovalV3(identity,scope,undefined,{rpc,reader});active();
      assert.deepEqual(v.reasons,[]);assert.equal(v.documentHash,reviewed[slot].hash);
      await finalAllocationApprovalV3(identity,scope,{requestId:scope.approvalId,expectedApprovalId:null,
        contextHash:v.contextHash,documentHash:v.documentHash},{rpc,reader});
      approval=await readFinalAllocationApprovalV3(identity,scope,rpc);
    }
    if(!approval.approval)return {slot,approved:false};
    assert.equal(approval.approval.id,scope.approvalId);assert.ok(approval.approval.current);
    assert.equal(approval.approval.documentHash,reviewed[slot].hash);verifyDocument(approval.approval.document,slot);
    let u=await finalAllocationUploadV3(identity,scope,undefined,rpc);
    if(action==="prepare"&&!u.prepared) {active();u=await finalAllocationUploadV3(identity,scope,
      {requestId:scope.uploadId,contextHash:u.contextHash,documentHash:u.documentHash},rpc);}
    if(!u.prepared)return {slot,approved:true,prepared:false};
    assert.equal(u.prepared.id,scope.uploadId);assert.equal(Number(u.entitlementCount),14);assert.equal(u.campaignAddress,reviewed[slot].address);
    let pub=await finalPublicationV3(identity,scope,undefined,rpc);
    if(action==="prepare"&&!pub.publication) {active();assert.deepEqual(pub.reasons,[]);
      pub=await finalPublicationV3(identity,scope,{requestId:key(5),contextHash:pub.contextHash,packageHash:pub.packageHash,evidenceHash:pub.evidenceHash},rpc);}
    const status=()=>readProgrammeExecutionStatusV3(identity,scope,rpc);
    let execution=await status();assert.ok(execution.current);assert.equal(execution.campaignAddress,reviewed[slot].address);
    if(actions.includes(action)||action==="reconcile") {
      assert.ok(pub.publicationBound);assert.equal(pub.publication.id,key(5));
      const pending=execution.steps.find(s=>s.state!=="confirmed");
      const selectedAction=action==="reconcile"?pending?.action:action;
      const index=actions.indexOf(selectedAction);assert.ok(index>=0);
      const selected={...scope,intentId:key(20+index),attemptId:key(30+index),jobId:key(40+index),workerId:key(50+index)};
      const reader=privyTrialReader(),shared={rpc,reader,chainId:10143,origin:"http://127.0.0.1:3102"};
      assert.equal(await reader.getChainId(),10143);active();
      if(action==="reconcile") {
        assert.equal(pending.state,"submitted");assert.equal(pending.intentId,selected.intentId);
        await runProgrammeLifecycleJobV3(identity,selected,{...shared,broadcast:receiptOnlyBroadcast});
      } else if(!execution.steps.some(s=>s.action===action&&s.state==="confirmed")) {
        assert.equal(actions.find(a=>!execution.steps.some(s=>s.action===a&&s.state==="confirmed")),action);
        assert.ok(!pending||!["submitted","failed","cancelled"].includes(pending.state),"pending_job_requires_inspection");
        const gas=index===1?2500000n:250000n;
        const upload=await readFinalAllocationUploadV3(identity,scope,rpc);verifyDocument(upload.document,slot);active();
        await prepareProgrammeLifecycleV3(identity,{...selected,predecessorId:index===0?null:key(19+index),body:{action,
          batchStart:index===1?0:null,batchSize:index===1?Number(u.entitlementCount):null,packageHash:u.prepared.packageHash,
          gasLimit:String(gas),maxFeePerGas:"200000000000",maxPriorityFeePerGas:"0",maxGasCostWei:String(gas*200000000000n),
          ...(index>=2?{publication:pub.publication.binding}:{})}},shared);
        const review=await inspectProgrammeSigningV3(identity,selected,shared);active();
        assert.equal(review.plan.campaignAddress,reviewed[slot].address);assert.equal(review.plan.valueWei,"0");
        if(!review.recorded)await signProgrammeV3(identity,{...selected,planHash:review.plan.planHash},{...shared,signal:controller.signal,
          loadSigner:()=>{active();return loadTestnetOperatorAccount("operator");}});
        active();await queueVerifiedProgrammeLifecycleV3(identity,selected,rpc);active();
        await runProgrammeLifecycleJobV3(identity,selected,{...shared,broadcast:serializedTransaction=>{
          active();return reader.sendRawTransaction({serializedTransaction});}});
      }
      execution=await status();
    }
    return {slot,approved:true,documentHash:reviewed[slot].hash,upload:u,publicationBound:pub.publicationBound,
      steps:execution.steps.map(s=>({action:s.action,state:s.state,transactionHash:s.transactionHash})),payoutPerformedByThisCommand:false};
  } finally {clearTimeout(timer);journal?.close();await s?.signOut();}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href) {
  try {console.log(JSON.stringify(await runFinalPot(parseFinalPotCommand(process.argv.slice(2)))));}
  catch(e){console.error(JSON.stringify({error:e.code??e.message}));process.exitCode=1;}
}
