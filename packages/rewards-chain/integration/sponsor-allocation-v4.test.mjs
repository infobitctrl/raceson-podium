import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {startOwnedRewardChain,fixtureSigner} from './owned-chain.mjs';
import {sponsorAllocationFixture} from '../../../apps/api/test/fixtures/sponsor-allocation.mjs';
import {previewSponsorAllocation} from '@raceson/domain/rewards/sponsor-allocation';
import {sponsorDeploymentData,sponsorFundingData,observeSponsorProgramme} from '../dist/sponsor-v4.js';
import {prepareSponsorUploadV4} from '../dist/sponsor-allocation-v4.js';
import {sponsorClaimMessagesV4,sponsorClaimDigestsV4,verifySponsorClaimProofV4,encodeSponsorClaimV4} from '../dist/sponsor-claims-v4.js';
import {readSponsorAthleteClaimV4} from '../dist/sponsor-claim-reader-v4.js';
const h=n=>'0x'+n.toString(16).padStart(64,'0');
test('V4 saved sponsor categories → opaque upload → verified typed recipient consent → actual local payment',{timeout:120000},async t=>{
 const chain=await startOwnedRewardChain();
 try{
  // Only synthetic fixture identities, source facts, salts and test signers.
  const f=sponsorAllocationFixture(),operator=fixtureSigner(0x881),recipient=fixtureSigner(0x883);
  f.plan={...f.plan,funder:chain.operator.address.toLowerCase(),operator:operator.address.toLowerCase(),unallocatedTreasury:chain.treasury.toLowerCase(),expiredTreasury:chain.treasury.toLowerCase()};
  await chain.testClient.setBalance({address:operator.address,value:10n**18n});
  const deploymentHash=await chain.operatorClient.sendTransaction({data:sponsorDeploymentData(f.plan),gas:25_000_000n});
  const deployed=await chain.publicClient.waitForTransactionReceipt({hash:deploymentHash});assert.equal(deployed.status,'success');
  const fundingHash=await chain.operatorClient.sendTransaction({to:deployed.contractAddress,data:sponsorFundingData(),value:BigInt(f.plan.budgetWei),gas:2000000n});
  assert.equal((await chain.publicClient.waitForTransactionReceipt({hash:fundingHash})).status,'success');
  await chain.testClient.mine({blocks:96,interval:1});
  const observed=await observeSponsorProgramme(chain.publicClient,f.plan,deploymentHash,fundingHash),child=observed.pots[0].address;
  const abi=JSON.parse(readFileSync(new URL('../../../contracts/out/RacesOnRewardCampaignV4.sol/RacesOnRewardCampaignV4.json',import.meta.url))).abi;
  const read=(functionName,args=[])=>chain.publicClient.readContract({address:child,abi,functionName,args});
  async function write(functionName,args=[]){const hash=await chain.operatorClient.writeContract({account:operator,address:child,abi,functionName,args,gas:3000000n});assert.equal((await chain.publicClient.waitForTransactionReceipt({hash})).status,'success');return hash;}
  const now=(await chain.publicClient.getBlock()).timestamp;
  const publication={reviewPeriod:0n,reviewStartedAt:now,officialPublishedAt:now,publicationEvidenceHash:h(90)};
  const calculation=previewSponsorAllocation(f.launch,f.plan,f.binding,f.source).pots[0];
  const allocation=prepareSponsorUploadV4({...f,slot:0,publication,snapshotSalt:h(99),recipients:calculation.recipients.map((r,i)=>({beneficiaryKind:r.beneficiaryKind,beneficiaryId:r.beneficiaryId,opaqueBeneficiaryId:h(100+i),entitlementId:h(200+i),explanationSalt:h(300+i)}))});
  const athlete=allocation.awards.find(a=>a.beneficiaryKind===0),club=allocation.awards.find(a=>a.beneficiaryKind===1);
  const request={plan:f.plan,deploymentHash,fundingHash,slot:0,allocation,entitlementId:athlete.entitlementId,recipient:recipient.address};
  await assert.rejects(readSponsorAthleteClaimV4(chain.publicClient,request),/sponsor_claim_unavailable/);
  await write('uploadAwards',[allocation.awards]);assert.equal(await read('uploadDigest'),allocation.uploadDigest);
  await write('stageAllocation',[allocation.snapshotDigest,allocation.uploadDigest,allocation.entitlementCount,now,now,publication.publicationEvidenceHash]);
  assert.equal(await read('allocationDigest'),allocation.allocationDigest);
  await write('activate',[allocation.allocationDigest,allocation.snapshotDigest]);
  await chain.testClient.mine({blocks:96,interval:1});
  let claimReads=0;
  const claimReader=new Proxy(chain.publicClient,{get(target,key){const fn=target[key];return typeof fn==='function'?async(...args)=>{claimReads++;return fn(...args);}:fn;}});
  let witness=await readSponsorAthleteClaimV4(claimReader,request);
  t.diagnostic(`synthetic single-entitlement observation: ${claimReads} reader calls`);
  assert.ok(claimReads<60,'one entitlement must not scan unrelated pots');
  await t.test('reader rejects changed commitment, recipient contract, club and reorg evidence',async()=>{
   await assert.rejects(readSponsorAthleteClaimV4(chain.publicClient,{...request,allocation:{...allocation,allocationDigest:h(999)}}));
   await assert.rejects(readSponsorAthleteClaimV4(chain.publicClient,{...request,recipient:child}),/reward_eoa_recipient_required/);
   await assert.rejects(readSponsorAthleteClaimV4(chain.publicClient,{...request,entitlementId:club.entitlementId}),/sponsor_athlete_award_required/);
   let count=0;
   await assert.rejects(readSponsorAthleteClaimV4({...chain.publicClient,getBlock:async args=>{const b=await chain.publicClient.getBlock(args);
    if(args.blockNumber===witness.finalizedBlock.number&&++count>=2)return {...b,hash:h(999)};return b;}},request));
  });
  await write('pause');await chain.testClient.mine({blocks:96,interval:1});
  await assert.rejects(readSponsorAthleteClaimV4(chain.publicClient,request),/sponsor_claim_unavailable/);
  await write('resume');await chain.testClient.mine({blocks:96,interval:1});
  witness=await readSponsorAthleteClaimV4(chain.publicClient,request);
  const claim={entitlementId:athlete.entitlementId,recipient:recipient.address,amount:witness.award.amount,pot:'league',nonce:witness.award.nonce,
   issuedAt:witness.finalizedBlock.timestamp,expiresAt:witness.finalizedBlock.timestamp+3600n,allocationDigest:witness.allocationDigest};
  const m=sponsorClaimMessagesV4(witness.context,claim),digests=sponsorClaimDigestsV4(witness.context,claim);
  const chainDigests=await read('claimDigests',[claim.entitlementId,claim.recipient,claim.nonce,claim.issuedAt,claim.expiresAt]);
  assert.deepEqual(chainDigests,[digests.authorization,digests.consent]);
  const proofs={operator:await operator.signTypedData(m.authorization),recipient:await recipient.signTypedData(m.consent)};
  await verifySponsorClaimProofV4(witness.context,claim,'recipient',operator.address,proofs.recipient);
  await verifySponsorClaimProofV4(witness.context,claim,'operator',operator.address,proofs.operator);
  const before=await chain.publicClient.getBalance({address:recipient.address});
  const tx=await chain.operatorClient.sendTransaction({to:child,data:encodeSponsorClaimV4(witness.context,claim,proofs),gas:1000000n});
  assert.equal((await chain.publicClient.waitForTransactionReceipt({hash:tx})).status,'success');
  assert.equal(await chain.publicClient.getBalance({address:recipient.address}),before+athlete.amount);
  await chain.testClient.mine({blocks:96,interval:1});
  await assert.rejects(readSponsorAthleteClaimV4(chain.publicClient,request),/sponsor_entitlement_unavailable/);
  const final=await observeSponsorProgramme(chain.publicClient,f.plan,deploymentHash,fundingHash);
  assert.equal(final.pots[0].paidWei,athlete.amount.toString());assert.equal(BigInt(final.pots[0].remainingWei),calculation.budgetWei-athlete.amount);
  assert.ok(final.pots.slice(1).every(p=>p.state===1&&p.paidWei==='0'&&p.remainingWei===p.amountWei));
 }finally{await chain.stop();}
});
