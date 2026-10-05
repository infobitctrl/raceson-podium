import assert from "node:assert/strict";
import { test } from "node:test";
import { validateRewardCampaignAccounting, rewardCampaignFundingSummary } from "../dist/index.js";
import { h } from "./fixtures.mjs";
const zero = `0x${"0".repeat(64)}`;
const funding = () => ({ state:0,paused:false,accountedFunding:0n,treasuryReturned:0n,budgets:[0n,0n],allocated:[0n,0n],paid:[0n,0n],
  nativeBalance:0n,entitlementCount:0n,uploadDigest:zero,snapshotDigest:zero,allocationDigest:zero,activationNotBefore:0n,claimDeadline:0n,pausedAt:0n });
const review = () => ({...funding(),state:1,accountedFunding:100n,budgets:[100n,0n],nativeBalance:100n});
const active = () => ({...review(),state:3,allocated:[60n,0n],paid:[20n,0n],nativeBalance:80n,entitlementCount:2n,uploadDigest:h("uploaded"),
  snapshotDigest:h("source"),allocationDigest:h("allocation"),activationNotBefore:100n,claimDeadline:200n});
test("funding summary uses only accounted deposits and keeps mismatches distinct from forced surplus",()=>{
  assert.equal(rewardCampaignFundingSummary({...funding(),nativeBalance:100n},0,100n).shortfall,100n);
  assert.equal(rewardCampaignFundingSummary({...funding(),nativeBalance:100n},0,100n).forcedSurplus,100n);
  const partial = rewardCampaignFundingSummary({...funding(),accountedFunding:40n,nativeBalance:140n},0,100n);
  assert.equal(partial.shortfall,60n); assert.equal(partial.forcedSurplus,100n); assert.equal(partial.fixedBudgetMatches,false);
  assert.equal(rewardCampaignFundingSummary({...funding(),accountedFunding:110n,nativeBalance:110n},0,100n).excess,10n);
  assert.equal(rewardCampaignFundingSummary(review(),0,100n).fixedBudgetMatches,true);
  assert.equal(rewardCampaignFundingSummary(review(),0,100n).state,1,"Budget agreement is not active or claimable");
  assert.throws(()=>rewardCampaignFundingSummary(review(),0,0n));
});
test("accounting handles paid reserves, pause, expiry returns and cancellation before funding closes",()=>{
  const a=active(); const summary=rewardCampaignFundingSummary(a,0,100n);
  assert.equal(summary.remainingAccounted,80n); assert.equal(summary.unpaidAllocated,40n);
  validateRewardCampaignAccounting({...a,paused:true,pausedAt:150n},0);
  validateRewardCampaignAccounting({...a,state:4,treasuryReturned:80n,nativeBalance:5n},0);
  validateRewardCampaignAccounting({...funding(),state:5,accountedFunding:40n,treasuryReturned:40n},0);
  const league={...review(),budgets:[0n,100n]}; assert.equal(rewardCampaignFundingSummary(league,1,100n).fixedBudgetMatches,true);
  const normalized=validateRewardCampaignAccounting(a,0); a.budgets[0]=999n; assert.equal(normalized.budgets[0],100n);
});
test("impossible accounting, mixed pots, missing lifecycle evidence and lossy values fail closed",()=>{
  for (const patch of [{state:6},{paused:"false"},{accountedFunding:100},{budgets:[100n,1n]},{paid:[61n,0n]},{allocated:[101n,0n]},
    {nativeBalance:79n},{treasuryReturned:81n},{entitlementCount:0n},{uploadDigest:zero},{snapshotDigest:zero},{activationNotBefore:0n},
    {claimDeadline:0n},{paused:true,pausedAt:0n},{pausedAt:150n},{state:1},{state:5},{budgets:[99n,0n]}])
    assert.throws(()=>validateRewardCampaignAccounting({...active(),...patch},0));
  assert.throws(()=>validateRewardCampaignAccounting({...funding(),budgets:[100n,0n],accountedFunding:100n,nativeBalance:100n},0));
});
