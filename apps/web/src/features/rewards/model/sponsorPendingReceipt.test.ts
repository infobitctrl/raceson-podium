import {afterEach,beforeEach,expect,it,vi} from "vitest";
import {createGuidedSetup} from "@raceson/domain/rewards/guided-setup-editor";
import type {SponsorLaunch} from "@raceson/domain/rewards/sponsor-launch";
import type {SponsorExecutionPlan} from "@raceson/domain/rewards/sponsor-execution";
import type {SponsorExecutionView} from "../data/sponsorExecutionCodec";
import {clearSponsorReceipt,readSponsorReceipt,saveSponsorReceipt,sponsorReceiptConfirmed,sponsorReceiptKey,type SponsorPendingReceipt} from "./sponsorPendingReceipt";

const id=(n:number)=>`77000000-0000-4000-8000-${String(n).padStart(12,"0")}`;
const hash=(byte:string)=>`0x${byte.repeat(64)}`;
const deployment:SponsorPendingReceipt={action:"deployment",hash:hash("a")};
const funding:SponsorPendingReceipt={action:"funding",hash:hash("b")};
let sequence=10;
const launch:SponsorLaunch={id:id(2),state:"prepared",configurationHash:"c".repeat(64),createdAt:"2026-09-24T00:00:00.000Z",
 setup:{id:id(1),chainId:10143,revision:1,updatedAt:"2026-09-24T00:00:00.000Z",configuration:createGuidedSetup(()=>id(sequence++))}};
const key=sponsorReceiptKey(launch);
const legacyKey=`raceson:sponsor-tx:${launch.setup.chainId}:${launch.setup.id}`;
const plan:SponsorExecutionPlan={version:4,launchId:launch.id,setupRevision:1,configurationHash:launch.configurationHash,chainId:10143,
 funder:`0x${"11".repeat(20)}`,operator:`0x${"22".repeat(20)}`,unallocatedTreasury:`0x${"33".repeat(20)}`,expiredTreasury:`0x${"33".repeat(20)}`,
 claimLifetime:86400,reviewPeriods:[0,0,0,0,0,0],caps:["100","0","0","0","0","0"],budgetWei:"100"};
const confirmed=():SponsorExecutionView=>({enabled:true,record:{plan,deploymentHash:deployment.hash,fundingHash:funding.hash},
 observation:{address:`0x${"44".repeat(20)}`,deploymentHash:deployment.hash,fundingHash:funding.hash,funded:true,cancelled:false,
 blockNumber:"100",blockTimestamp:"1790208000",blockHash:hash("c"),pots:[{slot:0,address:`0x${"55".repeat(20)}`,amountWei:"100",state:1,paused:false,
 allocatedWei:"0",paidWei:"0",returnedWei:"0",remainingWei:"100",claimDeadline:"0",entitlementCount:"0"}]}});
const unavailable=()=>{throw new DOMException("Storage unavailable","SecurityError");};
beforeEach(()=>{localStorage.clear();sessionStorage.clear();});
afterEach(()=>{vi.restoreAllMocks();vi.unstubAllGlobals();});

it.each([deployment,funding])("persists and reopens a public $action receipt",receipt=>{
 expect(saveSponsorReceipt(launch,receipt)).toBe(true);
 expect(JSON.parse(localStorage.getItem(key)!)).toEqual(receipt);
 expect(JSON.parse(sessionStorage.getItem(key)!)).toEqual(receipt);
 sessionStorage.clear();expect(readSponsorReceipt(launch)).toEqual(receipt);
});

it.each([
 "{broken", "null", "[]", '"receipt"', "123",
 JSON.stringify({action:"funding"}), JSON.stringify({hash:funding.hash}),
 JSON.stringify({action:"approve",hash:funding.hash}),
 JSON.stringify({...funding,confirmed:true}),
 JSON.stringify({action:"funding",hash:null}),
 JSON.stringify({action:"funding",hash:hash("0")}),
 JSON.stringify({action:"funding",hash:hash("B")}),
 JSON.stringify({action:"funding",hash:hash("g")}),
 JSON.stringify({action:"funding",hash:"0xbb"}),
 JSON.stringify({action:"funding",hash:hash("b")+"b"}),
])( "ignores malformed or non-exact stored receipts (%s)",raw=>{
 localStorage.setItem(key,raw);sessionStorage.setItem(key,raw);sessionStorage.setItem(legacyKey,raw);
 expect(readSponsorReceipt(launch)).toBeNull();
});

it("isolates durable receipts by exact chain, setup and immutable launch",()=>{
 saveSponsorReceipt(launch,funding);
 const alternatives:SponsorLaunch[]=[{...launch,id:id(3)},{...launch,setup:{...launch.setup,id:id(4)}},{...launch,setup:{...launch.setup,chainId:31337}}];
 for(const other of alternatives){
  expect(sponsorReceiptKey(other)).not.toBe(key);expect(readSponsorReceipt(other)).toBeNull();
  clearSponsorReceipt(other,funding);expect(readSponsorReceipt(launch)).toEqual(funding);
 }
});

