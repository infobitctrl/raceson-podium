import { z } from "zod";
import { readFinalAllocationApprovalV3, storeFinalAllocationApprovalV3, readFinalAllocationUploadV3, storeFinalAllocationUploadV3,
  copyRewardLedgerDocument as copy, RewardLedgerStoreError,
  type FinalAllocationStoreScopeV3, type FinalAllocationUploadScopeV3, type AllocationUploadChangeV3,
  type RewardAccountIdentity, type RewardLedgerRpc } from "@raceson/db/rewards";
import { buildFinalAllocationDocumentV3, finalAllocationReasonsV3 } from "@raceson/domain/rewards/final-allocation-document-v3";
import { canonicalRewardJson } from "@raceson/rewards-chain";
import { rewardProgrammeChildV3, type RewardProgrammeReaderV3 } from "@raceson/rewards-chain/programme-v3";
import { prepareFinalAllocationV3, finalAllocationSourceFromFactsV3 } from "./final-allocation-v3-service.js";
import { programmeDeploymentPlanV3 } from "./programme-deployment-v3-service.js";
import { composeApprovedAllocationUploadV3 } from "./allocation-upload-v3-service.js";
const uuid=z.string().uuid().regex(/^[0-9a-f-]+$/).refine(v=>v!=="00000000-0000-0000-0000-000000000000");
const digest=z.string().regex(/^[0-9a-f]{64}$/);
export const finalAllocationApprovalRequestV3=z.object({requestId:uuid,expectedApprovalId:uuid.nullable(),contextHash:digest,documentHash:digest}).strict();
export const finalAllocationUploadRequestV3=z.object({requestId:uuid,contextHash:digest,documentHash:digest}).strict();
function check(v:unknown,code="reward_planning_revision_changed"):asserts v{if(!v)throw new RewardLedgerStoreError(code);}
const same=(a:unknown,b:unknown)=>canonicalRewardJson(a)===canonicalRewardJson(b);
type State=Awaited<ReturnType<typeof readFinalAllocationApprovalV3>>;
function meta(a:State["approval"]){
  if(!a)return null;
  const {document:_,...fields}=a;return fields;
}
function project(state:State,slot:5|6,prepared:Awaited<ReturnType<typeof prepareFinalAllocationV3>>|null,reasons:string[],historicalAcknowledgement=false){
  return copy({schema:"raceson-final-allocation-approval-view-v3",draftId:state.source.policy.facts.record.draftId,
    chainId:state.source.policy.facts.record.chainId,slot,contextHash:state.contextHash,documentHash:prepared?.documentHash??null,
    calculation:prepared?.document.calculation??null,reasons,approval:meta(state.approval),recorded:meta(state.recorded),historicalAcknowledgement,
    allocationApproved:state.approval?.current===true,stageReady:false,payableWei:"0"});
}
function verifySource(state:State,slot:5|6,document:Awaited<ReturnType<typeof prepareFinalAllocationV3>>["document"]){
  const source=finalAllocationSourceFromFactsV3(state.source,slot);
  check(same(state.registry.context.approvalView.record,source.record)
    &&same(state.registry.context.approvalView.workspace.mapping,source.workspace.mapping));
  check(same(buildFinalAllocationDocumentV3(source.record,source.workspace,source.source,source.sourceReview,document.binding),document));
}

/** Exact request/CAS approval. Retrying a saved request acknowledges history
 * without querying chain funding, replacing recipients or undoing a later hold. */
