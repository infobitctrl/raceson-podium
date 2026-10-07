import {sponsorPreparedSource} from "./sponsorPreparedSource";
import {setupId as validSetupId,type RewardSponsorSelection} from "@raceson/domain/rewards/distribution-setup";
/** Public discovery identity. The server resolves its published reward source;
 * translated labels never select a league, race or category. */
export const sponsorDemoSource = {sourceLeagueId:sponsorPreparedSource.sourceLeagueId,sourceSeasonId:sponsorPreparedSource.sourceSeasonId};
export const sponsorDemoEditions = ["62692e70-3319-48c2-8bc4-76a67b882d5e","82ebae01-006c-3ada-53cb-228f939f923c","6221242e-b7bd-2850-a3d9-a8629e27a194","f26fe1b0-ea95-b5c6-772d-739d54377d9d","4ebea0d6-53f2-4638-9cd1-aa3431a51aa7"] as const;
export const sponsorOpportunities = [
  {id:"league", en:"League standings", hr:"Poredak lige", detail:"Short · Long · Clubs", local:"Kratka · Duga · Klubovi"},
  {id:"short", en:"Short-route categories", hr:"Kategorije kratke rute", detail:"Girls U16 · Boys U16 · Women · Men · Seniors 65+", local:"Djevojke U16 · Dječaci U16 · Žene · Muškarci · Seniori 65+"},
  {id:"long", en:"Long-route categories", hr:"Kategorije duge rute", detail:"Women · Men", local:"Žene · Muškarci"},
  {id:"clubs", en:"Club standings", hr:"Klupski poredak", detail:"Combined official league points", local:"Zajednički službeni bodovi lige"},
  {id:"participation", en:"Athlete participation", hr:"Sudjelovanje sportaša", detail:"Completed rounds, not registrations", local:"Završena kola, ne prijave"},
  {id:"club-distance", en:"Club distance", hr:"Klupski kilometri", detail:"Completed kilometres for the represented club", local:"Završeni kilometri za zastupani klub"},
] as const;
export const demoSponsorRounds = ["Vrpolje Trail", "Torak Trail", "Trtarski krug", "Raslina Trail", "Šubićevac Trail"];
export function sponsorIntent(value:string|null,hr=false) {
  const item=sponsorOpportunities.find(o=>o.id===value);
  if(item)return {id:item.id,label:hr?item.hr:item.en,round:0};
  const match=/^round-([1-5])$/.exec(value??"");
  return match?{id:value!,label:demoSponsorRounds[Number(match[1])-1],round:Number(match[1])}:null;
}
export function sponsorDiscoveryLink(setupId?:string|null) {
 return validSetupId(setupId)?`/rewards/events?${new URLSearchParams({setup:setupId})}`:"/rewards/events";
}
export function sponsorLink(target="league",setupId?:string|null,raceId?:string|null) {
 const intent=sponsorIntent(target),query=new URLSearchParams({opportunity:target,...sponsorDemoSource});
 if(intent?.round)query.set("eventEditionId",sponsorDemoEditions[intent.round-1]);
 const round=sponsorPreparedSource.rounds.find(r=>r.slot===intent?.round);
 if(validSetupId(raceId)&&round?.tracks.some(track=>track.raceId===raceId))query.set("raceId",raceId);
 if(validSetupId(setupId))query.set("setup",setupId);
 return `/rewards/create?${query}`;
}

/** Display metadata only; catalogue resolution always uses the IDs. */
export function sponsorSelectedEventName(selection:(RewardSponsorSelection&{raceId?:string})|undefined) {
 if(!selection||selection.sourceLeagueId!==sponsorDemoSource.sourceLeagueId||selection.sourceSeasonId!==sponsorDemoSource.sourceSeasonId)return undefined;
 if(selection.raceId){const round=sponsorPreparedSource.rounds.find(r=>r.eventEditionId===selection.eventEditionId);return round?.tracks.find(track=>track.raceId===selection.raceId)?.name;}
 if(selection.eventEditionId===null)return "Šibenik Trail League";
 return demoSponsorRounds[sponsorDemoEditions.findIndex(id=>id===selection.eventEditionId)];
}
