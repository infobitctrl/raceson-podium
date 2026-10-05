import {describe,expect,it} from "vitest";
import {calculateTestProgramme,createTestProgramme} from "./testRewardProgramme";
describe("configurable test programme",()=>{
  it("uses ten recurring synthetic athletes across two rounds",()=>{
    const results=createTestProgramme(2,10), value=calculateTestProgramme(100,results,"rank");
    expect(value.allocations.flat()).toHaveLength(20);
    expect(new Set(value.allocations.flat().map(row=>row.athlete)).size).toBe(10);
    expect(value.totals.reduce((a,b)=>a+b,0n)).toBe(100n*10n**18n);
  });
  it("conserves every wei across uneven budgets and rank weights",()=>{
    for(let rounds=1;rounds<=5;rounds++) for(let athletes=2;athletes<=20;athletes++) for(const rule of ["equal","rank"] as const){
      const value=calculateTestProgramme(101,createTestProgramme(rounds,athletes),rule);
      expect(value.totals.reduce((a,b)=>a+b,0n)).toBe(value.budget);
      value.allocations.forEach((rows,i)=>expect(rows.reduce((a,b)=>a+b.amount,0n)).toBe(value.roundBudgets[i]));
    }
  });
  it("rejects duplicate results and invalid sizes",()=>{
    expect(()=>calculateTestProgramme(100,[[0,0]],"rank")).toThrow();
    expect(()=>createTestProgramme(0,10)).toThrow();
    expect(()=>calculateTestProgramme(NaN,[[0,1]],"equal")).toThrow();
  });
});
