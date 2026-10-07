import {z} from 'zod';
import {apiRequest} from '@/lib/api';
import type {HostedUploadScope} from './hostedAwardUpload';
const did=z.string().regex(/^did:privy:[a-zA-Z0-9_-]{1,100}$/),uuid=z.string().uuid(),address=z.string().regex(/^0x[0-9a-f]{40}$/);
export const reviewWalletHandoverSchema=z.object({requestId:uuid.nullable(),acknowledgementRequired:z.boolean(),schema:z.literal('podium-review-wallet-handover-v1'),status:z.enum(['owned','transfer_required','connect_required']),operator:address,walletId:z.string().regex(/^[a-zA-Z0-9_-]{1,100}$/),ownerId:z.string(),ownerSubject:did,reviewerSubject:did.nullable(),reviewerUserId:uuid,appId:z.string(),fingerprint:z.string().regex(/^[0-9a-f]{64}$/),body:z.object({owner:z.object({user_id:did}).strict(),additional_signers:z.array(z.never()).length(0)}).strict().nullable()}).strict();
export type ReviewWalletHandover=z.infer<typeof reviewWalletHandoverSchema>;
export async function readReviewWalletHandover(scope:HostedUploadScope,body?:{action:'transfer';requestId:string;expectedFingerprint:string;ownerToken:string;authorizationSignature:string;requestExpiry:number}|{action:'acknowledge';requestId:string;expectedFingerprint:string}){
 const v=reviewWalletHandoverSchema.parse(await apiRequest({path:`/v1/rewards/demo-copy/reviews/${uuid.parse(scope.id)}/allocations/${scope.slot}/${uuid.parse(scope.approvalId)}/wallet-ownership`,method:body?'POST':'GET',...(body?{body}:{}),cache:'no-store'}));
 if(v.body?.owner.user_id!==v.reviewerSubject&&v.body!==null||v.status==='owned'&&v.ownerSubject!==v.reviewerSubject)throw Error('invalid_review_wallet_handover');return v;
}
