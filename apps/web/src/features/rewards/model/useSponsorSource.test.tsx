import {ApiError} from "@/lib/api";
import {useState} from "react";
import {act,renderHook,waitFor} from "@testing-library/react";
import {beforeEach,expect,it,vi} from "vitest";
import {createGuidedSetup,addGuidedGroup,bindGuidedSeason} from "@raceson/domain/rewards/guided-setup-editor";
import type {RewardDistributionSetup} from "@raceson/domain/rewards/distribution-setup";
import type {SponsorSourceViewV4} from "@raceson/domain/rewards/sponsor-source";
import {publishedSnapshot,id} from "../../../../../../apps/api/test/fixtures/published-reward-v2.mjs";
import {useSponsorSource} from "./useSponsorSource";
import {sponsorLink,sponsorDemoSource} from "./sponsorOpportunities";
const mock=vi.hoisted(()=>({resolve:vi.fn(),token:"a",signedIn:true}));
vi.mock("../data/sponsorSource",()=>({resolveSponsorSource:mock.resolve}));
vi.mock("@/lib/auth",()=>({useAuth:()=>({user:mock.signedIn?{id:"owner"}:null,account:{userId:"owner"},session:mock.signedIn?{access_token:mock.token,refresh_token:"r",user:{id:"owner"},expires_at:1900000000,token_type:"bearer"}:null})}));
function fixture(){
 let seq=2000;const next=()=>id(seq++),catalogue=publishedSnapshot().catalogue;
 const context={draftId:id(90),catalogueHash:"a".repeat(64),roundId:null,editionId:null,programmeName:"Test league",eventName:"Test league"};
 const source={schema:"raceson-sponsor-source-v4",...sponsorDemoSource,eventEditionId:null,context,catalogue,selectedRoundId:null,selectedSlot:null,categoryPresets:{}} as SponsorSourceViewV4;
 let configuration=createGuidedSetup(next);configuration.budgetMon="100";
 configuration=addGuidedGroup(configuration,configuration.guided!.pots[0].nodeId,"athlete_finishes",next,null);
 configuration.root.children[0].children[0].shareBps=10000;
 return {configuration,source};
}
const query=sponsorLink().split("?")[1];
function useHarness(initial:RewardDistributionSetup,search:string,setupId:string|undefined,locked=false){
 const [configuration,onChange]=useState(initial);
 return {...useSponsorSource(configuration,new URLSearchParams(search),{setupId,locked,onChange}),configuration,onChange};
}
beforeEach(()=>{mock.resolve.mockReset();mock.token="a";mock.signedIn=true;});
it("automatically connects explicit discovery identity without altering budget or prize economics",async()=>{
 const f=fixture(),before=structuredClone(f.configuration);mock.resolve.mockResolvedValue(f.source);
 const hook=renderHook(()=>useHarness(f.configuration,query,id(800)));
 await waitFor(()=>expect(hook.result.current.configuration.context).toEqual(f.source.context));
 expect(mock.resolve).toHaveBeenCalledTimes(1);expect(mock.resolve).toHaveBeenCalledWith({...sponsorDemoSource,eventEditionId:null});
 expect(hook.result.current.configuration.budgetMon).toBe("100");
 expect(hook.result.current.configuration.root.children.map(p=>({share:p.shareBps,groups:p.children}))).toEqual(before.root.children.map(p=>({share:p.shareBps,groups:p.children})));
 hook.rerender();expect(mock.resolve).toHaveBeenCalledTimes(1);
 // The source can then be saved and reopened by owned setup identity.
 const saved=hook.result.current.configuration;hook.unmount();
 const reopened=renderHook(()=>useHarness(saved,"",id(800)));
 await waitFor(()=>expect(reopened.result.current.status).toBe("ready"));
 expect(mock.resolve).toHaveBeenLastCalledWith({...sponsorDemoSource,eventEditionId:null});expect(reopened.result.current.configuration).toEqual(saved);
});
it("does not guess a saved category from its translated name while connecting its event",async()=>{
 const f=fixture();let seq=3000;
 f.configuration=addGuidedGroup(f.configuration,f.configuration.guided!.pots[1].nodeId,"athlete_standings",()=>id(seq++),null);
 const group=f.configuration.root.children[1].children[0];group.name="Short course · Women";group.shareBps=10000;
 mock.resolve.mockResolvedValue(f.source);const hook=renderHook(()=>useHarness(f.configuration,query,id(800)));
 await waitFor(()=>expect(hook.result.current.configuration.context).not.toBeNull());
 expect(hook.result.current.configuration.root.children[1].children[0]).toEqual(group);
});
it("keeps frozen and stale saved source configurations unchanged",async()=>{
 const f=fixture();mock.resolve.mockResolvedValue(f.source);
 const frozen=renderHook(()=>useHarness(f.configuration,query,id(800),true));
 await waitFor(()=>expect(frozen.result.current.status).toBe("locked"));expect(frozen.result.current.configuration).toEqual(f.configuration);frozen.unmount();
 const saved=bindGuidedSeason(f.configuration,{...f.source.context,catalogueHash:"b".repeat(64)},f.source.catalogue);
 const stale=renderHook(()=>useHarness(saved,"",id(800)));
 await waitFor(()=>expect(stale.result.current.status).toBe("changed"));expect(stale.result.current.source).toBeNull();expect(stale.result.current.configuration).toEqual(saved);
});
it("retries a failed read and retires old session replies",async()=>{
 const f=fixture();mock.resolve.mockRejectedValueOnce(Error("offline")).mockResolvedValueOnce(f.source);
 const hook=renderHook(()=>useHarness(f.configuration,query,undefined));
 await waitFor(()=>expect(hook.result.current.status).toBe("failed"));act(()=>hook.result.current.retry());
 await waitFor(()=>expect(hook.result.current.status).toBe("ready"));
 let finish!:(value:SponsorSourceViewV4)=>void;mock.resolve.mockImplementation(()=>new Promise(resolve=>{finish=resolve;}));
 mock.token="b";hook.rerender();expect(hook.result.current.source).toBeNull();expect(hook.result.current.status).toBe("loading");
 mock.signedIn=false;hook.rerender();await act(async()=>finish(f.source));expect(hook.result.current.source).toBeNull();expect(hook.result.current.status).toBe("signin");
});
it("rejects partial public identity without making a source request",()=>{
 const f=fixture();const hook=renderHook(()=>useHarness(f.configuration,`sourceLeagueId=${sponsorDemoSource.sourceLeagueId}`,undefined));
 expect(hook.result.current.status).toBe("invalid");expect(mock.resolve).not.toHaveBeenCalled();
});
it("keeps an incomplete budget editable if the source arrives while typing",async()=>{
 const f=fixture();f.configuration.budgetMon="";mock.resolve.mockResolvedValue(f.source);
 const hook=renderHook(()=>useHarness(f.configuration,query,undefined));
 await waitFor(()=>expect(hook.result.current.status).toBe("ready"));expect(hook.result.current.configuration.context).toEqual(f.source.context);expect(hook.result.current.configuration.budgetMon).toBe("");
 act(()=>hook.result.current.onChange({...hook.result.current.configuration,budgetMon:"100"}));
 await waitFor(()=>expect(hook.result.current.status).toBe("ready"));expect(hook.result.current.configuration.budgetMon).toBe("100");expect(mock.resolve).toHaveBeenCalledOnce();
});

