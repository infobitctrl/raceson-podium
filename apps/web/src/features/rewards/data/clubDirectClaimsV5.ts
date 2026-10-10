import {clubOwnersHashV1,clubClaimMessageV6,encodeClubClaimV6,encodeWalletRegistrationV2,verifyWalletBindingProofV2,type ClubClaimV6} from '@raceson/rewards-chain/club-signatures-v6';
import {z} from 'zod';
import {apiRequest} from '@/lib/api';
import {encodeFunctionData,recoverTypedDataAddress,type Address,type Hex} from 'viem';
import {directSafeAbiV5,directSafeMessageV5,verifyDirectSafeSignaturesV5,encodeDirectSafeCallV5,type DirectSafeCallV5} from '@raceson/rewards-chain/sponsor-club-direct-v5';
import {encodeRegisterAndClaimV5,encodeSponsorDirectClaimV5,verifyWalletBindingProofV1} from '@raceson/rewards-chain/sponsor-direct-claims-v5';
import {directClaimSchemaV5,directBindingSchemaV1,type SponsoredClaimSenderV5} from './directClaimsV5';
import type {RewardWalletProvider} from './browserWallet';
const address=z.string().regex(/^0x[0-9a-f]{40}$/),hash=z.string().regex(/^0x[0-9a-f]{64}$/),uuid=z.string().uuid();
const uint=z.string().regex(/^(0|[1-9][0-9]*)$/);
const clubClaim=z.object({entitlementId:hash,recipient:address,amount:uint,pot:z.union([z.literal(0),z.literal(1)]),nonce:uint,issuedAt:uint,expiresAt:uint,allocationDigest:hash,clubOwnersHash:hash,registrationNonce:uint}).strict();
const transaction=directClaimSchemaV5.shape.transaction.unwrap().extend({binding:directBindingSchemaV1.extend({beneficiaryKind:z.literal(1)}).nullable()}).strict();
export const clubDirectClaimSchemaV5=directClaimSchemaV5.extend({schema:z.literal('podium-club-direct-claim-v5'),creationId:uuid,clubId:uuid,
 phase:z.enum(['register','claim']).optional(),clubClaim:clubClaim.nullable().optional(),
 chainState:z.object({registrationNonce:uint,authorizationNonce:uint,clubOwnersHash:hash,allocationDigest:hash}).strict().optional(),
 registrationReceipt:z.object({transactionHash:hash,blockNumber:uint,blockHash:hash}).strict().nullable().optional(),
 ownerApproval:z.object({signerAddress:address.nullable(),requestId:uuid.nullable(),expiresAt:z.string().datetime({offset:true}).nullable(),signatures:z.array(z.object({address,signature:z.string().regex(/^0x[0-9a-fA-F]{130}$/)}).strict()).max(3),submissions:z.array(hash).max(8)}).strict().optional(),
 safeAddress:address,owners:z.array(address).length(3),safeNonce:z.string().regex(/^(0|[1-9][0-9]*)$/),transaction:transaction.nullable()}).strict();
