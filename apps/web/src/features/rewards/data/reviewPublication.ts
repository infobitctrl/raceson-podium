import {notifyReviewStatus} from './reviewStatus';
import {z} from 'zod';
import {apiRequest} from '@/lib/api';
import type {HostedUploadScope} from './hostedAwardUpload';
import {decodeFunctionData,type Hex} from 'viem';
import {sponsorLifecycleAbi} from '@raceson/rewards-chain/sponsor-lifecycle-v4';
const uuid=z.string().uuid(),hash=z.string().regex(/^[0-9a-f]{64}$/),address=z.string().regex(/^0x[0-9a-f]{40}$/);
const quantity=z.string().regex(/^0x[0-9a-f]+$/);
const request=z.object({version:z.literal(1),method:z.literal('POST'),url:z.string().regex(/^https:\/\/api\.privy\.io\/v1\/wallets\/[a-z0-9]+\/rpc$/),
 body:z.object({method:z.literal('eth_signTransaction'),chain_type:z.literal('ethereum'),params:z.object({transaction:z.object({type:z.literal(0),chain_id:z.literal(10143),to:address,data:quantity,value:z.literal('0x0'),nonce:z.number().int().nonnegative().safe(),gas_limit:quantity,gas_price:quantity}).strict()}).strict()}).strict(),
 headers:z.object({'privy-app-id':z.string().regex(/^[a-z0-9]{25}$/),'privy-request-expiry':z.string().regex(/^\d+$/)}).strict()}).strict();
const view=z.object({schema:z.literal('podium-review-publication-v1'),approvalId:uuid,slot:z.number().int().min(0).max(5),documentHash:hash,operator:address,campaignAddress:address,state:z.number().int().min(0).max(5),claimsOpen:z.boolean(),next:z.enum(['upload','stage','activate']).nullable(),ownership:z.enum(['owned','transfer_required','connect_required']),pending:z.object({hash:z.string().regex(/^0x[0-9a-f]{64}$/).nullable(),confirmed:z.boolean(),action:z.enum(['upload','stage','activate'])}).strict().nullable(),authorization:z.object({transactionId:uuid,request}).strict().nullable().default(null)}).strict();
export type ReviewPublication= z.infer<typeof view>;
export type ReviewPublicationAuthorizationRequest=z.infer<typeof request>;
export type ReviewPublicationAuthorization={transactionId:string;authorizationSignature:string;requestExpiry:number};
export function checkedPublicationAuthorization(value:ReviewPublication,appId:string){
 const v=view.parse(value),r=v.authorization?.request,t=r?.body.params.transaction,expiry=Number(r?.headers['privy-request-expiry']);
 if(!r||!t||v.ownership!=='owned'||!v.pending||v.pending.hash||v.pending.confirmed||r.headers['privy-app-id']!==appId||t.to!==v.campaignAddress
  ||expiry<=Date.now()||expiry>Date.now()+120_000||BigInt(t.gas_limit)<=0n||BigInt(t.gas_limit)>30_000_000n||BigInt(t.gas_price)<=0n||BigInt(t.gas_limit)*BigInt(t.gas_price)>500_000_000_000_000_000n)throw Error('review_publication_authorization_required');
 const decoded=decodeFunctionData({abi:sponsorLifecycleAbi,data:t.data as Hex});
 if(decoded.functionName!==({upload:'uploadAwards',stage:'stageAllocation',activate:'activate'} as const)[v.pending.action])throw Error('review_publication_authorization_required');
 return {version:1 as const,method:'POST' as const,url:r.url!,body:r.body!,headers:{'privy-app-id':r.headers['privy-app-id']!,'privy-request-expiry':r.headers['privy-request-expiry']!}};
}
export async function readReviewPublication(scope:HostedUploadScope,documentHash:string,advance=false,authorization?:ReviewPublicationAuthorization){
 const value=view.parse(await apiRequest({path:`/v1/rewards/demo-copy/reviews/${uuid.parse(scope.id)}/allocations/${scope.slot}/${uuid.parse(scope.approvalId)}/publish`,method:advance?'POST':'GET',...(advance?{body:{expectedDocumentHash:hash.parse(documentHash),...authorization}}:{}),cache:'no-store'}));
 if(value.approvalId!==scope.approvalId||value.slot!==scope.slot||value.documentHash!==documentHash||value.claimsOpen!==(value.state===3))throw Error('invalid_review_publication');
 if(advance&&(value.pending?.confirmed||value.claimsOpen&&!value.pending))notifyReviewStatus(scope.id);
 return value;
}
