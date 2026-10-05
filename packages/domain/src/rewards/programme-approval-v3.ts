import { decodeSavedRewardPlanningDraft, type SavedRewardPlanningDraft } from "./programme-draft-v2.js";
import { decodeRewardMappingWorkspaceV2, validateRewardSourceMappingV2, type RewardMappingWorkspaceV2 } from "./source-mapping-v2.js";
export type ProgrammeFundingTermsV3 = { funderAddress: string; operatorAddress: string; reviewPeriods: number[] };
export type ProgrammeApprovalV3 = { id: string; rulesRevision: number; mappingRevision: number; contextHash: string;
  terms: ProgrammeFundingTermsV3; approvedAt: string; current: boolean };
export type ProgrammeApprovalViewV3 = { schema: "raceson-programme-approval-v3"; record: SavedRewardPlanningDraft;
  workspace: RewardMappingWorkspaceV2; contextHash: string; approval: ProgrammeApprovalV3 | null; operationsEnabled: false };
function check(v: unknown): asserts v { if (!v) throw new Error("invalid_reward_programme_approval"); }
function object(v: unknown, keys: string) {
  check(v && typeof v === "object" && !Array.isArray(v)); const r=v as Record<string,unknown>;
  check(Object.keys(r).sort().join(",")===keys.split(",").sort().join(","));return r;
}
function hash(v:unknown):string {check(typeof v==="string"&&/^[0-9a-f]{64}$/.test(v));return v}
function revision(v:unknown):number {check(Number.isInteger(v)&&Number(v)>0&&Number(v)<=2147483645);return v as number}
export function programmeApprovalRequestIdV3(v:unknown):string {
  check(typeof v==="string"&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(v)&&BigInt(`0x${v.replaceAll("-","")}`)!==0n);return v;
}
export function decodeProgrammeFundingTermsV3(value:unknown):ProgrammeFundingTermsV3 {
  const r=object(value,"funderAddress,operatorAddress,reviewPeriods");
  const address=(v:unknown)=>{check(typeof v==="string"&&/^0x[0-9a-fA-F]{40}$/.test(v)&&BigInt(v)!==0n);return v.toLowerCase()};
  const funderAddress=address(r.funderAddress),operatorAddress=address(r.operatorAddress);
  check(funderAddress!==operatorAddress&&Array.isArray(r.reviewPeriods)&&r.reviewPeriods.length===6);
  const reviewPeriods=r.reviewPeriods.map(v=>{check(Number.isInteger(v)&&v>=0&&v<=2592000);return v as number});
  return{funderAddress,operatorAddress,reviewPeriods};
}
export function decodeProgrammeApprovalV3(value:unknown):ProgrammeApprovalViewV3 {
  const r=object(value,"schema,record,workspace,contextHash,approval,operationsEnabled");
  check(r.schema==="raceson-programme-approval-v3"&&r.operationsEnabled===false);
  const record=decodeSavedRewardPlanningDraft(r.record),workspace=decodeRewardMappingWorkspaceV2(r.workspace),contextHash=hash(r.contextHash);
  check(workspace.draftId===record.draftId&&workspace.rulesRevision===record.revision);
  let approval:ProgrammeApprovalV3|null=null;
  if(r.approval!==null){
    const a=object(r.approval,"id,rulesRevision,mappingRevision,contextHash,terms,approvedAt,current");
    const id=programmeApprovalRequestIdV3(a.id),rulesRevision=revision(a.rulesRevision),mappingRevision=revision(a.mappingRevision),approvedHash=hash(a.contextHash);
    check(typeof a.approvedAt==="string"&&Number.isFinite(Date.parse(a.approvedAt))&&typeof a.current==="boolean"
      &&a.current===(approvedHash===contextHash));
    if(a.current)check(rulesRevision===record.revision&&mappingRevision===workspace.revision);
    approval={id,rulesRevision,mappingRevision,contextHash:approvedHash,terms:decodeProgrammeFundingTermsV3(a.terms),approvedAt:a.approvedAt,current:a.current};
  }
  return{schema:"raceson-programme-approval-v3",record,workspace,contextHash,approval,operationsEnabled:false};
}
/** Completeness of funding scope only; never payout/readiness/identity approval. */
export function programmeApprovalMissingSlotsV3(workspace:RewardMappingWorkspaceV2):number[] {
  const w=decodeRewardMappingWorkspaceV2(workspace);
  validateRewardSourceMappingV2(w.mapping,w.catalogue);
  return w.mapping.rounds.filter(r=>!r.roundId||!w.catalogue.rounds.some(c=>c.id===r.roundId&&c.slot===r.slot&&c.status!=="cancelled"&&c.races.length>0)).map(r=>r.slot);
}
