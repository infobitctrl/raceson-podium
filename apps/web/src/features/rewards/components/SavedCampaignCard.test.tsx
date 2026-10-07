vi.mock('./CampaignSponsor',()=>({CampaignSponsor:()=> <span>Campaign sponsor</span>}));
import {act,fireEvent,render,screen,waitFor} from "@testing-library/react";
import {MemoryRouter} from "react-router-dom";
import {beforeEach,expect,it,vi} from "vitest";
import type {SavedRewardSetup} from "@raceson/domain/rewards/distribution-setup";
import {createGuidedSetup} from "@raceson/domain/rewards/guided-setup-editor";
import {ApiError} from "@/lib/api";
import SavedCampaignCard from "./SavedCampaignCard";
const {remove,archive}=vi.hoisted(()=>({remove:vi.fn(),archive:vi.fn()}));
vi.mock("../data/distributionSetups",()=>({deleteRewardDraft:remove,archiveRewardSetup:archive}));
let seq=1;const id=()=>`74000000-0000-4000-8000-${String(seq++).padStart(12,"0")}`;
function record():SavedRewardSetup{return {id:id(),chainId:10143,revision:2,lifecycle:{state:"draft",canDelete:true},updatedAt:"2026-09-23T12:00:00.000Z",configuration:{...createGuidedSetup(id),name:"My test draft"}};}
beforeEach(()=>{remove.mockReset();archive.mockReset();});
it("requires confirmation, supports cancel, then removes only after confirmed success",async()=>{
 const r=record(),done=vi.fn();let finish!:(v:unknown)=>void;remove.mockImplementation(()=>new Promise(resolve=>{finish=resolve;}));
 render(<MemoryRouter><SavedCampaignCard record={r} hr={false} onDeleted={done}/></MemoryRouter>);
 expect(screen.getByRole("link")).toHaveAttribute("href",`/rewards/create?setup=${r.id}`);
 fireEvent.click(screen.getByRole("button",{name:"Delete draft: My test draft"}));expect(remove).not.toHaveBeenCalled();
 expect(screen.getByText('Delete draft “My test draft”?')).toBeVisible();fireEvent.click(screen.getByRole("button",{name:"Cancel"}));expect(remove).not.toHaveBeenCalled();
 fireEvent.click(screen.getByRole("button",{name:"Delete draft: My test draft"}));fireEvent.click(screen.getByRole("button",{name:"Delete draft"}));
 expect(remove).toHaveBeenCalledWith(r.id,2);expect(done).not.toHaveBeenCalled();expect(screen.getByRole("button",{name:"Deleting…"})).toBeDisabled();
 await act(async()=>finish({id:r.id,deleted:true}));expect(done).toHaveBeenCalledWith(r.id);
});
it("keeps a rejected draft visible and explains protected launch plans",async()=>{
 const done=vi.fn();remove.mockRejectedValue(new ApiError("blocked",{status:409,code:"reward_setup_not_deletable"}));
 render(<MemoryRouter><SavedCampaignCard record={record()} hr={false} onDeleted={done}/></MemoryRouter>);
 fireEvent.click(screen.getByRole("button",{name:"Delete draft: My test draft"}));fireEvent.click(screen.getByRole("button",{name:"Delete draft"}));
 expect(await screen.findByRole("alert")).toHaveTextContent("Contract creation was requested");expect(done).not.toHaveBeenCalled();expect(screen.getByRole("link")).toBeVisible();
});
it("offers no delete action for ready campaigns and ignores completion after unmount",async()=>{
 const r=record(),done=vi.fn();r.configuration.stage="ready";r.lifecycle={state:"draft",canDelete:false};
 const page=render(<MemoryRouter><SavedCampaignCard record={r} hr={false} onDeleted={done}/></MemoryRouter>);
 expect(screen.queryByRole("button",{name:/Delete/})).not.toBeInTheDocument();page.unmount();
 let finish!:(v:unknown)=>void;remove.mockImplementation(()=>new Promise(resolve=>{finish=resolve;}));
 const draft=render(<MemoryRouter><SavedCampaignCard record={record()} hr={false} onDeleted={done}/></MemoryRouter>);
 fireEvent.click(screen.getByRole("button",{name:"Delete draft: My test draft"}));fireEvent.click(screen.getByRole("button",{name:"Delete draft"}));draft.unmount();
 await act(async()=>finish({deleted:true}));await waitFor(()=>expect(done).not.toHaveBeenCalled());
});

