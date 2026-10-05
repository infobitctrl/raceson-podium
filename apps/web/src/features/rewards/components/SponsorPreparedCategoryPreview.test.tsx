import {render,screen,within} from "@testing-library/react";
import {expect,it} from "vitest";
import {sponsorPreparedSource as source} from "../model/sponsorPreparedSource";
import SponsorPreparedCategoryPreview from "./SponsorPreparedCategoryPreview";

const round=source.rounds[3],track=round.tracks[0];
const selection={sourceLeagueId:source.sourceLeagueId,sourceSeasonId:source.sourceSeasonId,eventEditionId:round.eventEditionId,raceId:track.raceId};
it("labels prepared categories as a read-only preview without reward controls",()=>{
 render(<SponsorPreparedCategoryPreview selection={selection} status="signin" hr={false}/>);
 const region=screen.getByRole("region",{name:"Official reward category preview"});
 expect(within(region).getByText(track.name)).toBeVisible();
 expect(within(region).getAllByRole("listitem").map(item=>item.textContent)).toEqual(["Female","Male"]);
 expect(within(region).getByText(/This preview does not add rewards/)).toBeVisible();
 expect(within(region).queryByRole("button")).not.toBeInTheDocument();
 expect(within(region).queryByRole("checkbox")).not.toBeInTheDocument();
});
it.each(["ready","changed","invalid","unpublished","failed","loading","unselected","locked","settings"] as const)("does not substitute a prepared preview for %s source status",status=>{
 const {container}=render(<SponsorPreparedCategoryPreview selection={selection} status={status} hr={false}/>);
 expect(container).toBeEmptyDOMElement();
});
it("hides categories for a mismatched event and track",()=>{
 const {container}=render(<SponsorPreparedCategoryPreview selection={{...selection,eventEditionId:source.rounds[1].eventEditionId}} status="signin" hr={false}/>);
 expect(container).toBeEmptyDOMElement();
});
