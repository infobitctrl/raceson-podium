import type {SponsorExecutionRecord} from '@raceson/domain/rewards/sponsor-execution';
import type {RewardAccountIdentity,RewardLedgerRpc} from '@raceson/db/rewards';
import type {SponsorChainReader} from '@raceson/rewards-chain/sponsor-v4';
import {hostedReviewFunding} from './hosted-copy-review-funding.js';
import {hostedCopyAwardReview} from './hosted-copy-approval-service.js';
import {z} from 'zod';
const reviewSchema=z.object({approval:z.object({current:z.boolean(),decision:z.enum(['approved','held'])}).nullable()});

/** Read-only status; approval, deposit receipts and claim activation remain separate facts. */
export async function hostedReviewStatus(actor:RewardAccountIdentity,record:{execution:SponsorExecutionRecord|null;summary:{id:string;revision:number;launchId:string;pools:{slot:number}[]}},rpc:RewardLedgerRpc,reader?:SponsorChainReader){
 const funding=await hostedReviewFunding(record.execution,reader);
 const decisions=[];
 for(const pool of record.summary.pools){
  const review=reviewSchema.parse(await hostedCopyAwardReview(actor,record.summary.id,pool.slot,rpc));
  decisions.push(review.approval?.current?review.approval.decision:'pending');
 }
 const reviewState=decisions.every(d=>d==='approved')?'approved':decisions.some(d=>d==='held')?'held':decisions.some(d=>d==='approved')?'partially_approved':'pending';
 return {setupId:record.summary.id,revision:record.summary.revision,launchId:record.summary.launchId,fundingState:funding.state,claimState:funding.claimState,reviewState,blockNumber:funding.blockNumber};
}
