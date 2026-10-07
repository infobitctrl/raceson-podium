import {z} from 'zod';
import {sponsorLifecycleFactsV4,hostedCopyLifecycleRpc,reviewPublicationRpc,type RewardAccountIdentity,type RewardLedgerRpc,type SponsorUploadScopeV4} from '@raceson/db/rewards';
import {canonicalRewardJson as canonical} from '@raceson/rewards-chain';
import {observeSponsorLifecycleV4} from '@raceson/rewards-chain/sponsor-lifecycle-v4';
import {sponsorLifecycleInputV4} from './sponsor-lifecycle-v4-service.js';
import {advanceControllerTransaction} from './controller-transactions.js';
import type {SponsorCreationDeps} from './sponsor-creation-service.js';
import type {ReviewPublicationSigner} from './review-publication-privy.js';
const expectedDocumentHash=z.string().regex(/^[0-9a-f]{64}$/);
export const reviewPublicationCommand=z.union([
 z.object({expectedDocumentHash}).strict(),
 z.object({expectedDocumentHash,transactionId:z.string().uuid(),authorizationSignature:z.string().regex(/^[A-Za-z0-9+/]+={0,2}$/).min(80).max(200),requestExpiry:z.number().int().safe()}).strict(),
]);
type Deps={rpc:RewardLedgerRpc;reader:SponsorCreationDeps['reader'];resolveAccess:(operator:string,campaign:string)=>Promise<{status:'owned'|'transfer_required'|'connect_required';signer:ReviewPublicationSigner|null}>};
export async function reviewPublication(identity:RewardAccountIdentity,scope:SponsorUploadScopeV4,command:unknown|undefined,d:Deps){
 const read=()=>sponsorLifecycleFactsV4(identity,scope,undefined,hostedCopyLifecycleRpc(identity,d.rpc));
 const facts=await read();
 if(!facts.upload.current||!facts.publication?.current)throw Error('controller_source_not_ready');
 const binding=sponsorLifecycleInputV4(facts),source=canonical({upload:facts.upload,publication:facts.publication});
 const observed=await observeSponsorLifecycleV4(d.reader,binding);
 const fresh=await read();if(canonical({upload:fresh.upload,publication:fresh.publication})!==source)throw Error('controller_source_not_ready');
 const view=(job:null|{hash:string|null;confirmed:boolean;context:{kind:string;action?:string}}=null,authorization:null|{transactionId:string;request:ReturnType<ReviewPublicationSigner['request']>}=null)=>({schema:'podium-review-publication-v1',approvalId:scope.approvalId,slot:scope.slot,documentHash:facts.upload.documentHash,operator:binding.plan.operator,campaignAddress:binding.campaignAddress,state:observed.pot.state,claimsOpen:observed.pot.state===3,next:observed.next,ownership:access.status,pending:job?{hash:job.hash,confirmed:job.confirmed,action:job.context.action}:null,authorization});
 const access=await d.resolveAccess(binding.plan.operator,binding.campaignAddress),signer=access.signer;
 const assertActive=async()=>{const f=await read();if(canonical({upload:f.upload,publication:f.publication})!==source)throw Error('controller_source_not_ready');};
 const rpc=reviewPublicationRpc(identity,scope,binding.plan.operator,d.rpc),actor={subject:'service:review-publication',wallet:binding.plan.operator};
 // Read the journal first: a receipt may be waiting even when activation is already visible.
 const stored=await rpc('service_reward_controller_transaction',{p_subject:actor.subject,p_sender:actor.wallet,p_action:'read',p_id:null,p_context:null,p_transaction:null,p_signed:null,p_hash:null});
 if(stored.error)throw Error('controller_transaction_unavailable');
 const pending=z.object({id:z.string().uuid(),hash:z.string().nullable(),confirmed:z.boolean(),context:z.object({kind:z.literal('distribution'),action:z.enum(['upload','stage','activate'])})}).nullable().parse(stored.data);
 if(command===undefined)return view(pending); // GET never signs or broadcasts.
 const request=reviewPublicationCommand.parse(command);
 if(request.expectedDocumentHash!==facts.upload.documentHash)throw Error('controller_source_not_ready');
 if(!pending&&!observed.next)return view();
 // Receipt recovery uses persisted bytes; it never requests another signature.
 if(pending?.hash){const job=await advanceControllerTransaction({actor,reader:d.reader,rpc,assertActive},{action:'resume',id:pending.id});return view(job);}
 if(!signer||signer.address!==binding.plan.operator)throw Error('review_wallet_ownership_required');
 await signer.verifyReady();await assertActive();
 const job=await advanceControllerTransaction({actor,reader:d.reader,rpc,assertActive},{action:'prepare',kind:'distribution',setupId:scope.setupId,approvalId:scope.approvalId,expectedDocumentHash:request.expectedDocumentHash});
 if(!job)throw Error('controller_transaction_invalid');
 if(!('transactionId' in request))return view(job,{transactionId:job.id,request:signer.request(job.transaction,Date.now()+90_000)});
 if(request.transactionId!==job.id||request.requestExpiry<=Date.now()||request.requestExpiry>Date.now()+120_000)throw Error('review_publication_authorization_required');
 const bytes=await signer.sign(job.transaction,request.authorizationSignature,request.requestExpiry);await assertActive();
 return view(await advanceControllerTransaction({actor,reader:d.reader,rpc,assertActive},{action:'submit',id:job.id,signedTransaction:bytes}));
}
