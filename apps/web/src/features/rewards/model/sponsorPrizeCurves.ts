import {allocateRewardWeights} from "@raceson/domain/rewards";
import {presetSetupShares} from "@raceson/domain/rewards/distribution-setup";
export type SponsorPrizeCurve="equal"|"descending"|"exponential";
export function sponsorPrizeShares(count:number,curve:SponsorPrizeCurve):number[]{
  if(curve!=="exponential")return presetSetupShares(count,curve);
  if(!Number.isInteger(count)||count<1||count>100)throw Error("invalid_prize_count");
  // A bounded geometric series: first weight is ten times the last. Even at
  // 100 places every recipient retains a positive basis-point share.
  return allocateRewardWeights(10000n,Array.from({length:count},(_,i)=>({key:String(i).padStart(3,"0"),weight:BigInt(Math.round(1_000_000*Math.pow(10,count===1?0:-i/(count-1))))}))).allocations.map(row=>Number(row.amount));
}
export function identifySponsorCurve(shares:number[]):SponsorPrizeCurve|"custom"{
  for(const curve of ["equal","descending","exponential"] as const){
    if(JSON.stringify(shares)===JSON.stringify(sponsorPrizeShares(shares.length,curve)))return curve;
  }
  return "custom";
}
