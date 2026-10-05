import {act,fireEvent,render,screen} from "@testing-library/react";
import {beforeEach,expect,it,vi} from "vitest";
import {I18nProvider} from "@/shared/i18n/I18nProvider";
import {clubReviewV3Fixture as fixture,clubReviewTestId as id} from "../data/organizerClubReviewV3.fixture";
import OrganizerClubReviewV3 from "./OrganizerClubReviewV3";
const m=vi.hoisted(()=>({api:vi.fn(),done:vi.fn(),env:{rewardPortalEnabled:true,rewardDemo:{mode:"local-testnet"}}}));
vi.mock("@/lib/api",()=>({apiRequest:m.api}));vi.mock("@/lib/public-env",()=>({publicEnv:m.env}));
const mount=(locale:"en"|"hr"="en",readiness=fixture().readiness)=>render(<I18nProvider initialLocale={locale}>
  <OrganizerClubReviewV3 selection={fixture().selection} readiness={readiness} onDone={m.done}/></I18nProvider>);
beforeEach(()=>{m.api.mockReset();m.done.mockReset();m.api.mockImplementation(async req=>req.path.endsWith("/observe")?fixture().observation:
  {...fixture().record,reviewId:req.body.reviewId});});
async function observe(){const f=fixture();const inputs=screen.getAllByRole("textbox");fireEvent.change(inputs[0],{target:{value:f.input.factoryAddress}});
  fireEvent.change(inputs[1],{target:{value:f.input.deploymentTransactionHash}});
  fireEvent.click(screen.getAllByRole("button")[0]);await screen.findByRole("checkbox");}
function evidence(){screen.getAllByRole("textbox").slice(2).forEach((el,i)=>fireEvent.change(el,{target:{value:id(20+i)}}));}
it.each(["en","hr"] as const)("inspects → explicitly attests → saves V3 review, never payment (%s)",async locale=>{
  mount(locale);expect(m.api).not.toHaveBeenCalled();expect(screen.getAllByRole("button")[0]).toBeDisabled();
  await observe();const record=screen.getAllByRole("button")[1];expect(record).toBeDisabled();evidence();expect(record).toBeDisabled();
  fireEvent.click(screen.getByRole("checkbox"));expect(record).toBeEnabled();fireEvent.click(record);fireEvent.click(record);
  await screen.findByText(locale==="hr"?"Pregled klupskog novčanika evidentiran":"Club treasury review recorded");
  expect(m.api).toHaveBeenCalledTimes(2);expect(m.api.mock.calls[1][0].body.evidence.authorityEvidenceRef).toBe(id(20));
  expect(m.done).not.toHaveBeenCalled();expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
  fireEvent.click(screen.getAllByRole("button")[0]);expect(m.done).toHaveBeenCalledTimes(1);
});
it("edits invalidate observation and attestation; no synthetic evidence is autofilled",async()=>{
  mount();await observe();expect(screen.getAllByRole("textbox").slice(2).every(el=>(el as HTMLInputElement).value==="")).toBe(true);
  evidence();fireEvent.click(screen.getByRole("checkbox"));fireEvent.change(screen.getAllByRole("textbox")[2],{target:{value:id(70)}});
  expect(screen.getByRole("checkbox")).not.toBeChecked();fireEvent.change(screen.getAllByRole("textbox")[0],{target:{value:fixture().input.factoryAddress+"a"}});
  expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();expect(m.api).toHaveBeenCalledTimes(1);
});
it("retains the identical uncertain review and disables competing edits",async()=>{
  mount();await observe();evidence();fireEvent.click(screen.getByRole("checkbox"));
  m.api.mockRejectedValueOnce(Error("lost"));fireEvent.click(screen.getAllByRole("button")[1]);await screen.findByRole("alert");
  const original=m.api.mock.calls[1][0];expect(screen.getAllByRole("textbox").every(el=>(el as HTMLInputElement).matches(":disabled"))).toBe(true);
  fireEvent.click(screen.getByRole("button",{name:"Retry the same decision"}));await screen.findByText("Club treasury review recorded");
  expect(m.api.mock.calls[2][0]).toEqual(original);
});
it("held sources cannot inspect and late completions do not affect another mounted selection",async()=>{
  const f=fixture(),v=mount("en",{...f.readiness,state:"source_hold",sourceCurrent:false});expect(screen.queryByRole("textbox")).not.toBeInTheDocument();v.unmount();
  let resolve!:(v:unknown)=>void;m.api.mockImplementation(()=>new Promise(r=>resolve=r));const next=mount();
  fireEvent.change(screen.getAllByRole("textbox")[0],{target:{value:f.input.factoryAddress}});fireEvent.change(screen.getAllByRole("textbox")[1],{target:{value:f.input.deploymentTransactionHash}});
  fireEvent.click(screen.getAllByRole("button")[0]);next.unmount();await act(async()=>resolve(f.observation));expect(m.done).not.toHaveBeenCalled();
});
it("revocation requires reason and confirmation and uses only the original review",async()=>{
  const f=fixture();mount("en",{...f.readiness,state:"reviewed",reviewId:id(24),reviewedAt:f.record.reviewedAt});
  m.api.mockResolvedValue({...f.record,revokedAt:"2026-09-15T12:01:00Z"});
  const button=screen.getByRole("button",{name:/Revoke review/});expect(button).toBeDisabled();
  fireEvent.change(screen.getByRole("combobox"),{target:{value:"operator_correction"}});expect(button).toBeDisabled();
  fireEvent.click(screen.getByRole("checkbox"));fireEvent.click(button);await screen.findByText("Review revocation recorded");
  expect(m.api.mock.calls[0][0]).toMatchObject({path:expect.stringMatching(/\/revoke$/),body:{reviewId:id(24),reason:"operator_correction"}});
});
