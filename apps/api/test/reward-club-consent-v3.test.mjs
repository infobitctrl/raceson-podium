import test from "node:test";
import assert from "node:assert/strict";
import { toHex, hashTypedData } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { safeRewardConsentMessageV3 } from "../../../packages/rewards-chain/dist/campaign-v3.js";
import { decodeClubConsentSelectionV3,decodeClubConsentReviewV3,decodeClubConsentRecordV3,clubConsentSigningJsonV3,
  combineClubOwnerSignaturesV3,verifyClubOwnerSignatureV3 } from "../../../packages/rewards-chain/dist/club-consent-v3.js";
const id=n=>`8fd00000-0000-4000-8000-${String(n).padStart(12,"0")}`,h=n=>toHex(BigInt(n),{size:32}),a=n=>toHex(BigInt(n),{size:20});
function fixture(){
  const selection={chainId:31337,uploadId:id(1),requestId:id(2),claimId:id(3),entitlementId:h(1),campaignAddress:a(2),recipientAddress:a(3),amountWei:"1000000000000000001",pot:"league"};
  const record={schema:"raceson-club-claim-record-v3",chainId:31337,uploadId:id(1),requestId:id(2),claimId:id(3),entitlementId:h(1),recipientAddress:a(3),
    amountWei:selection.amountWei,issuedAt:"1800000000",expiresAt:"1800086400",recipientConsented:false,operatorApproved:false};
  const typedData=safeRewardConsentMessageV3({chainId:31337,environment:"local-simulation",verifyingContract:selection.campaignAddress},
    {entitlementId:selection.entitlementId,recipient:selection.recipientAddress,amount:BigInt(selection.amountWei),pot:"league",nonce:0n,issuedAt:1800000000n,expiresAt:1800086400n,allocationDigest:h(4)});
  const raw={...record,status:"signature_required",role:"recipient",binding:{schema:"raceson-club-consent-binding-v3",campaignAddress:a(2),pot:"league",nonce:"0",allocationDigest:h(4)},
    observation:{blockNumber:"200",blockHash:h(5),timestamp:"1800000001"},typedData};
  return{selection,record,raw};
}
test("club consent reconstructs the exact domain-4 prize under the pinned SafeMessage envelope",()=>{
  const f=fixture(),decoded=decodeClubConsentReviewV3(f.raw,f.selection);
  assert.equal(hashTypedData(decoded.typedData),hashTypedData(f.raw.typedData));
  const json=JSON.parse(clubConsentSigningJsonV3(decoded));assert.equal(json.primaryType,"SafeMessage");
  assert.deepEqual(json.types.EIP712Domain,[{name:"chainId",type:"uint256"},{name:"verifyingContract",type:"address"}]);
  assert.deepEqual(decodeClubConsentRecordV3(f.record,f.selection),f.record);
  const recorded={...f.record,recipientConsented:true,status:"already_recorded"};assert.deepEqual(decodeClubConsentReviewV3(recorded,f.selection),recorded);
});
test("club review refuses arbitrary wallet instructions, metadata/digest drift, invalid clocks and private extras",()=>{
  const f=fixture();
  for(const edit of [r=>r.role="operator",r=>r.amountWei="1",r=>r.chainId=143,r=>r.claimId=id(9),r=>r.recipientAddress=a(9),r=>r.binding.pot="race",
    r=>r.binding.campaignAddress=a(9),r=>r.binding.nonce="1",r=>r.binding.allocationDigest=h(6),r=>r.binding.schema="old",
    r=>r.typedData.domain.version="2",r=>r.typedData.domain.verifyingContract=a(9),r=>r.typedData.domain.chainId=10143,
    r=>r.typedData.primaryType="SafeTx",r=>r.typedData.message.message=h(7),r=>r.typedData.types.SafeMessage[0].type="bytes32",
    r=>r.typedData.types.SafeMessage.push({name:"value",type:"uint256"}),r=>r.typedData.message.value="1",r=>r.signature="private",
    r=>r.recipientConsented=true,r=>r.operatorApproved=true,r=>r.expiresAt="1800086401",r=>r.observation.blockNumber="0",
    r=>r.observation.blockHash=h(0),r=>r.observation.timestamp=r.expiresAt,r=>r.observation.timestamp="1799999999"]){
    const bad=structuredClone(f.raw);edit(bad);assert.throws(()=>decodeClubConsentReviewV3(bad,f.selection));
  }
  for(const edit of [s=>s.chainId=143,s=>s.amountWei=1,s=>s.amountWei="0",s=>s.amountWei=(1n<<256n).toString(),s=>s.privateKey="x"]){
    const bad={...f.selection};edit(bad);assert.throws(()=>decodeClubConsentSelectionV3(bad));
  }
  const bad=structuredClone(f.raw);Object.defineProperty(bad.binding,"nonce",{get(){assert.fail("accessor invoked");}});
  assert.throws(()=>decodeClubConsentReviewV3(bad,f.selection),/invalid_reward_club_consent_v3/);
});
test("two distinct EOA signatures are locally recovered and sorted; no eth_sign or prevalidated fallback",async()=>{
  const f=fixture(),owners=[1,2,3].map(n=>privateKeyToAccount(h(0xFD000+n))),typed=f.raw.typedData;
  const inputs=await Promise.all(owners.slice(0,2).map(async w=>({signer:w.address,signature:await w.signTypedData(typed)})));
  const combined=await combineClubOwnerSignaturesV3(typed,inputs),reverse=await combineClubOwnerSignaturesV3(typed,[...inputs].reverse());
  assert.equal(combined,reverse);assert.equal(combined.length,262);
  await assert.rejects(combineClubOwnerSignaturesV3(typed,[inputs[0],inputs[0]]));
  await assert.rejects(combineClubOwnerSignaturesV3(typed,[inputs[0]]));
  await assert.rejects(verifyClubOwnerSignatureV3(typed,owners[2].address,inputs[0].signature));
  for(const signature of ["0x",inputs[0].signature.slice(0,-2)+"00",inputs[0].signature.slice(0,-2)+"1f"])
    await assert.rejects(verifyClubOwnerSignatureV3(typed,inputs[0].signer,signature));
  const changed=structuredClone(typed);changed.message.message=h(9);await assert.rejects(combineClubOwnerSignaturesV3(changed,inputs));
});
