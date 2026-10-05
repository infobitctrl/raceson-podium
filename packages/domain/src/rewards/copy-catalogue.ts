import {setupId} from './distribution-setup.js';
export type CopyCatalogue = {
 name:string; sourceLeagueId:string; sourceSeasonId:string; status:'completed'; checkedAt:string;
 categories:{id:string;competitionId:string;competitionName:string;name:string;target:'individual'}[];
 rounds:{slot:number;roundId:string;sourceRoundId:string;eventEditionId:string;editionId:string;name:string;date:string;status:'completed';
  tracks:{raceId:string;sourceRaceId:string;competitionId:string;name:string;distanceMetres:string}[]}[];
};
/** Display metadata only. It is never an eligibility or execution approval. */
export function decodeCopyCatalogue(raw:unknown):CopyCatalogue {
 const bad=():never=>{throw Error('invalid_copy_catalogue');};
 if(!raw||typeof raw!=='object')return bad();
 const c=raw as CopyCatalogue, label=(v:unknown)=>typeof v==='string'&&v.length>0&&v.length<=200;
 if(!setupId(c.sourceLeagueId)||!setupId(c.sourceSeasonId)||!label(c.name)||c.status!=='completed'||!Number.isFinite(Date.parse(c.checkedAt))
  ||!Array.isArray(c.categories)||c.categories.length!==7||!Array.isArray(c.rounds)||c.rounds.length!==5)return bad();
 const ids=new Set<string>();
 for(const cat of c.categories){if(!setupId(cat.id)||ids.has(cat.id)||!setupId(cat.competitionId)||!label(cat.name)||!label(cat.competitionName)||cat.target!=='individual')return bad();ids.add(cat.id);}
 for(const [i,r] of c.rounds.entries()){
  if(r.slot!==i+1||!setupId(r.roundId)||r.sourceRoundId!==r.roundId||!setupId(r.eventEditionId)||r.editionId!==r.eventEditionId||!label(r.name)||r.status!=='completed'
   ||typeof r.date!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(r.date)||!Number.isFinite(Date.parse(r.date))||!Array.isArray(r.tracks)||r.tracks.length!==2||ids.has(r.roundId))return bad();
  ids.add(r.roundId);
  for(const t of r.tracks){if(!setupId(t.raceId)||t.sourceRaceId!==t.raceId||ids.has(t.raceId)||!c.categories.some(cat=>cat.competitionId===t.competitionId)||!label(t.name)||typeof t.distanceMetres!=='string'||! /^[1-9][0-9]{0,8}$/.test(t.distanceMetres))return bad();ids.add(t.raceId);}
 }
 return c;
}
