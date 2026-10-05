import test from 'node:test';
import assert from 'node:assert/strict';
import {privateKeyToAccount} from 'viem/accounts';
import {sponsorClaimMessagesV4,sponsorClaimDigestsV4,verifySponsorClaimProofV4,sponsorAllocationCommitmentV4,sponsorSafeConsentMessageV4} from '../dist/sponsor-claims-v4.js';
import {rewardClaimMessagesV3} from '../dist/campaign-v3.js';
import {prepareSponsorUploadV4} from '../dist/sponsor-allocation-v4.js';
import {previewSponsorAllocation} from '@raceson/domain/rewards/sponsor-allocation';
import {sponsorAllocationFixture} from '../../../apps/api/test/fixtures/sponsor-allocation.mjs';
const h=n=>'0x'+n.toString(16).padStart(64,'0');
// Synthetic deterministic test signers only; no real wallet credentials.
const operator=privateKeyToAccount(h(0x991)),recipient=privateKeyToAccount(h(0x992));
const context={environment:'local-simulation',chainId:31337,verifyingContract:'0x'+'44'.repeat(20)};
const claim={entitlementId:h(1),recipient:recipient.address,amount:7n,pot:'league',nonce:0n,issuedAt:100n,expiresAt:200n,allocationDigest:h(2)};
test('V4 signatures bind domain 5, recipient, amount, nonce, campaign, chain and allocation',async()=>{
 const m=sponsorClaimMessagesV4(context,claim),signature=await recipient.signTypedData(m.consent);
 const proof=await verifySponsorClaimProofV4(context,claim,'recipient',operator.address,signature);
 assert.equal(proof.protocolVersion,4);assert.equal(m.consent.domain.version,'5');assert.equal(proof.digest,sponsorClaimDigestsV4(context,claim).consent);
 assert.equal(sponsorSafeConsentMessageV4(context,claim).message.message,proof.digest);
 for(const patch of [{amount:8n},{nonce:1n},{allocationDigest:h(3)},{recipient:operator.address}])await assert.rejects(verifySponsorClaimProofV4(context,{...claim,...patch},'recipient',operator.address,signature));
 await assert.rejects(verifySponsorClaimProofV4({...context,verifyingContract:operator.address},claim,'recipient',operator.address,signature));
 await assert.rejects(verifySponsorClaimProofV4({environment:'monad-testnet',chainId:10143,verifyingContract:context.verifyingContract},claim,'recipient',operator.address,signature));
 await assert.rejects(verifySponsorClaimProofV4(context,claim,'operator',operator.address,signature));
 const old=await recipient.signTypedData(rewardClaimMessagesV3(context,claim).consent);
 await assert.rejects(verifySponsorClaimProofV4(context,claim,'recipient',operator.address,old));
 await assert.rejects(verifySponsorClaimProofV4(context,claim,'recipient',operator.address,signature.slice(0,-2)+'00'));
 assert.throws(()=>sponsorClaimMessagesV4({...context,chainId:1},claim));
});
function input(){
 const f=sponsorAllocationFixture(),p=previewSponsorAllocation(f.launch,f.plan,f.binding,f.source).pots[0];
 return {...f,slot:0,publication:{reviewPeriod:0n,reviewStartedAt:1800000000n,officialPublishedAt:1800000000n,publicationEvidenceHash:h(90)},snapshotSalt:h(99),
  recipients:p.recipients.map((r,i)=>({beneficiaryKind:r.beneficiaryKind,beneficiaryId:r.beneficiaryId,opaqueBeneficiaryId:h(100+i),entitlementId:h(200+i),explanationSalt:h(300+i)}))};
}
test('V4 private calculation aggregates all categories into public opaque awards and matches exact caps',()=>{
 const i=input(),u=prepareSponsorUploadV4(i),p=previewSponsorAllocation(i.launch,i.plan,i.binding,i.source).pots[0];
 assert.equal(u.protocolVersion,4);assert.equal(u.allocated[1],p.proposedWei);assert.equal(u.unallocated,p.retainedWei);
 assert.equal(u.awards.length,p.recipients.length);
 const json=JSON.stringify(u,(_,v)=>typeof v==='bigint'?v.toString():v);
 for(const r of p.recipients)assert.ok(!json.includes(r.beneficiaryId));
 assert.ok(!json.includes(i.snapshotSalt));assert.ok(!json.includes(i.recipients[0].explanationSalt));
 assert.notEqual(prepareSponsorUploadV4({...i,snapshotSalt:h(999)}).allocationDigest,u.allocationDigest);
});
test('V4 upload refuses unresolved sources, incomplete/private binding sets, reused salts and early publication',()=>{
 for(const mutate of [i=>i.source.rounds[4].evidence.held=true,i=>i.recipients.pop(),i=>i.recipients[0].explanationSalt=i.snapshotSalt,
  i=>i.recipients[1].opaqueBeneficiaryId=i.recipients[0].opaqueBeneficiaryId,i=>i.recipients[1].entitlementId=i.recipients[0].entitlementId,
  i=>i.publication.officialPublishedAt=i.publication.reviewStartedAt=1n]){const i=input();mutate(i);assert.throws(()=>prepareSponsorUploadV4(i));}
});
test('V4 commitments change with immutable economic policy and reject disabled slots or wrong review clock',()=>{
 const i=input(),u=prepareSponsorUploadV4(i);
 const data={...i.publication,snapshotDigest:u.snapshotDigest,awards:u.awards};
 for(const patch of [{claimLifetime:86400},{expiredTreasury:operator.address.toLowerCase()},{unallocatedTreasury:operator.address.toLowerCase()}])
  assert.notEqual(sponsorAllocationCommitmentV4({...i.plan,...patch},0,data).allocationDigest,u.allocationDigest);
 assert.throws(()=>sponsorAllocationCommitmentV4(i.plan,6,data));
 assert.throws(()=>sponsorAllocationCommitmentV4(i.plan,0,{...data,reviewPeriod:1n}));
 assert.throws(()=>prepareSponsorUploadV4({...i,plan:{...i.plan,claimLifetime:86400}}));
});
