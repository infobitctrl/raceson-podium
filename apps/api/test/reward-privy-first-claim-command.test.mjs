import assert from "node:assert/strict";
import test from "node:test";
import {readFileSync} from "node:fs";
import {parseFirstPrivyClaim,firstPrivyClaim} from "../../../demo/rewards/scripts/privy-testnet-first-claim.mjs";
test("first Privy claim operator accepts only fixed scoped commands and a reviewed source digest",()=>{
  for(const action of ["prepare","approve","pay"])assert.deepEqual(parseFirstPrivyClaim([action,"--confirm-source","a".repeat(64)]),{action,digest:"a".repeat(64)});
  for(const args of [[],["pay"],["pay","--chain","143"],["fund","--confirm-source","a".repeat(64)],
    ["pay","--confirm-source","a".repeat(64),"--recipient=other"],["pay","--confirm-source","0x"+"a".repeat(64)]])
    assert.throws(()=>parseFirstPrivyClaim(args));
  assert.equal(firstPrivyClaim.chainId,10143);assert.equal(firstPrivyClaim.paymentId,"9a000000-0000-4000-8000-000000802010");
  assert.ok(Object.isFrozen(firstPrivyClaim));
});
test("fixed claim executor awaits database writes before closing organizer Auth",()=>{
  const source=readFileSync(new URL("../../../demo/rewards/scripts/privy-testnet-first-claim.mjs",import.meta.url),"utf8");
  assert.match(source,/return await prepareAthleteClaimV3/);
  assert.match(source,/return await recordAthleteClaimProofV3/);
  assert.match(source,/finally\{journal\?\.close\(\);await session\?\.signOut\(\);\}/);
  assert.match(source,/\$\{action\}-source-\$\{digest\}\.json/);
});
