import {concatHex,encodeAbiParameters,encodeFunctionData,hashTypedData,keccak256,parseAbi,recoverTypedDataAddress,type Address,type Hex} from 'viem';
import {bytes32,demand,signatureBytes,walletAddress} from './validation.js';
import {type WalletBindingV1,type WalletRegistryContextV1} from './sponsor-direct-claims-v5.js';

import {walletBindingMessageV2} from './club-signatures-v6.js';

/** Future V7/V3 only. Never use these domains with deployed V5/V6/V2 plans. */
export const clubClaimAbiV7=parseAbi([
 'function claimClub(bytes32 entitlementId,uint256 nonce,uint64 issuedAt,uint64 expiresAt,bytes ownerSignatures)',
]);
export const walletRegistryAbiV3=parseAbi([
 'function registrations(bytes32) view returns(address recipient,uint8 beneficiaryKind,uint256 nonce,bytes32 clubOwnersHash)',
 'function registerAndClaim((bytes32 beneficiaryId,address recipient,uint8 beneficiaryKind,uint256 nonce,uint64 issuedAt,uint64 expiresAt,bytes32 clubOwnersHash) b,bytes identityProof,address campaign,bytes32 entitlementId)',
 'event WalletRegistered(bytes32 indexed beneficiaryId,address indexed recipient,uint8 beneficiaryKind,uint256 nonce)',
 'function register((bytes32 beneficiaryId,address recipient,uint8 beneficiaryKind,uint256 nonce,uint64 issuedAt,uint64 expiresAt,bytes32 clubOwnersHash) b,bytes identityProof)',
]);
export type WalletBindingV3=WalletBindingV1&{clubOwnersHash:Hex};
export function clubOwnersHashV1(input:readonly Address[]){
 const owners=input.map(a=>walletAddress(a).toLowerCase() as Address).sort();
 demand(owners.length===3&&new Set(owners).size===3&&owners.every(a=>BigInt(a)>1n),'invalid_club_owners');
 return keccak256(encodeAbiParameters([{type:'address[]'}],[owners]));
}
export function walletBindingMessageV3(context:WalletRegistryContextV1,binding:WalletBindingV3){
 const lifetime=binding.beneficiaryKind===1?172800n:86400n;
 demand(typeof binding.issuedAt==='bigint'&&typeof binding.expiresAt==='bigint'&&binding.expiresAt>binding.issuedAt&&binding.expiresAt-binding.issuedAt<=lifetime&&binding.expiresAt<2n**64n,'invalid_wallet_binding');
 // Reuse all V2 address/owner/type checks with a validation-only one-day span.
 const v1=walletBindingMessageV2(context,{...binding,expiresAt:binding.issuedAt+1n}),clubOwnersHash=bytes32(binding.clubOwnersHash,true);
 demand((binding.beneficiaryKind===1)===(BigInt(clubOwnersHash)!==0n),'invalid_club_owners');
 return {...v1,domain:{...v1.domain,version:'3'},types:v1.types,message:{...v1.message,expiresAt:binding.expiresAt,clubOwnersHash}} as const;
}
export function encodeWalletRegistrationV3(context:WalletRegistryContextV1,binding:WalletBindingV3,proof:Hex){
 return encodeFunctionData({abi:walletRegistryAbiV3,functionName:'register',args:[walletBindingMessageV3(context,binding).message,signatureBytes(proof)]});
}
export type ClubClaimContextV7={chainId:10143|31337;campaign:Address};
export type ClubClaimV7={entitlementId:Hex;recipient:Address;amount:bigint;pot:0|1;nonce:bigint;issuedAt:bigint;expiresAt:bigint;allocationDigest:Hex;clubOwnersHash:Hex;registrationNonce:bigint};
export function clubClaimMessageV7(context:ClubClaimContextV7,claim:ClubClaimV7){
 demand(context.chainId===10143||context.chainId===31337,'invalid_club_claim');
 for(const value of [claim.amount,claim.nonce,claim.registrationNonce])demand(typeof value==='bigint'&&value>=0n&&value<2n**256n,'invalid_club_claim');
 demand(claim.amount>0n&&claim.registrationNonce>0n&&(claim.pot===0||claim.pot===1)
  &&typeof claim.issuedAt==='bigint'&&typeof claim.expiresAt==='bigint'&&claim.issuedAt>0n
  &&claim.expiresAt>claim.issuedAt&&claim.expiresAt-claim.issuedAt<=172800n&&claim.expiresAt<2n**64n,'invalid_club_claim');
 const message={...claim,recipient:walletAddress(claim.recipient),entitlementId:bytes32(claim.entitlementId),allocationDigest:bytes32(claim.allocationDigest),clubOwnersHash:bytes32(claim.clubOwnersHash)};
 demand([message.entitlementId,message.allocationDigest,message.clubOwnersHash].every(v=>BigInt(v)!==0n),'invalid_club_claim');
 return {domain:{name:'RacesOnRewardCampaign',version:'8',chainId:context.chainId,verifyingContract:walletAddress(context.campaign)},primaryType:'ReceiveClubReward' as const,
  types:{ReceiveClubReward:[{name:'entitlementId',type:'bytes32'},{name:'recipient',type:'address'},{name:'amount',type:'uint256'},{name:'pot',type:'uint8'},
   {name:'nonce',type:'uint256'},{name:'issuedAt',type:'uint64'},{name:'expiresAt',type:'uint64'},{name:'allocationDigest',type:'bytes32'},
   {name:'clubOwnersHash',type:'bytes32'},{name:'registrationNonce',type:'uint256'}]},message} as const;
}
export async function verifyClubClaimSignaturesV7(context:ClubClaimContextV7,claim:ClubClaimV7,owners:readonly Address[],signatures:readonly Hex[]){
 const typed=clubClaimMessageV7(context,claim);
 demand(clubOwnersHashV1(owners)===typed.message.clubOwnersHash&&signatures.length===2,'reward_club_two_signatures_required');
 const proofs=await Promise.all(signatures.map(async signature=>{
  demand(/^0x[0-9a-fA-F]{130}$/.test(signature)&&[27,28].includes(Number.parseInt(signature.slice(-2),16)),'reward_club_consent_invalid');
  // OpenZeppelin rejects high-s signatures; mirror that restriction before prompting submission.
  demand(BigInt('0x'+signature.slice(66,130))<=0x7fffffffffffffffffffffffffffffff5d576e7357a4501ddfe92f46681b20a0n,'reward_club_consent_invalid');
  const signer=(await recoverTypedDataAddress({...typed,signature})).toLowerCase() as Address;
  demand(owners.some(a=>a.toLowerCase()===signer),'reward_club_consent_invalid');return {signer,signature};
 }));
 demand(proofs[0]!.signer!==proofs[1]!.signer,'reward_club_two_signatures_required');proofs.sort((a,b)=>a.signer.localeCompare(b.signer));
 return {digest:hashTypedData(typed),signers:proofs.map(p=>p.signer),signature:concatHex(proofs.map(p=>p.signature))};
}
/** Verifies both proofs before encoding. On-chain state/time checks are still authoritative. */
export async function encodeClubClaimV7(context:ClubClaimContextV7,claim:ClubClaimV7,owners:readonly Address[],signatures:readonly Hex[]){
 const proof=await verifyClubClaimSignaturesV7(context,claim,owners,signatures);
 return encodeFunctionData({abi:clubClaimAbiV7,functionName:'claimClub',args:[claim.entitlementId,claim.nonce,claim.issuedAt,claim.expiresAt,proof.signature]});
}

export async function verifyWalletBindingProofV3(context:WalletRegistryContextV1,binding:WalletBindingV3,issuer:Address,proof:Hex){
 const message=walletBindingMessageV3(context,binding);
 demand((await recoverTypedDataAddress({...message,signature:signatureBytes(proof)})).toLowerCase()===walletAddress(issuer).toLowerCase(),'wallet_binding_issuer_mismatch');
 return hashTypedData(message);
}
export function encodeRegisterAndClaimV7(context:WalletRegistryContextV1,binding:WalletBindingV3,proof:Hex,campaign:Address,entitlementId:Hex){
 demand(binding.beneficiaryKind===0,'club_claim_requires_fresh_signatures');
 return encodeFunctionData({abi:walletRegistryAbiV3,functionName:'registerAndClaim',args:[walletBindingMessageV3(context,binding).message,signatureBytes(proof),walletAddress(campaign),bytes32(entitlementId)]});
}
