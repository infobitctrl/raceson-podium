import {concatHex,encodeAbiParameters,encodeFunctionData,hashTypedData,keccak256,parseAbi,recoverTypedDataAddress,type Address,type Hex} from 'viem';
import {bytes32,demand,signatureBytes,walletAddress} from './validation.js';
import {walletBindingMessageV1,type WalletBindingV1,type WalletRegistryContextV1} from './sponsor-direct-claims-v5.js';

/** V6 protocol only. Existing V5 plans must never use these signatures. */
export const clubClaimAbiV6=parseAbi([
 'function claimClub(bytes32 entitlementId,uint256 nonce,uint64 issuedAt,uint64 expiresAt,bytes ownerSignatures)',
]);
export const walletRegistryAbiV2=parseAbi([
 'function registrations(bytes32) view returns(address recipient,uint8 beneficiaryKind,uint256 nonce,bytes32 clubOwnersHash)',
 'function registerAndClaim((bytes32 beneficiaryId,address recipient,uint8 beneficiaryKind,uint256 nonce,uint64 issuedAt,uint64 expiresAt,bytes32 clubOwnersHash) b,bytes identityProof,address campaign,bytes32 entitlementId)',
 'event WalletRegistered(bytes32 indexed beneficiaryId,address indexed recipient,uint8 beneficiaryKind,uint256 nonce)',
 'function register((bytes32 beneficiaryId,address recipient,uint8 beneficiaryKind,uint256 nonce,uint64 issuedAt,uint64 expiresAt,bytes32 clubOwnersHash) b,bytes identityProof)',
]);
export type WalletBindingV2=WalletBindingV1&{clubOwnersHash:Hex};
export function clubOwnersHashV1(input:readonly Address[]){
 const owners=input.map(a=>walletAddress(a).toLowerCase() as Address).sort();
 demand(owners.length===3&&new Set(owners).size===3&&owners.every(a=>BigInt(a)>1n),'invalid_club_owners');
 return keccak256(encodeAbiParameters([{type:'address[]'}],[owners]));
}
export function walletBindingMessageV2(context:WalletRegistryContextV1,binding:WalletBindingV2){
 const v1=walletBindingMessageV1(context,binding),clubOwnersHash=bytes32(binding.clubOwnersHash,true);
 demand((binding.beneficiaryKind===1)===(BigInt(clubOwnersHash)!==0n),'invalid_club_owners');
 return {...v1,domain:{...v1.domain,version:'2'},types:{WalletBinding:[...v1.types.WalletBinding,{name:'clubOwnersHash',type:'bytes32'}]},message:{...v1.message,clubOwnersHash}} as const;
}
export function encodeWalletRegistrationV2(context:WalletRegistryContextV1,binding:WalletBindingV2,proof:Hex){
 return encodeFunctionData({abi:walletRegistryAbiV2,functionName:'register',args:[walletBindingMessageV2(context,binding).message,signatureBytes(proof)]});
}
export type ClubClaimContextV6={chainId:10143|31337;campaign:Address};
export type ClubClaimV6={entitlementId:Hex;recipient:Address;amount:bigint;pot:0|1;nonce:bigint;issuedAt:bigint;expiresAt:bigint;allocationDigest:Hex;clubOwnersHash:Hex;registrationNonce:bigint};
export function clubClaimMessageV6(context:ClubClaimContextV6,claim:ClubClaimV6){
 demand(context.chainId===10143||context.chainId===31337,'invalid_club_claim');
 for(const value of [claim.amount,claim.nonce,claim.registrationNonce])demand(typeof value==='bigint'&&value>=0n&&value<2n**256n,'invalid_club_claim');
 demand(claim.amount>0n&&claim.registrationNonce>0n&&(claim.pot===0||claim.pot===1)
  &&typeof claim.issuedAt==='bigint'&&typeof claim.expiresAt==='bigint'&&claim.issuedAt>0n
  &&claim.expiresAt>claim.issuedAt&&claim.expiresAt-claim.issuedAt<=86400n&&claim.expiresAt<2n**64n,'invalid_club_claim');
 const message={...claim,recipient:walletAddress(claim.recipient),entitlementId:bytes32(claim.entitlementId),allocationDigest:bytes32(claim.allocationDigest),clubOwnersHash:bytes32(claim.clubOwnersHash)};
 demand([message.entitlementId,message.allocationDigest,message.clubOwnersHash].every(v=>BigInt(v)!==0n),'invalid_club_claim');
 return {domain:{name:'RacesOnRewardCampaign',version:'7',chainId:context.chainId,verifyingContract:walletAddress(context.campaign)},primaryType:'ReceiveClubReward' as const,
  types:{ReceiveClubReward:[{name:'entitlementId',type:'bytes32'},{name:'recipient',type:'address'},{name:'amount',type:'uint256'},{name:'pot',type:'uint8'},
   {name:'nonce',type:'uint256'},{name:'issuedAt',type:'uint64'},{name:'expiresAt',type:'uint64'},{name:'allocationDigest',type:'bytes32'},
   {name:'clubOwnersHash',type:'bytes32'},{name:'registrationNonce',type:'uint256'}]},message} as const;
}
export async function verifyClubClaimSignaturesV6(context:ClubClaimContextV6,claim:ClubClaimV6,owners:readonly Address[],signatures:readonly Hex[]){
 const typed=clubClaimMessageV6(context,claim);
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
export async function encodeClubClaimV6(context:ClubClaimContextV6,claim:ClubClaimV6,owners:readonly Address[],signatures:readonly Hex[]){
 const proof=await verifyClubClaimSignaturesV6(context,claim,owners,signatures);
 return encodeFunctionData({abi:clubClaimAbiV6,functionName:'claimClub',args:[claim.entitlementId,claim.nonce,claim.issuedAt,claim.expiresAt,proof.signature]});
}

export async function verifyWalletBindingProofV2(context:WalletRegistryContextV1,binding:WalletBindingV2,issuer:Address,proof:Hex){
 const message=walletBindingMessageV2(context,binding);
 demand((await recoverTypedDataAddress({...message,signature:signatureBytes(proof)})).toLowerCase()===walletAddress(issuer).toLowerCase(),'wallet_binding_issuer_mismatch');
 return hashTypedData(message);
}
export function encodeRegisterAndClaimV6(context:WalletRegistryContextV1,binding:WalletBindingV2,proof:Hex,campaign:Address,entitlementId:Hex){
 demand(binding.beneficiaryKind===0,'club_claim_requires_fresh_signatures');
 return encodeFunctionData({abi:walletRegistryAbiV2,functionName:'registerAndClaim',args:[walletBindingMessageV2(context,binding).message,signatureBytes(proof),walletAddress(campaign),bytes32(entitlementId)]});
}
