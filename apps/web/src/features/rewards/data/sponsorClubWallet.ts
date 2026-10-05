import {concatHex,recoverTypedDataAddress,type Hex} from "viem";
import {sponsorSafeConsentMessageV4} from "@raceson/rewards-chain/sponsor-claims-v4";
import {canonicalRewardJson} from "@raceson/rewards-chain";
import type {RewardWalletProvider} from "./browserWallet";
import type {SponsorClubClaim} from "./sponsorClubClaims";

export function sponsorClubMessage(view:SponsorClubClaim){
 const v=structuredClone(view),c=v.claim,x=v.context;
 if(!c||!x||x.chainId!==v.chainId||x.environment!==(v.chainId===31337?"local-simulation":"monad-testnet")||c.recipient!==v.address
  ||v.owners.length!==3||new Set(v.owners).size!==3||v.owners.some(a=>!/^0x[0-9a-f]{40}$/.test(a))||v.owners.includes(v.address))throw Error("invalid_claim");
 return sponsorSafeConsentMessageV4({environment:x.environment!,chainId:x.chainId!,verifyingContract:x.verifyingContract as Hex},{...c,pot:c.pot!,entitlementId:c.entitlementId as Hex,recipient:c.recipient as Hex,
  allocationDigest:c.allocationDigest as Hex,amount:BigInt(c.amount),nonce:BigInt(c.nonce),issuedAt:BigInt(c.issuedAt),expiresAt:BigInt(c.expiresAt)});
}
export async function verifySponsorClubOwnerProof(view:SponsorClubClaim,signer:string,signature:unknown){
 const typed=sponsorClubMessage(view),owners=[...view.owners];
 if(!owners.includes(signer)||typeof signature!=="string"||!/^0x[0-9a-f]{128}(1b|1c)$/i.test(signature))throw Error("invalid_club_signature");
 const normalized=signature.toLowerCase() as Hex,s=BigInt(`0x${normalized.slice(66,130)}`);
 if(s<=0n||s>0x7fffffffffffffffffffffffffffffff5d576e7357a4501ddfe92f46681b20a0n)throw Error("invalid_club_signature");
 if((await recoverTypedDataAddress({...typed,signature:normalized})).toLowerCase()!==signer)throw Error("invalid_club_signature");return normalized;
}
export async function combineSponsorClubSignatures(view:SponsorClubClaim,proofs:readonly {signer:string;signature:Hex}[]){
 const fixed=structuredClone(view),rows=proofs.map(p=>({...p})).sort((a,b)=>a.signer.localeCompare(b.signer));
 if(rows.length!==2||rows[0].signer===rows[1].signer)throw Error("club_quorum_required");
 return concatHex(await Promise.all(rows.map(p=>verifySponsorClubOwnerProof(fixed,p.signer,p.signature))));
}
export async function verifySponsorClubSignatures(view:SponsorClubClaim,signature:Hex){
 const fixed=structuredClone(view),typed=sponsorClubMessage(fixed);
 if(!/^0x[0-9a-f]{260}$/.test(signature))throw Error("club_quorum_required");
 const proofs=await Promise.all([signature.slice(2,132),signature.slice(132)].map(async part=>{const signature=`0x${part}` as Hex;
  return {signature,signer:(await recoverTypedDataAddress({...typed,signature})).toLowerCase()};}));
 if(await combineSponsorClubSignatures(fixed,proofs)!==signature)throw Error("invalid_club_signature");
}
/** A single explicit owner signature. Never submits consent or sends tokens. */
export async function signSponsorClubConsent(provider:RewardWalletProvider,view:SponsorClubClaim,signer:string,current:()=>boolean){
 const v=structuredClone(view),typed=sponsorClubMessage(v);
 if(v.role!=="recipient"||!v.current||v.status!=="awaiting_consent"||!v.owners.includes(signer)||canonicalRewardJson(typed)!==canonicalRewardJson(v.signing))throw Error("invalid_claim");
 let changed=false;const changedWallet=()=>{changed=true;},events=["accountsChanged","chainChanged","disconnect"];
 const active=()=>{if(changed||!current())throw Error("wallet_changed");};
 const check=async()=>{active();const a=await provider.request({method:"eth_accounts"}),c=await provider.request({method:"eth_chainId"});active();
  if(!Array.isArray(a)||typeof a[0]!=="string"||a[0].toLowerCase()!==signer||typeof c!=="string"||!/^0x[0-9a-f]+$/i.test(c)||BigInt(c)!==BigInt(v.chainId))throw Error("wallet_changed");};
 events.forEach(e=>provider.on(e,changedWallet));try{
  await check();const json=canonicalRewardJson({...typed,types:{...typed.types,EIP712Domain:[{name:"chainId",type:"uint256"},{name:"verifyingContract",type:"address"}]}});
  const signature=await provider.request({method:"eth_signTypedData_v4",params:[signer,json]});active();await check();
  const proof=await verifySponsorClubOwnerProof(v,signer,signature);active();return proof;
 }finally{events.forEach(e=>provider.removeListener(e,changedWallet));}
}
