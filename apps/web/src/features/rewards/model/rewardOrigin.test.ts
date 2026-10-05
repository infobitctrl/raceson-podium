import {expect,it} from "vitest";
import {rewardOrigin} from "./rewardOrigin";
import {consentV3Fixture} from "./athleteConsentV3Fixtures.test-helper";
it("uses the exact approved programme and event, never a hard-coded round-to-event lookup",()=>{
 const award={...consentV3Fixture().award,slot:1 as const};
 award.origin={schema:"raceson-reward-origin-v1",programmeName:"Another league",hostName:"Another host",potKind:"race",roundId:"round-id",eventName:"Different event",eventEditionId:"edition-id",eventDate:"2026-09-01",sourceKind:"minimized_source"};
 expect(rewardOrigin(award,"en")).toMatchObject({programme:"Another league",event:"Different event",host:"Another host",pot:"Round pot 1"});
});
it("does not invent an event for a synthetic or legacy allocation without origin metadata",()=>{
 const award=consentV3Fixture().award;delete award.origin;
 expect(rewardOrigin(award,"en")).toMatchObject({event:null,date:null});
 expect(rewardOrigin({...award,slot:6,sourceKind:"final_league",ageStatus:"synthetic_test"},"en")).toMatchObject({pot:"League pot",synthetic:true});
});
