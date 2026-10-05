import assert from "node:assert/strict";
import test from "node:test";
import {programmeDeploymentFixtureV3,programmeTestId as id} from "./fixtures/programme-deployment-v3.mjs";
import {decodeProgrammeDeploymentV3,rewardProgrammeDeploymentV3} from "../../../packages/db/dist/rewards/index.js";
import {programmeDeploymentPlanV3,prepareProgrammeDeploymentV3} from "../dist/features/rewards/programme-deployment-v3-service.js";
const identity=()=>({userId:id(4),sessionId:id(5)});
const input=()=>({chainId:31337,draftId:id(1),requestId:id(81),approvalId:id(80),contextHash:"c".repeat(64),maximumGasCostWei:3n*10n**18n});
test("programme plan binds one approved 100,000 MON six-pot constructor without claiming deployment",()=>{
  const a=programmeDeploymentPlanV3(decodeProgrammeDeploymentV3(programmeDeploymentFixtureV3()));
  assert.equal(a.budgetWei,100000n*10n**18n);assert.equal(a.deploymentNonce,4n);assert.equal(new Set(a.campaignIds).size,6);
  assert.equal("deploymentTransactionHash" in a,false);assert.deepEqual(a.reviewPeriods,Array(6).fill(86400n));
  const b=programmeDeploymentFixtureV3();b.intent.id=id(82);
  const changed=programmeDeploymentPlanV3(decodeProgrammeDeploymentV3(b));assert.notEqual(changed.programmeId,a.programmeId);assert.notEqual(changed.programmeManifestHash,a.programmeManifestHash);
});
test("private preparation captures identity/approval before RPC and reserves the observed nonce only once",async()=>{
  const a=identity(),i=input(),calls=[],f=programmeDeploymentFixtureV3();
  const result=await prepareProgrammeDeploymentV3(a,i,{reader:{getChainId:async()=>31337,getTransactionCount:async()=>{
    a.userId=id(99);i.draftId=id(99);i.approvalId=id(99);i.maximumGasCostWei=1n;return 4;}},rpc:async(name,args)=>{
    calls.push([name,args]);return{data:name.startsWith("service_read")?{...f,intent:null}:f,error:null};}});
  assert.equal(result.status,"reserved");assert.equal(calls.length,2);assert.equal(calls[1][1].p_actor_user_id,id(4));assert.equal(calls[1][1].p_draft_id,id(1));
  assert.equal(calls[1][1].p_approval_id,id(80));assert.equal(calls[1][1].p_pending_nonce,"4");assert.equal(calls[1][1].p_maximum_gas_cost_wei,"3000000000000000000");
});
test("stale exact history recovers its original plan without a new nonce observation",async()=>{
  const f=programmeDeploymentFixtureV3();f.approvalView.contextHash="d".repeat(64);f.approvalView.approval.current=false;f.intent.current=false;
  const result=await prepareProgrammeDeploymentV3(identity(),input(),{reader:{getChainId(){throw Error("unreachable")}},rpc:async()=>({data:f,error:null})});
  assert.equal(result.status,"held");assert.equal(result.plan.deploymentNonce,4n);
});
test("unapproved or unsupported funding splits fail before nonce I/O",async()=>{
  for(const mutate of[f=>{f.approvalView.approval=null},f=>{f.approvalView.record.rules.leagueShareBps=6000;f.approvalView.record.rules.roundSharesBps=Array(5).fill(800)}]){
    const f=programmeDeploymentFixtureV3();f.intent=null;mutate(f);
    await assert.rejects(prepareProgrammeDeploymentV3(identity(),input(),{reader:{getChainId(){throw Error("must not call")}},rpc:async()=>({data:f,error:null})}),/reward_programme_(approval_required|split_unsupported)/);
  }
});
test("strict deployment storage decoding refuses mismatched roles, chain, nonce, extra fields and current context",()=>{
  for(const patch of[{chainId:1},{operatorAddress:`0x${"d".repeat(40)}`},{nonce:"9007199254740992"},{maximumGasCostWei:"0"},{privateKey:"never"},{current:false}]){
    const f=programmeDeploymentFixtureV3();Object.assign(f.intent,patch);assert.throws(()=>decodeProgrammeDeploymentV3(f));
  }
});
test("private repository redacts transport failures and validates the saved request scope",async()=>{
  const r={...input(),pendingNonce:4n};
  await assert.rejects(rewardProgrammeDeploymentV3(identity(),31337,id(1),r,async()=>({error:{message:"private provider information"},data:null})),{code:"reward_ledger_unavailable"});
  const f=programmeDeploymentFixtureV3();f.intent.id=id(82);
  await assert.rejects(rewardProgrammeDeploymentV3(identity(),31337,id(1),r,async()=>({error:null,data:f})),{code:"invalid_reward_programme_deployment"});
  await assert.rejects(rewardProgrammeDeploymentV3(identity(),31337,id(1),{...r,maximumGasCostWei:1n<<256n},async()=>{throw Error("must not call")}),{code:"invalid_reward_programme_deployment"});
});
