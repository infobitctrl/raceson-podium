import {z} from 'zod';
import {apiRequest} from '@/lib/api';
import {rewardClubSafeCreationPlan,rewardClubSafeTestnetDependencies} from '@raceson/rewards-chain';
import {canonicalRewardJson} from '@raceson/rewards-chain';
import type {Address,Hex} from 'viem';
import type {RewardWalletProvider} from './browserWallet';
const uuid=z.string().uuid(),address=z.string().regex(/^0x[0-9a-f]{40}$/).refine(v=>BigInt(v)>1n),hex=z.string().regex(/^0x[0-9a-f]{64}$/),uint=z.string().regex(/^(0|[1-9][0-9]*)$/);
const receipt=z.object({transactionHash:hex,safeAddress:address,blockNumber:uint.refine(v=>BigInt(v)<2n**64n),blockHash:hex,initializerHash:hex}).strict();
export const clubCreationRecord=z.object({requestId:uuid,clubId:uuid,chainId:z.literal(10143),sender:address,owners:z.array(address).length(3),saltNonce:uint,createdAt:z.string().datetime({offset:true}),current:z.boolean(),transactions:z.array(z.object({transactionHash:hex}).strict()).max(16),verified:receipt.nullable()}).strict().superRefine((v,c)=>{
 if(new Set(v.owners).size!==3||v.owners.some((o,i)=>i>0&&o<=v.owners[i-1])||BigInt(v.saltNonce)<=0n||BigInt(v.saltNonce)>=2n**128n||new Set(v.transactions.map(t=>t.transactionHash)).size!==v.transactions.length
  ||v.verified&&!v.transactions.some(t=>t.transactionHash===v.verified!.transactionHash))c.addIssue({code:'custom',message:'invalid_creation'});
});
export type ClubCreationRecord=z.infer<typeof clubCreationRecord>;
export type ClubCreationPrepared={plan:ReturnType<typeof rewardClubSafeCreationPlan>;gas:string;gasPrice:string;maximumFee:string;balance:string};
export type ClubCreationView={record:ClubCreationRecord;prepared:ClubCreationPrepared|null};
export function decodeClubCreationView(value:unknown,requestId:string):ClubCreationView{
 const v=z.object({schema:z.literal('podium-club-safe-creation-v1'),record:clubCreationRecord,prepared:z.unknown().nullable()}).strict().parse(value);
 if(v.record.requestId!==requestId)throw Error('invalid_creation');
 if(v.prepared===null)return{record:v.record,prepared:null};
 const q=z.object({plan:z.object({proxyCreation:z.string().regex(/^0x[0-9a-f]+$/)}).passthrough(),observedAt:z.object({number:uint,hash:hex,timestamp:uint}).strict(),gas:uint,gasPrice:uint,maximumFee:uint,balance:uint}).strict().parse(v.prepared);
 const plan=rewardClubSafeCreationPlan({environment:'monad-testnet',chainId:10143,sender:v.record.sender as Address,owners:v.record.owners as Address[],saltNonce:BigInt(v.record.saltNonce),dependencies:rewardClubSafeTestnetDependencies},q.plan.proxyCreation as Hex);
 const serial=JSON.parse(JSON.stringify(plan,(_,x)=>typeof x==='bigint'?x.toString():x));
 const gas=BigInt(q.gas),price=BigInt(q.gasPrice),fee=BigInt(q.maximumFee);
 if(!v.record.current||v.record.verified||v.record.transactions.length||canonicalRewardJson(serial)!==canonicalRewardJson(q.plan)||gas<=0n||gas>30_000_000n||price<=0n||fee!==gas*price||fee>500_000_000_000_000_000n||BigInt(q.balance)<fee)throw Error('invalid_creation');
 return{record:v.record,prepared:{plan,gas:q.gas,gasPrice:q.gasPrice,maximumFee:q.maximumFee,balance:q.balance}};
}
const base='/v1/rewards/demo-copy/club-creations';
export async function clubSafeCreation(requestId:string,body?:unknown){uuid.parse(requestId);return decodeClubCreationView(await apiRequest<unknown>({path:`${base}/${requestId}`,cache:'no-store',...(body?{method:'POST' as const,body}:{})}),requestId);}
export async function clubSafeCreationHistory(after:string|null=null){if(after!==null)uuid.parse(after);
 const p=z.object({items:z.array(clubCreationRecord).max(25),nextCursor:uuid.nullable()}).strict().parse(await apiRequest<unknown>({path:base+(after?`?after=${encodeURIComponent(after)}`:''),cache:'no-store'}));
 let previous=after;for(const r of p.items){if(previous!==null&&r.requestId<=previous)throw Error('invalid_creation');previous=r.requestId;}
 if(p.nextCursor!==null&&(p.items.length!==25||p.nextCursor!==previous))throw Error('invalid_creation');return p;
}
/** Explicit creation confirmation only. The plan is rebuilt from the exact
 * owner intent; provider events/session changes retire it. Never auto-retry. */
export async function sendClubSafeCreation(provider:RewardWalletProvider,view:ClubCreationView,isCurrent:()=>boolean){
 const r=clubCreationRecord.parse(structuredClone(view.record)),q=view.prepared?structuredClone(view.prepared):null;
 if(!q||!r.current||r.transactions.length||r.verified)throw Error('creation_unavailable');
 const fixed=rewardClubSafeCreationPlan({environment:'monad-testnet',chainId:10143,sender:r.sender as Address,owners:r.owners as Address[],saltNonce:BigInt(r.saltNonce),dependencies:rewardClubSafeTestnetDependencies},q.plan.proxyCreation);
 const serial=(v:unknown)=>canonicalRewardJson(JSON.parse(JSON.stringify(v,(_,x)=>typeof x==='bigint'?x.toString():x)));
 const gas=BigInt(uint.parse(q.gas)),price=BigInt(uint.parse(q.gasPrice)),fee=BigInt(uint.parse(q.maximumFee));
 if(serial(fixed)!==serial(q.plan)||gas<=0n||gas>30_000_000n||price<=0n||fee!==gas*price||fee>500_000_000_000_000_000n)throw Error('invalid_creation');
 let changed=false;const change=()=>{changed=true;},events=['accountsChanged','chainChanged','disconnect'];events.forEach(e=>provider.on(e,change));
 const active=()=>{if(changed||!isCurrent())throw Error('wallet_changed');};
 async function check(){active();const [accounts,chain]=await Promise.all([provider.request({method:'eth_accounts'}),provider.request({method:'eth_chainId'})]);active();
  if(!Array.isArray(accounts)||typeof accounts[0]!=='string'||accounts[0].toLowerCase()!==r.sender||typeof chain!=='string'||!/^0x[0-9a-f]+$/i.test(chain)||BigInt(chain)!==10143n)throw Error('wallet_changed');}
 try{await check();const t=fixed.transaction,tx={from:t.from,to:t.to,data:t.data,value:'0x0',chainId:'0x279f',gas:`0x${gas.toString(16)}`,gasPrice:`0x${price.toString(16)}`};
  const balance=await provider.request({method:'eth_getBalance',params:[r.sender,'pending']});active();if(typeof balance!=='string'||!/^0x[0-9a-f]+$/i.test(balance)||BigInt(balance)<fee)throw Error('creation_gas_required');
  await check();const result=await provider.request({method:'eth_sendTransaction',params:[tx]});active();if(typeof result!=='string'||!/^0x[0-9a-f]{64}$/i.test(result))throw Error('creation_submission_unknown');return result.toLowerCase();
 }finally{events.forEach(e=>provider.removeListener(e,change));}
}
