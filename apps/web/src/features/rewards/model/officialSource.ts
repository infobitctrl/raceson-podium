import type {RewardSponsorSelection} from '@raceson/domain/rewards/distribution-setup';
import {sponsorCatalogue,sponsorArtwork,sponsorLeague} from './sponsorCatalogue';
import {sponsorPreparedSource} from './sponsorPreparedSource';

// Destinations verified against the public RacesOn league calendar on 7 October 2026.
// Copied edition IDs must resolve to their original event, never to a guessed UUID URL.
const leagueUrl='https://www.raceson.com/leagues/sibenska-trail-liga';
const eventSlugs=['vrpolje-trail-2026-2026','torak-trail-2026','trtarski-krug-2026','raslina-trail-2026','s-ubicevac-trail-2026'];
export function officialSource(selection:RewardSponsorSelection|null|undefined,slot?:number){
 if(!selection||selection.sourceLeagueId!==sponsorLeague.sourceLeagueId||selection.sourceSeasonId!==sponsorLeague.sourceSeasonId)return null;
 const selected=sponsorPreparedSource.rounds.find(r=>r.eventEditionId===selection.eventEditionId||r.editionId===selection.eventEditionId);
 if(selection.eventEditionId&&!selected)return null;
 if(selection.raceId&&(!selected||!selected.tracks.some(t=>t.raceId===selection.raceId||t.sourceRaceId===selection.raceId)))return null;
 if(slot!==undefined&&(!Number.isInteger(slot)||slot<0||slot>5||selected&&slot!==selected.slot))return null;
 const round=slot===undefined?selected:slot?sponsorPreparedSource.rounds.find(r=>r.slot===slot):undefined;
 const event=round&&sponsorCatalogue.find(e=>e.kind==='race'&&e.eventEditionId===round.eventEditionId);
 return {name:event?.name??sponsorLeague.name,image:event?.image??sponsorArtwork.league,date:event?.date??null,
  leagueUrl,eventUrl:round?`${leagueUrl}/events/${eventSlugs[round.slot-1]}?tab=results`:null};
}
