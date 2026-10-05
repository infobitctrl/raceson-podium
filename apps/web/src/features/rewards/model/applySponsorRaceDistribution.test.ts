import {expect,it} from "vitest";
import {createGuidedSetup,addGuidedGroup,bindGuidedSeason} from "@raceson/domain/rewards/guided-setup-editor";
import {decodeStoredRewardSnapshot} from "@raceson/domain/rewards/published-preview-v2";
import {publishedSnapshot,id} from "../../../../../../apps/api/test/fixtures/published-reward-v2.mjs";
import {applySponsorRaceDistribution} from "./applySponsorRaceDistribution";
function fixture(bound=false){let seq=8000;const next=()=>id(seq++),catalogue=decodeStoredRewardSnapshot(publishedSnapshot()).catalogue;let c=createGuidedSetup(next);
 if(bound)c=bindGuidedSeason(c,{draftId:id(90),roundId:null,editionId:null,catalogueHash:"a".repeat(64),programmeName:"Season",eventName:"Season"},catalogue);
 c=addGuidedGroup(c,c.root.children[1].id,"athlete_standings",next,bound?catalogue.categories[0]:null);
 c.root.children[1].children[0].shareBps=10000;c.root.children[1].children[0].locked=true;c.root.children[1].children[0].rule!.sharesBps=[7000,2000,1000];
 c.guided!.groups[0].eligibilityApproved=true;return {c,next,catalogue};
}
it("copies draft rules only to selected races, preserving pots and separating group IDs",()=>{
 const {c,next}=fixture(),before=JSON.stringify(c),result=applySponsorRaceDistribution(c,c.root.children[1].id,[c.root.children[2].id,c.root.children[3].id],null,next);
 expect(JSON.stringify(c)).toBe(before);expect(result.root.children.map(p=>p.shareBps)).toEqual(c.root.children.map(p=>p.shareBps));
 expect(result.root.children[0]).toEqual(c.root.children[0]);expect(result.root.children[4]).toEqual(c.root.children[4]);
 for(const pot of result.root.children.slice(2,4)){expect(pot.children[0]).toMatchObject({shareBps:10000,locked:true,rule:{sharesBps:[7000,2000,1000],source:null}});expect(result.guided!.groups.find(g=>g.nodeId===pot.children[0].id)?.eligibilityApproved).toBe(false);}
 const ids=result.root.children.flatMap(p=>p.children.map(n=>n.id));expect(new Set(ids).size).toBe(3);
});
it("rebinds compatible official sources to each target round and leaves unmapped rounds unsourced",()=>{
 const {c,next,catalogue}=fixture(true),targets=c.root.children.slice(2).map(p=>p.id),result=applySponsorRaceDistribution(c,c.root.children[1].id,targets,catalogue,next);
 expect(result.root.children[2].children[0].rule!.source?.roundId).toBe(c.guided!.pots[2].roundId);
 expect(result.root.children[2].children[0].rule!.source?.roundId).not.toBe(c.guided!.pots[1].roundId);
 expect(result.root.children[5].children[0].rule!.source).toBeNull();
});
it("rejects league targets, unknown targets and empty source distributions",()=>{
 const {c,next}=fixture(),source=c.root.children[1].id;
 expect(()=>applySponsorRaceDistribution(c,source,[c.root.children[0].id],null,next)).toThrow();
 expect(()=>applySponsorRaceDistribution(c,source,[id(999)],null,next)).toThrow();
 expect(()=>applySponsorRaceDistribution(c,c.root.children[2].id,[source],null,next)).toThrow();
});
