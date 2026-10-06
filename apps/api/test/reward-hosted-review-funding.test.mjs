import test from 'node:test';
import assert from 'node:assert/strict';
import {hostedReviewFunding} from '../dist/features/rewards/hosted-copy-review-funding.js';
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
