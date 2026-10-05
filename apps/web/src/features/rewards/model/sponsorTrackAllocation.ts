import {allocateRewardWeights} from '@raceson/domain/rewards';
import {addGuidedGroup} from '@raceson/domain/rewards/guided-setup-editor';
import {updateSetupNode,type RewardDistributionSetup,type RewardSetupNode} from '@raceson/domain/rewards/distribution-setup';
import type {RewardSourceCatalogueV2} from '@raceson/domain/rewards/source-mapping-v2';

export type SponsorTrack = {id:string;name:string;categoryIds:string[];nodeIds?:string[]};
export function trackContains(track:SponsorTrack,node:RewardSetupNode){
 return track.nodeIds ? track.nodeIds.includes(node.id) : Boolean(node.rule?.source&&track.categoryIds.includes(node.rule.source.categoryId));
}
export function sponsorTrackRows(pot:RewardSetupNode,tracks:SponsorTrack[]){
 return tracks.map(track=>({...track,nodes:pot.children.filter(n=>trackContains(track,n)),shareBps:pot.children.filter(n=>trackContains(track,n)).reduce((sum,n)=>sum+n.shareBps,0)}));
}
/** Preserve the existing flat saved structure. Track controls aggregate its official categories. */
function distribute(total:number,nodes:{id:string;shareBps:number}[],equal=false){
 if(!Number.isInteger(total)||total<0||total>10000)throw Error('invalid_track_allocation');
 const weighted=!equal&&nodes.some(n=>n.shareBps>0);
 return new Map(allocateRewardWeights(BigInt(total),nodes.map(n=>({key:n.id,weight:BigInt(weighted?n.shareBps:1)}))).allocations.map(n=>[n.key,Number(n.amount)]));
}
export function allocateSponsorTracks(configuration:RewardDistributionSetup,potId:string,tracks:SponsorTrack[],change:{id:string;shareBps:number}|null,catalogue?:RewardSourceCatalogueV2|null,hr=false,newId:()=>string=()=>crypto.randomUUID()):RewardDistributionSetup{
 let c=configuration,pot=c.root.children.find(p=>p.id===potId);
 if(!pot||pot.locked||pot.children.some(n=>n.locked)||!tracks.length||new Set(tracks.map(t=>t.id)).size!==tracks.length)throw Error('locked_or_invalid_tracks');
 if(change&&(!tracks.some(t=>t.id===change.id)||!Number.isInteger(change.shareBps)||change.shareBps<0||change.shareBps>10000))throw Error('invalid_track_share');
 // The hosted copy already has fixed nodes. Local catalogue categories are added only by this explicit allocation action.
 if(catalogue)for(const track of tracks)for(const category of catalogue.categories.filter(cat=>track.categoryIds.includes(cat.id)&&cat.target==='individual')){
  if(!c.root.children.find(p=>p.id===potId)!.children.some(n=>n.rule?.source?.categoryId===category.id))c=addGuidedGroup(c,potId,'athlete_standings',newId,category,hr);
 }
 pot=c.root.children.find(p=>p.id===potId)!;
 const rows=sponsorTrackRows(pot,tracks),ids=rows.flatMap(r=>r.nodes.map(n=>n.id));
 if(rows.some(r=>!r.nodes.length)||new Set(ids).size!==ids.length)throw Error('track_categories_unavailable');
 const otherShare=pot.children.filter(n=>!ids.includes(n.id)).reduce((sum,n)=>sum+n.shareBps,0),available=10000-otherShare;
 let shares:Map<string,number>;
 if(!change)shares=distribute(available,rows,true);
 else{
  const peers=rows.filter(r=>r.id!==change.id),requested=Math.min(change.shareBps,available);
  // Excluding the last selected track leaves an explicit empty allocation.
  const remainder=change.shareBps===0&&!peers.some(r=>r.shareBps>0)?0:available-requested;
  shares=distribute(remainder,peers);shares.set(change.id,peers.length?requested:change.shareBps===0?0:available);
 }
 const categoryShares=new Map(rows.flatMap(r=>[...distribute(shares.get(r.id)??0,r.nodes)]));
 return {...c,root:updateSetupNode(c.root,potId,n=>({...n,children:n.children.map(child=>categoryShares.has(child.id)?{...child,shareBps:categoryShares.get(child.id)!}:child)}))};
}