it("retains event intent before sign-in and publication, then recovers by saved identity",async()=>{
 const f=fixture(),selection={...sponsorDemoSource,eventEditionId:id(204)};
 mock.signedIn=false;
 const hook=renderHook(()=>useHarness(f.configuration,new URLSearchParams(selection).toString(),undefined));
 await waitFor(()=>expect(hook.result.current.configuration.sponsorSelection).toEqual(selection));
 expect(mock.resolve).not.toHaveBeenCalled();expect(hook.result.current.configuration.context).toBeNull();
 const saved=hook.result.current.configuration;hook.unmount();mock.signedIn=true;
 mock.resolve.mockRejectedValueOnce(new ApiError("Unavailable",{status:404,code:"reward_sponsor_source_not_found"}));
 const reopened=renderHook(()=>useHarness(saved,"",id(800)));
 await waitFor(()=>expect(reopened.result.current.status).toBe("unpublished"));
 expect(mock.resolve).toHaveBeenLastCalledWith(selection);expect(reopened.result.current.configuration).toEqual(saved);
 mock.resolve.mockResolvedValue({...f.source,...selection,selectedRoundId:f.source.catalogue.rounds[3].id,selectedSlot:4});
 act(()=>reopened.result.current.retry());await waitFor(()=>expect(reopened.result.current.status).toBe("ready"));
 expect(reopened.result.current.source?.selectedSlot).toBe(4);expect(reopened.result.current.configuration.budgetMon).toBe("100");
});
it("does not replace a persisted event from conflicting URL identity",()=>{
 const f=fixture();f.configuration.sponsorSelection={...sponsorDemoSource,eventEditionId:id(204)};
 const hook=renderHook(()=>useHarness(f.configuration,query,id(800)));
 expect(hook.result.current.status).toBe("changed");expect(hook.result.current.configuration).toEqual(f.configuration);expect(mock.resolve).not.toHaveBeenCalled();
});
it("still resolves legacy bound setups by owned setup ID without rewriting them",async()=>{
 const f=fixture(),saved=bindGuidedSeason(f.configuration,f.source.context,f.source.catalogue);mock.resolve.mockResolvedValue(f.source);
 const hook=renderHook(()=>useHarness(saved,"",id(800)));
 await waitFor(()=>expect(hook.result.current.status).toBe("ready"));expect(mock.resolve).toHaveBeenCalledWith({setupId:id(800)});expect(hook.result.current.configuration).toEqual(saved);
});

