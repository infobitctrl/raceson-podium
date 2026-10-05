import {expect,it} from "vitest";
import type {RewardSetupNode} from "@raceson/domain/rewards/distribution-setup";
import {balanceSponsorCategories,setSponsorCategoryShare} from "./sponsorCategoryAllocation";
const node=(id:string,shareBps:number,locked=false):RewardSetupNode=>({id,name:id,shareBps,locked,children:[],rule:null});
const total=(nodes:RewardSetupNode[])=>nodes.reduce((sum,n)=>sum+n.shareBps,0);
it("normalizes old zero allocations and conserves every basis point over repeated edits",()=>{
 let nodes=balanceSponsorCategories(Array.from({length:11},(_,i)=>node(String(i),0)));
 expect(total(nodes)).toBe(10000);expect(Math.max(...nodes.map(n=>n.shareBps))-Math.min(...nodes.map(n=>n.shareBps))).toBeLessThanOrEqual(1);
 for(let i=0;i<200;i++){
  nodes=setSponsorCategoryShare(nodes,String(i%11),(i*7919)%10001);
  expect(total(nodes)).toBe(10000);expect(nodes.every(n=>Number.isInteger(n.shareBps)&&n.shareBps>=0)).toBe(true);
 }
});
it("keeps locks fixed, redistributes proportionally and clamps to available budget",()=>{
 const nodes=[node("a",2000,true),node("b",3000),node("c",1000),node("d",4000)];
 const next=setSponsorCategoryShare(nodes,"b",5000);
 expect(next.map(n=>n.shareBps)).toEqual([2000,5000,600,2400]);
 expect(setSponsorCategoryShare(nodes,"b",9500).map(n=>n.shareBps)).toEqual([2000,8000,0,0]);
 expect(setSponsorCategoryShare(nodes,"a",5000)).toEqual(nodes);
 expect(balanceSponsorCategories(nodes,true).map(n=>n.shareBps)).toEqual([2000,2667,2667,2666]);
});
it("handles sole unlocked category, zero peers, empty pots and impossible legacy locks",()=>{
 expect(setSponsorCategoryShare([node("a",4000,true),node("b",6000)],"b",1000).map(n=>n.shareBps)).toEqual([4000,6000]);
 expect(setSponsorCategoryShare([node("a",10000),node("b",0),node("c",0)],"a",0).map(n=>n.shareBps)).toEqual([0,5000,5000]);
 expect(balanceSponsorCategories([])).toEqual([]);
 expect(()=>balanceSponsorCategories([node("a",6000,true)])).toThrow();
 expect(()=>balanceSponsorCategories([node("a",11000,true),node("b",0)])).toThrow();
});
