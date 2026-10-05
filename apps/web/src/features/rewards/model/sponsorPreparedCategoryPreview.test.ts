import {expect,it} from "vitest";
import type {RewardSponsorSelection} from "@raceson/domain/rewards/distribution-setup";
import {sponsorPreparedSource as source} from "./sponsorPreparedSource";
import {sponsorPreparedCategoryPreview as preview} from "./sponsorPreparedCategoryPreview";

const league={sourceLeagueId:source.sourceLeagueId,sourceSeasonId:source.sourceSeasonId,eventEditionId:null};
for(const round of source.rounds)for(const track of round.tracks){
 it(`previews only the official individual categories for ${track.name}`,()=>{
  const result=preview({...league,eventEditionId:round.eventEditionId,raceId:track.raceId});
  expect(result?.name).toBe(track.name);
  expect(result?.groups.flatMap(group=>group.categories)).toEqual(source.categories.filter(category=>category.competitionId===track.competitionId&&category.target==="individual"));
  expect(result).not.toHaveProperty("context");
 });
}
it("retains prepared league and event categories without inventing participation classifications",()=>{
 expect(preview(league)?.groups.flatMap(group=>group.categories)).toEqual(source.categories);
 expect(preview({...league,eventEditionId:source.rounds[0].eventEditionId})?.groups.flatMap(group=>group.categories)).toEqual(source.categories);
});
it.each<[string,RewardSponsorSelection|undefined]>([
 ["missing identity",undefined],
 ["unknown league",{...league,sourceLeagueId:"unknown"}],
 ["unknown season",{...league,sourceSeasonId:"unknown"}],
 ["unknown edition",{...league,eventEditionId:"unknown"}],
 ["empty edition",{...league,eventEditionId:""}],
 ["track without event",{...league,raceId:source.rounds[0].tracks[0].raceId}],
 ["wrong event parent",{...league,eventEditionId:source.rounds[1].eventEditionId,raceId:source.rounds[0].tracks[0].raceId}],
 ["unknown track",{...league,eventEditionId:source.rounds[0].eventEditionId,raceId:"unknown"}],
 ["empty track",{...league,eventEditionId:source.rounds[0].eventEditionId,raceId:""}],
 ["upstream finale track without local mapping",{...league,eventEditionId:source.rounds[4].eventEditionId,raceId:source.rounds[4].tracks[0].sourceRaceId}],
])("has no preview for %s",(_name,selection)=>{expect(preview(selection)).toBeNull();});
