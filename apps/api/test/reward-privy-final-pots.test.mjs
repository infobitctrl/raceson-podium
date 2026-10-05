import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { finalPotScope, parseFinalPotCommand } from "../../../demo/rewards/scripts/privy-testnet-final-pots.mjs";
test("final test adapter accepts only slots 5/6 and exact-source bounded actions",()=>{
  for(const slot of [5,6]) {
    const scope=finalPotScope(slot);assert.equal(scope.chainId,10143);
    assert.equal(scope.draftId,"9a000000-0000-4000-8000-000000000052");
    assert.deepEqual(parseFinalPotCommand(["inspect",String(slot)]),{action:"inspect",slot,digest:undefined});
    for(const action of ["prepare","complete_funding","upload_awards","stage_allocation","activate","reconcile"])
      assert.deepEqual(parseFinalPotCommand([action,String(slot),"--confirm-source","a".repeat(64)]),{action,slot,digest:"a".repeat(64)});
  }
  for(const slot of [1,2,3,4,7,5.5,"5"])assert.throws(()=>finalPotScope(slot));
  for(const args of [["pay","5"],["prepare","5"],["prepare","5","--confirm-source","bad"],
    ["activate","5","--confirm-source","a".repeat(64),"--rpc","https://example.com"],["inspect","05"],
    ["inspect","5","--confirm-source","a".repeat(64)]])assert.throws(()=>parseFinalPotCommand(args));
});
test("final adapter preserves shared journal, zero value, final publications and receipt-only recovery",()=>{
  const source=readFileSync(new URL("../../../demo/rewards/scripts/privy-testnet-final-pots.mjs",import.meta.url),"utf8");
  assert.match(source,/privy-testnet-ui-v3/);assert.match(source,/assert.equal\(pilotUiDigest\(\),digest\)/);
  assert.match(source,/review.plan.valueWei,"0"/);assert.match(source,/publication:pub.publication.binding/);
  assert.match(source,/broadcast:receiptOnlyBroadcast/);assert.match(source,/pending_job_requires_inspection/);
  assert.doesNotMatch(source,/recordAthleteClaimProof|runPayment|rewardRoundPublicationV3|fundPrivyProgrammeStep|privateKeyToAccount/);
});
