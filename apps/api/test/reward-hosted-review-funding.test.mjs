import test from 'node:test';
import assert from 'node:assert/strict';
import {hostedReviewFunding,reviewClaimState} from '../dist/features/rewards/hosted-copy-review-funding.js';
import {fixture,plan,deploymentHash,fundingHash} from '../../../packages/rewards-chain/test/sponsor-settlement-fixture.mjs';
test('review funding uses verified runtime and finalized receipts, scoped to positive caps',async()=>{
 const record={plan,deploymentHash,fundingHash},funded=fixture({funded:true});
 const result=await hostedReviewFunding(record,funded.reader);
 assert.equal(result.state,'funded');assert.equal(result.fundedWei,'100');assert.equal(result.remainingWei,'100');assert.equal(result.paidWei,'0');assert.deepEqual(result.pools.map(p=>p.slot),[0]);
 funded.deposited.status='reverted';const failed=await hostedReviewFunding(record,funded.reader);assert.equal(failed.state,'unverified');assert.equal(failed.fundedWei,null);assert.deepEqual(failed.pools,[]);
});
test('awaiting creation, awaiting funding, and unverifiable hashes never claim a deposit',async()=>{
 assert.equal((await hostedReviewFunding(null)).state,'awaiting_contract');
 const observed=await hostedReviewFunding({plan,deploymentHash,fundingHash:null},fixture().reader);assert.equal(observed.state,'awaiting_funding');assert.equal(observed.fundedWei,'0');
 const missing=await hostedReviewFunding({plan,deploymentHash,fundingHash});assert.equal(missing.state,'unverified');assert.equal(missing.fundedWei,null);
});

test('claims status requires active, unpaused, unexpired positive-budget pools',()=>{
 const pot={amountWei:'100',state:1,paused:false,claimDeadline:'0'},observation={cancelled:false,blockTimestamp:'100',pots:[pot]};
 assert.equal(reviewClaimState(observation),'not_open');
 pot.state=3;pot.claimDeadline='101';assert.equal(reviewClaimState(observation),'open');
 pot.paused=true;assert.equal(reviewClaimState(observation),'paused');
 pot.paused=false;pot.claimDeadline='100';assert.equal(reviewClaimState(observation),'closed');
 pot.claimDeadline='101';observation.pots.push({...pot,state:1});assert.equal(reviewClaimState(observation),'partially_open');
 observation.pots[1].amountWei='0';assert.equal(reviewClaimState(observation),'open');
 observation.cancelled=true;assert.equal(reviewClaimState(observation),'closed');
});
