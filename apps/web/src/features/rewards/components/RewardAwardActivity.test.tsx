import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { I18nProvider } from "@/shared/i18n/I18nProvider";
import { consentV3Fixture } from "../model/athleteConsentV3Fixtures.test-helper";
import RewardAwardActivity from "./RewardAwardActivity";

const mocks=vi.hoisted(()=>({payment:vi.fn()}));
vi.mock("../data/athletePaymentStatusV3",()=>({getAthletePaymentStatusV3:mocks.payment}));
vi.mock("@/lib/public-env",()=>({publicEnv:{rewardPortalEnabled:true,rewardDemo:{mode:"local"}}}));

it("refreshes the award summary when a pending payment becomes confirmed in its detail",async()=>{
  const fixture=consentV3Fixture(),refresh=vi.fn();let confirmed=false;
  mocks.payment.mockImplementation(async()=>confirmed?{...fixture.payment,state:"confirmed",confirmed:true,
    paymentId:fixture.claim.claimId,transactionHash:`0x${"a".repeat(64)}`,blockNumber:"400",blockHash:`0x${"b".repeat(64)}`}:
    {...fixture.payment,state:"not_prepared",paymentId:null,transactionHash:null,confirmed:false,blockNumber:null,blockHash:null});
  render(<I18nProvider initialLocale="en"><RewardAwardActivity award={fixture.award} claims={[fixture.claim]}
    complete onRefresh={refresh} onAccessLost={vi.fn()} /></I18nProvider>);
  await screen.findByText("Not sent");
  if (!screen.getByText(/Claim history/).closest("details")!.open) fireEvent.click(screen.getByText(/Claim history/));
  fireEvent.click(screen.getByRole("button",{name:"Reward payment status"}));
  const detail=await screen.findByRole("region",{name:"Reward payment status"});
  await waitFor(()=>expect(within(detail).getByRole("button",{name:"Refresh payment status"})).toBeEnabled());
  confirmed=true;fireEvent.click(within(detail).getByRole("button",{name:"Refresh payment status"}));
  await waitFor(()=>expect(screen.getByText("Paid", {exact:true})).toBeVisible());
  expect(screen.getByText("Test payment confirmed")).toBeInTheDocument();
  expect(screen.queryByText("Not sent")).not.toBeInTheDocument();
  expect(refresh).toHaveBeenCalledOnce();
  expect(screen.queryByRole("button", { name: "Claim reward" })).not.toBeInTheDocument();
  expect(screen.queryByText(/matching allocation is not available/)).not.toBeInTheDocument();
});
