import {expect,it} from 'vitest';
import {createGuidedSetup,addGuidedGroup} from '@raceson/domain/rewards/guided-setup-editor';
import {sponsorTrackRulesComplete} from './sponsorTrackRules';

function fixture(){
 let i=1;const next=()=>`74000000-0000-4000-8000-${String(i++).padStart(12,'0')}`;
 let c=createGuidedSetup(next);const potId=c.guided!.pots[1].nodeId;
 for(let k=0;k<2;k++)c=addGuidedGroup(c,potId,'athlete_standings',next,null);
 c.budgetMon='1';c.root.children.forEach(p=>{p.shareBps=p.id===potId?10000:0;});
 const pot=c.root.children[1];pot.children.forEach(n=>{n.shareBps=5000;});
 const tracks=pot.children.map((n,i)=>({id:String(i),name:`Track ${i}`,categoryIds:[],nodeIds:[n.id]}));
 return {c,pot,tracks,potId};
}
it('marks existing valid track rules complete without claiming eligibility approval',()=>{
 const {c,tracks,potId}=fixture(),before=JSON.stringify(c);
 expect(tracks.map(t=>sponsorTrackRulesComplete(c,potId,t))).toEqual([true,true]);
 expect(c.guided!.groups.every(g=>!g.eligibilityApproved)).toBe(true);expect(JSON.stringify(c)).toBe(before);
});
it('clears only the invalid track check and excludes zero-share categories',()=>{
 const {c,pot,tracks,potId}=fixture();pot.children[0].rule!.sharesBps=[6000,6000];
 expect(tracks.map(t=>sponsorTrackRulesComplete(c,potId,t))).toEqual([false,true]);
 pot.children[0].shareBps=0;expect(sponsorTrackRulesComplete(c,potId,tracks[0])).toBe(false);
});
it('requires a positive valid prize pool and an included pot',()=>{
 const {c,pot,tracks,potId}=fixture();
 for(const budget of ['','0','invalid']){c.budgetMon=budget;expect(sponsorTrackRulesComplete(c,potId,tracks[0])).toBe(false);}
 c.budgetMon='1';pot.shareBps=0;expect(sponsorTrackRulesComplete(c,potId,tracks[0])).toBe(false);
 expect(sponsorTrackRulesComplete(c,'missing',tracks[0])).toBe(false);
});
