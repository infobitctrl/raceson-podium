import {act,fireEvent,render,screen} from "@testing-library/react";
import {beforeEach,expect,it,vi} from "vitest";
import {deriveLeagueParticipationMetrics} from "@raceson/domain/rewards/league-participation-metrics";
import {decodeStoredRewardSnapshot} from "@raceson/domain/rewards/published-preview-v2";
import type {ParticipationReviewChange,ParticipationReviewWorkspace} from "@raceson/domain/rewards/participation-review";
import {publishedSnapshot,id} from "../../../../../../apps/api/test/fixtures/published-reward-v2.mjs";
import {ApiError} from "@/lib/api";
import type {SetupEventSelection} from "./RewardSetupEvent";
import RewardParticipationReview from "./RewardParticipationReview";
const request=vi.hoisted(()=>vi.fn());vi.mock("../data/participationReview",()=>({requestParticipationReview:request}));
const selection={record:{draftId:id(30),revision:1},workspace:{catalogueHash:"a".repeat(64)}} as SetupEventSelection;
const hash="b".repeat(64);
function data():ParticipationReviewWorkspace {
  const source=publishedSnapshot();source.results[1].athleteId=source.results[0].athleteId;source.results[1].participationStatus="dns";
  const snapshot=decodeStoredRewardSnapshot(source);
  return {...selection,snapshot,sourceHash:hash,metrics:deriveLeagueParticipationMetrics(snapshot,hash),review:null,history:[],recordedReview:null};
}
function stored(base:ParticipationReviewWorkspace,c:ParticipationReviewChange) {
  const r={id:c.requestId,previousReviewId:c.expectedReviewId,revision:(base.review?.revision??0)+1,review:structuredClone(c.review),reason:c.reason,reviewedAt:"2026-09-21T12:00:00Z",reviewedByUserId:id(40),current:true};
  return {...base,review:r,recordedReview:r,history:[r,...base.history.map(r=>({...r,current:false}))]};
}
async function open(){fireEvent.click(screen.getByRole("button",{name:"Open review"}));await screen.findByText("No saved review yet.");}
function reason(){fireEvent.change(screen.getByRole("textbox",{name:"Reason for saving / correction"}),{target:{value:"Reviewed official source"}});}
beforeEach(()=>request.mockReset());
it("saves explicit duplicate and unaffiliated decisions and reopens their revision",async()=>{
  const initial=data();let current=initial;
  request.mockImplementation(async(_s,_h,c?:ParticipationReviewChange)=>c?(current=stored(current,c)):current);
  const view=render(<RewardParticipationReview selection={selection} sourceHash={hash} hr={false}/>);await open();
  fireEvent.change(screen.getByRole("combobox"),{target:{value:id(500)}});
  fireEvent.change(screen.getByRole("textbox",{name:"Decision reason"}),{target:{value:"Second entry DNS"}});
  fireEvent.click(screen.getAllByRole("checkbox")[0]);reason();fireEvent.click(screen.getByRole("button",{name:"Save review"}));
  expect(await screen.findByRole("status")).toHaveTextContent("Review saved");
  expect(current.review?.review.duplicates[0].resultIds).toEqual([id(500),id(501)]);expect(current.review?.review.confirmedUnaffiliatedResultIds).toEqual([id(500)]);
  view.unmount();render(<RewardParticipationReview selection={selection} sourceHash={hash} hr={false}/>);
  fireEvent.click(screen.getByRole("button",{name:"Open review"}));await screen.findByText("Saved revision 1");
  expect(screen.getByRole("combobox")).toHaveValue(id(500));expect(screen.getAllByRole("checkbox")[0]).toBeChecked();
  fireEvent.click(screen.getAllByRole("checkbox")[0]);reason();fireEvent.click(screen.getByRole("button",{name:"Save review"}));await screen.findByText("Saved revision 2");
  expect(current.history).toHaveLength(2);expect(current.review?.review.confirmedUnaffiliatedResultIds).toEqual([]);
});
it("unknown saves freeze edits and retry the identical request",async()=>{
  const initial=data();request.mockResolvedValueOnce(initial).mockRejectedValueOnce(Error("timeout")).mockImplementationOnce(async(_s,_h,c)=>stored(initial,c));
  render(<RewardParticipationReview selection={selection} sourceHash={hash} hr={false}/>);await open();reason();
  fireEvent.click(screen.getByRole("button",{name:"Save review"}));expect(await screen.findByRole("alert")).toHaveTextContent("Save is unconfirmed");
  expect(screen.getByRole("textbox",{name:"Reason for saving / correction"})).toBeDisabled();expect(screen.getByRole("button",{name:"Reload review"})).toBeDisabled();
  const submitted=structuredClone(request.mock.calls[1][2]);fireEvent.click(screen.getByRole("button",{name:"Retry same save"}));await screen.findByRole("status");
  expect(request.mock.calls[2][2]).toEqual(submitted);
});
it("conflicting reviews require reload and retain the server's latest decision",async()=>{
  const initial=data();request.mockResolvedValueOnce(initial).mockRejectedValueOnce(new ApiError("Changed",{status:409})).mockResolvedValueOnce(initial);
  render(<RewardParticipationReview selection={selection} sourceHash={hash} hr={false}/>);await open();reason();fireEvent.click(screen.getByRole("button",{name:"Save review"}));
  expect(await screen.findByRole("alert")).toHaveTextContent("Reload before continuing");expect(screen.getByRole("combobox")).toBeDisabled();
  fireEvent.click(screen.getByRole("button",{name:"Reload review"}));await screen.findByText("No saved review yet.");
  expect(screen.getByRole("textbox",{name:"Reason for saving / correction"})).toHaveValue("");
});
it("stale source history is shown without carrying its decisions into the new source",async()=>{
  const initial=data(),r=stored(initial,{requestId:id(50),expectedReviewId:null,review:{version:1,sourceHash:"c".repeat(64),duplicates:[],confirmedUnaffiliatedResultIds:[id(500)]},reason:"Old source review"});
  r.review.current=false;r.history[0].current=false;request.mockResolvedValue(r);
  render(<RewardParticipationReview selection={selection} sourceHash={hash} hr={false}/>);
  fireEvent.click(screen.getByRole("button",{name:"Open review"}));await screen.findByText(/Source changed/);
  expect(screen.getAllByRole("checkbox").every(c=>!(c as HTMLInputElement).checked)).toBe(true);
  fireEvent.click(screen.getByText("Review history · latest 10 revisions"));expect(screen.getByText("Old source review")).toBeVisible();
});
it("ignores an old response after the selected programme changes",async()=>{
  let resolve!:(v:ParticipationReviewWorkspace)=>void;request.mockReturnValue(new Promise(r=>resolve=r));
  const view=render(<RewardParticipationReview selection={selection} sourceHash={hash} hr={false}/>);
  fireEvent.click(screen.getByRole("button",{name:"Open review"}));view.rerender(<RewardParticipationReview selection={{...selection,record:{...selection.record,draftId:id(90)}}} sourceHash={hash} hr={false}/>);
  await act(async()=>resolve(data()));expect(screen.queryByRole("combobox")).not.toBeInTheDocument();expect(screen.getByRole("button",{name:"Open review"})).toBeEnabled();
});
it("requires reasons, preserves unresolved decisions, and reports unsaved changes to its parent",async()=>{
  request.mockResolvedValue(data());const change=vi.fn();render(<RewardParticipationReview selection={selection} sourceHash={hash} hr={false} onUnsavedChange={change}/>);await open();
  fireEvent.change(screen.getByRole("combobox"),{target:{value:"none"}});reason();fireEvent.click(screen.getByRole("button",{name:"Save review"}));
  expect(await screen.findByRole("alert")).toHaveTextContent("Provide a reason");expect(request).toHaveBeenCalledTimes(1);expect(change).toHaveBeenLastCalledWith(true);
  fireEvent.click(screen.getByRole("button",{name:"Discard unsaved changes"}));expect(screen.getByRole("combobox")).toHaveValue("unresolved");expect(change).toHaveBeenLastCalledWith(false);
});

it("settles an uncertain save after a programme change and unlocks refreshing its data",async()=>{
  const initial=data(),unsaved=vi.fn();
  request.mockResolvedValueOnce(initial).mockRejectedValueOnce(Error("timeout")).mockImplementationOnce(async(_s,_h,c)=>{
    const next=stored(initial,c);next.record={...next.record,revision:2};return next;
  });
  render(<RewardParticipationReview selection={selection} sourceHash={hash} hr={false} onUnsavedChange={unsaved}/>);await open();reason();
  fireEvent.click(screen.getByRole("button",{name:"Save review"}));await screen.findByRole("alert");
  fireEvent.click(screen.getByRole("button",{name:"Retry same save"}));expect(await screen.findByRole("status")).toHaveTextContent("Review saved. Refresh programme data");
  expect(unsaved).toHaveBeenLastCalledWith(false);expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
});
