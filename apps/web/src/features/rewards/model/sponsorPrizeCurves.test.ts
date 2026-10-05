import {expect,it} from "vitest";
import {identifySponsorCurve,sponsorPrizeShares} from "./sponsorPrizeCurves";

it("keeps every supported winner count positive, ordered and exactly within the pot",()=>{
  for(const curve of ["equal","descending","exponential"] as const)for(let count=1;count<=100;count++){
    const shares=sponsorPrizeShares(count,curve);
    expect(shares).toHaveLength(count);expect(shares.reduce((a,b)=>a+b,0)).toBe(10000);
    expect(shares.every((v,i)=>Number.isInteger(v)&&v>0&&(i===0||v<=shares[i-1]))).toBe(true);
  }
});
it("recovers saved presets and preserves custom shares without silently normalizing them",()=>{
  expect(identifySponsorCurve(sponsorPrizeShares(5,"exponential"))).toBe("exponential");
  expect(identifySponsorCurve([7000,2000,1000])).toBe("custom");
  expect(identifySponsorCurve([6000,6000])).toBe("custom");
  for(const count of [0,101,1.5,NaN])expect(()=>sponsorPrizeShares(count,"exponential")).toThrow();
});
