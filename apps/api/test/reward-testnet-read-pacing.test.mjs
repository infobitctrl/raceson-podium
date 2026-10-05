import assert from "node:assert/strict";
import test from "node:test";
import { createTestnetReadPacer } from "../dist/features/rewards/testnet-read-pacing.js";
test("testnet reads start apart, share a bounded concurrency pool and permit cancellation", async () => {
  const acquire=createTestnetReadPacer(10,2), signal=new AbortController().signal;
  const first=await acquire(signal), started=Date.now(), second=await acquire(signal);
  assert.ok(Date.now()-started>=8);
  let thirdStarted=false;
  const third=acquire(signal).then(release=>{thirdStarted=true;return release;});
  await new Promise(r=>setTimeout(r,20)); assert.equal(thirdStarted,false);
  const aborted=new AbortController(), waiting=acquire(aborted.signal);
  aborted.abort();await assert.rejects(waiting);
  first();const release=await third;second();release();release();
  const done=await acquire(signal);done();
});