export type ClubDirectClaimV5=z.infer<typeof clubDirectClaimSchemaV5>;
export async function readClubDirectClaimV5(award:{approvalId:string;entitlementId:string},creationId:string,command?:{action:'prepare';proofId:string}|{action:'receipt'|'registrationReceipt';hash:string}|{action:'sign';requestId:string;signature:Hex}|{action:'submitted';requestId:string;hash:string}){
 const path=`/v1/club/rewards/direct-claims/${uuid.parse(award.approvalId)}/${hash.parse(award.entitlementId)}/${uuid.parse(creationId)}`;
 const v=clubDirectClaimSchemaV5.parse(await apiRequest({path,cache:'no-store',...(command?{method:'POST' as const,body:command}:{})}));
 if(v.approvalId!==award.approvalId||v.entitlementId!==award.entitlementId||v.creationId!==creationId||BigInt(v.amountWei)<=0n
  ||new Set(v.owners).size!==3||v.receipt&&(v.receipt.amountWei!==v.amountWei||v.receipt.recipient!==v.safeAddress))throw Error('invalid_direct_club_claim');
 validateClubVersion(v);return v;
}
export async function directClubCallV5(view:ClubDirectClaimV5):Promise<DirectSafeCallV5>{
 const v=clubDirectClaimSchemaV5.parse(view),tx=v.transaction;validateClubVersion(v);
 if(v.protocolVersion===6&&v.phase!=='register')throw Error('invalid_direct_club_claim');
 if(v.status!=='claimable'||!tx||tx.from!==v.safeAddress||new Set(v.owners).size!==3||v.owners.includes(v.safeAddress))throw Error('invalid_direct_club_claim');
 if(tx.binding){
  const b={...tx.binding,beneficiaryKind:1 as const,beneficiaryId:tx.binding.beneficiaryId as Hex,recipient:tx.binding.recipient as Address,nonce:BigInt(tx.binding.nonce),issuedAt:BigInt(tx.binding.issuedAt),expiresAt:BigInt(tx.binding.expiresAt)};
  const context={chainId:10143 as const,registry:v.registryAddress as Address};
  if(!tx.identityProof||tx.to!==v.registryAddress||b.recipient!==v.safeAddress||b.beneficiaryId!==v.beneficiaryId||b.expiresAt<=BigInt(Math.floor(Date.now()/1000)))throw Error('invalid_direct_club_claim');
  if(v.protocolVersion===6){if(b.clubOwnersHash!==clubOwnersHashV1(v.owners as Address[]))throw Error('invalid_direct_club_claim');await verifyWalletBindingProofV2(context,{...b,clubOwnersHash:b.clubOwnersHash as Hex},v.identityIssuer as Address,tx.identityProof as Hex);}
  else {if(b.clubOwnersHash!==undefined)throw Error('invalid_direct_club_claim');await verifyWalletBindingProofV1(context,b,v.identityIssuer as Address,tx.identityProof as Hex);}
  if(tx.data!==(v.protocolVersion===6?encodeWalletRegistrationV2(context,{...b,clubOwnersHash:b.clubOwnersHash as Hex},tx.identityProof as Hex):encodeRegisterAndClaimV5(context,b,tx.identityProof as Hex,v.campaignAddress as Address,v.entitlementId as Hex)))throw Error('invalid_direct_club_claim');
 }else if(v.protocolVersion===6||tx.identityProof!==null||tx.to!==v.campaignAddress||v.recipient!==v.safeAddress||tx.data!==encodeSponsorDirectClaimV5(v.entitlementId as Hex))throw Error('invalid_direct_club_claim');
 return {chainId:10143,safe:v.safeAddress as Address,to:tx.to as Address,data:tx.data as Hex,nonce:BigInt(v.safeNonce)};
}
async function walletCurrent(provider:RewardWalletProvider,address:string,current:()=>boolean){
 if(!current())throw Error('wallet_changed');
 const [a,c]=await Promise.all([provider.request({method:'eth_accounts'}),provider.request({method:'eth_chainId'})]);
 if(!current()||!Array.isArray(a)||typeof a[0]!=='string'||a[0].toLowerCase()!==address||typeof c!=='string'||!/^0x[0-9a-f]+$/i.test(c)||BigInt(c)!==10143n)throw Error('wallet_changed');
}
export async function signDirectClubClaimV5(provider:RewardWalletProvider,view:ClubDirectClaimV5,address:string,current:()=>boolean){
 const claim=view.protocolVersion===6&&view.phase==='claim'?validateClubClaimV6(view):null;
 const call=claim?null:await directClubCallV5(view);if(!view.owners.includes(address))throw Error('reward_club_owner_required');
 const typed=claim?clubClaimMessageV6({chainId:10143,campaign:view.campaignAddress as Address},claim):directSafeMessageV5(call!);await walletCurrent(provider,address,current);
 const signature=await provider.request({method:'eth_signTypedData_v4',params:[address,JSON.stringify({...typed,types:{...typed.types,EIP712Domain:[...(claim?[{name:'name',type:'string'},{name:'version',type:'string'}]:[]),{name:'chainId',type:'uint256'},{name:'verifyingContract',type:'address'}]}},(_,v)=>typeof v==='bigint'?v.toString():v)]});
 await walletCurrent(provider,address,current);
 if(typeof signature!=='string'||!/^0x[0-9a-f]{130}$/i.test(signature)||(await (typed.primaryType==='ReceiveClubReward'?recoverTypedDataAddress({...typed,signature:signature as Hex}):recoverTypedDataAddress({...typed,signature:signature as Hex}))).toLowerCase()!==address)throw Error('reward_club_consent_invalid');
 return signature as Hex;
}
export async function sendDirectClubClaimV5(provider:RewardWalletProvider,view:ClubDirectClaimV5,signatures:Hex[],address:string,current:()=>boolean,send?:SponsoredClaimSenderV5){
 const claim=view.protocolVersion===6&&view.phase==='claim'?validateClubClaimV6(view):null;
 const call=claim?null:await directClubCallV5(view);
 const data=claim?await encodeClubClaimV6({chainId:10143,campaign:view.campaignAddress as Address},claim,view.owners as Address[],signatures):encodeDirectSafeCallV5(call!,(await verifyDirectSafeSignaturesV5(call!,view.owners as Address[],signatures)).signature);
 if(!view.owners.includes(address))throw Error('reward_club_owner_required');
 let changed=false;const change=()=>{changed=true;},events=['accountsChanged','chainChanged','disconnect'];events.forEach(e=>provider.on(e,change));
 const check=()=>walletCurrent(provider,address,()=>!changed&&current());
 const quantity=(v:unknown)=>{if(typeof v==='bigint')return v;if(typeof v!=='string'||!/^0x[0-9a-f]+$/i.test(v))throw Error('invalid_wallet_response');return BigInt(v);};
 try{
  await check();const tx={from:address,to:claim?view.campaignAddress:call!.safe,data,value:'0x0',chainId:'0x279f'};
  if(call){const nonce=quantity(await provider.request({method:'eth_call',params:[{to:call.safe,data:encodeFunctionData({abi:directSafeAbiV5,functionName:'nonce'})},'pending']}));
  if(nonce!==call.nonce)throw Error('reward_sponsor_claim_conflict');}
  if(send){
   // Privy pays gas without drawing from the owner or the club's prize funds.
   // A rejected or ambiguous sponsored send must never fall back to owner gas.
   if(claim)validateClubClaimV6(view);else await directClubCallV5(view);
   await check();
   const {hash}=await send({from:address as Address,to:tx.to as Address,data,value:0n,chainId:10143},
    {address:address as Address,sponsor:true,uiOptions:{showWalletUIs:true}});
   if(typeof hash!=='string'||!/^0x[0-9a-f]{64}$/i.test(hash))throw Error('transaction_unknown');return hash.toLowerCase();
  }
  const initialBalance=quantity(await provider.request({method:'eth_getBalance',params:[address,'pending']}));
  await check();if(initialBalance===0n)throw Error('claim_insufficient_balance');
  const gas=(quantity(await provider.request({method:'eth_estimateGas',params:[tx]}))*12n+9n)/10n,price=quantity(await provider.request({method:'eth_gasPrice'}));
  if(gas<=0n||gas>2_000_000n||price<=0n||gas*price>500_000_000_000_000_000n)throw Error('claim_gas_limit');
  const balance=quantity(await provider.request({method:'eth_getBalance',params:[address,'pending']}));
  await check();if(balance<gas*price)throw Error('claim_insufficient_balance');
  const hash=await provider.request({method:'eth_sendTransaction',params:[{...tx,gas:`0x${gas.toString(16)}`,gasPrice:`0x${price.toString(16)}`}]});
  if(typeof hash!=='string'||!/^0x[0-9a-f]{64}$/i.test(hash))throw Error('transaction_unknown');return hash.toLowerCase();
 }finally{events.forEach(e=>provider.removeListener(e,change));}
}