it("uses server lifecycle instead of the stale configuration stage",()=>{
 const r=record();r.lifecycle={state:"saved",canDelete:false};
 render(<MemoryRouter><SavedCampaignCard record={r} hr={false} onDeleted={vi.fn()}/></MemoryRouter>);
 expect(screen.getByText("Saved · not launched")).toBeVisible();
 expect(screen.getByText("Review source links →")).toBeVisible();
 expect(screen.queryByRole("button",{name:/Delete/})).not.toBeInTheDocument();
 expect(screen.queryByText("Event not selected yet")).not.toBeInTheDocument();
});
it("does not guess deletion eligibility when lifecycle is missing",()=>{
 const r=record();delete r.lifecycle;
 render(<MemoryRouter><SavedCampaignCard record={r} hr={false} onDeleted={vi.fn()}/></MemoryRouter>);
 expect(screen.queryByRole("button",{name:/Delete/})).not.toBeInTheDocument();
});
it.each([false,true])("marks an unbound deposit campaign as needing source links while retaining recovery access (hr=%s)",(hr)=>{
 const r=record();r.lifecycle={state:"deposit",canDelete:false};
 render(<MemoryRouter><SavedCampaignCard record={r} hr={hr} onDeleted={vi.fn()}/></MemoryRouter>);
 expect(screen.getByText(hr?"Potrebne poveznice rezultata":"Source links required")).toBeVisible();
 expect(screen.queryByText(hr?"Spremno za uplatu":"Ready for deposit")).not.toBeInTheDocument();
 expect(screen.getByRole("link")).toHaveAttribute("href",`/rewards/campaigns/${r.id}`);
 expect(screen.getByText(hr?"Pregledaj poveznice rezultata →":"Review source links →")).toBeVisible();
 expect(screen.queryByRole("button")).not.toBeInTheDocument();
});
it("retains the observed funded state even if a historical campaign lacks source links",()=>{
 const r=record();r.lifecycle={state:"funded",canDelete:false};
 render(<MemoryRouter><SavedCampaignCard record={r} hr={false} onDeleted={vi.fn()}/></MemoryRouter>);
 expect(screen.getByText("Funded")).toBeVisible();
 expect(screen.queryByText("Source links required")).not.toBeInTheDocument();
 expect(screen.getByRole("link")).toHaveAttribute("href",`/rewards/campaigns/${r.id}`);
});
it("shows deposit readiness for a campaign with its required source links",()=>{
 const r=record();r.lifecycle={state:"deposit",canDelete:false};
 r.configuration.context={draftId:id(),catalogueHash:"a".repeat(64),roundId:null,editionId:null,programmeName:"Test league",eventName:"Test season"};
 r.configuration.guided!.pots.forEach(p=>{if(p.slot>0)p.roundId=id();});
 render(<MemoryRouter><SavedCampaignCard record={r} hr={false} onDeleted={vi.fn()}/></MemoryRouter>);
 expect(screen.getByText("Ready for deposit")).toBeVisible();
 expect(screen.queryByText("Source links required")).not.toBeInTheDocument();
});

it("shows the selected event for an unbound saved draft and reopens its editor",()=>{
 const r=record();r.configuration.sponsorSelection={sourceLeagueId:'ba81ced7-b2c5-4d51-95b6-d95d8c04fa36',sourceSeasonId:'323d55fc-a396-4ff4-a17e-eb7152c8f8f1',eventEditionId:'f26fe1b0-ea95-b5c6-772d-739d54377d9d'};
 render(<MemoryRouter><SavedCampaignCard record={r} hr={false} onDeleted={vi.fn()}/></MemoryRouter>);
 expect(screen.getByText('Raslina Trail 2026')).toBeVisible();expect(screen.getByRole('link',{name:/My test draft/})).toHaveAttribute('href',`/rewards/create?setup=${r.id}`);
 expect(screen.queryByText('Ready for deposit')).not.toBeInTheDocument();
});

