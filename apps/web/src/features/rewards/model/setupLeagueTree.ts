import {presetSetupShares, type RewardSetupContext, type RewardSetupNode} from '@raceson/domain/rewards/distribution-setup';
import type {RewardSourceCatalogueV2} from '@raceson/domain/rewards/source-mapping-v2';

export type LeagueRewardOption = {
  key:string; name:string; scopeName:string;
  category:RewardSourceCatalogueV2['categories'][number]; roundId:string|null;
};
export function leagueRewardOptions(catalogue:RewardSourceCatalogueV2, context:RewardSetupContext, hr=false):LeagueRewardOption[] {
  const rounds=catalogue.rounds.filter(r=>r.status!=='cancelled'&&(!context.roundId||r.id===context.roundId));
  return [
    ...(context.roundId?[]:catalogue.categories.map(category=>({key:`league|${category.id}`,name:`${category.competitionName} · ${category.name}`,scopeName:hr?'Liga':'League',category,roundId:null}))),
    ...rounds.flatMap(round=>catalogue.categories.filter(c=>round.races.some(r=>r.competitionId===c.competitionId)).map(category=>({key:`${round.id}|${category.id}`,name:`${category.competitionName} · ${category.name}`,scopeName:round.name,category,roundId:round.id}))),
  ];
}
// New distributions group season awards separately from individual rounds. Existing
// allocations are never passed through this generator on load or source selection.
export function generateLeagueSetupTree(root:RewardSetupNode, context:RewardSetupContext, selected:Array<LeagueRewardOption & {winners:number}>, newId:()=>string, hr=false):RewardSetupNode {
  if(!selected.length||selected.some(o=>!Number.isInteger(o.winners)||o.winners<1||o.winners>100))throw Error('invalid selection');
  const group=(name:string,children:RewardSetupNode[]):RewardSetupNode=>{
    if(children.length>50)throw Error('too many groups');
    const shares=presetSetupShares(children.length);
    return {id:newId(),name:name.slice(0,100),shareBps:10000,locked:false,rule:null,children:children.map((node,i)=>({...node,shareBps:shares[i]}))};
  };
  const leaves=(options:typeof selected)=>options.map((o):RewardSetupNode=>({id:newId(),name:o.name.slice(0,100),shareBps:0,locked:false,children:[],rule:{basis:o.category.target==='club'?'club_points':o.roundId?'race_position':'league_position',sharesBps:presetSetupShares(o.winners,'descending'),source:{draftId:context.draftId,roundId:o.roundId,categoryId:o.category.id,catalogueHash:context.catalogueHash}}}));
  const league=selected.filter(o=>o.roundId===null),roundIds=[...new Set(selected.flatMap(o=>o.roundId?[o.roundId]:[]))];
  const rounds=roundIds.map(roundId=>{const options=selected.filter(o=>o.roundId===roundId);return group(options[0].scopeName,leaves(options));});
  const children=[...(league.length?[group(hr?'Liga':'League',leaves(league))]:[]),...(rounds.length?[group(hr?'Kola':'Rounds',rounds)]:[])];
  const generated=group(root.name,children);
  return {...root,rule:null,children:generated.children};
}
