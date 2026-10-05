import {expect,it} from 'vitest';
import {createGuidedSetup,addGuidedGroup} from '@raceson/domain/rewards/guided-setup-editor';
import {decodeRewardSetup,previewRewardSetup} from '@raceson/domain/rewards/distribution-setup';
import {allocateSponsorTracks,sponsorTrackRows,type SponsorTrack} from './sponsorTrackAllocation';
export function trackFixture(){
 let i=1;const next=()=>`73000000-0000-4000-8000-${String(i++).padStart(12,'0')}`;
 let c=createGuidedSetup(next);const potId=c.guided!.pots[5].nodeId;
 for(let k=0;k<3;k++)c=addGuidedGroup(c,potId,'athlete_standings',next,null);
 c=addGuidedGroup(c,potId,'club_standings',next,null);
 c.budgetMon='100.000000000000000001';
 c.root.children=c.root.children.map(n=>({...n,shareBps:n.id===potId?10000:0}));
 const nodes=c.root.children[5].children;
 const tracks:SponsorTrack[]=[{id:'long',name:'Velika',categoryIds:[],nodeIds:[nodes[0].id]},{id:'short',name:'Mala',categoryIds:[],nodeIds:[nodes[1].id,nodes[2].id]}];
 return {c,potId,tracks};
}
it('splits tracks equally despite different category counts and preserves all stored identities and prize rules',()=>{
 const {c,potId,tracks}=trackFixture(),next=allocateSponsorTracks(c,potId,tracks,null),pot=next.root.children[5];
 expect(sponsorTrackRows(pot,tracks).map(r=>r.shareBps)).toEqual([5000,5000]);
 expect(pot.children.map(n=>n.shareBps)).toEqual([5000,2500,2500,0]);
 expect(next.guided).toEqual(c.guided);expect(next.sponsorSelection).toEqual(c.sponsorSelection);
 expect(next.root.children.slice(0,5)).toEqual(c.root.children.slice(0,5));
 expect(pot.children.map(({shareBps,...rest})=>rest)).toEqual(c.root.children[5].children.map(({shareBps,...rest})=>rest));
 expect(decodeRewardSetup(next)).toEqual(next);
 const preview=previewRewardSetup(next);expect(preview.retainedWei).toBe(0n);
 expect(pot.children.reduce((sum,n)=>sum+preview.rows.find(r=>r.id===n.id)!.amountWei!,0n)).toBe(preview.budgetWei);
});
it('rebalances exact track percentages, exclusions and reloads without losing category prize weights',()=>{
 const {c,potId,tracks}=trackFixture();let next=allocateSponsorTracks(c,potId,tracks,null);
 for(const value of [6000,3333,9999,1,0,7500]){
  next=allocateSponsorTracks(next,potId,tracks,{id:'long',shareBps:value});
  expect(sponsorTrackRows(next.root.children[5],tracks).map(r=>r.shareBps)).toEqual([value,10000-value]);
  expect(decodeRewardSetup(JSON.parse(JSON.stringify(next)))).toEqual(next);
 }
 next=allocateSponsorTracks(next,potId,tracks,{id:'short',shareBps:0});
 expect(next.root.children[5].children.map(n=>n.shareBps)).toEqual([10000,0,0,0]);
 next=allocateSponsorTracks(next,potId,tracks,{id:'long',shareBps:0});
 expect(next.root.children[5].children.every(n=>n.shareBps===0)).toBe(true);
});
it('preserves club rewards and relative category ratios while redistributing track budgets',()=>{
 const {c,potId,tracks}=trackFixture();c.root.children[5].children.forEach((n,i)=>{n.shareBps=[4000,1000,3000,2000][i];});
 const next=allocateSponsorTracks(c,potId,tracks,{id:'long',shareBps:6000});
 expect(next.root.children[5].children.map(n=>n.shareBps)).toEqual([6000,500,1500,2000]);
});
it('rejects locked, duplicate, missing and invalid track allocations without mutating the original',()=>{
 const {c,potId,tracks}=trackFixture(),before=JSON.stringify(c);
 for(const value of [-1,10001,0.1,NaN])expect(()=>allocateSponsorTracks(c,potId,tracks,{id:'long',shareBps:value})).toThrow();
 expect(()=>allocateSponsorTracks(c,potId,[tracks[0],tracks[0]],null)).toThrow();
 expect(()=>allocateSponsorTracks(c,potId,[{...tracks[0],nodeIds:[]}],null)).toThrow();
 expect(JSON.stringify(c)).toBe(before);
 c.root.children[5].children[0].locked=true;expect(()=>allocateSponsorTracks(c,potId,tracks,null)).toThrow();
});
it('uses official category IDs when creating local track groups, independent of labels',()=>{
 let i=100;const next=()=>`73000000-0000-4000-8000-${String(i++).padStart(12,'0')}`;
 const c=createGuidedSetup(next),roundId=next(),categoryId=next(),competitionId=next();
 c.context={draftId:next(),roundId:null,editionId:null,catalogueHash:'a'.repeat(64),programmeName:'Source',eventName:'Event'};
 c.guided!.pots[5].roundId=roundId;
 const catalogue={rounds:[{id:roundId,editionId:next(),slot:5,name:'Race',date:'2026-10-04',status:'completed',races:[{id:next(),competitionId,name:'Mala',distanceMetres:'5000',publicationId:null,publicationState:null,resultCount:0}]}],categories:[{id:categoryId,competitionId,competitionName:'Short',name:'Category',target:'individual' as const,eligibility:{}}]};
 const track={id:catalogue.rounds[0].races[0].id,name:'Mala',categoryIds:[categoryId]};
 const result=allocateSponsorTracks(c,c.guided!.pots[5].nodeId,[track],null,catalogue,false,next);
 expect(result.root.children[5].children).toHaveLength(1);
 expect(result.root.children[5].children[0]).toMatchObject({shareBps:10000,rule:{source:{roundId,categoryId}}});
 expect(result.root.children.slice(0,5)).toEqual(c.root.children.slice(0,5));
 expect(allocateSponsorTracks(result,c.guided!.pots[5].nodeId,[track],null,catalogue,false,next).root.children[5].children).toHaveLength(1);
});
