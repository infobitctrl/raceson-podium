import {expect,it} from 'vitest';
import {officialSource} from './officialSource';
import {sponsorPreparedSource as source} from './sponsorPreparedSource';
const league={sourceLeagueId:source.sourceLeagueId,sourceSeasonId:source.sourceSeasonId,eventEditionId:null};
it('maps each copied and original edition to the observed event destination',()=>{
 const slugs=['vrpolje-trail-2026-2026','torak-trail-2026','trtarski-krug-2026','raslina-trail-2026','s-ubicevac-trail-2026'];
 for(const round of source.rounds)for(const eventEditionId of [round.eventEditionId,round.editionId]){
  const result=officialSource({...league,eventEditionId});expect(result?.eventUrl).toBe(`https://www.raceson.com/leagues/sibenska-trail-liga/events/${slugs[round.slot-1]}?tab=results`);
  expect(officialSource(league,round.slot)?.eventUrl).toBe(result?.eventUrl);
 }
 expect(officialSource(league)?.eventUrl).toBeNull();
});
it('never guesses unknown league, season, edition, route or unrelated pool destinations',()=>{
 expect(officialSource({...league,sourceLeagueId:'foreign'})).toBeNull();expect(officialSource({...league,sourceSeasonId:'foreign'})).toBeNull();
 expect(officialSource({...league,eventEditionId:'foreign'})).toBeNull();expect(officialSource({...league,raceId:'foreign'})).toBeNull();
 const round=source.rounds[0];expect(officialSource({...league,eventEditionId:round.eventEditionId,raceId:'foreign'})).toBeNull();
 expect(officialSource({...league,eventEditionId:round.eventEditionId},2)).toBeNull();expect(officialSource(league,6)).toBeNull();
 expect(officialSource({...league,eventEditionId:round.eventEditionId,raceId:round.tracks[0].raceId})?.eventUrl).toContain('vrpolje-trail-2026-2026');
});
