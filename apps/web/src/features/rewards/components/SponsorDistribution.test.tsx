import {fireEvent, render, screen} from "@testing-library/react";
import {expect, it} from "vitest";
import {createGuidedSetup} from "@raceson/domain/rewards/guided-setup-editor";
import type {SponsorLaunch} from "@raceson/domain/rewards/sponsor-launch";
import type {SponsorExecutionPlan} from "@raceson/domain/rewards/sponsor-execution";
import type {SponsorChainObservation} from "@raceson/rewards-chain/sponsor-v4";
import {decodeSponsorExecutionView} from "../data/sponsorExecution";
import SponsorDistribution from "./SponsorDistribution";

const id = (n: number) => `73000000-0000-4000-8000-${String(n).padStart(12,"0")}`;
const address = (n: string) => `0x${n.repeat(40)}`, hash = (n: string) => `0x${n.repeat(64)}`;
const plan: SponsorExecutionPlan = {version:4,launchId:id(3),setupRevision:4,configurationHash:"a".repeat(64),chainId:10143,
  funder:address("1"),operator:address("2"),unallocatedTreasury:address("3"),expiredTreasury:address("1"),claimLifetime:86400,
  reviewPeriods:[0,0,0,0,0,0],caps:["1000000000000000000","0","0","0","0","0"],budgetWei:"1000000000000000000"};
let seq = 10;
const launch: SponsorLaunch = {id:id(3),state:"prepared",createdAt:"2026-09-23T08:00:00.000Z",configurationHash:plan.configurationHash,
  setup:{id:id(1),revision:4,chainId:10143,updatedAt:"2026-09-23T08:00:00.000Z",configuration:createGuidedSetup(()=>id(seq++))}};
const observed = (): SponsorChainObservation => ({address:address("4"),deploymentHash:hash("a"),funded:true,cancelled:false,fundingHash:hash("b"),
  blockNumber:"100",blockTimestamp:"1000",blockHash:hash("c"),pots:[{slot:0,address:address("5"),amountWei:plan.budgetWei,state:3,paused:false,
    allocatedWei:"800000000000000000",paidWei:"200000000000000000",returnedWei:"0",remainingWei:"800000000000000000",claimDeadline:"2000",entitlementCount:"4"}]});

it("renders finalized accounting, distinguishes pause from expiry, and never offers a payment action",()=>{
  const observation=observed();
  const page=render(<SponsorDistribution launch={launch} plan={plan} observation={observation} hr={false}/>);
  expect(screen.getByText(/Claims open/)).toBeVisible();
  fireEvent.click(screen.getByText("Reward pots & verification"));
  fireEvent.click(screen.getByText(/Amounts & contract/));
  expect(screen.getByRole("link",{name:address("5")})).toHaveAttribute("href",`https://testnet.monadvision.com/address/${address("5")}`);
  expect(screen.getAllByText("0.2 test MON")).toHaveLength(2);
  expect(screen.queryByRole("button")).not.toBeInTheDocument();
  observation.pots[0]!.paused=true;observation.blockTimestamp="3000";
  page.rerender(<SponsorDistribution launch={launch} plan={plan} observation={observation} hr={false}/>);
  expect(screen.getByText(/Security pause/)).toBeVisible();expect(screen.queryByText(/Claim period ended/)).not.toBeInTheDocument();
  observation.pots[0]!.paused=false;
  page.rerender(<SponsorDistribution launch={launch} plan={plan} observation={observation} hr={false}/>);
  expect(screen.getByText(/Claim period ended/)).toBeVisible();
});

it("rejects corrupted balances, loose lifecycle states and missing observation time",()=>{
  const view=()=>({enabled:true,record:{plan,deploymentHash:hash("a"),fundingHash:hash("b")},observation:observed()});
  expect(decodeSponsorExecutionView(view(),10143).observation?.pots[0]?.paidWei).toBe("200000000000000000");
  for(const patch of [{paidWei:"900000000000000000"},{remainingWei:"1"},{returnedWei:"-1"},{state:9},{state:0},{claimDeadline:"0"},{paused:"false"},{allocatedWei:"1000000000000000001"}]) {
    const input=view();Object.assign(input.observation.pots[0]!,patch);expect(()=>decodeSponsorExecutionView(input,10143)).toThrow();
  }
  const input=view();input.observation.blockTimestamp="";expect(()=>decodeSponsorExecutionView(input,10143)).toThrow();
});

it("shows four independently open rounds with no automatic payouts and preserves later pots",()=>{
  const observation=observed(), mon=10n**18n;
  observation.pots=Array.from({length:6},(_,slot)=>({...observation.pots[0]!,slot,address:address(String(slot+1)),
    state:slot>=1&&slot<=4?3:1,amountWei:((slot===0?50n:10n)*mon).toString(),
    allocatedWei:slot>=1&&slot<=4?(5n*mon).toString():"0",paidWei:"0",returnedWei:"0",
    remainingWei:((slot===0?50n:10n)*mon).toString(),entitlementCount:slot>=1&&slot<=4?"2":"0"}));
  const page=render(<SponsorDistribution launch={launch} plan={plan} observation={observation} hr={false}/>);
  expect(screen.getByRole("heading",{name:"Claims open for some pots"})).toBeVisible();
  fireEvent.click(screen.getByText("Reward pots & verification"));
  expect(screen.getAllByText("Claims open")).toHaveLength(4);
  expect(screen.getAllByText(/Waiting for approved results/)).toHaveLength(2);
  expect(screen.getByText(/Athletes and clubs claim their own rewards/)).toBeVisible();
  expect(screen.getByText("100 test MON")).toBeVisible();
  observation.pots[2]!.paused=true;
  page.rerender(<SponsorDistribution launch={launch} plan={plan} observation={observation} hr={false}/>);
  expect(screen.getAllByText("Claims open")).toHaveLength(3);
  expect(screen.getByText(/Security pause/)).toBeVisible();
});

it("accepts an explicit controller queue reason without inventing a transaction hash",()=>{
 const value={enabled:true,record:null,observation:null,creation:{status:"processing",reason:"controller_busy",hash:null}};
 expect(decodeSponsorExecutionView(value,10143).creation).toEqual(value.creation);
 expect(()=>decodeSponsorExecutionView({...value,creation:{...value.creation,reason:"unknown"}},10143)).toThrow();
});

it('keeps paid, held and returned funds distinct in the sponsor overview',()=>{
 const observation=observed();
 Object.assign(observation.pots[0],{state:4,paidWei:'200000000000000000',remainingWei:'300000000000000000',returnedWei:'500000000000000000'});
 render(<SponsorDistribution launch={launch} plan={plan} observation={observation} hr={false}/>);
 expect(screen.getByRole('heading',{name:'Claim period ended'})).toBeVisible();
 expect(screen.getByRole('img',{name:'Paid: 0.2 test MON; Held, not yet claimed: 0.3 test MON; Returned: 0.5 test MON'})).toBeVisible();
 expect(screen.getByText('20%')).toBeVisible();expect(screen.getByText('30%')).toBeVisible();expect(screen.getByText('50%')).toBeVisible();
});
