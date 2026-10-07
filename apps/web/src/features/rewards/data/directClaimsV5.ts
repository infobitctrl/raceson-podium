import {z} from 'zod';
import {apiRequest} from '@/lib/api';
import {encodeRegisterAndClaimV5,encodeSponsorDirectClaimV5,verifyWalletBindingProofV1} from '@raceson/rewards-chain/sponsor-direct-claims-v5';
import type {RewardWalletProvider} from './browserWallet';
import type {Address,Hex} from 'viem';
const hash=z.string().regex(/^0x[0-9a-f]{64}$/),address=z.string().regex(/^0x[0-9a-f]{40}$/),uint=z.string().regex(/^(0|[1-9][0-9]*)$/),uuid=z.string().uuid();
export const directBindingSchemaV1=z.object({beneficiaryId:hash,recipient:address,beneficiaryKind:z.literal(0),nonce:uint,issuedAt:uint,expiresAt:uint}).strict();
const receipt=z.object({transactionHash:hash,amountWei:uint,recipient:address,blockNumber:uint,blockHash:hash}).strict();
export const directClaimSchemaV5=z.object({schema:z.literal('podium-direct-claim-v5'),approvalId:uuid,entitlementId:hash,chainId:z.literal(10143),amountWei:uint,
 campaignAddress:address,registryAddress:address,identityIssuer:address,beneficiaryId:hash,status:z.enum(['paid','not_open','paused','expired','claimable']),recipient:address.nullable(),deadline:uint,
 transaction:z.object({chainId:z.literal(10143),from:address,to:address,data:z.string().regex(/^0x[0-9a-f]+$/),value:z.literal('0'),binding:directBindingSchemaV1.nullable(),identityProof:z.string().regex(/^0x[0-9a-f]{130}$/).nullable()}).strict().nullable(),receipt:receipt.nullable(),rehearsalPolicy:z.literal('podium-demo-alias-rehearsal-v1')}).strict();
export type DirectClaimV5=z.infer<typeof directClaimSchemaV5>;
export async function readDirectClaimV5(award:{approvalId:string;entitlementId:string},command?:{action:'prepare';proofId:string}|{action:'receipt';hash:string}){
 const path=`/v1/athlete/rewards/direct-claims/${uuid.parse(award.approvalId)}/${hash.parse(award.entitlementId)}`;
 const view=directClaimSchemaV5.parse(await apiRequest({path,cache:'no-store',...(command?{method:'POST' as const,body:command}:{})}));
 if(view.approvalId!==award.approvalId||view.entitlementId!==award.entitlementId||BigInt(view.amountWei)<=0n||view.receipt&&view.receipt.amountWei!==view.amountWei)throw Error('invalid_direct_claim');
 return view;
}
export async function validateDirectClaimTransactionV5(view:DirectClaimV5){
 const v=directClaimSchemaV5.parse(view),tx=v.transaction;
 if(v.status!=='claimable'||!tx||tx.chainId!==v.chainId)throw Error('invalid_direct_claim_transaction');
 if(tx.binding){
  const b={...tx.binding,beneficiaryKind:0 as const,beneficiaryId:tx.binding.beneficiaryId as Hex,recipient:tx.binding.recipient as Address,nonce:BigInt(tx.binding.nonce),issuedAt:BigInt(tx.binding.issuedAt),expiresAt:BigInt(tx.binding.expiresAt)};
  const context={chainId:10143 as const,registry:v.registryAddress as Address};
  if(!tx.identityProof||tx.to!==v.registryAddress||b.recipient!==tx.from||b.beneficiaryId!==v.beneficiaryId||b.expiresAt<=BigInt(Math.floor(Date.now()/1000)))throw Error('invalid_direct_claim_transaction');
  await verifyWalletBindingProofV1(context,b,v.identityIssuer as Address,tx.identityProof as Hex);
  if(tx.data!==encodeRegisterAndClaimV5(context,b,tx.identityProof as Hex,v.campaignAddress as Address,v.entitlementId as Hex))throw Error('invalid_direct_claim_transaction');
 }else if(tx.identityProof!==null||tx.to!==v.campaignAddress||tx.from!==v.recipient||tx.data!==encodeSponsorDirectClaimV5(v.entitlementId as Hex))throw Error('invalid_direct_claim_transaction');
 return tx;
}
/** Exact recipient transaction capability. Never creates a wallet or requests a
 * reviewer signature, and never accepts arbitrary browser-authored calldata. */
export async function sendDirectClaimV5(provider:RewardWalletProvider,view:DirectClaimV5,current:()=>boolean){
 const tx=await validateDirectClaimTransactionV5(view);
 let changed=false;const change=()=>{changed=true;},events=['accountsChanged','chainChanged','disconnect'];
 const check=async()=>{if(changed||!current())throw Error('wallet_changed');
  const accounts=await provider.request({method:'eth_accounts'}),chain=await provider.request({method:'eth_chainId'});
  if(changed||!current()||!Array.isArray(accounts)||typeof accounts[0]!=='string'||accounts[0].toLowerCase()!==tx.from
   ||typeof chain!=='string'||!/^0x[0-9a-f]+$/i.test(chain)||BigInt(chain)!==10143n)throw Error('wallet_changed');};
 const quantity=(value:unknown)=>{if(typeof value==='bigint')return value;if(typeof value!=='string'||!/^0x[0-9a-f]+$/i.test(value))throw Error('invalid_wallet_response');return BigInt(value);};
 events.forEach(event=>provider.on(event,change));
 try{
  await check();const transaction={from:tx.from,to:tx.to,data:tx.data,value:'0x0',chainId:'0x279f'};
  const gas=(quantity(await provider.request({method:'eth_estimateGas',params:[transaction]}))*12n+9n)/10n;
  const price=quantity(await provider.request({method:'eth_gasPrice'}));
  if(gas<=0n||gas>2_000_000n||price<=0n||gas*price>500_000_000_000_000_000n)throw Error('claim_gas_limit');
  await check();const result=await provider.request({method:'eth_sendTransaction',params:[{...transaction,gas:`0x${gas.toString(16)}`,gasPrice:`0x${price.toString(16)}`}]});
  if(typeof result!=='string'||!/^0x[0-9a-f]{64}$/i.test(result))throw Error('transaction_unknown');
  return result.toLowerCase();
 }finally{events.forEach(event=>provider.removeListener(event,change));}
}
