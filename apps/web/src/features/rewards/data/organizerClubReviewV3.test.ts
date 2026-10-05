import {beforeEach,expect,it,vi} from "vitest";
import {clubReviewV3Fixture as fixture,clubReviewTestId as id} from "./organizerClubReviewV3.fixture";
import {clubObservationInputV3,decodeClubObservationV3,observeOrganizerClubV3,makeClubReviewCommandV3,makeClubRevocationCommandV3,saveOrganizerClubReviewV3} from "./organizerClubReviewV3";
const m=vi.hoisted(()=>({api:vi.fn(),env:{rewardPortalEnabled:true,rewardDemo:{mode:"local-testnet"} as {mode:string}|null}}));
vi.mock("@/lib/api",()=>({apiRequest:m.api}));vi.mock("@/lib/public-env",()=>({publicEnv:m.env}));
beforeEach(()=>{m.api.mockReset();m.env.rewardPortalEnabled=true;m.env.rewardDemo={mode:"local-testnet"};});
it("observes exact original source and Safe without evidence, signatures or payment",async()=>{
  const f=fixture();m.api.mockResolvedValue(f.observation);
  const input=clubObservationInputV3(f.selection,f.readiness,f.input.factoryAddress,f.input.deploymentTransactionHash);
  expect(await observeOrganizerClubV3(f.selection,input)).toEqual(f.observation);
  expect(m.api).toHaveBeenCalledExactlyOnceWith({path:`/v1/organizer/rewards/uploads/${id(2)}/club-treasuries/${id(3)}/readiness-v3/observe`,method:"POST",cache:"no-store",body:f.input});
});
it.each([{uploadId:id(90)},{requestId:id(90)},{clubId:id(90)},{slot:6},{chainId:143},{sourceGuardHash:"f".repeat(64)},
  {previousReviewId:id(90)},{identityFingerprint:"f".repeat(64)},{scope:"full_history"},{executionHistoryReviewRequired:false},{authorityEvidenceRef:id(90)}])("rejects foreign or overstated observation %j",patch=>{
  const f=fixture();expect(()=>decodeClubObservationV3({...f.observation,...patch},f.selection,f.input)).toThrow();
});
it("freezes exact human references and preserves uncertain/revoked historical retries",async()=>{
  const f=fixture(),p=decodeClubObservationV3(f.observation,f.selection,f.input),c=makeClubReviewCommandV3(f.selection,p,f.refs,id(24));
  f.refs.authorityEvidenceRef=id(90);f.selection.award.uploadId=id(90);expect(Object.isFrozen(c.body)).toBe(true);
  m.api.mockRejectedValueOnce(Error("lost")).mockResolvedValueOnce({...f.record,revokedAt:"2026-09-15T12:01:00Z"});
  await expect(saveOrganizerClubReviewV3(c)).rejects.toThrow();expect(m.api).toHaveBeenCalledTimes(1);
  expect((await saveOrganizerClubReviewV3(c)).revokedAt).not.toBeNull();expect(m.api.mock.calls[1]).toEqual(m.api.mock.calls[0]);
  expect(m.api.mock.calls[0][0].body.evidence.authorityEvidenceRef).toBe(id(20));
  expect(m.api.mock.calls[0][0].body).not.toHaveProperty("factoryAddress");
});
it("cannot reuse an observation for another upload or omit genuine evidence references",()=>{
  const f=fixture(),p=decodeClubObservationV3(f.observation,f.selection,f.input);
  expect(()=>makeClubReviewCommandV3({...f.selection,award:{...f.selection.award,uploadId:id(90)}},p,f.refs,id(24))).toThrow();
  expect(()=>makeClubReviewCommandV3(f.selection,p,{...f.refs,controlEvidenceRef:""},id(24))).toThrow();
});
it.each(["source_hold","identity_hold","request_withdrawn"] as const)("never observes held %s",state=>{
  const f=fixture();expect(()=>clubObservationInputV3(f.selection,{...f.readiness,state},f.input.factoryAddress,f.input.deploymentTransactionHash)).toThrow();
});
it("requires exact revocation reason and verifies recorded revocation",async()=>{
  const f=fixture(),r={...f.readiness,state:"reviewed" as const,reviewId:id(24),reviewedAt:f.record.reviewedAt};
  const c=makeClubRevocationCommandV3(f.selection,r,"operator_correction");m.api.mockResolvedValue(f.record);
  await expect(saveOrganizerClubReviewV3(c)).rejects.toThrow();
  m.api.mockResolvedValue({...f.record,revokedAt:"2026-09-15T12:01:00Z"});await saveOrganizerClubReviewV3(c);
  expect(m.api.mock.calls[1][0].path).toMatch(/\/revoke$/);
});
it("fails closed on environment change and malformed block metadata",async()=>{
  const f=fixture();m.env.rewardPortalEnabled=false;await expect(observeOrganizerClubV3(f.selection,f.input)).rejects.toThrow();expect(m.api).not.toHaveBeenCalled();
  m.env.rewardPortalEnabled=true;m.api.mockImplementation(async()=>{m.env.rewardDemo=null;return f.observation;});
  await expect(observeOrganizerClubV3(f.selection,f.input)).rejects.toThrow();
  expect(()=>decodeClubObservationV3({...f.observation,deploymentBlock:{...f.observation.deploymentBlock,number:"102"}},f.selection,f.input)).toThrow();
});
