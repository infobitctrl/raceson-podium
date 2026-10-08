import {notifyReviewStatus} from './reviewStatus';
import {z} from 'zod';
import {apiRequest} from '@/lib/api';
const uuid=z.string().uuid(),hash=z.string().regex(/^[0-9a-f]{64}$/),wei=z.string().regex(/^(0|[1-9][0-9]{0,24})$/);
const ack=z.object({id:uuid,previousApprovalId:uuid.nullable(),contextHash:hash,documentHash:hash,decision:z.enum(['approved','held']),createdAt:z.string().datetime(),current:z.boolean()}).strict().nullable();
const common={version:z.literal('podium-copy-award-review-v1'),setupId:uuid,slot:z.number().int().min(0).max(5),approval:ack,recorded:ack,stageReady:z.literal(false),payableWei:z.literal('0')};
const view=z.discriminatedUnion('historicalAcknowledgement',[
 z.object({...common,historicalAcknowledgement:z.literal(true)}).strict(),
 z.object({...common,historicalAcknowledgement:z.literal(false),contextHash:hash,documentHash:hash,budgetWei:wei,proposedWei:wei,retainedWei:wei,reasons:z.array(z.string().min(1)).max(64),
  recipientCounts:z.object({athletes:z.number().int().min(0).max(10000),clubs:z.number().int().min(0).max(10000)}).strict()}).strict(),
]);
export type HostedAwardDecision={requestId:string;expectedApprovalId:string|null;contextHash:string;documentHash:string;decision:'approved'|'held'};
export async function readHostedAwardReview(setupId:string,slot:number,change?:HostedAwardDecision){
 const result=view.parse(await apiRequest({path:`/v1/rewards/demo-copy/reviews/${uuid.parse(setupId)}/allocations/${z.number().int().min(0).max(5).parse(slot)}`,
  method:change?'POST':'GET',...(change?{body:change}:{}),cache:'no-store'}));
 if(result.setupId!==setupId||result.slot!==slot||'contextHash' in result&&BigInt(result.budgetWei)!==BigInt(result.proposedWei)+BigInt(result.retainedWei))throw Error('invalid_award_review');
 if(change&&(result.recorded?.id!==change.requestId||result.recorded.documentHash!==change.documentHash||result.recorded.contextHash!==change.contextHash
  ||result.recorded.decision!==change.decision||result.recorded.previousApprovalId!==change.expectedApprovalId))throw Error('invalid_award_review');
 if(change)notifyReviewStatus(setupId);
 return result;
}