it("keeps exact track intent through sign-in and reload while resolving the event API shape",async()=>{
 const f=fixture(),round=f.source.catalogue.rounds[3];
 const selection={...sponsorDemoSource,eventEditionId:id(204),raceId:round.races[0].id};
 mock.signedIn=false;
 const hook=renderHook(()=>useHarness(f.configuration,new URLSearchParams(selection).toString(),undefined));
 await waitFor(()=>expect(hook.result.current.configuration.sponsorSelection).toEqual(selection));
 expect(hook.result.current.status).toBe("signin");expect(mock.resolve).not.toHaveBeenCalled();
 const saved=hook.result.current.configuration;hook.unmount();mock.signedIn=true;
 mock.resolve.mockResolvedValue({...f.source,eventEditionId:selection.eventEditionId,selectedRoundId:round.id,selectedSlot:round.slot});
 const reopened=renderHook(()=>useHarness(saved,"",id(800)));
 await waitFor(()=>expect(reopened.result.current.status).toBe("ready"));
 expect(mock.resolve).toHaveBeenCalledWith({...sponsorDemoSource,eventEditionId:selection.eventEditionId});
 expect(reopened.result.current.selectedRaceId).toBe(selection.raceId);
 expect(reopened.result.current.configuration.sponsorSelection).toEqual(selection);
 expect(reopened.result.current.configuration.root.children.map(p=>p.shareBps)).toEqual(saved.root.children.map(p=>p.shareBps));
});
it("rejects a foreign track without binding the catalogue",async()=>{
 const f=fixture(),round=f.source.catalogue.rounds[3];
 mock.resolve.mockResolvedValue({...f.source,eventEditionId:id(204),selectedRoundId:round.id,selectedSlot:round.slot});
 const selection={...sponsorDemoSource,eventEditionId:id(204),raceId:f.source.catalogue.rounds[0].races[0].id};
 const hook=renderHook(()=>useHarness(f.configuration,new URLSearchParams(selection).toString(),undefined));
 await waitFor(()=>expect(hook.result.current.status).toBe("invalid"));
 expect(hook.result.current.source).toBeNull();expect(hook.result.current.configuration.context).toBeNull();
 expect(hook.result.current.configuration.guided?.pots.every(p=>p.roundId===null)).toBe(true);
});
it("rejects malformed or eventless tracks without requesting a catalogue",()=>{
 for(const search of [`${query}&raceId=${id(304)}`,`${query}&eventEditionId=${id(204)}&raceId=bad`]){
  const hook=renderHook(()=>useHarness(fixture().configuration,search,undefined));
  expect(hook.result.current.status).toBe("invalid");hook.unmount();
 }
 expect(mock.resolve).not.toHaveBeenCalled();
});
it("does not widen or replace a saved track from conflicting URL identity",()=>{
 const f=fixture();f.configuration.sponsorSelection={...sponsorDemoSource,eventEditionId:id(204),raceId:id(304)};
 for(const race of ["",`&raceId=${id(305)}`]){
  const hook=renderHook(()=>useHarness(f.configuration,`${query}&eventEditionId=${id(204)}${race}`,id(800)));
  expect(hook.result.current.status).toBe("changed");expect(hook.result.current.configuration).toEqual(f.configuration);hook.unmount();
 }
 expect(mock.resolve).not.toHaveBeenCalled();
});
it("places a fresh event or track budget wholly in its chosen round only once",async()=>{
 const f=fixture(),round=f.source.catalogue.rounds[3];
 mock.resolve.mockResolvedValue({...f.source,eventEditionId:id(204),selectedRoundId:round.id,selectedSlot:round.slot});
 for(const track of [undefined,round.races[0].id]){
  let seq=5000;const initial=createGuidedSetup(()=>id(seq++));
  const selection={...sponsorDemoSource,eventEditionId:id(204),...(track?{raceId:track}:{})};
  const hook=renderHook(()=>useHarness(initial,new URLSearchParams(selection).toString(),undefined));
  await waitFor(()=>expect(hook.result.current.status).toBe("ready"));
  expect(hook.result.current.configuration.root.children.map(p=>p.shareBps)).toEqual([0,0,0,0,10000,0]);
  const changed={...hook.result.current.configuration,root:{...hook.result.current.configuration.root,children:hook.result.current.configuration.root.children.map(p=>({...p,shareBps:0}))}};
  act(()=>hook.result.current.onChange(changed));hook.rerender();
  expect(hook.result.current.configuration).toEqual(changed);hook.unmount();
 }
});
it("preserves saved empty draft and existing group economics on event binding",async()=>{
 const f=fixture(),round=f.source.catalogue.rounds[3];
 mock.resolve.mockResolvedValue({...f.source,eventEditionId:id(204),selectedRoundId:round.id,selectedSlot:round.slot});
 let seq=6000;const empty=createGuidedSetup(()=>id(seq++));
 for(const [initial,setupId] of [[empty,id(800)],[f.configuration,undefined]] as const){
  const before=initial.root.children.map(p=>p.shareBps);
  const hook=renderHook(()=>useHarness(initial,`${query}&eventEditionId=${id(204)}`,setupId));
  await waitFor(()=>expect(hook.result.current.status).toBe("ready"));
  expect(hook.result.current.configuration.root.children.map(p=>p.shareBps)).toEqual(before);hook.unmount();
 }
});
