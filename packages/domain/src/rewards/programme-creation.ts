import { testProgrammeId } from "./test-programme.js";
export type RewardProgrammeSource = { seasonId:string;seasonName:string;organizationId:string;organizationName:string;draftId:string|null };
export type CreateRewardProgramme = { seasonId:string;draftId:string;budgetMon:string };
export function decodeProgrammeSources(value:unknown):RewardProgrammeSource[]{
  if(!Array.isArray(value)||value.length>100)throw new Error("invalid_reward_planning_request");
  const seen=new Set<string>();
  return value.map(v=>{
    if(!v||typeof v!=="object"||Array.isArray(v)||Object.keys(v).sort().join()!=="draftId,organizationId,organizationName,seasonId,seasonName"
      ||!testProgrammeId(v.seasonId)||!testProgrammeId(v.organizationId)||v.draftId!==null&&!testProgrammeId(v.draftId)
      ||[v.seasonName,v.organizationName].some(s=>typeof s!=="string"||!s.trim()||s.length>300)||seen.has(v.seasonId))throw new Error("invalid_reward_planning_request");
    seen.add(v.seasonId);return {...v};
  });
}
export function decodeCreateProgramme(v:unknown):CreateRewardProgramme{
  if(!v||typeof v!=="object"||Array.isArray(v))throw new Error("invalid_reward_planning_request");
  const r=v as Record<string,unknown>;
  if(Object.keys(r).sort().join()!=="budgetMon,draftId,seasonId"||!testProgrammeId(r.seasonId)||!testProgrammeId(r.draftId)
    ||typeof r.budgetMon!=="string"||!(/^[1-9][0-9]{0,6}$/).test(r.budgetMon)||Number(r.budgetMon)>1000000)throw new Error("invalid_reward_planning_request");
  return {seasonId:r.seasonId as string,draftId:r.draftId as string,budgetMon:r.budgetMon};
}
