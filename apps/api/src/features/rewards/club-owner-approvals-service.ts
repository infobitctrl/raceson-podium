import {isDeepStrictEqual} from 'node:util';
import {recoverTypedDataAddress,type Address,type Hex} from 'viem';
import {clubOwnerApproval,type ClubOwnerRequest,type RewardAccountIdentity} from '@raceson/db/rewards';
import {clubClaimMessageV6,type ClubClaimV6} from '@raceson/rewards-chain/club-signatures-v6';
import {directSafeMessageV5} from '@raceson/rewards-chain/sponsor-club-direct-v5';
import {buildClubDirectClaimV5,type ClubDirectClaimCommandV5} from './club-direct-claims-v5-service.js';
type View=Awaited<ReturnType<typeof buildClubDirectClaimV5>>;
type Deps=Parameters<typeof buildClubDirectClaimV5>[5];
export type ClubOwnerCommand=ClubDirectClaimCommandV5|{action:'sign';requestId:string;signature:Hex}|{action:'submitted';requestId:string;hash:Hex};
const conflict=()=>{throw Error('reward_sponsor_claim_conflict');};
const fields=['creationId','clubId','approvalId','entitlementId','chainId','amountWei','campaignAddress','registryAddress','identityIssuer','beneficiaryId','safeAddress','owners','safeNonce','recipient','deadline','protocolVersion','phase','chainState'] as const;
export function currentClubOwnerRequest(request:ClubOwnerRequest,current:View,now=Date.now()){
 return current.status==='claimable'&&Date.parse(request.expiresAt)>now+5000&&!!request.body.transaction
  &&fields.every(k=>isDeepStrictEqual(request.body[k],current[k]));
}
/** Only server-produced, stored message bodies reach this function. No browser
 * supplied transaction, owner set or digest is accepted by the route. */
export async function recoverClubOwnerSignature(body:Record<string,unknown>,signature:Hex){
 if(!/^0x[0-9a-fA-F]{130}$/.test(signature)||![27,28].includes(parseInt(signature.slice(-2),16))||
  BigInt('0x'+signature.slice(66,130))>0x7fffffffffffffffffffffffffffffff5d576e7357a4501ddfe92f46681b20a0n)throw Error('reward_club_consent_invalid');
 const view=body as unknown as View;
 if(view.protocolVersion===6&&view.phase==='claim'){
  const c=view.clubClaim;if(!c)throw Error('reward_club_consent_invalid');
  const claim:ClubClaimV6={...c,amount:BigInt(c.amount),nonce:BigInt(c.nonce),issuedAt:BigInt(c.issuedAt),expiresAt:BigInt(c.expiresAt),registrationNonce:BigInt(c.registrationNonce)};
  return (await recoverTypedDataAddress({...clubClaimMessageV6({chainId:10143,campaign:view.campaignAddress as Address},claim),signature})).toLowerCase();
 }
 const tx=view.transaction;if(!tx)throw Error('reward_club_consent_invalid');
 return (await recoverTypedDataAddress({...directSafeMessageV5({chainId:10143,safe:view.safeAddress as Address,to:tx.to as Address,data:tx.data,nonce:BigInt(view.safeNonce)}),signature})).toLowerCase();
}
export async function clubDirectClaimV5(actor:RewardAccountIdentity,approvalId:string,entitlementId:string,creationId:string,command:ClubOwnerCommand|undefined,deps:Deps){
 return coordinateClubOwnerApproval(actor,{approvalId,entitlementId,creationId},command,{rpc:deps.rpc,build:change=>buildClubDirectClaimV5(actor,approvalId,entitlementId,creationId,change,deps)});
}
export async function coordinateClubOwnerApproval(actor:RewardAccountIdentity,scope:{approvalId:string;entitlementId:string;creationId:string},command:ClubOwnerCommand|undefined,deps:{rpc:Deps['rpc'];build:(command?:ClubDirectClaimCommandV5)=>Promise<View>}){
 const read=()=>deps.build();
 let [current,saved]=await Promise.all([read(),clubOwnerApproval(actor,scope,deps.rpc)]);
 if(command?.action==='prepare'){
  if(!saved.signerAddress)throw Error('reward_club_owner_required');
  // Rejoining a valid request never replaces another owner's signature.
  if(!saved.request||!currentClubOwnerRequest(saved.request,current)){
   const prepared=await deps.build(command);
   const expiry=prepared.clubClaim?.expiresAt??prepared.transaction?.binding?.expiresAt;
   // Legacy V5 Safe calls have no signed expiry; coordination expires after 9m.
   const expiresAt=new Date(expiry?Number(expiry)*1000:Date.now()+540000).toISOString();
   saved=await clubOwnerApproval(actor,scope,deps.rpc,'prepare',{previousId:saved.request?.requestId??null,body:prepared,expiresAt});
   current=await read();
  }
 }else if(command?.action==='sign'||command?.action==='submitted'){
  if(!saved.signerAddress)throw Error('reward_club_owner_required');
  const request=saved.request;
  if(!request||request.requestId!==command.requestId||!currentClubOwnerRequest(request,current))return conflict();
  if(command.action==='sign'){
   const address=await recoverClubOwnerSignature(request.body,command.signature);
   if(address!==saved.signerAddress||!current.owners.includes(address))throw Error('reward_club_consent_invalid');
   if(!currentClubOwnerRequest(request,await read()))return conflict();
   saved=await clubOwnerApproval(actor,scope,deps.rpc,'sign',{requestId:command.requestId,address,signature:command.signature});
  }else{
   if(request.signatures.length<2)return conflict();
   saved=await clubOwnerApproval(actor,scope,deps.rpc,'submitted',{requestId:command.requestId,hash:command.hash});
  }
 }else if(command){
  current=await deps.build(command);
 }
 const request=saved.request;
 const usable=request&&currentClubOwnerRequest(request,current);
 return {...current,...(usable?{transaction:request.body.transaction as View['transaction'],...(current.protocolVersion===6?{clubClaim:request.body.clubClaim as View['clubClaim']}:{})}:{}),
  ownerApproval:{signerAddress:saved.signerAddress,requestId:usable?request.requestId:null,expiresAt:usable?request.expiresAt:null,
   signatures:usable?request.signatures:[],submissions:request&&request.body.phase===current.phase&&current.status!=='paid'?request.submissions:[]}};
}