function validateClubVersion(v:ClubDirectClaimV5){
 if(v.protocolVersion===6){
  if(!v.phase||!v.chainState||v.clubClaim===undefined||v.registrationReceipt===undefined
   ||v.phase==='register'&&v.clubClaim!==null)throw Error('invalid_direct_club_claim');
 }else if(v.phase!==undefined||v.chainState!==undefined||v.clubClaim!==undefined||v.registrationReceipt!==undefined)throw Error('invalid_direct_club_claim');
}
export function validateClubClaimV6(input:ClubDirectClaimV5):ClubClaimV6{
 const v=clubDirectClaimSchemaV5.parse(input);validateClubVersion(v);const c=v.clubClaim,tx=v.transaction,state=v.chainState;
 if(v.protocolVersion!==6||v.phase!=='claim'||v.status!=='claimable'||!c||!state||!tx||tx.binding!==null||tx.identityProof!==null
  ||tx.from!==v.safeAddress||tx.to!==v.campaignAddress||tx.data!=='0x'||v.recipient!==v.safeAddress
  ||c.entitlementId!==v.entitlementId||c.recipient!==v.safeAddress||c.amount!==v.amountWei||c.nonce!==state.authorizationNonce
  ||c.registrationNonce!==state.registrationNonce||c.allocationDigest!==state.allocationDigest||c.clubOwnersHash!==state.clubOwnersHash
  ||c.clubOwnersHash!==clubOwnersHashV1(v.owners as Address[])||BigInt(c.expiresAt)<=BigInt(Math.floor(Date.now()/1000))
  ||BigInt(c.issuedAt)>BigInt(Math.floor(Date.now()/1000)))throw Error('invalid_direct_club_claim');
 const claim={...c,pot:c.pot as 0|1,entitlementId:c.entitlementId as Hex,recipient:c.recipient as Address,amount:BigInt(c.amount),nonce:BigInt(c.nonce),issuedAt:BigInt(c.issuedAt),expiresAt:BigInt(c.expiresAt),allocationDigest:c.allocationDigest as Hex,clubOwnersHash:c.clubOwnersHash as Hex,registrationNonce:BigInt(c.registrationNonce)};
 clubClaimMessageV6({chainId:10143,campaign:v.campaignAddress as Address},claim);return claim;
}
