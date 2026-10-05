import assert from "node:assert/strict";
import test from "node:test";
import {readFileSync} from "node:fs";
import {finalClaimScope,parseFinalClaimCommand} from "../../../demo/rewards/scripts/privy-testnet-final-claims.mjs";
import {finalPotScope} from "../../../demo/rewards/scripts/privy-testnet-final-pots.mjs";
const athlete="9a000000-0000-4000-8000-000000001060";
function upload(slot){return {current:true,prepared:{id:finalPotScope(slot).uploadId},document:{slot,source:{kind:"synthetic_rehearsal"},
  record:{draftId:finalPotScope(slot).draftId,chainId:10143},binding:{campaignAddress:slot===5?"0x51e5e6e624e76152a170abf2ef13166b39ea7252":"0x9e7076fe48f9f67c377f3642eb940fb0d8a3381b"}},
  recipients:[{beneficiaryKind:"athlete",sourceBeneficiaryId:athlete,entitlementId:`0x${"a".repeat(64)}`,amountWei:slot===5?400120000000000000n:1868346153846153846n}]};}
test("final claims retain exact tester, destination, amount and final-pot scope",()=>{
  for(const slot of [5,6]) {
    const u=upload(slot),s=finalClaimScope(slot,u);assert.equal(s.chainId,10143);assert.equal(s.uploadId,u.prepared.id);
    assert.equal(s.destinationId,"b8616917-975c-47cc-974e-da72a00fe958");
    for(const change of [u=>u.current=false,u=>u.document.record.chainId=143,u=>u.document.source.kind="minimized_source",
      u=>u.recipients[0].amountWei=1n,u=>u.recipients[0].beneficiaryKind="club",u=>u.recipients[0].sourceBeneficiaryId="foreign",
      u=>u.recipients.push(u.recipients[0]),u=>u.document.slot=1,u=>u.prepared.id=finalPotScope(slot===5?6:5).uploadId]) {
      const changed=upload(slot);change(changed);assert.throws(()=>finalClaimScope(slot,changed));
    }
  }
});
test("CLI rejects scope, credential, recipient, network and unsigned-source overrides",()=>{
  for(const action of ["prepare","approve","pay","reconcile"])
    assert.equal(parseFinalClaimCommand([action,"5","--confirm-source","a".repeat(64)]).action,action);
  for(const args of [["pay","5"],["prepare","1"],["inspect","6","extra"],["approve","6","--confirm-source","bad"],
    ["consent","5","--confirm-source","a".repeat(64)],["pay","6","--confirm-source","a".repeat(64),"--wallet","other"]])
    assert.throws(()=>parseFinalClaimCommand(args));
});
test("operator adapter never manufactures recipient consent and retains receipt-only recovery",()=>{
  const source=readFileSync(new URL("../../../demo/rewards/scripts/privy-testnet-final-claims.mjs",import.meta.url),"utf8");
  assert.match(source,/genuine_privy_recipient_consent_required/);assert.match(source,/role:"operator",signature/);
  assert.doesNotMatch(source,/role:"recipient",signature|privateKeyToAccount|generatePrivateKey/);
  assert.match(source,/original.profileFingerprint,readiness.profileFingerprint/);
  assert.match(source,/action==="reconcile"\?receiptOnlyBroadcast/);assert.match(source,/payment\?\.receipt\)return view/);
  assert.match(source,/privy-testnet-ui-v3/);assert.match(source,/60000000000000000/);
});
