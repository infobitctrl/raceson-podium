import {z} from 'zod';
import {decodeCampaignBranding} from '@raceson/domain/rewards/campaign-branding';
import {decodeRewardSponsorSelection} from '@raceson/domain/rewards/distribution-setup';
export const reviewBranding=z.unknown().transform(value=>decodeCampaignBranding([value])[0]);
export const reviewSelection=z.unknown().transform(value=>value==null?null:decodeRewardSponsorSelection(value));
import {apiRequest} from '@/lib/api';
const item=z.object({id:z.string().uuid(),name:z.string().min(1).max(120),revision:z.number().int().positive(),launchId:z.string().uuid(),
 branding:reviewBranding.optional(),selection:reviewSelection.optional(),budgetWei:z.string().regex(/^(0|[1-9][0-9]{0,24})$/),pools:z.array(z.object({slot:z.number().int().min(0).max(5),name:z.string().min(1),budgetWei:z.string().regex(/^[1-9][0-9]{0,24}$/)}).strict()).min(1).max(6),executionState:z.enum(['awaiting_contract','awaiting_funding','needs_chain_check'])}).strict();
const queue=z.object({version:z.literal('podium-copy-review-queue-v1'),items:z.array(item).max(200),wallet:z.object({address:z.string().regex(/^0x[0-9a-f]{40}$/),owned:z.literal(true),balanceWei:z.string().regex(/^(0|[1-9][0-9]*)$/)}).nullable().optional()}).strict();
export async function readHostedReviewSources(){
 const data=queue.parse(await apiRequest({path:'/v1/rewards/demo-copy/reviews',cache:'no-store'}));
 if(new Set(data.items.map(i=>i.id)).size!==data.items.length)throw Error('invalid_review_queue');
 for(const i of data.items)if(i.branding&&i.branding.id!==i.id||new Set(i.pools.map(p=>p.slot)).size!==i.pools.length||i.pools.reduce((sum,p)=>sum+BigInt(p.budgetWei),0n)!==BigInt(i.budgetWei))throw Error('invalid_review_queue');
 return data;
}