it("reads legacy session receipts without overriding a current launch receipt",()=>{
 sessionStorage.setItem(legacyKey,JSON.stringify(deployment));expect(readSponsorReceipt(launch)).toEqual(deployment);
 sessionStorage.setItem(key,JSON.stringify(funding));expect(readSponsorReceipt(launch)).toEqual(funding);
 localStorage.setItem(key,JSON.stringify(deployment));expect(readSponsorReceipt(launch)).toEqual(deployment);
});

it("falls back past invalid durable data to a valid session receipt",()=>{
 localStorage.setItem(key,"broken");sessionStorage.setItem(key,JSON.stringify(funding));expect(readSponsorReceipt(launch)).toEqual(funding);
 sessionStorage.setItem(key,"broken");sessionStorage.setItem(legacyKey,JSON.stringify(deployment));expect(readSponsorReceipt(launch)).toEqual(deployment);
});

it("retains a tab receipt when durable storage is unavailable and reports it is not durable",()=>{
 vi.stubGlobal("localStorage",{getItem:unavailable,setItem:unavailable,removeItem:unavailable});
 expect(saveSponsorReceipt(launch,funding)).toBe(false);expect(readSponsorReceipt(launch)).toEqual(funding);
 clearSponsorReceipt(launch,funding);expect(readSponsorReceipt(launch)).toBeNull();
});

it("keeps durable recovery working when session storage is unavailable",()=>{
 vi.stubGlobal("sessionStorage",{getItem:unavailable,setItem:unavailable,removeItem:unavailable});
 expect(saveSponsorReceipt(launch,deployment)).toBe(true);expect(readSponsorReceipt(launch)).toEqual(deployment);
 clearSponsorReceipt(launch,deployment);expect(readSponsorReceipt(launch)).toBeNull();
});

it("handles both storage mechanisms being blocked without claiming persistence",()=>{
 for(const storage of ["localStorage","sessionStorage"])vi.stubGlobal(storage,{getItem:unavailable,setItem:unavailable,removeItem:unavailable});
 expect(saveSponsorReceipt(launch,funding)).toBe(false);expect(readSponsorReceipt(launch)).toBeNull();
 expect(()=>clearSponsorReceipt(launch,funding)).not.toThrow();
});

it("clears only the matching action and hash, retaining a newer receipt",()=>{
 const newer={...funding,hash:hash("d")};
 saveSponsorReceipt(launch,newer);sessionStorage.setItem(legacyKey,JSON.stringify(funding));
 clearSponsorReceipt(launch,funding);
 expect(readSponsorReceipt(launch)).toEqual(newer);expect(sessionStorage.getItem(key)).toBe(JSON.stringify(newer));expect(sessionStorage.getItem(legacyKey)).toBeNull();
 clearSponsorReceipt(launch,{action:"deployment",hash:newer.hash});expect(readSponsorReceipt(launch)).toEqual(newer);
 clearSponsorReceipt(launch,newer);expect(localStorage.getItem(key)).toBeNull();expect(sessionStorage.getItem(key)).toBeNull();
});

it("does not erase a newer legacy receipt while clearing the current receipt",()=>{
 saveSponsorReceipt(launch,funding);sessionStorage.setItem(legacyKey,JSON.stringify(deployment));
 clearSponsorReceipt(launch,funding);expect(readSponsorReceipt(launch)).toEqual(deployment);
});

it.each([deployment,funding])("requires matching record and observation before confirming $action",receipt=>{
 expect(sponsorReceiptConfirmed(confirmed(),receipt)).toBe(true);
 const field=receipt.action==="deployment"?"deploymentHash":"fundingHash";
 const noRecord=confirmed();noRecord.record=null;expect(sponsorReceiptConfirmed(noRecord,receipt)).toBe(false);
 const noObservation=confirmed();noObservation.observation=null;expect(sponsorReceiptConfirmed(noObservation,receipt)).toBe(false);
 const wrongRecord=confirmed();wrongRecord.record![field]=hash("d");expect(sponsorReceiptConfirmed(wrongRecord,receipt)).toBe(false);
 const wrongObservation=confirmed();wrongObservation.observation![field]=hash("d");expect(sponsorReceiptConfirmed(wrongObservation,receipt)).toBe(false);
 const bothWrong=confirmed();bothWrong.record![field]=hash("d");bothWrong.observation![field]=hash("d");expect(sponsorReceiptConfirmed(bothWrong,receipt)).toBe(false);
});

it("requires observed funding, even when both funding hashes match",()=>{
 const view=confirmed();view.observation!.funded=false;expect(sponsorReceiptConfirmed(view,funding)).toBe(false);
 expect(sponsorReceiptConfirmed(view,deployment)).toBe(true);
});
