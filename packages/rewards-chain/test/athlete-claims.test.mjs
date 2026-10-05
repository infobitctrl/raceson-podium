import assert from "node:assert/strict";
import test from "node:test";
import { getContractAddress, toHex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { normalizeRewardAthleteClaimExpectation, rewardClaimMessages, verifyRewardClaimEoaProof } from "../dist/index.js";
import { proposalFor, h } from "./fixtures.mjs";

// Public deterministic synthetic signers; never funded outside owned simulation.
const operator=privateKeyToAccount(toHex(0xA11CEn,{size:32}));
const athlete=privateKeyToAccount(toHex(993n,{size:32}));
const other=privateKeyToAccount(toHex(994n,{size:32}));
function fixture(){
  const upload=proposalFor();const award=upload.awards.find(a=>a.beneficiaryKind===0);
  const deployment={context:{environment:"local-simulation",chainId:31337,verifyingContract:getContractAddress({from:operator.address,nonce:0n})},
    operatorAddress:operator.address,treasuryAddress:other.address,programmeId:upload.programmeId,campaignId:upload.campaignId,
    programmeManifestHash:upload.programmeManifestHash,enabledPot:0,deploymentNonce:0n,deploymentTransactionHash:h("claim-deployment")};
  const expected={deployment,upload,entitlementId:award.entitlementId,recipient:athlete.address};
  const claim={entitlementId:award.entitlementId,recipient:athlete.address,amount:award.amount,pot:"race",nonce:0n,
    issuedAt:1801000000n,expiresAt:1801086400n,allocationDigest:upload.allocationDigest};
  return{expected,claim,context:deployment.context};
}
test("athlete preparation recomputes the complete immutable package and copies the selected earned award",()=>{
  const {expected}=fixture();const normalized=normalizeRewardAthleteClaimExpectation(expected);
  assert.equal(normalized.award.entitlementId,expected.entitlementId);
  expected.upload.awards[0].amount++;expected.deployment.context.chainId=143;
  assert.equal(normalized.deployment.context.chainId,31337);
  assert.notDeepEqual(normalized.upload.awards,expected.upload.awards);
});
test("athlete preparation rejects altered budgets, digests, amounts, foreign campaigns, unknown awards and club claims",()=>{
  for(const mutate of [e=>{e.upload.awards[0].amount++;},e=>{e.upload.allocated[0]++;},e=>{e.upload.budgets[0]++;},
    e=>{e.upload.snapshotDigest=h("wrong");},e=>{e.upload.entitlementCount++;},e=>{e.upload.unallocated++;},
    e=>{e.deployment.campaignId=h("foreign");},e=>{e.entitlementId=h("missing");},
    e=>{e.entitlementId=e.upload.awards.find(a=>a.beneficiaryKind===1).entitlementId;},e=>{e.deployment.context.chainId=143;}]){
    const {expected}=fixture();mutate(expected);assert.throws(()=>normalizeRewardAthleteClaimExpectation(expected));
  }
});
test("real EOA signatures separate operator approval from recipient receipt consent",async()=>{
  const {context,claim}=fixture();const m=rewardClaimMessages(context,claim);
  const approval=await operator.signTypedData(m.authorization);const consent=await athlete.signTypedData(m.consent);
  assert.equal((await verifyRewardClaimEoaProof(context,claim,"operator",operator.address,approval)).signer,operator.address.toLowerCase());
  assert.equal((await verifyRewardClaimEoaProof(context,claim,"recipient",operator.address,consent)).signer,athlete.address.toLowerCase());
  for(const [role,signature] of [["operator",consent],["recipient",approval],["operator",await other.signTypedData(m.authorization)],
    ["recipient",await other.signTypedData(m.consent)],["recipient",await athlete.signTypedData(m.authorization)]])
    await assert.rejects(verifyRewardClaimEoaProof(context,claim,role,operator.address,signature));
});
test("recipient proofs bind amount, pot, nonce, recipient, window, campaign contract and chain",async()=>{
  const {context,claim}=fixture();const signature=await athlete.signTypedData(rewardClaimMessages(context,claim).consent);
  for(const patch of [{amount:claim.amount+1n},{pot:"league"},{nonce:1n},{recipient:other.address},{issuedAt:claim.issuedAt+1n},
    {expiresAt:claim.expiresAt-1n},{allocationDigest:h("new")},{entitlementId:h("other")}])
    await assert.rejects(verifyRewardClaimEoaProof(context,{...claim,...patch},"recipient",operator.address,signature));
  for(const patch of [{verifyingContract:other.address},{environment:"monad-testnet",chainId:10143}])
    await assert.rejects(verifyRewardClaimEoaProof({...context,...patch},claim,"recipient",operator.address,signature));
});
test("EOA proof validation rejects malformed and high-S signatures, and freezes inputs across recovery",async()=>{
  const {context,claim}=fixture();const signature=await athlete.signTypedData(rewardClaimMessages(context,claim).consent);
  const order=0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141n;
  const highS=`${signature.slice(0,66)}${(order-BigInt(`0x${signature.slice(66,130)}`)).toString(16).padStart(64,"0")}${signature.endsWith("1b")?"1c":"1b"}`;
  for(const invalid of ["0x",`${signature}00`,signature.slice(0,-2),`${signature.slice(0,-2)}00`,highS])
    await assert.rejects(verifyRewardClaimEoaProof(context,claim,"recipient",operator.address,invalid));
  const pending=verifyRewardClaimEoaProof(context,claim,"recipient",operator.address,signature);
  context.chainId=143;claim.recipient=other.address;claim.amount++;
  assert.equal((await pending).signer,athlete.address.toLowerCase());
});
