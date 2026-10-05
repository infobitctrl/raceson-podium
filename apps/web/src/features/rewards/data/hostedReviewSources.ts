import {z} from 'zod';
import {apiRequest} from '@/lib/api';
const item=z.object({id:z.string().uuid(),name:z.string().min(1).max(120),revision:z.number().int().positive(),launchId:z.string().uuid(),
 budgetWei:z.string().regex(/^(0|[1-9][0-9]{0,24})$/),executionState:z.enum(['awaiting_contract','awaiting_funding','needs_chain_check'])}).strict();
const queue=z.object({version:z.literal('podium-copy-review-queue-v1'),items:z.array(item).max(200)}).strict();
export async function readHostedReviewSources(){
 const data=queue.parse(await apiRequest({path:'/v1/rewards/demo-copy/reviews',cache:'no-store'}));
 if(new Set(data.items.map(i=>i.id)).size!==data.items.length)throw Error('invalid_review_queue');
 return data;
}
