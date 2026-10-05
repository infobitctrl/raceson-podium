import {expect,it} from "vitest";
import {createGuidedSetup,addGuidedGroup} from "@raceson/domain/rewards/guided-setup-editor";
import {finishRewardSetup} from "@raceson/domain/rewards/distribution-setup";
import {sponsorSetupComplete} from "./sponsorSetupComplete";
function setup(){let n=1;const next=()=>`90000000-0000-4000-8000-${String(n++).padStart(12,"0")}`;let c=createGuidedSetup(next);c=addGuidedGroup(c,c.root.children[0].id,"athlete_standings",next,null);c.root.children.forEach((p,i)=>p.shareBps=i===0?10000:0);c.root.children[0].children[0].shareBps=10000;return c;}
it("completes unsourced sponsorship without marking it ready for distributions",()=>{
 const c=setup();expect(sponsorSetupComplete(c)).toBe(true);
 expect(c.guided!.groups[0].eligibilityApproved).toBe(false);expect(c.context).toBeNull();
 expect(()=>finishRewardSetup(c)).toThrow();
});
it("requires every funded pot and prize split to be balanced",()=>{
 const c=setup();c.root.children[0].shareBps=9000;c.root.children[1].shareBps=1000;expect(sponsorSetupComplete(c)).toBe(false);
 const prizes=setup();prizes.root.children[0].children[0].rule!.sharesBps=[9000];expect(sponsorSetupComplete(prizes)).toBe(false);
 const categories=setup();categories.root.children[0].children[0].shareBps=11000;expect(sponsorSetupComplete(categories)).toBe(false);
});
it("rejects invalid budget or no funded rewards",()=>{
 const c=setup();c.budgetMon="0";expect(sponsorSetupComplete(c)).toBe(false);
 c.budgetMon="bad";expect(sponsorSetupComplete(c)).toBe(false);
 c.budgetMon="100000";c.root.children[0].children[0].shareBps=0;expect(sponsorSetupComplete(c)).toBe(false);
});
