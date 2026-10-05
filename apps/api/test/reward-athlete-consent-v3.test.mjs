import test from "node:test";
import assert from "node:assert/strict";
import { toHex, hashTypedData } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { rewardClaimMessagesV3 } from "../../../packages/rewards-chain/dist/campaign-v3.js";
import { decodeAthleteConsentSelectionV3,decodeAthleteConsentReviewV3,decodeAthleteConsentRecordV3,decodeOwnAthleteClaimsV3,
  athleteConsentSigningJsonV3,verifyAthleteConsentSignatureV3 } from "../../../packages/rewards-chain/dist/athlete-consent-v3.js";
const id=n=>`8fe00000-0000-4000-8000-${String(n).padStart(12,"0")}`,h=n=>toHex(BigInt(n),{size:32}),a=n=>toHex(BigInt(n),{size:20});
// Explicit synthetic unit-test signer, not a portal athlete or provisioned wallet.
const signer=privateKeyToAccount(h(0xFE001));
function fixture(){
  const selection={chainId:31337,uploadId:id(1),destinationId:id(2),claimId:id(3),entitlementId:h(1),campaignAddress:a(2),
    recipientAddress:signer.address.toLowerCase(),amountWei:"1000000000000000001",pot:"league"};
  const record={schema:"raceson-athlete-claim-record-v3",chainId:31337,uploadId:id(1),destinationId:id(2),claimId:id(3),entitlementId:h(1),
    recipientAddress:selection.recipientAddress,amountWei:selection.amountWei,issuedAt:"1800000000",expiresAt:"1800086400",recipientConsented:false,operatorApproved:false};
  const messages=rewardClaimMessagesV3({chainId:31337,environment:"local-simulation",verifyingContract:selection.campaignAddress},
    {entitlementId:selection.entitlementId,recipient:selection.recipientAddress,amount:BigInt(selection.amountWei),pot:"league",nonce:0n,
      issuedAt:1800000000n,expiresAt:1800086400n,allocationDigest:h(4)});
  const raw=JSON.parse(JSON.stringify({...record,status:"signature_required",role:"recipient",typedData:messages.consent,
    observation:{blockNumber:"200",blockHash:h(5),timestamp:"1800000001"}},(_k,v)=>typeof v==="bigint"?v.toString():v));
  return{selection,record,messages,raw};
}
test("athlete browser codec reconstructs exact domain-4 ReceiveReward from wire and decoded records",async()=>{
  const f=fixture(),decoded=decodeAthleteConsentReviewV3(f.raw,f.selection),json=JSON.parse(athleteConsentSigningJsonV3(decoded));
  assert.equal(hashTypedData(decoded.typedData),hashTypedData(f.messages.consent));
  assert.deepEqual(decodeAthleteConsentReviewV3(decoded,f.selection),decoded);
  assert.equal(json.message.amount,f.selection.amountWei);assert.equal(json.domain.version,"4");assert.equal(json.primaryType,"ReceiveReward");
  assert.deepEqual(json.types.EIP712Domain,[{name:"name",type:"string"},{name:"version",type:"string"},{name:"chainId",type:"uint256"},{name:"verifyingContract",type:"address"}]);
  assert.deepEqual(decodeAthleteConsentRecordV3(f.record,f.selection),f.record);
  const recorded={...f.record,recipientConsented:true,status:"already_recorded"};assert.deepEqual(decodeAthleteConsentReviewV3(recorded,f.selection),recorded);
  const proof=await signer.signTypedData(json);assert.equal(await verifyAthleteConsentSignatureV3(decoded,proof),proof);
});
test("athlete review refuses downgrades, operator instructions, precision loss, swapped scope and extra fields",()=>{
  const f=fixture();
  for(const edit of [r=>r.role="operator",r=>r.amountWei="1",r=>r.chainId=143,r=>r.claimId=id(9),r=>r.destinationId=id(9),r=>r.recipientAddress=a(9),
    r=>r.typedData.domain.version="2",r=>r.typedData.domain.version="3",r=>r.typedData.domain.verifyingContract=a(9),r=>r.typedData.domain.chainId=10143,
    r=>r.typedData.domain.name="other",r=>r.typedData.primaryType="AuthorizeReward",r=>r.typedData=f.messages.authorization,
    r=>r.typedData.message.pot=0,r=>r.typedData.message.recipient=a(9),r=>r.typedData.message.entitlementId=h(9),r=>r.typedData.message.amount=Number(r.amountWei),
    r=>r.typedData.message.amount="01",r=>r.typedData.message.nonce="-1",r=>r.typedData.message.nonce=((1n<<256n)-1n).toString(),
    r=>r.typedData.message.allocationDigest=h(0),r=>r.typedData.message.issuedAt="1800000001",r=>r.typedData.message.expiresAt="1800086399",
    r=>r.typedData.types.ReceiveReward[0].type="bytes",r=>r.typedData.types.ReceiveReward.reverse(),r=>r.typedData.message.value="1",
    r=>r.signature="private",r=>r.recipientConsented=true,r=>r.operatorApproved=true,r=>r.expiresAt="1800086401",
    r=>r.observation.blockNumber="0",r=>r.observation.blockHash=h(0),r=>r.observation.timestamp=r.expiresAt,r=>r.observation.timestamp="1799999999"]){
    const bad=structuredClone(f.raw);edit(bad);assert.throws(()=>decodeAthleteConsentReviewV3(bad,f.selection));
  }
  for(const edit of [s=>s.chainId=143,s=>s.amountWei=1,s=>s.amountWei="0",s=>s.amountWei=(1n<<256n).toString(),s=>s.privateKey="x"]){
    const bad={...f.selection};edit(bad);assert.throws(()=>decodeAthleteConsentSelectionV3(bad));
  }
  for(const target of ["message","field"]){const bad=structuredClone(f.raw),object=target==="message"?bad.typedData.message:bad.typedData.types.ReceiveReward[0];
    Object.defineProperty(object,target==="message"?"nonce":"name",{get(){assert.fail("accessor invoked");}});
    assert.throws(()=>decodeAthleteConsentReviewV3(bad,f.selection),/invalid_reward_athlete_consent_v3/);}
});
test("recipient proof requires canonical low-S EOA signature for this exact domain, award and destination",async()=>{
  const f=fixture(),review=decodeAthleteConsentReviewV3(f.raw,f.selection),proof=await signer.signTypedData(review.typedData);
  const other=privateKeyToAccount(h(0xFE002));
  for(const wrong of ["0x",proof.slice(0,-2)+"00",proof.slice(0,-2)+"1f",await other.signTypedData(review.typedData),
    await signer.signTypedData({...review.typedData,domain:{...review.typedData.domain,version:"2"}}),
    await signer.signTypedData({...review.typedData,message:{...review.typedData.message,amount:1n}}),
    proof.slice(0,66)+"f".repeat(64)+proof.slice(-2)])await assert.rejects(verifyAthleteConsentSignatureV3(review,wrong));
});
test("own claim history has a distinct UUID cursor, strict ordered pages and no payment/private material",()=>{
  const f=fixture(),items=Array.from({length:50},(_,i)=>({...f.record,claimId:id(i+1)}));
  const page={schema:"raceson-own-claims-v3",chainId:31337,items,nextCursor:id(50)};
  assert.equal(decodeOwnAthleteClaimsV3(page,31337).items.length,50);
  assert.deepEqual(decodeOwnAthleteClaimsV3({...page,items:[],nextCursor:null},31337,id(50)).items,[]);
  for(const edit of [p=>p.chainId=10143,p=>p.nextCursor=id(49),p=>p.items.pop(),p=>p.items.reverse(),p=>p.items[1]=p.items[0],
    p=>p.items[0].paid=true,p=>p.items[0].operatorApproved=true,p=>p.items[0].chainId=10143,p=>p.items[0].expiresAt="18446744073709551616"]){
    const bad=structuredClone(page);edit(bad);assert.throws(()=>decodeOwnAthleteClaimsV3(bad,31337));}
  assert.throws(()=>decodeOwnAthleteClaimsV3(page,31337,h(1)));assert.throws(()=>decodeOwnAthleteClaimsV3(page,31337,id(1)));
  const bad=structuredClone(page);Object.defineProperty(bad.items,"0",{get(){assert.fail("accessor invoked");}});assert.throws(()=>decodeOwnAthleteClaimsV3(bad,31337));
});
