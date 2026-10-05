import assert from "node:assert/strict";
import test from "node:test";
import { rewardLeaseCanStartSend } from "../dist/features/rewards/worker-send-fence.js";
test("send fence requires a finite future deadline and fails exactly at expiry",()=>{
  const time=Date.parse("2026-09-08T12:00:00Z");const lease={leaseExpiresAt:"2026-09-08T12:00:00Z"};
  assert.equal(rewardLeaseCanStartSend(lease,time-1),true);
  assert.equal(rewardLeaseCanStartSend(lease,time),false);
  assert.equal(rewardLeaseCanStartSend(lease,time+1),false);
  for(const leaseExpiresAt of [null,undefined,"bad",0])assert.equal(rewardLeaseCanStartSend({leaseExpiresAt},time),false);
  for(const now of [NaN,Infinity,-Infinity])assert.equal(rewardLeaseCanStartSend(lease,now),false);
});