it("lets a prepared campaign without execution be deleted with a truthful label",()=>{
 const r=record();r.lifecycle={state:"saved",canDelete:true,archived:false};
 render(<MemoryRouter><SavedCampaignCard record={r} hr={false} onDeleted={vi.fn()}/></MemoryRouter>);
 expect(screen.getByRole("button",{name:"Delete campaign: My test draft"})).toBeVisible();
 expect(screen.queryByRole("button",{name:/Archive campaign/})).not.toBeInTheDocument();
});
it("archives only after confirmation and preserves contract recovery links",async()=>{
 const r=record();r.lifecycle={state:"deposit",canDelete:false,archived:false};
 const done=vi.fn();let finish!:(value:unknown)=>void;archive.mockImplementation(()=>new Promise(resolve=>{finish=resolve;}));
 render(<MemoryRouter><SavedCampaignCard record={r} hr={false} onDeleted={vi.fn()} onArchived={done}/></MemoryRouter>);
 fireEvent.click(screen.getByRole("button",{name:"Archive campaign: My test draft"}));
 expect(screen.getByText(/does not cancel its contract or transactions or refund funds/)).toBeVisible();expect(archive).not.toHaveBeenCalled();
 fireEvent.click(screen.getByRole("button",{name:"Cancel"}));expect(archive).not.toHaveBeenCalled();
 fireEvent.click(screen.getByRole("button",{name:"Archive campaign: My test draft"}));fireEvent.click(screen.getByRole("button",{name:"Archive campaign"}));
 expect(archive).toHaveBeenCalledWith(r.id,r.revision,true);expect(done).not.toHaveBeenCalled();expect(screen.getByRole("button",{name:"Archiving…"})).toBeDisabled();
 const updated={...r,lifecycle:{...r.lifecycle,archived:true}};await act(async()=>finish(updated));expect(done).toHaveBeenCalledWith(updated);
 expect(screen.getByRole("link")).toHaveAttribute("href",`/rewards/campaigns/${r.id}`);
});
it("keeps a newly funded campaign visible when archive is rejected",async()=>{
 const r=record();r.lifecycle={state:"deposit",canDelete:false,archived:false};const done=vi.fn();
 archive.mockRejectedValue(new ApiError("funded",{status:409,code:"reward_setup_not_archivable"}));
 render(<MemoryRouter><SavedCampaignCard record={r} hr={false} onDeleted={vi.fn()} onArchived={done}/></MemoryRouter>);
 fireEvent.click(screen.getByRole("button",{name:"Archive campaign: My test draft"}));fireEvent.click(screen.getByRole("button",{name:"Archive campaign"}));
 expect(await screen.findByRole("alert")).toHaveTextContent("Funding has been confirmed");expect(done).not.toHaveBeenCalled();expect(screen.getByRole("link")).toBeVisible();
});
it("allows restoring an archived campaign even if funding was later confirmed",async()=>{
 const r=record();r.lifecycle={state:"funded",canDelete:false,archived:true};const done=vi.fn(),updated={...r,lifecycle:{...r.lifecycle,archived:false}};archive.mockResolvedValue(updated);
 render(<MemoryRouter><SavedCampaignCard record={r} hr={false} onDeleted={vi.fn()} onArchived={done}/></MemoryRouter>);
 fireEvent.click(screen.getByRole("button",{name:"Restore campaign: My test draft"}));await waitFor(()=>expect(done).toHaveBeenCalledWith(updated));expect(archive).toHaveBeenCalledWith(r.id,r.revision,false);
});
it("does not offer archive for funded campaigns or legacy responses",()=>{
 const r=record();r.lifecycle={state:"funded",canDelete:false,archived:false};
 const page=render(<MemoryRouter><SavedCampaignCard record={r} hr={false} onDeleted={vi.fn()}/></MemoryRouter>);
 expect(screen.queryByRole("button")).not.toBeInTheDocument();r.lifecycle={state:"deposit",canDelete:false};page.rerender(<MemoryRouter><SavedCampaignCard record={r} hr={false} onDeleted={vi.fn()}/></MemoryRouter>);expect(screen.queryByRole("button")).not.toBeInTheDocument();
});
it("ignores archive completion after unmount",async()=>{
 const r=record();r.lifecycle={state:"deposit",canDelete:false,archived:false};const done=vi.fn();let finish!:(value:unknown)=>void;archive.mockImplementation(()=>new Promise(resolve=>{finish=resolve;}));
 const page=render(<MemoryRouter><SavedCampaignCard record={r} hr={false} onDeleted={vi.fn()} onArchived={done}/></MemoryRouter>);
 fireEvent.click(screen.getByRole("button",{name:"Archive campaign: My test draft"}));fireEvent.click(screen.getByRole("button",{name:"Archive campaign"}));page.unmount();await act(async()=>finish({...r,lifecycle:{...r.lifecycle,archived:true}}));expect(done).not.toHaveBeenCalled();
});

it('labels verified finished campaigns consistently and keeps the amount explicitly planned',()=>{
 const r=record();r.lifecycle={state:'funded',canDelete:false};
 render(<MemoryRouter><SavedCampaignCard record={r} hr={false} finished onDeleted={vi.fn()}/></MemoryRouter>);
 expect(screen.getByText('Finished')).toBeVisible();expect(screen.queryByText('Funded')).not.toBeInTheDocument();expect(screen.getByText('Planned budget')).toBeVisible();
 expect(screen.getByRole('link')).toHaveAttribute('href',`/rewards/campaigns/${r.id}`);
});
