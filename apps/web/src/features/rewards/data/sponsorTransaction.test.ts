import {expect, it, vi} from "vitest";
import {checkSponsorTransaction, sendSponsorTransaction} from "./sponsorTransaction";
import {sponsorDeploymentData, sponsorFundingData} from "@raceson/rewards-chain/sponsor-v4";
import type {SponsorExecutionPlan} from "@raceson/domain/rewards/sponsor-execution";
const plan: SponsorExecutionPlan = {version:4,launchId:"73000000-0000-4000-8000-000000000003",setupRevision:4,configurationHash:"a".repeat(64),chainId:10143,
  funder:"0x"+"11".repeat(20),operator:"0x"+"22".repeat(20),unallocatedTreasury:"0x"+"33".repeat(20),expiredTreasury:"0x"+"11".repeat(20),
  claimLifetime:86400,reviewPeriods:[0,0,0,0,0,0],caps:["101","0","0","0","0","0"],budgetWei:"101"};
const hash="0x"+"aa".repeat(32),address="0x"+"44".repeat(20);
function provider(sender=plan.operator){return {on:vi.fn(),removeListener:vi.fn(),request:vi.fn(async({method}:{method:string;params?:unknown[]}):Promise<unknown>=>({
 eth_accounts:[sender],eth_chainId:"0x279f",eth_estimateGas:"0x100000",eth_gasPrice:"0x3b9aca00",eth_sendTransaction:hash,eth_getBalance:"0xde0b6b3a7640000",
 }[method]))};}
it("sends only exact pinned deployment data or the exact whole-pot deposit, with explicit sender/network/gas bounds",async()=>{
 const p=provider();expect(await sendSponsorTransaction(p,{plan,action:"deployment"},()=>true)).toBe(hash);
 const sent=p.request.mock.calls.find(([r])=>r.method==="eth_sendTransaction")![0].params![0];
 expect(sent).toMatchObject({from:plan.operator,chainId:"0x279f",value:"0x0",data:sponsorDeploymentData(plan)});expect(sent).not.toHaveProperty("to");
 expect(p.removeListener).toHaveBeenCalledTimes(3);const fund=provider(plan.funder);
 await sendSponsorTransaction(fund,{plan,action:"funding",address},()=>true);
 expect(fund.request.mock.calls.find(([r])=>r.method==="eth_sendTransaction")![0].params![0]).toMatchObject({from:plan.funder,to:address,value:"0x65",data:sponsorFundingData()});
});
it("never sends after a wallet/network change or excessive fee estimate",async()=>{
 for(const mismatch of ["account","chain","gas"]){const p=provider(),normal=p.request.getMockImplementation()!;
  p.request.mockImplementation(async r=>r.method==="eth_accounts"&&mismatch==="account"?[address]:r.method==="eth_chainId"&&mismatch==="chain"?"0x1":r.method==="eth_gasPrice"&&mismatch==="gas"?"0xffffffffffffffffff":normal(r));
  await expect(sendSponsorTransaction(p,{plan,action:"deployment"},()=>true)).rejects.toThrow();expect(p.request.mock.calls.some(([r])=>r.method==="eth_sendTransaction")).toBe(false);
 }
 const p=provider();let current=true;const normal=p.request.getMockImplementation()!;
 p.request.mockImplementation(async r=>{if(r.method==="eth_estimateGas")current=false;return normal(r);});
 await expect(sendSponsorTransaction(p,{plan,action:"deployment"},()=>current)).rejects.toThrow("sponsor_wallet_changed");
});
it("preserves a broadcast hash when the session changes during wallet confirmation",async()=>{
 const p=provider();let current=true;const normal=p.request.getMockImplementation()!;
 p.request.mockImplementation(async r=>{if(r.method==="eth_sendTransaction")current=false;return normal(r);});
 expect(await sendSponsorTransaction(p,{plan,action:"deployment"},()=>current)).toBe(hash);
});

