import {expect,it} from "vitest";
import {sponsorBudgetAmount,sponsorAmountShare,sponsorPotBranches,splitSponsorSections,splitSponsorRoundsEqually,setSponsorRoundShare} from "./sponsorBudget";
import {createGuidedSetup,addGuidedGroup} from "@raceson/domain/rewards/guided-setup-editor";
import {decodeRewardSetup} from "@raceson/domain/rewards/distribution-setup";
it("preserves wei in editable amounts and bounds basis-point rounding",()=>{
 expect(sponsorBudgetAmount(1000000000000000001n)).toBe("1.000000000000000001");
 expect(sponsorBudgetAmount(0n)).toBe("0");expect(sponsorBudgetAmount(null)).toBe("");
 expect(sponsorAmountShare("50000","100000")).toBe(5000);
 expect(sponsorAmountShare("49995","100000")).toBe(5000);
 expect(sponsorAmountShare("0.000000000000000001","0.000000000000000002")).toBe(5000);
 for(const value of ["-1","NaN","100001","1e3"])expect(()=>sponsorAmountShare(value,"100000")).toThrow();
 expect(()=>sponsorAmountShare("1","0")).toThrow();
});
const draft=()=>createGuidedSetup(()=>crypto.randomUUID());
it("splits sections and rounds exactly while preserving category rules and source identifiers",()=>{
 let c=draft();c=addGuidedGroup(c,c.root.children[1].id,"athlete_standings",()=>crypto.randomUUID(),null);
 const group=c.root.children[1].children[0],meta=c.guided;
 c=splitSponsorSections(c,3333);
 expect(c.root.children.map(n=>n.shareBps).reduce((a,b)=>a+b,0)).toBe(10000);
 expect(c.root.children[0].shareBps).toBe(3333);
 c=setSponsorRoundShare(c,c.root.children[1].id,4000);
 expect(c.root.children[1].shareBps).toBe(2667);
 expect(sponsorPotBranches(c).roundsBps).toBe(6667);
 c=splitSponsorRoundsEqually(c);
 expect(sponsorPotBranches(c).rounds.map(n=>n.shareBps).sort()).toEqual([1333,1333,1333,1334,1334]);
 expect(c.guided).toBe(meta);expect(c.root.children[1].children[0]).toBe(group);
 expect(decodeRewardSetup(c)).toEqual(c);
});
it("handles zero round pots and protects locked shares and invalid edits",()=>{
 const c=draft(),zero=splitSponsorSections(c,10000);
 expect(sponsorPotBranches(zero).rounds.every(n=>n.shareBps===0)).toBe(true);
 expect(()=>setSponsorRoundShare(zero,zero.root.children[1].id,5000)).toThrow();
 expect(sponsorPotBranches(splitSponsorSections(zero,5000)).rounds.map(n=>n.shareBps)).toEqual([1000,1000,1000,1000,1000]);
 for(const n of [-1,10001,0.5,NaN])expect(()=>splitSponsorSections(c,n)).toThrow();
 c.root.children[2].locked=true;
 expect(()=>splitSponsorSections(c,7000)).toThrow();
 expect(()=>splitSponsorRoundsEqually(c)).toThrow();
 expect(()=>setSponsorRoundShare(c,c.root.children[1].id,5000)).toThrow();
});
