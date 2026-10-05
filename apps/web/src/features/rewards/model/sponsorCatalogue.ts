import type {DirectoryCampaign} from "@raceson/domain/rewards/public-directory";
import type {RewardSponsorSelection} from "@raceson/domain/rewards/distribution-setup";
import valley from "../assets/sitrail-valley.jpeg";
import wordmark from "../assets/sitrail-wordmark.png";
import subicevac from "../assets/subicevac.jpeg";
import raslina from "../assets/raslina.jpeg";
import trtar from "../assets/trtar.png";
import vrpolje from "../assets/vrpolje.jpeg";
import {staticAssetUrl} from "@/lib/static-asset";
import {sponsorPreparedSource as source} from "./sponsorPreparedSource";

// Artwork is presentation only; sporting identities and labels come from the capture.
export const sponsorArtwork = {league:staticAssetUrl(valley),logo:staticAssetUrl(wordmark)};
export const roundArtwork=[vrpolje,valley,trtar,raslina,subicevac].map(staticAssetUrl);
type Category={id:string;competitionId:string;competitionName:string;name:string;target:string};
type CatalogueSource={sourceLeagueId:string;sourceSeasonId:string;categories:readonly Category[];rounds:readonly {slot:number;roundId:string;sourceRoundId:string;eventEditionId:string;editionId:string;name:string;date:string;status:string;tracks:readonly {raceId:string;sourceRaceId:string;competitionId:string;name:string;distanceMetres:string|null}[]}[]};
export type SponsorCatalogueItem={id:string;kind:"race"|"track";name:string;image:string;detail:string;parent:string;parentName:string;
 sourceLeagueId:string;sourceSeasonId:string;eventEditionId:string;editionId:string;roundId:string;sourceRoundId:string;date:string;status:string;
 raceId?:string;sourceRaceId?:string;competitionId?:string;categories:readonly Category[]};
export const sponsorLeague={id:source.sourceLeagueId,name:"Šibenik Trail League",sourceLeagueId:source.sourceLeagueId,sourceSeasonId:source.sourceSeasonId,
 categories:source.categories,roundCount:source.rounds.length,trackCount:source.rounds.reduce((sum,r)=>sum+r.tracks.length,0)};
const distance=(metres:string|null)=>metres===null?null:`${Number(metres)/1000} km`;
export function buildSponsorCatalogue(source:CatalogueSource):SponsorCatalogueItem[]{return source.rounds.flatMap(round=>{
 const common={sourceLeagueId:source.sourceLeagueId,sourceSeasonId:source.sourceSeasonId,eventEditionId:round.eventEditionId,editionId:round.editionId,
  roundId:round.roundId,sourceRoundId:round.sourceRoundId,parent:`round-${round.slot}`,parentName:round.name,image:roundArtwork[round.slot-1],date:round.date,status:round.status};
 const categories=source.categories.filter(c=>c.target==="individual"&&round.tracks.some(t=>t.competitionId===c.competitionId));
 const race:SponsorCatalogueItem={...common,id:`round-${round.slot}`,kind:"race",name:round.name,detail:round.tracks.map(t=>distance(t.distanceMetres)).filter(Boolean).join(" / "),categories};
 const tracks:SponsorCatalogueItem[]=round.tracks.map((track):SponsorCatalogueItem=>({...common,id:track.raceId,kind:"track",name:track.name,detail:distance(track.distanceMetres)??"",
  raceId:track.raceId,sourceRaceId:track.sourceRaceId,competitionId:track.competitionId,categories:categories.filter(c=>c.competitionId===track.competitionId)}));
 return [race,...tracks];
});}
export const sponsorCatalogue=buildSponsorCatalogue(source);
export const sponsorColors=["#ff5b15","#ad7563","#c8ac69","#8fa681","#c98d80","#aa8c9f","#e8a273"];

/** Count published campaigns at their selected league or parent race, never by label. */
export function countEventSponsorships(items:readonly DirectoryCampaign[],event:RewardSponsorSelection):number {
 return items.filter(({selection})=>selection!==null&&selection.sourceLeagueId===event.sourceLeagueId&&selection.sourceSeasonId===event.sourceSeasonId&&selection.eventEditionId===event.eventEditionId).length;
}