it("reports a read-only gas blocker and never opens a transaction request",async()=>{
 const p=provider(),normal=p.request.getMockImplementation()!;
 p.request.mockImplementation(async r=>r.method==="eth_estimateGas"?"0xe63e8c":r.method==="eth_gasPrice"?"0x4a817c8000":normal(r));
 const ready=await checkSponsorTransaction(p,{plan,action:"deployment"},()=>true);
 expect(ready.blocker).toBe("gas_limit");expect(BigInt(ready.gasCostWei!)).toBeGreaterThan(500_000_000_000_000_000n);
 await expect(sendSponsorTransaction(p,{plan,action:"deployment"},()=>true)).rejects.toThrow("sponsor_gas_limit");
 expect(p.request.mock.calls.some(([r])=>r.method==="eth_sendTransaction")).toBe(false);
});
it("requires balance for deposit plus gas and rechecks it on submission",async()=>{
 const p=provider(plan.funder),normal=p.request.getMockImplementation()!;let balance="0xde0b6b3a7640000";
 p.request.mockImplementation(async r=>r.method==="eth_getBalance"?balance:normal(r));
 expect((await checkSponsorTransaction(p,{plan,action:"funding",address},()=>true)).blocker).toBeNull();balance="0x65";
 await expect(sendSponsorTransaction(p,{plan,action:"funding",address},()=>true)).rejects.toThrow("sponsor_insufficient_balance");
 expect(p.request.mock.calls.some(([r])=>r.method==="eth_sendTransaction")).toBe(false);
});
it("reports an unfunded sponsor before a provider can reject the value-bearing estimate",async()=>{
 const p=provider(plan.funder),normal=p.request.getMockImplementation()!;
 p.request.mockImplementation(async r=>{if(r.method==="eth_getBalance")return "0x0";if(r.method==="eth_estimateGas")throw Error("insufficient funds");return normal(r);});
 await expect(checkSponsorTransaction(p,{plan,action:"funding",address},()=>true)).resolves.toEqual({balanceWei:"0",gasCostWei:null,blocker:"balance"});
 await expect(sendSponsorTransaction(p,{plan,action:"funding",address},()=>true)).rejects.toThrow("sponsor_insufficient_balance");
 expect(p.request.mock.calls.some(([r])=>["eth_estimateGas","eth_sendTransaction"].includes(r.method))).toBe(false);
});
it("recognizes the exact reward budget without mistaking an unestimated fee for zero",async()=>{
 const p=provider(plan.funder),normal=p.request.getMockImplementation()!;
 p.request.mockImplementation(async r=>r.method==="eth_getBalance"?"0x65":normal(r));
 expect(await checkSponsorTransaction(p,{plan,action:"funding",address},()=>true)).toEqual({balanceWei:"101",gasCostWei:null,blocker:"balance"});
 expect(p.request.mock.calls.some(([r])=>r.method==="eth_estimateGas")).toBe(false);
});
it("distinguishes a failed estimate, declined wallet request and uncertain broadcast",async()=>{
 for(const [method,error,expected] of [
  ["eth_estimateGas",new Error("private RPC details"),"sponsor_preflight_failed"],
  ["eth_sendTransaction",{code:4001},"sponsor_wallet_rejected"],
  ["eth_sendTransaction",new Error("network lost"),"sponsor_transaction_unknown"],
 ] as const){const p=provider(),normal=p.request.getMockImplementation()!;
  p.request.mockImplementation(async r=>{if(r.method===method)throw error;return normal(r);});
  await expect(sendSponsorTransaction(p,{plan,action:"deployment"},()=>true)).rejects.toThrow(expected);
 }
});

it("accepts Privy's bigint gas estimate while keeping fee bounds and exact calldata",async()=>{
 const p=provider(),normal=p.request.getMockImplementation()!;
 p.request.mockImplementation(async r=>r.method==="eth_estimateGas"?1_048_576n:normal(r));
 expect((await checkSponsorTransaction(p,{plan,action:"deployment"},()=>true)).blocker).toBeNull();
 expect(await sendSponsorTransaction(p,{plan,action:"deployment"},()=>true)).toBe(hash);
 expect(p.request.mock.calls.find(([r])=>r.method==="eth_sendTransaction")![0].params![0]).toMatchObject({gas:"0x133334",data:sponsorDeploymentData(plan)});
});

it("requires the operator for creation and keeps sponsor funding separate",async()=>{
 const sponsor=provider(plan.funder);
 await expect(sendSponsorTransaction(sponsor,{plan,action:"deployment"},()=>true)).rejects.toThrow("sponsor_wallet_changed");
 const operator=provider();
 await expect(sendSponsorTransaction(operator,{plan,action:"funding",address},()=>true)).rejects.toThrow("sponsor_wallet_changed");
 for(const p of [sponsor,operator])expect(p.request.mock.calls.some(([r])=>r.method==="eth_sendTransaction")).toBe(false);
});
it("uses the operator balance and deployment ceiling without changing the deposit ceiling",async()=>{
 const p=provider(),normal=p.request.getMockImplementation()!;
 p.request.mockImplementation(async r=>r.method==="eth_estimateGas"?15_089_292n:r.method==="eth_gasPrice"?"0x17bfac7c00":r.method==="eth_getBalance"?"0x0":normal(r));
 const ready=await checkSponsorTransaction(p,{plan,action:"deployment"},()=>true);
 expect(ready.blocker).toBe("balance");
 expect(p.request.mock.calls.find(([r])=>r.method==="eth_getBalance")![0].params).toEqual([plan.operator,"pending"]);
 expect(p.request.mock.calls.some(([r])=>r.method==="eth_sendTransaction")).toBe(false);
});
