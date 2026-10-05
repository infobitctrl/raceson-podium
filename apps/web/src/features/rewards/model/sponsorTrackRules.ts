import {previewRewardSetup,type RewardDistributionSetup} from '@raceson/domain/rewards/distribution-setup';
import {sponsorTrackRows,type SponsorTrack} from './sponsorTrackAllocation';

/** Configuration completeness only; this never indicates approval, funding or payment. */
export function sponsorTrackRulesComplete(c:RewardDistributionSetup,potId:string,track:SponsorTrack){
 const pot=c.root.children.find(n=>n.id===potId);
 if(!pot||pot.shareBps<=0)return false;
 const included=sponsorTrackRows(pot,[track])[0].nodes.filter(n=>n.shareBps>0);
 if(!included.length)return false;
 try{
  const preview=previewRewardSetup(c);
  return preview.budgetWei>0n&&included.every(n=>{
   const row=preview.rows.find(r=>r.id===n.id);
   return c.guided?.groups.some(g=>g.nodeId===n.id)&&row?.issue===null&&row.amountWei!==null;
  });
 }catch{return false;}
}
