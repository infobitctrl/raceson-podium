import {expect,it} from "vitest";
import {createGuidedSetup,addGuidedGroup,bindGuidedSeason} from "@raceson/domain/rewards/guided-setup-editor";
import {decodeStoredRewardSnapshot} from "@raceson/domain/rewards/published-preview-v2";
import {publishedSnapshot,id} from "../../../../../../apps/api/test/fixtures/published-reward-v2.mjs";
import {applySponsorCategorySettings} from "./applySponsorCategorySettings";
function fixture(){let seq=9000;const next=()=>id(seq++),catalogue=decodeStoredRewardSnapshot(publishedSnapshot()).catalogue;
 let c=bindGuidedSeason(createGuidedSetup(next),{draftId:id(90),roundId:null,editionId:null,catalogueHash:"a".repeat(64),programmeName:"Season",eventName:"Season"},catalogue);
 for(const category of catalogue.categories.slice(0,2))c=addGuidedGroup(c,c.root.children[0].id,category.target==="club"?"club_standings":"athlete_standings",next,category);
 c=addGuidedGroup(c,c.root.children[0].id,"athlete_finishes",next,null);
 c=addGuidedGroup(c,c.root.children[0].id,"athlete_metres",next,null);
 c=addGuidedGroup(c,c.root.children[1].id,"athlete_standings",next,null);
 c.root.children[0].children.forEach((n,i)=>{n.shareBps=2500;n.locked=i===0;});
 c.guided!.groups.forEach(g=>g.eligibilityApproved=true);return c;
}
it("updates several prize rules atomically without changing budgets, sources, locks or other pots",()=>{
 const c=fixture(),before=JSON.stringify(c),pot=c.root.children[0],ids=pot.children.slice(0,2).map(n=>n.id);
 const result=applySponsorCategorySettings(c,pot.id,ids,{method:"ranked",minimumFinishes:1,sharesBps:[6000,3000,1000]});
 expect(JSON.stringify(c)).toBe(before);
 expect(result.root.children.slice(1)).toEqual(c.root.children.slice(1));
 result.root.children[0].children.forEach((n,i)=>{
  if(i<2){expect(n).toEqual({...pot.children[i],rule:{...pot.children[i].rule,sharesBps:[6000,3000,1000]}});expect(result.guided!.groups.find(g=>g.nodeId===n.id)?.eligibilityApproved).toBe(false);}
  else expect(n).toEqual(pot.children[i]);
 });
 expect(result.root.children[0].children.reduce((a,n)=>a+n.shareBps,0)).toBe(10000);
});
it("applies shared participation rules while preserving each contribution type",()=>{
 const c=fixture(),pot=c.root.children[0],ids=pot.children.slice(2).map(n=>n.id);
 const result=applySponsorCategorySettings(c,pot.id,ids,{method:"ranked",minimumFinishes:3,sharesBps:[10000]});
 expect(result.guided!.groups.filter(g=>ids.includes(g.nodeId)).map(g=>[g.type,g.method,g.minimumFinishes])).toEqual([["athlete_finishes","ranked",3],["athlete_metres","ranked",3]]);
});
it("rejects mixed families, cross-pot selections and incomplete prize percentages",()=>{
 const c=fixture(),pot=c.root.children[0],ids=pot.children.map(n=>n.id),settings={method:"ranked" as const,minimumFinishes:1,sharesBps:[10000]};
 for(const selected of [[],[ids[0],ids[0]],[ids[0],ids[2]],[ids[0],c.root.children[1].children[0].id]])expect(()=>applySponsorCategorySettings(c,pot.id,selected,settings)).toThrow();
 expect(()=>applySponsorCategorySettings(c,pot.id,[ids[0]],{...settings,sharesBps:[6000,2000]})).toThrow();
 expect(()=>applySponsorCategorySettings(c,pot.id,[ids[0]],{...settings,method:"proportional",sharesBps:[]})).toThrow();
});