export async function finalAllocationApprovalV3(identity:RewardAccountIdentity,input:FinalAllocationStoreScopeV3,
  change:z.infer<typeof finalAllocationApprovalRequestV3>|undefined,deps:{rpc?:RewardLedgerRpc;reader?:RewardProgrammeReaderV3}){
  const actor={...identity},c=change?finalAllocationApprovalRequestV3.parse(change):null,scope={...input,requestId:c?.requestId};
  const state=await readFinalAllocationApprovalV3(actor,scope,deps.rpc);
  if(c&&state.recorded){
    check(state.recorded.contextHash===c.contextHash&&state.recorded.documentHash===c.documentHash
      &&state.recorded.previousApprovalId===c.expectedApprovalId,"reward_allocation_approval_conflict");
    const after=await readFinalAllocationApprovalV3(actor,scope,deps.rpc);
    check(after.contextHash===state.contextHash&&same(after.recorded,state.recorded));
    return project(after,scope.slot,null,["historical_acknowledgement"],true);
  }
  if(c){check(c.contextHash===state.contextHash);check((state.approval?.id??null)===c.expectedApprovalId,"reward_allocation_approval_conflict");}
  let prepared;
  try{prepared=await prepareFinalAllocationV3(actor,scope,deps);verifySource(state,scope.slot,prepared.document);}
  catch(e){
    const code=e instanceof RewardLedgerStoreError?e.code:"";
    if(!c&&["reward_final_allocation_source_not_ready","reward_league_publication_not_ready"].includes(code))return project(state,scope.slot,null,[code]);
    throw e;
  }
  if(state.approval?.current)check(state.approval.documentHash===prepared.documentHash,"invalid_reward_final_allocation");
  const after=await readFinalAllocationApprovalV3(actor,scope,deps.rpc);
  if(c&&after.recorded){
    check(after.recorded.contextHash===c.contextHash&&after.recorded.documentHash===c.documentHash
      &&after.recorded.previousApprovalId===c.expectedApprovalId,"reward_allocation_approval_conflict");
    return project(after,scope.slot,null,["historical_acknowledgement"],true);
  }
  check(after.contextHash===state.contextHash);check(same(after.approval,state.approval),"reward_allocation_approval_conflict");verifySource(after,scope.slot,prepared.document);
  if(!c)return project(after,scope.slot,prepared,prepared.reasons);
  check(c.documentHash===prepared.documentHash);
  check(prepared.reasons.length===0&&prepared.funding,"reward_allocation_not_ready");
  const saved=await storeFinalAllocationApprovalV3(actor,scope,{expectedApprovalId:c.expectedApprovalId,contextHash:c.contextHash,
    document:prepared.document,funding:prepared.funding},deps.rpc);
  check(saved.recorded?.id===c.requestId&&saved.recorded.documentHash===c.documentHash,"invalid_reward_final_allocation");
  verifySource(saved,scope.slot,prepared.document);
  return project(saved,scope.slot,prepared,[]);
}

export function composeFinalAllocationUploadV3(facts:Awaited<ReturnType<typeof readFinalAllocationUploadV3>>){
  check(finalAllocationReasonsV3(facts.document).length===0,"invalid_reward_allocation_upload");
  return composeApprovedAllocationUploadV3(facts,facts.document.enabledPot);
}
/** Stable upload package only. Signing, uploading to chain, staging and payout
 * remain separate private worker actions, never side effects of this endpoint. */
export async function finalAllocationUploadV3(identity:RewardAccountIdentity,input:FinalAllocationUploadScopeV3,
  change:AllocationUploadChangeV3|undefined,rpc?:RewardLedgerRpc){
  const actor={...identity},scope={...input},c=change?finalAllocationUploadRequestV3.parse(change):null;
  let facts=await readFinalAllocationUploadV3(actor,scope,rpc);const package_=composeFinalAllocationUploadV3(facts);
  if(facts.prepared)check(same(package_,facts.prepared.package),"invalid_reward_allocation_upload");
  if(c&&!facts.prepared){
    check(facts.current,"reward_allocation_not_ready");check(c.contextHash===facts.contextHash&&c.documentHash===facts.documentHash);
    const state=await readFinalAllocationApprovalV3(actor,scope,rpc);
    check(state.approval?.id===scope.approvalId&&state.approval.current&&state.contextHash===facts.contextHash
      &&state.approval.documentHash===facts.documentHash&&state.registry.registry);
    verifySource(state,scope.slot,facts.document);
    const plan=programmeDeploymentPlanV3(state.registry.context),child=rewardProgrammeChildV3(plan,scope.slot-1);
    check(package_.programmeAddress===plan.context.verifyingContract.toLowerCase()&&package_.campaignAddress===child.context.verifyingContract.toLowerCase()
      &&package_.campaignId===child.campaignId&&package_.programmeId===plan.programmeId&&package_.programmeManifestHash===plan.programmeManifestHash
      &&package_.reviewPeriod===child.reviewPeriod.toString()&&package_.budgetWei===child.budgetWei.toString()
      &&package_.deploymentTransactionHash===state.registry.registry.provenance.transactionHash,"invalid_reward_allocation_upload");
  }
  if(c)facts=await storeFinalAllocationUploadV3(actor,scope,{...c,package:package_},rpc);
  const after=await readFinalAllocationUploadV3(actor,scope,rpc);
  check(after.contextHash===facts.contextHash&&after.current===facts.current&&same(after.prepared,facts.prepared)
    &&same(composeFinalAllocationUploadV3(after),package_));
  return{schema:"raceson-final-allocation-upload-view-v3",chainId:scope.chainId,draftId:scope.draftId,slot:scope.slot,enabledPot:package_.enabledPot,
    approvalId:scope.approvalId,contextHash:after.contextHash,documentHash:after.documentHash,current:after.current,campaignAddress:package_.campaignAddress,
    budgetWei:package_.budgetWei,allocatedWei:package_.allocatedWei,unallocatedWei:package_.unallocatedWei,entitlementCount:package_.entitlementCount,
    prepared:after.prepared?{id:after.prepared.id,packageHash:after.prepared.packageHash,preparedAt:after.prepared.preparedAt}:null,
    stageReady:false,payableWei:"0"};
}
