import type {RewardSponsorSelection} from "@raceson/domain/rewards/distribution-setup";
import {sponsorPreparedSource} from "./sponsorPreparedSource";

/** Display-only projection. This never supplies a source context or readiness. */
export function sponsorPreparedCategoryPreview(selection:RewardSponsorSelection|undefined) {
 if(!selection||selection.sourceLeagueId!==sponsorPreparedSource.sourceLeagueId||selection.sourceSeasonId!==sponsorPreparedSource.sourceSeasonId)return null;
 const round=selection.eventEditionId?sponsorPreparedSource.rounds.find(row=>row.eventEditionId===selection.eventEditionId):null;
 if(selection.eventEditionId!==null&&!round||selection.raceId!==undefined&&!round)return null;
 const track=selection.raceId?round?.tracks.find(row=>row.raceId===selection.raceId):null;
 if(selection.raceId!==undefined&&!track)return null;
 const categories=sponsorPreparedSource.categories.filter(category=>!track||category.target==="individual"&&category.competitionId===track.competitionId);
 return {
  name:track?.name??round?.name??null,
  groups:[...new Set(categories.map(category=>category.competitionId))].map(id=>({
   id,
   name:categories.find(category=>category.competitionId===id)!.competitionName,
   categories:categories.filter(category=>category.competitionId===id),
  })),
 };
}
